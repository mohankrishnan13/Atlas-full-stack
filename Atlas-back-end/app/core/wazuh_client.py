"""
core/wazuh_client.py — Wazuh Active Response Client (WazuhActions)

Used by routes_actions.py to trigger real mitigations against Wazuh agents
(e.g. host-deny, firewall-drop, restart-wazuh).

Security changes
────────────────
• Removed ALL hardcoded constructor defaults (host, user, pw).
• Constructor now reads exclusively from Settings (core/config.py), which in
  turn reads from environment variables — no secret ever lives in source code.
• wazuh_verify_ssl / wazuh_ca_bundle settings are honoured so SSL verification
  can be enabled once a proper CA bundle is available in production.

Production note
───────────────
  Set WAZUH_VERIFY_SSL=true and WAZUH_CA_BUNDLE=/etc/wazuh-certs/ca.pem in
  your .env to enable certificate validation and eliminate the urllib3 warning.
"""

import logging

import requests
import urllib3

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class WazuhActions:
    """
    Thin synchronous wrapper around the Wazuh Active Response REST endpoint.

    All connection details are sourced from the application Settings object —
    never from constructor arguments — so there is no risk of a caller
    accidentally supplying a hardcoded credential.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self.base_url: str = settings.wazuh_api_url.rstrip("/")
        self._auth: tuple[str, str] = (settings.wazuh_username, settings.wazuh_password)

        # SSL verification: use the CA bundle path when verify_ssl is True,
        # otherwise disable verification (acceptable for self-signed lab certs).
        if settings.wazuh_verify_ssl:
            self._verify: str | bool = settings.wazuh_ca_bundle or True
        else:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            self._verify = False

    def run_command(self, agent_id: str, command: str) -> bool:
        """
        Executes a Wazuh Active Response command against *agent_id*.

        Common commands:
          host-deny        — block a source IP for N seconds (e.g. host-deny600)
          firewall-drop    — add a DROP rule to iptables
          restart-wazuh    — restart the agent process

        Returns True on HTTP 200, False on any error.
        """
        endpoint = f"{self.base_url}/active-response/{agent_id}"
        try:
            response = requests.put(
                endpoint,
                auth=self._auth,
                json={"command": command, "alert": {"rule": {"level": 15}}},
                verify=self._verify,
                timeout=5,
            )
            if response.status_code != 200:
                logger.warning(
                    f"[WazuhActions] run_command '{command}' on agent {agent_id} "
                    f"returned HTTP {response.status_code}: {response.text[:200]}"
                )
            return response.status_code == 200
        except requests.exceptions.ConnectionError:
            logger.error(
                f"[WazuhActions] Cannot connect to Wazuh Manager at {self.base_url}. "
                "Check WAZUH_API_URL and network connectivity."
            )
        except requests.exceptions.Timeout:
            logger.error(
                f"[WazuhActions] Timed out waiting for Wazuh Manager at {self.base_url}."
            )
        except Exception as exc:
            logger.error(f"[WazuhActions] Unexpected error running command '{command}': {exc}")
        return False
