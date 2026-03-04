import { NextResponse } from 'next/server';
import type { DbMonitoringData } from '@/lib/types';

const CLOUD_DATA: DbMonitoringData = {
    activeConnections: 128,
    avgQueryLatency: 45,
    dataExportVolume: 2.3,
    operationsChart: [
        { name: "12am", SELECT: 80000, INSERT: 20000, UPDATE: 15000, DELETE: 5000 },
        { name: "3am", SELECT: 95000, INSERT: 22000, UPDATE: 18000, DELETE: 6000 },
        { name: "6am", SELECT: 110000, INSERT: 25000, UPDATE: 20000, DELETE: 7000 },
        { name: "9am", SELECT: 250000, INSERT: 50000, UPDATE: 40000, DELETE: 15000 },
        { name: "12pm", SELECT: 300000, INSERT: 60000, UPDATE: 50000, DELETE: 20000 },
        { name: "3pm", SELECT: 280000, INSERT: 55000, UPDATE: 45000, DELETE: 18000 },
        { name: "6pm", SELECT: 260000, INSERT: 52000, UPDATE: 42000, DELETE: 16000 },
        { name: "9pm", SELECT: 200000, INSERT: 40000, UPDATE: 30000, DELETE: 10000 },
    ],
    suspiciousActivity: [
        { id: 1, app: 'Analytics-Svc', user: 'prod-user-15', type: 'SELECT', table: 'user_profiles', reason: 'Anomalous data volume' },
        { id: 2, app: 'Billing-Engine', user: 'service-account-billing', type: 'UPDATE', table: 'subscriptions', reason: 'Unusual update frequency' },
        { id: 3, app: 'Auth-Service', user: 'prod-user-88', type: 'SELECT', table: 'auth_tokens', reason: 'Access from new GeoIP' },
        { id: 4, app: 'Data-Warehouse', user: 'etl-script', type: 'DELETE', table: 'events_partition_3', reason: 'Out-of-sequence deletion' },
    ]
};

const LOCAL_DATA: DbMonitoringData = {
    activeConnections: 32,
    avgQueryLatency: 12,
    dataExportVolume: 0.1,
    operationsChart: [
        { name: "12am", SELECT: 500, INSERT: 100, UPDATE: 50, DELETE: 10 },
        { name: "3am", SELECT: 300, INSERT: 50, UPDATE: 20, DELETE: 5 },
        { name: "6am", SELECT: 1000, INSERT: 200, UPDATE: 100, DELETE: 20 },
        { name: "9am", SELECT: 8000, INSERT: 1500, UPDATE: 1000, DELETE: 100 },
        { name: "12pm", SELECT: 9000, INSERT: 2000, UPDATE: 1200, DELETE: 150 },
        { name: "3pm", SELECT: 8500, INSERT: 1800, UPDATE: 1100, DELETE: 120 },
        { name: "6pm", SELECT: 4000, INSERT: 800, UPDATE: 400, DELETE: 50 },
        { name: "9pm", SELECT: 2000, INSERT: 400, UPDATE: 200, DELETE: 30 },
    ],
    suspiciousActivity: [
        { id: 1, app: 'HR-App', user: 'j.smith', type: 'SELECT', table: 'employee_salaries', reason: 'Off-hours access' },
        { id: 2, app: 'Unknown (psql)', user: 'NETWORK SERVICE', type: 'DELETE', table: 'it_assets', reason: 'Mass record deletion' },
        { id: 3, app: 'Backup-Script', user: 'adm.backup', type: 'SELECT *', table: 'ad_users', reason: 'Full table scan outside backup window' },
    ]
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get('env') || 'cloud';

  const data = env === 'local' ? LOCAL_DATA : CLOUD_DATA;
  
  await new Promise(resolve => setTimeout(resolve, 500));

  return NextResponse.json(data);
}
