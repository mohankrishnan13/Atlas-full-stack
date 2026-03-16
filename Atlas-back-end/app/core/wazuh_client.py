import requests
import urllib3

urllib3.disable_warnings()

class WazuhActions:
    def __init__(self, host="127.0.0.1", user="wazuh-wui", pw="lkt7zI?aDP1eGXqOW10h8fuV69rp0xpz"):
        self.base_url = f"https://{host}:55000"
        self.auth = (user, pw)

    def run_command(self, agent_id: str, command: str):
        """
        Executes a Wazuh Active Response.
        Common commands: 'host-deny', 'firewall-drop', 'restart-wazuh'
        """
        try:
            # Note: Real production would fetch a login token first
            endpoint = f"{self.base_url}/active-response/{agent_id}"
            response = requests.put(
                endpoint, 
                auth=self.auth, 
                json={"command": command, "alert": {"rule": {"level": 15}}}, 
                verify=False,
                timeout=5
            )
            return response.status_code == 200
        except Exception as e:
            print(f"Connection to Wazuh Manager failed: {e}")
            return False