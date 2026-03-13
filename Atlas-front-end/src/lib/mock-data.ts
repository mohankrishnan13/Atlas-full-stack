export const mockHeaderData = {
  applications: [
    { id: "auth-service", name: "Auth Service" },
    { id: "payments-api", name: "Payments API" },
    { id: "network-gateway", name: "Network Gateway" },
    { id: "endpoint-fleet", name: "Endpoint Fleet" }
  ]
};

// Includes both standard backend keys and Figma-specific keys so it works on any UI branch
export const mockOverviewData = {
  apiRequests: 1258345,
  errorRate: 1.2,
  activeAlerts: 3,
  costRisk: 4,
  aiBriefing: "ATLAS AI detected abnormal API consumption on high-cost GenAI services. Failing nodes: Auth-Svc. Recent anomalies: SSH Brute Force.",
  microservices: [
    { id: '1', name: 'Auth-Svc', type: 'Gateway', status: 'Failing', position: { top: 0, left: 0 }, connections: [] },
    { id: '2', name: 'Payment-GW', type: 'Service', status: 'Healthy', position: { top: 0, left: 0 }, connections: [] },
    { id: '3', name: 'GenAI Service', type: 'Service', status: 'Healthy', position: { top: 0, left: 0 }, connections: [] },
    { id: '4', name: 'Flipkart DB', type: 'Database', status: 'Healthy', position: { top: 0, left: 0 }, connections: [] },
  ],
  apiRequestsByApp: [
    { app: 'Auth-Svc', requests: 450000 },
    { app: 'Payment-GW', requests: 320000 },
    { app: 'GenAI Service', requests: 150000 },
    { app: 'Flipkart DB', requests: 90000 },
    { app: 'Naukri Portal', requests: 50000 },
  ],
  appAnomalies: [
    { name: 'Auth-Svc', anomalies: 85 },
    { name: 'Payment-GW', anomalies: 42 },
    { name: 'GenAI Service', anomalies: 27 },
    { name: 'Flipkart DB', anomalies: 12 },
    { name: 'Naukri Portal', anomalies: 5 },
  ],
  systemAnomalies: [
    { id: 'INC-001', service: 'Auth-Svc', type: 'SSH Brute Force', severity: 'Critical', timestamp: '10 mins ago' }
  ]
};

export const mockApiMonitoringData = {
  // Standard Keys
  apiCallsToday: 1258345,
  blockedRequests: 12456,
  avgLatency: 12.5,
  estimatedCost: 314.50,
  apiConsumptionByApp: [
    { app: 'Auth-Svc', actual: 12500, limit: 10000 },
    { app: 'Payment-GW', actual: 8000, limit: 12000 },
    { app: 'GenAI Service', actual: 4500, limit: 4000 },
  ],
  apiRouting: [
    { id: 1, app: 'Auth-Svc', path: '/v1/login', method: 'POST', cost: 0.005, trend: 15, action: 'OK' }
  ],
  // Figma Keys
  totalApiCalls: 1258345,
  blockedThreats: 12456,
  globalAvailability: 99.8,
  activeIncidents: 3,
  apiOveruse: [
    { application_name: 'Auth-Svc', currentRpm: 12500, limitRpm: 10000 },
    { application_name: 'Payment-GW', currentRpm: 8000, limitRpm: 12000 },
  ],
  mostAbusedEndpoints: [
    { endpoint: '/v1/login', violations: 4500, severity: 'critical' },
  ],
  topConsumers: [
    { consumer: '185.220.101.45', application_name: 'Auth-Svc', total_calls: 850000, average_cost: 0.005, is_overuse: true },
  ],
  activeMitigations: [
    { target: 'Auth-Svc', offender: '185.220.101.45', violation_type: 'Rate Limit Exceeded', details: 'Trend +800%', action: 'BLOCK' },
  ]
};

export const mockNetworkTrafficData = {
  bandwidth: 4500,
  activeConnections: 12500,
  droppedPackets: 850,
  networkAnomalies: [
    { id: 1, sourceIp: '185.220.101.45', destIp: '10.0.1.42', app: 'Auth-Svc', port: 443, type: 'SSH Brute Force Attack', severity: 'Critical' },
    { id: 2, sourceIp: '103.77.237.12', destIp: '10.0.2.15', app: 'Payment-GW', port: 8080, type: 'Port Scan Detected', severity: 'High' },
    { id: 3, sourceIp: '45.137.65.132', destIp: '192.168.1.101', app: 'GenAI Service', port: 22, type: 'Data Exfiltration via SFTP', severity: 'Critical' },
    { id: 4, sourceIp: '212.102.40.208', destIp: '172.16.0.55', app: 'Flipkart DB', port: 5432, type: 'Suspicious Outbound Connection', severity: 'Medium' },
  ]
};

export const mockEndpointSecurityData = {
  monitoredLaptops: 1250,
  offlineDevices: 15,
  malwareAlerts: 3,

  osDistribution: [
    { name: 'Windows 11', value: 640, fill: '#3b82f6' },
    { name: 'Windows 10', value: 420, fill: '#60a5fa' },
    { name: 'macOS Sonoma', value: 120, fill: '#a78bfa' },
    { name: 'Ubuntu 22.04', value: 50, fill: '#f97316' },
    { name: 'Other Linux', value: 20, fill: '#10b981' }
  ],

  alertTypes: [
    { name: 'Malware Detection', value: 3, fill: '#ef4444' },
    { name: 'Firewall Policy Violation', value: 8, fill: '#f97316' },
    { name: 'Unauthorized USB Device', value: 6, fill: '#eab308' },
    { name: 'Privilege Escalation Attempt', value: 4, fill: '#dc2626' },
    { name: 'Suspicious Network Activity', value: 9, fill: '#fb923c' }
  ],

  wazuhEvents: [
    {
      id: 'evt-001',
      timestamp: new Date().toISOString(),
      workstationId: 'WKST-2088',
      employee: 'john.doe',
      alert: 'Cryptominer.exe detected running in background',
      severity: 'Critical',
      process: 'cryptominer.exe',
      file_path: 'C:\\Users\\john\\AppData\\Roaming\\cryptominer.exe',
      action_taken: 'Process quarantined'
    },
    {
      id: 'evt-002',
      timestamp: new Date().toISOString(),
      workstationId: 'LAPTOP-DEV-04',
      employee: 'dev.user01',
      alert: 'Firewall policy bypass attempt detected',
      severity: 'High',
      rule: 'allow_all',
      source_ip: '192.168.12.14'
    },
    {
      id: 'evt-003',
      timestamp: new Date().toISOString(),
      workstationId: 'MAC-HR-02',
      employee: 'sarah.smith',
      alert: 'Unauthorized USB storage device connected',
      severity: 'Medium',
      device_vendor: 'SanDisk',
      device_type: 'USB Storage'
    },
    {
      id: 'evt-004',
      timestamp: new Date().toISOString(),
      workstationId: 'WKST-1102',
      employee: 'finance.user',
      alert: 'Multiple failed privilege escalation attempts',
      severity: 'High',
      process: 'sudo',
      attempts: 5
    },
    {
      id: 'evt-005',
      timestamp: new Date().toISOString(),
      workstationId: 'LAPTOP-SALES-09',
      employee: 'sales.exec',
      alert: 'Suspicious outbound traffic detected',
      severity: 'Medium',
      destination_ip: '45.76.122.19',
      port: 4444
    }
  ]
};

export const mockDbMonitoringData = {
  criticalDataExport: { application_name: 'Flipkart DB', bytes_exported: 4500000000 }, 
  connectionPool: { application_name: 'Auth-Svc', utilization_percent: 92, avg_query_latency_ms: 250 },
  authFailures: 450,
  activeConnections: 350,
  avgQueryLatency: 12.5,
  dataExportVolume: 4.5,
  dlpByTargetApp: [
    { app: 'Flipkart DB', application_name: 'Flipkart DB', bytes_exported: 45, count: 45 },
    { app: 'Payment-GW', application_name: 'Payment-GW', bytes_exported: 12, count: 12 },
  ],
  operationsByApp: [
    { app: 'Flipkart DB', app_name: 'Flipkart DB', select_count: 80000, insert_count: 15000, update_count: 5000, delete_count: 1200, SELECT: 80000, INSERT: 15000, UPDATE: 5000, DELETE: 1200 },
  ],
  suspiciousActivity: [
    { id: 1, user: 'dev_temp', application_name: 'Flipkart DB', app: 'Flipkart DB', table: 'orders', type: 'DELETE', reason: 'Bulk DELETE on sensitive table' },
  ]
};

export const mockCaseManagementData = {
  kpis: { criticalOpenCases: 3, mttr: "14m 22s", unassignedEscalations: 5 },
  cases: [
    { caseId: 'INC-9042', id: 'INC-9042', scopeTags: ['Auth-Svc', 'External IP'], aiThreatNarrative: 'External IP brute-forced Auth-Svc.', assigneeName: 'Sarah Smith', assigneeInitials: 'SS', status: 'Open', playbookActions: ['Block External IP'], targetApp: 'Auth-Svc' },
    { caseId: 'INC-9043', id: 'INC-9043', scopeTags: ['Flipkart DB', 'DLP Alert'], aiThreatNarrative: 'Mass data export detected from service account.', assigneeName: 'John Doe', assigneeInitials: 'JD', status: 'Investigating', playbookActions: ['Lock DB User'], targetApp: 'Flipkart DB' },
  ]
};

// --- NEW MOCK DATA ---
export const mockUsersData = [
  {
    id: 1,
    name: 'Sarah Smith',
    email: 'sarah@atlas.local',
    role: 'Admin',
    is_active: true,
    invite_pending: false
  },
  {
    id: 2,
    name: 'John Doe',
    email: 'john@atlas.local',
    role: 'Analyst',
    is_active: true,
    invite_pending: false
  },
  {
    id: 3,
    name: 'Dev Ops',
    email: 'dev@atlas.local',
    role: 'Read-Only',
    is_active: false,
    invite_pending: true
  },
  {
    id: 4,
    name: 'Emily Carter',
    email: 'emily@atlas.local',
    role: 'Analyst',
    is_active: true,
    invite_pending: false
  },
  {
    id: 5,
    name: 'Michael Chen',
    email: 'michael@atlas.local',
    role: 'Read-Only',
    is_active: true,
    invite_pending: false
  }
];

export const mockReportsData = {
  scheduledReports: [
    {
      id: 1,
      title: "Weekly Executive Threat Briefing",
      description: "High-level overview of critical security events and trends",
      schedule: "Weekly (Monday 08:00)",
      active: true,
      configureLabel: "Configure"
    },
    {
      id: 2,
      title: "API Consumption & Cost Analysis",
      description: "Detailed report on API usage, requests, and cost breakdown",
      schedule: "Monthly (1st day)",
      active: true,
      configureLabel: "Configure"
    },
    {
      id: 3,
      title: "Endpoint Security Compliance",
      description: "Endpoint compliance status including patch levels and policy violations",
      schedule: "Weekly (Friday 18:00)",
      active: true,
      configureLabel: "Configure"
    },
    {
      id: 4,
      title: "Network Anomaly Summary",
      description: "Summary of unusual network traffic and threat intelligence matches",
      schedule: "Daily (02:00)",
      active: false,
      configureLabel: "Configure"
    },
    {
      id: 5,
      title: "User Risk Activity Report",
      description: "Identifies high-risk users based on anomalous behavior",
      schedule: "Weekly (Wednesday)",
      active: false,
      configureLabel: "Configure"
    }
  ],

  recentDownloads: [
    {
      id: 1,
      fileName: "Auth-Service_Security_Audit.pdf",
      targetAppScope: "Auth-Service",
      generated: "Today",
      size: "2.4 MB",
      downloadUrl: "/mock-downloads/auth-service-audit.pdf"
    },
    {
      id: 2,
      fileName: "Network_Anomalies_Report.csv",
      targetAppScope: "Global",
      generated: "Yesterday",
      size: "1.8 MB",
      downloadUrl: "/mock-downloads/network-anomalies.csv"
    },
    {
      id: 3,
      fileName: "Endpoint_Compliance_Status.pdf",
      targetAppScope: "Endpoint Fleet",
      generated: "2 days ago",
      size: "3.2 MB",
      downloadUrl: "/mock-downloads/endpoint-compliance.pdf"
    },
    {
      id: 4,
      fileName: "API_Usage_Cost_Report.csv",
      targetAppScope: "API Gateway",
      generated: "3 days ago",
      size: "950 KB",
      downloadUrl: "/mock-downloads/api-usage.csv"
    },
    {
      id: 5,
      fileName: "User_Risk_Activity_Summary.pdf",
      targetAppScope: "Identity Platform",
      generated: "Last week",
      size: "1.5 MB",
      downloadUrl: "/mock-downloads/user-risk.pdf"
    }
  ]
};