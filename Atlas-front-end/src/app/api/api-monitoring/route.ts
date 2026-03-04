import { NextResponse } from 'next/server';
import type { ApiMonitoringData } from '@/lib/types';

const CLOUD_DATA: ApiMonitoringData = {
    apiCallsToday: 1_258_345,
    blockedRequests: 12_456,
    avgLatency: 128,
    estimatedCost: 2516.69,
    apiUsageChart: [
        { name: "12am", actual: 2000, predicted: 1800 },
        { name: "3am", actual: 3500, predicted: 3200 },
        { name: "6am", actual: 5000, predicted: 4800 },
        { name: "9am", actual: 12000, predicted: 11000 },
        { name: "12pm", actual: 18000, predicted: 17500 },
        { name: "3pm", actual: 25000, predicted: 24000 },
        { name: "6pm", actual: 22000, predicted: 21000 },
        { name: "9pm", actual: 15000, predicted: 14500 },
    ],
    apiRouting: [
        { id: 1, app: 'Payment-GW', path: '/v1/charge', method: 'POST', cost: 0.0250, trend: 15, action: 'Rate-Limited' },
        { id: 2, app: 'Auth-Svc', path: '/v1/login', method: 'POST', cost: 0.0010, trend: 5, action: 'OK' },
        { id: 3, app: 'Shipping-API', path: '/v1/rates', method: 'GET', cost: 0.0500, trend: -10, action: 'OK' },
        { id: 4, app: 'IP-Intel-API', path: '/v1/check', method: 'GET', cost: 0.0005, trend: 250, action: 'Blocked' },
        { id: 5, app: 'Product-Catalog', path: '/v2/products', method: 'GET', cost: 0.0001, trend: 2, action: 'OK' },
    ]
};

const LOCAL_DATA: ApiMonitoringData = {
    apiCallsToday: 45_678,
    blockedRequests: 1_234,
    avgLatency: 24,
    estimatedCost: 0,
    apiUsageChart: [
        { name: "12am", actual: 100, predicted: 110 },
        { name: "3am", actual: 50, predicted: 60 },
        { name: "6am", actual: 800, predicted: 850 },
        { name: "9am", actual: 4000, predicted: 4100 },
        { name: "12pm", actual: 5000, predicted: 5000 },
        { name: "3pm", actual: 4500, predicted: 4400 },
        { name: "6pm", actual: 2000, predicted: 2100 },
        { name: "9pm", actual: 1500, predicted: 1550 },
    ],
    apiRouting: [
        { id: 1, app: 'Domain-Ctrl', path: '/internal/kerberos/auth', method: 'POST', cost: 0.0000, trend: 5, action: 'OK' },
        { id: 2, app: 'File-Server', path: '/api/shares/read', method: 'GET', cost: 0.0000, trend: -2, action: 'OK' },
        { id: 3, app: 'Intranet-Portal', path: '/_api/web/lists/getbytitle', method: 'GET', cost: 0.0000, trend: 3, action: 'OK' },
        { id: 4, app: 'Scanner-Subnet', path: '/dev/null', method: 'POST', cost: 0.0000, trend: 800, action: 'Blocked' },
        { id: 5, app: 'HR-DB', path: '/rpc/get_all_employees', method: 'POST', cost: 0.0000, trend: 12, action: 'Rate-Limited' },
    ]
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_DATA : CLOUD_DATA;
  
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
