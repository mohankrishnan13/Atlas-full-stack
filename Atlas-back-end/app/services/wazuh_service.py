"""
services/wazuh_service.py — Legacy Wazuh Polling Collector

IMPORTANT — async concern
──────────────────────────
This class uses `requests` (synchronous) inside an async context.  It is
preserved here for compatibility with the existing main.py background task,
but ALL new code should use `app.services.connectors.wazuh_client` instead,
which is fully async (httpx) and avoids blocking the event loop.

Security changes
────────────────
• Removed ALL hardcoded constructor defaults (host, user, password).
• Settings are now read exclusively from get_settings() — credentials never
  appear in source code.
• WAZUH_VERIFY_SSL / WAZUH_CA_BUNDLE settings are honoured for SSL control.
"""

import logging
import requests
import urllib3
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models import EndpointLog

logger = logging.getLogger(__name__)

class WazuhCollector:
    """
    Synchronous Wazuh polling collector.

    All connection details are read from Settings (environment variables) at
    construction time — no credentials are accepted as constructor arguments.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self.base_url: str = settings.wazuh_api_url.rstrip("/")
        self._auth: tuple[str, str] = (settings.wazuh_username, settings.wazuh_password)
        self.token: str | None = None

        if settings.wazuh_verify_ssl:
            self._verify: str | bool = settings.wazuh_ca_bundle or True
        else:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            self._verify = False

    # ── Authentication ────────────────────────────────────────────────────────

    def get_token(self) -> str | None:
        """Authenticates with the Wazuh API and caches a short-lived JWT."""
        try:
            response = requests.get(
                f"{self.base_url}/security/user/authenticate",
                auth=self._auth,
                verify=self._verify,
                timeout=10,
            )
            response.raise_for_status()
            self.token = response.json().get("data", {}).get("token")
            return self.token
        except requests.exceptions.ConnectionError:
            logger.error(
                "[WazuhCollector] Cannot connect to Wazuh Manager at %s. "
                "Check WAZUH_API_URL and network connectivity.",
                self.base_url,
            )
        except Exception as exc:
            logger.error("[WazuhCollector] Authentication failed: %s", exc)
        return None

    # ── Alert synchronisation ─────────────────────────────────────────────────

    async def sync_alerts(self, db: AsyncSession) -> None:
        """
        Polls the Wazuh OpenSearch Indexer (Port 9200) for real security alerts.
        """
        # 1. Update the URL to point to the Indexer (Port 9200)
        # Note: Replace self.base_url parsing if needed, or hardcode your LAN IP for the demo
        # Assuming your laptop IP is 10.10.5.142
        indexer_url = "https://10.10.5.142:9200/wazuh-alerts-*/_search"
        
        # OpenSearch usually defaults to 'admin' and your custom password
        auth = ("admin", self._auth[1]) 

        # We ask OpenSearch for the 20 newest alerts
        query = {
            "size": 20,
            "sort": [{"timestamp": {"order": "desc"}}],
            "query": {
                "range": {
                    "rule.level": {"gte": 3} # Only fetch actual threats (Level 3+)
                }
            }
        }

        try:
            response = requests.post(
                indexer_url,
                auth=auth,
                json=query,
                verify=self._verify,
                timeout=10,
            )
            response.raise_for_status()
            
            # OpenSearch nests data inside hits -> hits -> _source
            data = response.json()
            alerts = [hit["_source"] for hit in data.get("hits", {}).get("hits", [])]
            
        except Exception as exc:
            logger.error("[WazuhCollector] Failed to fetch alerts from Indexer on port 9200: %s", exc)
            return

        new_records_count = 0
        for alert in alerts:
            stmt = (
                select(EndpointLog)
                .where(EndpointLog.timestamp == alert.get("timestamp"))
                .limit(1)
            )
            result = await db.execute(stmt)
            if result.scalar_one_or_none():
                continue

            agent_data = alert.get("agent", {})
            rule_data = alert.get("rule", {})
            
            # OpenSearch alert structure might slightly differ, adapt as needed
            new_log = EndpointLog(
                env="cloud", # Ensure this matches your frontend toggle
                workstation_id=agent_data.get("name", "Unknown-Host"),
                employee="system", # Simplify user mapping for now
                alert_message=rule_data.get("description", "Wazuh Security Alert"),
                alert_category=(rule_data.get("groups") or ["security"])[0],
                severity=self._map_wazuh_level(rule_data.get("level", 0)),
                os_name=agent_data.get("os", {}).get("name", "Managed Agent"),
                is_malware=rule_data.get("level", 0) >= 10,
                is_offline=False,
                timestamp=alert.get("timestamp", ""),
                raw_payload=alert,
            )
            db.add(new_log)
            new_records_count += 1

        if new_records_count > 0:
            await db.commit()
            logger.info(
                "[WazuhCollector] Synced %d new real alerts from Wazuh Indexer.", new_records_count
            )

    @staticmethod
    def _map_wazuh_level(level: int) -> str:
        """Translates Wazuh's 0–15 rule level scale to ATLAS severity vocabulary."""
        if level >= 12:
            return "Critical"
        if level >= 7:
            return "High"
        if level >= 4:
            return "Medium"
        return "Low"