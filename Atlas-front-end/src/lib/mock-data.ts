
import { OverviewData, APIMonitoringData, NetworkTrafficData, EndpointSecurityData, DbMonitoringData, CaseManagementResponse } from './types';

export const mockOverviewData: OverviewData = {
  total_api_calls: 1250000,
  total_network_traffic: 4500,
  total_endpoint_events: 850,
  total_db_queries: 250000,
  api_call_trends: [
    { time: '00:00', calls: 2200 },
    { time: '01:00', calls: 2400 },
    { time: '02:00', calls: 2300 },
    { time: '03:00', calls: 2600 },
    { time: '04:00', calls: 2900 },
    { time: '05:00', calls: 3200 },
    { time: '06:00', calls: 3500 },
  ],
  top_attacked_apps: [
    { app: 'Auth-Svc', attacks: 320 },
    { app: 'Payment-GW', attacks: 250 },
    { app: 'GenAI Service', attacks: 180 },
    { app: 'Flipkart DB', attacks: 120 },
    { app: 'Naukri Portal', attacks: 90 },
  ],
  top_threat_ips: [
    { ip: '185.220.101.45', app: 'Auth-Svc', threat: 'SSH Brute Force' },
    { ip: '103.77.237.12', app: 'Payment-GW', threat: 'SQL Injection' },
    { ip: '45.137.65.132', app: 'GenAI Service', threat: 'Data Exfiltration' },
    { ip: '212.102.40.208', app: 'Flipkart DB', threat: 'DDoS Attempt' },
    { ip: '198.54.130.22', app: 'Naukri Portal', threat: 'Cross-Site Scripting' },
  ]
};

export const mockApiMonitoringData: APIMonitoringData = {
  total_requests: 1200000,
  total_errors: 45000,
  average_latency: 120,
  top_consumers: [
    { app_name: 'Auth-Svc', requests: 450000, cost: 450 },
    { app_name: 'Payment-GW', requests: 300000, cost: 300 },
    { app_name: 'GenAI Service', requests: 200000, cost: 200 },
    { app_name: 'Flipkart DB', requests: 150000, cost: 150 },
    { app_name: 'Naukri Portal', requests: 100000, cost: 100 },
  ],
  top_routes_by_request: [
    { app_name: 'Auth-Svc', path: '/api/v1/login', requests: 250000 },
    { app_name: 'Payment-GW', path: '/api/v1/process', requests: 150000 },
    { app_name: 'GenAI Service', path: '/api/v1/generate', requests: 100000 },
    { app_name: 'Flipkart DB', path: '/api/v1/products', requests: 75000 },
    { app_name: 'Naukri Portal', path: '/api/v1/jobs', requests: 50000 },
  ],
  top_routes_by_latency: [
    { app_name: 'GenAI Service', path: '/api/v1/generate', latency: 550 },
    { app_name: 'Payment-GW', path: '/api/v1/process', latency: 250 },
    { app_name: 'Auth-Svc', path: '/api/v1/login', latency: 150 },
    { app_name: 'Flipkart DB', path: '/api/v1/products', latency: 100 },
    { app_name: 'Naukri Portal', path: '/api/v1/jobs', latency: 80 },
  ],
  cost_trends: [
    { date: '2023-01', cost: 1200 },
    { date: '2023-02', cost: 1300 },
    { date: '2023-03', cost: 1400 },
    { date: '2023-04', cost: 1500 },
    { date: '2023-05', cost: 1600 },
  ],
};

export const mockNetworkTrafficData: NetworkTrafficData = {
  total_traffic_gb: 4500,
  total_anomalies: 75,
  anomaly_trends: [
    { time: '00:00', anomalies: 5 },
    { time: '01:00', anomalies: 7 },
    { time: '02:00', anomalies: 6 },
    { time: '03:00', anomalies: 8 },
    { time: '04:00', anomalies: 10 },
    { time: '05:00', anomalies: 12 },
    { time: '06:00', anomalies: 15 },
  ],
  top_source_ips: [
    { ip: '185.220.101.45', traffic_gb: 500, threat_type: 'SSH Brute Force' },
    { ip: '103.77.237.12', traffic_gb: 400, threat_type: 'SQL Injection' },
    { ip: '45.137.65.132', traffic_gb: 300, threat_type: 'Data Exfiltration via SFTP' },
    { ip: '212.102.40.208', traffic_gb: 200, threat_type: 'DDoS Attempt' },
    { ip: '198.54.130.22', traffic_gb: 100, threat_type: 'Cross-Site Scripting' },
  ],
  top_target_apps: [
    { app: 'Auth-Svc', traffic_gb: 1200, threat_type: 'SSH Brute Force' },
    { app: 'Payment-GW', traffic_gb: 1000, threat_type: 'SQL Injection' },
    { app: 'GenAI Service', traffic_gb: 800, threat_type: 'Data Exfiltration via SFTP' },
    { app: 'Flipkart DB', traffic_gb: 600, threat_type: 'DDoS Attempt' },
    { app: 'Naukri Portal', traffic_gb: 400, threat_type: 'Cross-Site Scripting' },
  ],
};

export const mockEndpointSecurityData: EndpointSecurityData = {
  total_events: 850,
  total_quarantined: 45,
  top_detected_threats: [
    { threat: 'Cryptominer.exe', count: 120, severity: 'High' },
    { threat: 'Adware.Win32.InstallCore', count: 95, severity: 'Medium' },
    { threat: 'Ransomware.WannaCry', count: 60, severity: 'Critical' },
    { threat: 'Trojan.GenericKD.3121337', count: 55, severity: 'High' },
    { threat: 'Backdoor.PowerShell', count: 40, severity: 'High' },
  ],
  events_by_host: [
    { hostname: 'prod-web-01', threat: 'Cryptominer.exe', status: 'Quarantined' },
    { hostname: 'dev-db-03', threat: 'Adware.Win32.InstallCore', status: 'Detected' },
    { hostname: 'qa-app-02', threat: 'Ransomware.WannaCry', status: 'Quarantined' },
    { hostname: 'prod-api-05', threat: 'Trojan.GenericKD.3121337', status: 'Detected' },
    { hostname: 'corp-laptop-112', threat: 'Backdoor.PowerShell', status: 'Detected' },
  ],
  recent_events: [
    { timestamp: '2023-10-27T10:00:00Z', hostname: 'prod-web-01', threat: 'Cryptominer.exe', action: 'Quarantined' },
    { timestamp: '2023-10-27T10:05:00Z', hostname: 'dev-db-03', threat: 'Adware.Win32.InstallCore', action: 'Detected' },
    { timestamp: '2023-10-27T10:10:00Z', hostname: 'qa-app-02', threat: 'Ransomware.WannaCry', action: 'Quarantined' },
    { timestamp: '2023-10-27T10:15:00Z', hostname: 'prod-api-05', threat: 'Trojan.GenericKD.3121337', action: 'Detected' },
    { timestamp: '2023-10-27T10:20:00Z', hostname: 'corp-laptop-112', threat: 'Backdoor.PowerShell', action: 'Detected' },
  ]
};

export const mockDbMonitoringData: DbMonitoringData = {
  total_queries: 250000,
  total_suspicious_queries: 120,
  suspicious_query_trends: [
    { time: '00:00', queries: 10 },
    { time: '01:00', queries: 12 },
    { time: '02:00', queries: 11 },
    { time: '03:00', queries: 14 },
    { time: '04:00', queries: 16 },
    { time: '05:00', queries: 18 },
    { time: '06:00', queries: 20 },
  ],
  top_active_users: [
    { user: 'svc-data-loader', queries: 50000, last_activity: '2023-10-27T10:00:00Z' },
    { user: 'app-user-prod', queries: 45000, last_activity: '2023-10-27T10:05:00Z' },
    { user: 'dev-analyst-01', queries: 30000, last_activity: '2023-10-27T10:10:00Z' },
    { user: 'reporting-engine', queries: 25000, last_activity: '2023-10-27T10:15:00Z' },
    { user: 'admin', queries: 15000, last_activity: '2023-10-27T10:20:00Z' },
  ],
  top_queried_tables: [
    { database: 'Flipkart DB', table: 'orders', queries: 100000 },
    { database: 'Naukri Portal', table: 'job_postings', queries: 80000 },
    { database: 'Auth-Svc', table: 'user_sessions', queries: 40000 },
    { database: 'Payment-GW', table: 'transactions', queries: 20000 },
    { database: 'GenAI Service', table: 'usage_logs', queries: 10000 },
  ]
};

export const mockCaseManagementData: CaseManagementResponse = {
  cases: [
    { id: 'CASE-001', title: 'SSH Brute Force on Auth-Svc', status: 'Open', assignee: 'Analyst 1', created_at: '2023-10-27T10:00:00Z' },
    { id: 'CASE-002', title: 'SQL Injection attempt on Payment-GW', status: 'In Progress', assignee: 'Analyst 2', created_at: '2023-10-27T11:00:00Z' },
    { id: 'CASE-003', title: 'Data Exfiltration via SFTP from GenAI Service', status: 'Closed', assignee: 'Analyst 1', created_at: '2023-10-26T09:00:00Z' },
    { id: 'CASE-004', title: 'DDoS attempt on Flipkart DB', status: 'Open', assignee: 'Analyst 3', created_at: '2023-10-27T12:00:00Z' },
    { id: 'CASE-005', title: 'Cross-Site Scripting on Naukri Portal', status: 'In Progress', assignee: 'Analyst 2', created_at: '2023-10-27T13:00:00Z' },
  ]
};
