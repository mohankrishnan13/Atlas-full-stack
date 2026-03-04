import { NextResponse } from 'next/server';
import type { NetworkTrafficData } from '@/lib/types';

const CLOUD_DATA: NetworkTrafficData = {
    bandwidth: 82,
    activeConnections: 45201,
    droppedPackets: 10320,
    networkAnomalies: [
        { id: 1, sourceIp: '1.2.3.4', destIp: '34.120.24.11', app: 'Product-Catalog', port: 443, type: 'DDoS Attempt (SYN Flood)' },
        { id: 2, sourceIp: '10.0.1.12', destIp: '98.76.54.32', app: 'Payment-Service', port: 443, type: 'Anomalous Data Exfiltration' },
        { id: 3, sourceIp: '5.6.7.8', destIp: '35.227.100.5', app: 'Auth-Service', port: 22, type: 'SSH Brute Force' },
        { id: 4, sourceIp: '9.10.11.12', destIp: '34.135.80.2', app: 'Shipping-API', port: 8080, type: 'Unencrypted Traffic to API' },
    ]
};

const LOCAL_DATA: NetworkTrafficData = {
    bandwidth: 45,
    activeConnections: 1250,
    droppedPackets: 150,
    networkAnomalies: [
        { id: 1, sourceIp: '10.10.20.88', destIp: '10.10.20.1-255', app: 'N/A', port: 445, type: 'Internal Port Scan (SMB)' },
        { id: 2, sourceIp: '10.10.10.112', destIp: '10.10.20.88', app: 'File-Server', port: 3389, type: 'Anomalous RDP Session' },
        { id: 3, sourceIp: '10.10.30.5', destIp: '8.8.8.8', app: 'Intranet-Portal', port: 53, type: 'Anomalous DNS Query' },
        { id: 4, sourceIp: '10.10.20.45', destIp: '10.10.30.10', app: 'N/A', port: 4444, type: 'Lateral Movement Detected' },
    ]
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_DATA : CLOUD_DATA;
  
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
