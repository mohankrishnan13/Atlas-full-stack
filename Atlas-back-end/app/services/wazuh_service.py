"""
services/wazuh_service.py — Simplified Wazuh Polling Collector
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
    """Simplified synchronous Wazuh polling collector."""

    def __init__(self) -> None:
        settings = get_settings()
        self.indexer_url = settings.wazuh_indexer_url.rstrip("/")
        self.indexer_auth = (settings.wazuh_indexer_username, settings.wazuh_indexer_password)
        self.alerts_index = settings.wazuh_alerts_index

        if not settings.wazuh_indexer_verify_ssl:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            self.indexer_verify = False
        else:
            self.indexer_verify = settings.wazuh_indexer_ca_bundle or True

    async def sync_alerts(self, db: AsyncSession) -> None:
        """
        Fetches alerts from Wazuh Indexer and stores them in ATLAS database.
        """
        search_url = f"{self.indexer_url}/{self.alerts_index}/_search"
        query = {
            "size": 50,
            "sort": [{"timestamp": {"order": "desc"}}],
            "query": {"range": {"rule.level": {"gte": 3}}},
        }

        try:
            response = requests.post(
                search_url,
                auth=self.indexer_auth,
                json=query,
                verify=self.indexer_verify,
                timeout=15,
            )
            response.raise_for_status()
            alerts = [h["_source"] for h in response.json().get("hits", {}).get("hits", [])]
        except requests.RequestException as e:
            logger.error(f"[WazuhCollector] Failed to fetch alerts from Indexer: {e}")
            return

        new_records = 0
        for alert in alerts:
            if not (timestamp := alert.get("timestamp")):
                continue

            exists = (await db.execute(select(EndpointLog).where(EndpointLog.timestamp == timestamp).limit(1))).scalar_one_or_none()
            if exists:
                continue

            agent = alert.get("agent", {})
            rule = alert.get("rule", {})
            db.add(
                EndpointLog(
                    env="cloud",
                    workstation_id=agent.get("name", "unknown-host"),
                    employee="system",
                    alert_message=rule.get("description", "Wazuh Security Alert"),
                    alert_category=(rule.get("groups") or ["security"])[0],
                    severity=self._map_wazuh_level(rule.get("level", 0)),
                    os_name=agent.get("os", {}).get("name", "Managed Agent"),
                    is_malware=rule.get("level", 0) >= 10,
                    is_offline=False,
                    timestamp=timestamp,
                    raw_payload=alert,
                )
            )
            new_records += 1

        if new_records:
            await db.commit()
            logger.info(f"[WazuhCollector] Synced {new_records} new alerts.")

    @staticmethod
    def _map_wazuh_level(level: int) -> str:
        if level >= 12: return "Critical"
        if level >= 7: return "High"
        if level >= 4: return "Medium"
        return "Low"
