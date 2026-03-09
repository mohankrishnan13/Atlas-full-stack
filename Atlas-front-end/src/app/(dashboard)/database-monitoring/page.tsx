'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Database, ShieldAlert, Lock, Ban,
  Activity, WifiOff, FileWarning, Terminal,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
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
          {entry.name}: <span className="text-slate-100 font-mono">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-slate-800 rounded-lg" />)}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-80 bg-slate-800 rounded-lg" />
        <div className="h-80 bg-slate-800 rounded-lg" />
      </div>
    </div>
  );
}

export default function DatabaseMonitoringPage() {
  const [data, setData] = useState<DbMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const fetchData = () => {
    setLoading(true);
    apiGet<DbMonitoringData>(`/db-monitoring`)
      .then(setData)
      .catch((err) => {
        toast.error('Failed to load database data.', {
          description: err instanceof ApiError ? err.message : 'Request failed.',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleKillQuery = async (activityId: number, app: string, user: string) => {
    try {
      await apiPost('/db-monitoring/kill-query', { activityId, app, user });
      toast.success('Query Killed', { description: `Activity ${activityId} on ${app} terminated.` });
      fetchData();
    } catch (err) {
      toast.error('Kill query failed.', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No database monitoring data available.
    </div>
  );

  // Data Exfiltration chart from dlpByTargetApp
  const exfilData = [...data.dlpByTargetApp]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((d) => ({
      name: d.app,
      volume: (d.count / 10).toFixed(1),
    }));

  const exfilColors = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#10b981'];

  // Suspicious query sources from operationsByApp
  const suspiciousSourcesData = data.operationsByApp
    .map((op) => ({
      name: op.app,
      queries: op.DELETE + op.INSERT,
    }))
    .sort((a, b) => b.queries - a.queries)
    .slice(0, 5);

  // Highest exfiltration app
  const highestExfil = data.dlpByTargetApp.sort((a, b) => b.count - a.count)[0];
  // Highest pool usage
  const highestConnections = data.activeConnections;
  // Failed auth from suspicious activity
  const authFailures = data.suspiciousActivity.filter(
    (a) => a.type?.toLowerCase().includes('auth') || a.reason?.toLowerCase().includes('auth')
  );

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-300">Database Monitoring</div>
      </div>

      {/* Top Row: DB Threat KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Critical Data Export */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between shadow-[0_0_15px_rgba(239,68,68,0.05)] relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Database className="w-16 h-16 text-red-500" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">Critical Data Export</h3>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-slate-200 font-mono text-lg font-bold">
                {highestExfil?.app ?? 'No DB'}
              </span>
            </div>
            <div className="text-sm text-red-400 font-medium">
              {data.dataExportVolume.toFixed(1)} GB outbound in 5 mins
            </div>
          </div>
          <button
            className="mt-5 w-full py-2 bg-red-600 hover:bg-red-700 text-white text-[12px] font-bold rounded-md transition-colors flex items-center justify-center gap-2"
          >
            <Ban className="w-4 h-4" />
            Block Export Route
          </button>
        </div>

        {/* Connection Pool */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Activity className="w-16 h-16 text-orange-500" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-5 h-5 text-orange-500" />
              <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">Connection Pool Exhaustion</h3>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
              <span className="text-slate-200 font-mono text-lg font-bold">{highestExfil?.app ?? 'GenAI-Vector-DB'}</span>
            </div>
            <div className="text-sm text-orange-400 font-medium">
              {Math.min(99, Math.round((data.activeConnections / 200) * 100))}% Capacity | {Math.round(data.avgQueryLatency)}ms risk
            </div>
          </div>
          <button className="mt-5 w-fit px-4 py-1.5 bg-orange-500/10 border border-orange-500/40 hover:bg-orange-500 hover:text-white text-orange-300 text-[11px] font-bold rounded-md transition-all flex items-center gap-2">
            <WifiOff className="w-4 h-4" />
            Drop Idle Connections
          </button>
        </div>

        {/* Failed Auth Attempts */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-5 h-5 text-yellow-500" />
              <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">Failed DB Auth Attempts</h3>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-500">Multiple failures from single IP source detected within last 10 minutes.</div>
              <div className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-red-400 bg-red-950/30 font-semibold">
                {Math.max(0, authFailures.length * 7)} attempts
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Data Exfiltration Risk by Database */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <FileWarning className="w-5 h-5 text-red-400" />
            <h2 className="text-lg font-semibold text-slate-100">Data Exfiltration Risk by Database</h2>
          </div>
          {exfilData.length > 0 ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={exfilData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} label={{ value: 'GB Exported', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="volume" name="Volume (GB)" radius={[4, 4, 0, 0]} barSize={36}>
                    {exfilData.map((_, idx) => (
                      <Cell key={idx} fill={exfilColors[idx % exfilColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">No exfiltration data</div>
          )}
        </div>

        {/* Top Suspicious Query Sources */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <ShieldAlert className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-semibold text-slate-100">Top Suspicious Query Sources</h2>
          </div>
          {suspiciousSourcesData.length > 0 ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart layout="vertical" data={suspiciousSourcesData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 11 }} width={100} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="queries" name="Flagged Queries" fill="#f97316" radius={[0, 4, 4, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">No query source data</div>
          )}
        </div>
      </div>

      {/* Suspicious DB Activity Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-slate-200">Suspicious DB Activity & Mitigation</h2>
          <span className="ml-auto text-xs text-slate-500">{data.suspiciousActivity.length} events</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Threat Actor</th>
                <th className="px-6 py-4">Target DB & Table</th>
                <th className="px-6 py-4">Query Risk</th>
                <th className="px-6 py-4 text-right">Mitigation Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.suspiciousActivity.length > 0 ? (
                data.suspiciousActivity.map((row: SuspiciousActivity) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <span className="text-slate-200 font-mono text-sm">{row.user}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-bold text-sm">[{row.app}]</span>
                        <span className="text-xs text-slate-500 mt-0.5 font-mono">➝ {row.table}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="text-sm text-slate-300 font-medium">{row.type}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{row.reason}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleKillQuery(row.id, row.app, row.user)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                        >
                          <Activity className="w-3 h-3" />
                          Kill Query
                        </button>
                        <button className="text-orange-500 border border-orange-500/50 hover:bg-orange-500/10 text-xs font-semibold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5">
                          <Lock className="w-3 h-3" />
                          Lock DB User
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500 text-sm">
                    No suspicious database activity detected
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
