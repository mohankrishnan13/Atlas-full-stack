import requests
import urllib3
import logging
from sqlalchemy import select
from app.models.db_models import EndpointLog
from sqlalchemy.ext.asyncio import AsyncSession

# Disable SSL warnings for local self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

class WazuhCollector:
    def __init__(self, host="127.0.0.1", user="wazuh-wui", password="lkt7zI?aDP1eGXqOW10h8fuV69rp0xpz"):
        self.base_url = f"https://{host}:55000"
        self.auth = (user, password)
        self.token = None

    def get_token(self):
        """Authenticates with Wazuh API to get a temporary JWT token."""
        try:
            response = requests.get(
                f"{self.base_url}/security/user/authenticate", 
                auth=self.auth, 
                verify=False,
                timeout=10
            )
            response.raise_for_status()
            self.token = response.json().get('data', {}).get('token')
            return self.token
        except Exception as e:
            logger.error(f"Failed to authenticate with Wazuh: {e}")
            return None

    async def sync_alerts(self, db: AsyncSession):
        """Polls Wazuh for alerts and saves new ones to PostgreSQL."""
        if not self.token:
            if not self.get_token():
                return

        headers = {'Authorization': f'Bearer {self.token}'}
        # We fetch more to ensure we don't miss any during the sleep interval
        params = {'limit': 20, 'sort': '-timestamp'}
        
        try:
            response = requests.get(
                f"{self.base_url}/alerts", 
                headers=headers, 
                params=params, 
                verify=False,
                timeout=10
            )
            response.raise_for_status()
            alerts = response.json().get('data', {}).get('affected_items', [])
        except Exception as e:
            logger.error(f"Error fetching alerts from Wazuh: {e}")
            return

        new_records_count = 0
        for alert in alerts:
            # 1. DEDUPLICATION: Check if this alert ID already exists in our DB
            # We store the Wazuh ID in the raw_payload or a dedicated column if you added one
            # For now, we check the alert_message and timestamp combo as a proxy
            wazuh_id = alert.get('id')
            
            # Simple check to see if we've already ingested this specific alert
            # Adjust the query if you have a specific 'external_id' column
            stmt = select(EndpointLog).where(
                EndpointLog.timestamp == alert.get('timestamp')
            ).limit(1)
            result = await db.execute(stmt)
            if result.scalar_one_or_none():
                continue # Skip if already exists

            # 2. DATA MAPPING: Extracting real laptop details
            agent_data = alert.get('agent', {})
            rule_data = alert.get('rule', {})
            full_data = alert.get('data', {})

            new_log = EndpointLog(
                env="local",
                workstation_id=agent_data.get('name', 'Unknown-Host'),
                employee=full_data.get('dstuser', full_data.get('srcuser', 'system')),
                alert_message=rule_data.get('description', 'Wazuh Security Alert'),
                alert_category=rule_data.get('groups', ['security'])[0],
                severity=self._map_wazuh_level(rule_data.get('level', 0)),
                os_name=agent_data.get('os', {}).get('name', 'Managed Agent'),
                is_malware=rule_data.get('level', 0) >= 10,
                is_offline=False,
                timestamp=alert.get('timestamp', ''),
                raw_payload=alert # Critical: Keep the full JSON for detailed forensics
            )
            
            db.add(new_log)
            new_records_count += 1
        
        if new_records_count > 0:
            await db.commit()
            logger.info(f"Successfully synced {new_records_count} real alerts from Wazuh.")

    def _map_wazuh_level(self, level: int) -> str:
        """Translates Wazuh's 0-15 scale to ATLAS's Low-Critical scale."""
        if level >= 12: return "Critical"
        if level >= 7:  return "High"
        if level >= 4:  return "Medium"
        return "Low"