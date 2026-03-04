import { NextResponse } from 'next/server';
import type { EndpointSecurityData } from '@/lib/types';
import placeholderData from '@/lib/placeholder-images.json';

const CLOUD_DATA: EndpointSecurityData = {
    monitoredLaptops: 5000,
    offlineDevices: 125,
    malwareAlerts: 12,
    osDistribution: [
        { name: 'Ubuntu 22.04', value: 3500, fill: 'hsl(var(--chart-1))' },
        { name: 'Debian 11', value: 1000, fill: 'hsl(var(--chart-2))' },
        { name: 'RHEL 9', value: 500, fill: 'hsl(var(--chart-3))' },
    ],
    alertTypes: [
        { name: 'SSH Brute Force', value: 8, fill: 'hsl(var(--chart-5))' },
        { name: 'Anomalous outbound', value: 2, fill: 'hsl(var(--chart-2))' },
        { name: 'Rootkit Detected', value: 2, fill: 'hsl(var(--chart-3))' },
    ],
    wazuhEvents: [
        { id: 1, workstationId: 'prod-web-78', employee: 'N/A (Server)', avatar: '', alert: 'SSH brute force attempt', severity: 'Critical' },
        { id: 2, workstationId: 'prod-db-12', employee: 'N/A (Server)', avatar: '', alert: 'Anomalous outbound traffic to known C2', severity: 'Critical' },
        { id: 3, workstationId: 'prod-worker-4', employee: 'N/A (Server)', avatar: '', alert: 'Rootkit [Diamorphine] detected', severity: 'High' },
    ]
};

const LOCAL_DATA: EndpointSecurityData = {
    monitoredLaptops: 1500,
    offlineDevices: 23,
    malwareAlerts: 4,
    osDistribution: [
        { name: 'Windows 11', value: 1200, fill: 'hsl(var(--chart-1))' },
        { name: 'MacOS (Sonoma)', value: 250, fill: 'hsl(var(--chart-2))' },
        { name: 'Windows 10', value: 50, fill: 'hsl(var(--chart-3))' },
    ],
    alertTypes: [
        { name: 'Malware', value: 4, fill: 'hsl(var(--chart-5))' },
        { name: 'Policy Violation', value: 18, fill: 'hsl(var(--chart-2))' },
        { name: 'Anomalous Activity', value: 9, fill: 'hsl(var(--chart-3))' },
    ],
    wazuhEvents: [
        { id: 1, workstationId: 'WKSTN-1045', employee: 'John Smith', avatar: placeholderData.placeholderImages[1].imageUrl, alert: 'Unauthorized USB device detected', severity: 'Medium' },
        { id: 2, workstationId: 'WKSTN-0987', employee: 'Emily Jones', avatar: placeholderData.placeholderImages[2].imageUrl, alert: 'Potential ransomware activity (mass file encryption)', severity: 'Critical' },
        { id: 3, workstationId: 'WKSTN-0112', employee: 'Michael Brown', avatar: placeholderData.placeholderImages[3].imageUrl, alert: 'Installation of unapproved software (torrent client)', severity: 'Low' },
        { id: 4, workstationId: 'WKSTN-0765', employee: 'Sarah Miller', avatar: placeholderData.placeholderImages[4].imageUrl, alert: 'Multiple failed login attempts', severity: 'High' },
    ]
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_DATA : CLOUD_DATA;
  
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
