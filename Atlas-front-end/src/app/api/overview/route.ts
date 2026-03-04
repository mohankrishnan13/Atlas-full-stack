import { NextResponse } from 'next/server';
import type { OverviewData } from '@/lib/types';

const CLOUD_DATA: OverviewData = {
    apiRequests: 1_258_345,
    errorRate: 1.2,
    activeAlerts: 3,
    costRisk: 7,
    appAnomalies: [
        { name: "Payments", anomalies: 12 },
        { name: "Auth", anomalies: 5 },
        { name: "Shipping", anomalies: 8 },
        { name: "Catalog", anomalies: 2 },
        { name: "Reviews", anomalies: 1 },
    ],
    microservices: [
        { id: "auth", name: "Auth-Service", status: 'Healthy', position: { top: '50%', left: '15%' }, connections: ['pg', 'cat'] },
        { id: "pg", name: "Payment-Gateway", status: 'Failing', position: { top: '20%', left: '40%' }, connections: ['ship'] },
        { id: "cat", name: "Product-Catalog", status: 'Healthy', position: { top: '80%', left: '40%' }, connections: ['rev'] },
        { id: "ship", name: "Shipping-API", status: 'Healthy', position: { top: '20%', left: '70%' }, connections: [] },
        { id: "rev", name: "Reviews-Service", status: 'Healthy', position: { top: '80%', left: '70%' }, connections: [] },
        { id: "ext", name: "3rd-Party-FX", status: 'Healthy', position: { top: '50%', left: '90%' }, connections: [] }
    ],
    failingEndpoints: {
        'pg': '/v1/process-card'
    },
    apiRequestsChart: [
        { name: "12am", requests: 2000 }, { name: "3am", requests: 3500 },
        { name: "6am", requests: 5000 }, { name: "9am", requests: 12000 },
        { name: "12pm", requests: 18000 }, { name: "3pm", requests: 25000 },
        { name: "6pm", requests: 22000 }, { name: "9pm", requests: 15000 },
    ],
    systemAnomalies: [
        { id: 'sa-1', service: 'Payment-Gateway', type: '5xx Error Spike', severity: 'Critical', timestamp: '2024-05-21 10:45:11Z' },
        { id: 'sa-2', service: 'Shipping-API', type: 'High Latency', severity: 'High', timestamp: '2024-05-21 10:42:01Z' },
        { id: 'sa-3', service: 'Auth-Service', type: 'Unusual Login Pattern', severity: 'Medium', timestamp: '2024-05-21 10:30:55Z' },
        { id: 'sa-4', service: 'Product-Catalog', type: 'Cache-Miss Rate Increase', severity: 'Low', timestamp: '2024-05-21 10:15:23Z' },
    ]
};

const LOCAL_DATA: OverviewData = {
    apiRequests: 45_678,
    errorRate: 0.3,
    activeAlerts: 2,
    costRisk: 1,
    appAnomalies: [
        { name: "File-Server", anomalies: 9 },
        { name: "Intranet", anomalies: 4 },
        { name: "HR-DB", anomalies: 2 },
        { name: "Printer", anomalies: 1 },
    ],
    microservices: [
        { id: "firewall", name: "Office-Firewall", status: 'Healthy', position: { top: '50%', left: '15%' }, connections: ['hr', 'files'] },
        { id: "hr", name: "HR-Subnet", status: 'Failing', position: { top: '20%', left: '50%' }, connections: ['laptops'] },
        { id: "files", name: "File-Server", status: 'Healthy', position: { top: '80%', left: '50%' }, connections: ['laptops'] },
        { id: "laptops", name: "Employee-Laptops", status: 'Healthy', position: { top: '50%', left: '85%' }, connections: [] },
    ],
    failingEndpoints: {
        'hr': 'Port 3389 (RDP)'
    },
    apiRequestsChart: [
        { name: "12am", requests: 100 }, { name: "3am", requests: 50 },
        { name: "6am", requests: 800 }, { name: "9am", requests: 4000 },
        { name: "12pm", requests: 5000 }, { name: "3pm", requests: 4500 },
        { name: "6pm", requests: 2000 }, { name: "9pm", requests: 1500 },
    ],
    systemAnomalies: [
        { id: 'la-1', service: 'HR-Subnet', type: 'Internal Port Scan', severity: 'Critical', timestamp: '2024-05-21 11:12:44Z' },
        { id: 'la-2', service: 'WKSTN-1045', type: 'Excessive Login Failures', severity: 'High', timestamp: '2024-05-21 11:05:19Z' },
        { id: 'la-3', service: 'File-Server', type: 'Anomalous File Access', severity: 'Medium', timestamp: '2024-05-21 10:55:02Z' },
    ]
};


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_DATA : CLOUD_DATA;
  
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
