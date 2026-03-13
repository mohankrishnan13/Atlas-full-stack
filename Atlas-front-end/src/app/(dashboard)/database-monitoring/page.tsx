'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Database, ShieldAlert, Lock, Ban,
  Activity, WifiOff, Terminal, LoaderCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { DbMonitoringData, SuspiciousActivity } from '@/lib/types';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 p-3 rounded shadow-lg">
      <p className="text-slate-200 font-semibold mb-1 text-sm">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-xs text-slate-400">
          {entry.name}: <span className="text-slate-100 font-mono">{(Number(entry.value) || 0).toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-slate-800 rounded-lg" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 bg-slate-800 rounded-lg" />
        <div className="h-80 bg-slate-800 rounded-lg" />
      </div>
      <div className="h-96 bg-slate-800 rounded-lg" />
    </div>
  );
}

export default function DatabaseMonitoringPage() {
  const [data, setData] = useState<DbMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const fetchData = () => {
    setLoading(true);
    apiGet<DbMonitoringData>(`/db-monitoring`).then(setData).catch((err) => {
        toast.error('Failed to load database telemetry.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }).finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleKillQuery = async (activityId: number, app: string, user: string) => {
    try {
      await apiPost('/db-monitoring/kill-query', { activity_id: activityId, app_name: app, user_name: user });
      toast.success('Query Killed', { description: `Activity ${activityId} on ${app} has been terminated.` });
      fetchData(); // Refresh data after action
    } catch (err) {
      toast.error('Kill Query Failed', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  if (loading) return <div className="p-6"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No database monitoring data available from backend.</div>;

  // Safe Variable Parsing
  const { criticalDataExport, connectionPool, dlpByTargetApp, operationsByApp, suspiciousActivity } = data;
  const safeAuthFailures = Number(data.authFailures) || 0;

  const exfilData = [...dlpByTargetApp]
    .map(d => ({ ...d, bytes_exported: Number(d.bytes_exported) || 0 }))
    .sort((a, b) => b.bytes_exported - a.bytes_exported)
    .slice(0, 6);

  const suspiciousQueriesData = operationsByApp
    .map(op => ({ 
        name: op.app_name, 
        queries: (Number(op.delete_count) || 0) + (Number(op.insert_count) || 0)
    }))
    .sort((a, b) => b.queries - a.queries)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Database className="w-5 h-5 text-blue-400" />Database Monitoring</h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time query analysis, anomaly detection, and data exfiltration monitoring from the database_telemetry schema.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-red-900/50 rounded-lg p-5 flex flex-col justify-between shadow-sm">
            <div className="flex items-center gap-2 mb-3"><ShieldAlert className="w-5 h-5 text-red-500" /><h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">Critical Data Export</h3></div>
            <div className="text-slate-200 font-mono text-lg font-bold">{criticalDataExport.application_name}</div>
            <div className="text-sm text-red-400 font-medium">{(criticalDataExport.bytes_exported / 1e9).toFixed(2)} GB outbound</div>
            <button className="mt-4 w-full py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-2"><Ban className="w-4 h-4" />BLOCK EXPORT ROUTE</button>
        </div>
        <div className="bg-slate-900 border border-orange-900/50 rounded-lg p-5 flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-3"><Activity className="w-5 h-5 text-orange-500" /><h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">Connection Pool Exhaustion</h3></div>
            <div className="text-slate-200 font-mono text-lg font-bold">{connectionPool.application_name}</div>
            <div className="text-sm text-orange-400 font-medium">{connectionPool.utilization_percent}% Capacity | {connectionPool.avg_query_latency_ms}ms avg latency</div>
            <button className="mt-4 w-fit px-4 py-1.5 bg-orange-500/10 border border-orange-500/40 hover:bg-orange-500 hover:text-white text-orange-300 text-xs font-bold rounded-md transition-all flex items-center gap-2"><WifiOff className="w-4 h-4" />DROP IDLE CONNECTIONS</button>
        </div>
        <div className="bg-slate-900 border border-yellow-900/50 rounded-lg p-5 flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-3"><Lock className="w-5 h-5 text-yellow-500" /><h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">Failed DB Auth Attempts</h3></div>
            <div className="text-sm text-slate-400">Multiple failures from a single source IP detected.</div>
            <div className="text-lg font-bold text-yellow-400">{safeAuthFailures.toLocaleString()} attempts</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Data Exfiltration Risk by Database</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={exfilData} margin={{ top: 10, right: 20, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="application_name" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                <Label value="Application Name" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
              </XAxis>
              <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} label={{ value: 'GB Exported', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12 }} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="bytes_exported" name="Volume (GB)" radius={[4, 4, 0, 0]} barSize={36}>{exfilData.map((d, idx) => <Cell key={idx} fill={idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : '#eab308'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">Top Suspicious Query Sources (by DELETEs/INSERTs)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart layout="vertical" data={suspiciousQueriesData} margin={{ top: 5, right: 20, left: 30, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} >
                <Label value="Flagged Query Count" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
              </XAxis>
              <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 11 }} width={120} tickLine={false} >
                 <Label value="Application Name" angle={-90} position="left" offset={-20} className="fill-slate-500 text-xs"/>
              </YAxis>
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="queries" name="Flagged Queries" fill="#f97316" radius={[0, 4, 4, 0]} barSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center gap-2"><Terminal className="w-5 h-5 text-blue-400" /><h2 className="text-lg font-semibold text-slate-200">Suspicious DB Activity & Mitigation</h2><span className="ml-auto text-xs text-slate-500">{suspiciousActivity.length} events logged from database_telemetry schema</span></div>
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm"><thead><tr className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800"><th className="px-6 py-4 font-semibold">Threat Actor (User)</th><th className="px-6 py-4 font-semibold">Target DB & Table</th><th className="px-6 py-4 font-semibold">Query Risk</th><th className="px-6 py-4 font-semibold text-right">Mitigation</th></tr></thead><tbody className="divide-y divide-slate-800">{suspiciousActivity.map((row: SuspiciousActivity) => <tr key={row.id} className="hover:bg-slate-800/30"><td className="px-6 py-4 font-mono text-sm">{row.user}</td><td className="px-6 py-4"><div className="font-bold text-sm">[{row.application_name}]</div><div className="text-xs text-slate-500 font-mono">➝ {row.table}</div></td><td className="px-6 py-4"><div className="flex items-start gap-2"><ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" /><div><div className="text-sm font-medium">{row.type}</div><div className="text-xs text-slate-500">{row.reason}</div></div></div></td><td className="px-6 py-4 text-right"><div className="flex justify-end gap-2"><button onClick={() => handleKillQuery(row.id, row.application_name, row.user)} className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5"><Activity className="w-3 h-3" />KILL QUERY</button><button className="text-orange-500 border border-orange-500/50 hover:bg-orange-500/10 text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5"><Lock className="w-3 h-3" />LOCK DB USER</button></div></td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}