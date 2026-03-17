"""
services/wazuh_service.py — Legacy Wazuh Polling Collector

IMPORTANT — async concern
──────────────────────────
This class uses `requests` (synchronous) inside an async context.
It is preserved only for compatibility with the existing background task.

All new integrations should use the async connector client instead.

Security guarantees
──────────────────
• No credentials are stored in source code
• All connection settings come from environment variables
• SSL verification is controlled via config.py
"""

from __future__ import annotations

import logging
import requests
import urllib3

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models import EndpointLog

logger = logging.getLogger(__name__)


class WazuhCollector:
    """Legacy synchronous Wazuh polling collector."""

    def __init__(self) -> None:
        self.settings = get_settings()

        # ── Wazuh API (manager)
        self.api_url = self.settings.wazuh_api_url.rstrip("/")
        self.api_auth = (
            self.settings.wazuh_username,
            self.settings.wazuh_password,
        )

        # ── Wazuh Indexer (alerts)
        self.indexer_url = self.settings.wazuh_indexer_url.rstrip("/")
        self.indexer_auth = (
            self.settings.wazuh_indexer_username,
            self.settings.wazuh_indexer_password,
        )

        self.alerts_index = self.settings.wazuh_alerts_index

        self.token: str | None = None

        # ── SSL handling
        if self.settings.wazuh_verify_ssl:
            self.api_verify = self.settings.wazuh_ca_bundle or True
        else:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            self.api_verify = False

        if self.settings.wazuh_indexer_verify_ssl:
            self.indexer_verify = self.settings.wazuh_indexer_ca_bundle or True
        else:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            self.indexer_verify = False

    # ─────────────────────────────────────────────
    # Wazuh API Authentication
    # ─────────────────────────────────────────────

    def get_token(self) -> str | None:
        """
        Authenticates with Wazuh Manager API and returns JWT token.
        """
        try:
            response = requests.get(
                f"{self.api_url}/security/user/authenticate",
                auth=self.api_auth,
                verify=self.api_verify,
                timeout=10,
            )

            response.raise_for_status()

            self.token = response.json().get("data", {}).get("token")

            return self.token

        except requests.exceptions.ConnectionError:
            logger.error(
                "[WazuhCollector] Cannot connect to Wazuh API at %s",
                self.api_url,
            )

        except Exception as exc:
            logger.error(
                "[WazuhCollector] API authentication failed: %s",
                exc,
            )

        return None

    # ─────────────────────────────────────────────
    # Alert polling
    # ─────────────────────────────────────────────

    async def sync_alerts(self, db: AsyncSession) -> None:
        """
        Fetches alerts from Wazuh Indexer and stores them in ATLAS database.
        """

        search_url = f"{self.indexer_url}/{self.alerts_index}/_search"

        query = {
            "size": 20,
            "sort": [{"timestamp": {"order": "desc"}}],
            "query": {
                "range": {
                    "rule.level": {"gte": 3}
                }
            },
        }

        try:
            response = requests.post(
                search_url,
                auth=self.indexer_auth,
                json=query,
                verify=self.indexer_verify,
                timeout=10,
            )

            response.raise_for_status()

            payload = response.json()

            alerts = [
                hit["_source"]
                for hit in payload.get("hits", {}).get("hits", [])
            ]

        except Exception as exc:
            logger.error(
                "[WazuhCollector] Failed to fetch alerts from Indexer: %s",
                exc,
            )
            return

        new_records = 0

        for alert in alerts:
            timestamp = alert.get("timestamp")

            if not timestamp:
                continue

            stmt = (
                select(EndpointLog)
                .where(EndpointLog.timestamp == timestamp)
                .limit(1)
            )

            result = await db.execute(stmt)

            if result.scalar_one_or_none():
                continue

            agent_data = alert.get("agent", {})
            rule_data = alert.get("rule", {})

            new_log = EndpointLog(
                env="cloud",
                workstation_id=agent_data.get("name", "unknown-host"),
                employee="system",
                alert_message=rule_data.get(
                    "description",
                    "Wazuh Security Alert",
                ),
                alert_category=(rule_data.get("groups") or ["security"])[0],
                severity=self._map_wazuh_level(rule_data.get("level", 0)),
                os_name=agent_data.get("os", {}).get("name", "Managed Agent"),
                is_malware=rule_data.get("level", 0) >= 10,
                is_offline=False,
                timestamp=timestamp,
                raw_payload=alert,
            )

            db.add(new_log)

            new_records += 1

        if new_records:
            await db.commit()

            logger.info(
                "[WazuhCollector] Synced %d new alerts from Wazuh Indexer",
                new_records,
            )

    # ─────────────────────────────────────────────
    # Severity mapping
    # ─────────────────────────────────────────────

    @staticmethod
    def _map_wazuh_level(level: int) -> str:
        """
        Converts Wazuh rule level (0-15) to ATLAS severity scale.
        """

        if level >= 12:
            return "Critical"

        if level >= 7:
            return "High"

        if level >= 4:
            return "Medium"

        return "Low"