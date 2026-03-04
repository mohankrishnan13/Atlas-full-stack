import { NextResponse } from 'next/server';
import type { Incident } from '@/lib/types';

const CLOUD_DATA: Incident[] = [
    {
        id: "INC-2405-001",
        eventName: "Potential SQL Injection",
        timestamp: "2024-05-21 12:34:56Z",
        severity: "High",
        sourceIp: "185.191.171.12",
        destIp: "34.120.24.11",
        targetApp: "Product-Catalog",
        status: "Active",
        eventDetails: "LOG: timestamp=..., source=api-gateway, path=/v2/products/search, query='q=widget' UNION SELECT user, pass FROM users --', user-agent=sqlmap/1.5.1, response_code=500"
    },
    {
        id: "INC-2405-002",
        eventName: "Credential Stuffing",
        timestamp: "2024-05-21 11:30:00Z",
        severity: "Critical",
        sourceIp: "103.208.220.100",
        destIp: "35.227.100.5",
        targetApp: "Auth-Service",
        status: "Contained",
        eventDetails: "LOG: timestamp=..., source=auth-service, message='1,500 failed login attempts for 250 distinct users from a single IP in 5 minutes. IP has been rate-limited.'"
    },
    {
        id: "INC-2405-003",
        eventName: "Anomalous API Usage",
        timestamp: "2024-05-20 08:00:15Z",
        severity: "Medium",
        sourceIp: "23.95.210.60",
        destIp: "34.135.80.2",
        targetApp: "Shipping-API",
        status: "Active",
        eventDetails: "LOG: timestamp=..., source=rate-limiter, message='API key A*************** has exceeded usage quota by 300%. Normal daily usage is ~1,000 calls, current is 3,500 calls in 2 hours.'"
    },
     {
        id: "INC-2405-004",
        eventName: "Cross-Site Scripting (XSS)",
        timestamp: "2024-05-20 04:20:10Z",
        severity: "Medium",
        sourceIp: "45.133.193.10",
        destIp: "34.120.24.11",
        targetApp: "Reviews-Service",
        status: "Closed",
        eventDetails: "LOG: timestamp=..., source=waf, path=/v1/reviews/submit, body='{\"review\":\"Great product! <script>alert(document.cookie)</script>\"}', action=blocked"
    }
];

const LOCAL_DATA: Incident[] = [
    {
        id: "INC-2405-101",
        eventName: "Malware Propagation",
        timestamp: "2024-05-21 09:15:22Z",
        severity: "Critical",
        sourceIp: "10.10.20.45",
        destIp: "10.10.30.0/24",
        targetApp: "File-Server",
        status: "Active",
        eventDetails: "LOG: source=wazuh, agent=WKSTN-0987, alert='Potential ransomware activity (mass file encryption)', signature=exploit.ransom.wannacry.c, action=quarantined"
    },
    {
        id: "INC-2405-102",
        eventName: "Insider Threat Activity",
        timestamp: "2024-05-21 08:45:00Z",
        severity: "High",
        sourceIp: "10.10.10.112",
        destIp: "10.10.50.5",
        targetApp: "HR-Database",
        status: "Active",
        eventDetails: "LOG: source=db-audit, user=j.smith, query='SELECT ssn, salary FROM employee_salaries', message='Anomalous off-hours access by non-HR personnel.'"
    },
    {
        id: "INC-2405-103",
        eventName: "Internal Port Scanning",
        timestamp: "2024-05-20 14:00:00Z",
        severity: "Medium",
        sourceIp: "10.10.20.88",
        destIp: "10.10.20.0/24",
        targetApp: "N/A",
        status: "Contained",
        eventDetails: "LOG: source=firewall, message='Detected TCP SYN scan from 10.10.20.88 against 255 hosts on subnet 10.10.20.0/24. Ports targeted: 22, 135, 445, 3389. Host has been isolated.'"
    },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_DATA : CLOUD_DATA;
  
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
