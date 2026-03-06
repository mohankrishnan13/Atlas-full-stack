'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, ShieldAlert, Server, Lock, Ban,
  TrendingUp, AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { useToast } from '@/hooks/use-toast';
import type { ApiMonitoringData } from '@/lib/types';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 p-3 rounded shadow-lg">
      <p className="text-slate-200 font-semibold mb-1 text-sm">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="text-xs">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function StatCard({
  value, label, color = 'default', icon: Icon,
}: {
  value: string | number;
  label: string;
  color?: 'default' | 'red' | 'green' | 'orange';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const colors = {
    default: 'text-slate-200',
    red: 'text-red-400',
    green: 'text-emerald-400',
    orange: 'text-orange-400',
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex items-center justify-between">
      <div>
        <div className={`text-2xl font-bold ${colors[color]}`}>{value}</div>
        <div className="text-sm text-slate-400 mt-0.5">{label}</div>
      </div>
      {Icon && <Icon className={`w-8 h-8 ${colors[color]} opacity-60`} />}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-lg" />)}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-96 bg-slate-800 rounded-lg" />
        <div className="h-96 bg-slate-800 rounded-lg" />
      </div>
    </div>
  );
}

export default function ApiMonitoringPage() {
  const [data, setData] = useState<ApiMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    apiGet<ApiMonitoringData>(`/api-monitoring?env=${environment}`)
      .then(setData)
      .catch((err) => {
        toast({
          title: 'Error',
          description: err instanceof ApiError ? err.message : 'Failed to load API monitoring data.',
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  }, [environment, toast]);

  const handleBlockRoute = async (app: string, path: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app, path });
      toast({ title: 'Hard Block Applied', description: `Route ${app} ${path} has been blocked.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof ApiError ? err.message : 'Block action failed.',
        variant: 'destructive',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No API monitoring data available.
    </div>
  );

  // Map apiConsumptionByApp → overuse chart
  const overuseData = data.apiConsumptionByApp.map((a) => ({
    app: a.app,
    current: a.actual,
    limit: a.limit,
  }));

  // Map apiRouting → abused endpoints (sorted by cost descending)
  const abusedEndpoints = [...data.apiRouting]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 6)
    .map((r) => ({
      endpoint: `[${r.app}] ${r.path}`,
      count: Math.round(r.cost * 100),
      severity: r.action === 'Blocked' ? 'critical' : r.action === 'Rate-Limited' ? 'high' : 'medium',
    }));

  // Top consumers table
  const topConsumers = [...data.apiRouting]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5)
    .map((r) => ({
      consumer: r.app.toLowerCase().replace(/ /g, '_') + '_service',
      app: `[${r.app}]`,
      calls: `${Math.round(r.cost * 40)}K`,
      cost: `$${r.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      isOveruse: r.trend > 0,
      actionLabel: r.action === 'Blocked' ? 'View Block' : r.action === 'Rate-Limited' ? 'Review Quota' : 'Audit Logs',
      actionType: r.action === 'Blocked' ? 'critical' : r.action === 'Rate-Limited' ? 'warning' : 'neutral',
      path: r.path,
    }));

  // Active mitigation feed: routes that aren't OK
  const mitigationFeed = data.apiRouting
    .filter((r) => r.action !== 'OK')
    .map((r) => ({
      target: `[${r.app}]`,
      offender: r.app.toLowerCase().replace(/ /g, '_') + '_bot',
      violation: r.action === 'Blocked' ? 'Hard Blocked Route' : 'Rate Limit Exceeded',
      details: `${r.method} ${r.path} — trend: ${r.trend > 0 ? '+' : ''}${r.trend}%`,
      actionLabel: r.action === 'Blocked' ? 'View Policy' : 'Enforce Hard Block',
      actionColor: r.action === 'Blocked' ? 'blue' : 'red',
      app: r.app,
      path: r.path,
    }));

  const criticalIncidents = data.apiRouting.filter((r) => r.action === 'Blocked').length;

  return (
    <div className="space-y-6">

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard value={data.apiCallsToday.toLocaleString()} label="Total API Calls" icon={Activity} />
        <StatCard value={data.blockedRequests.toLocaleString()} label="Blocked Threats" color="red" icon={Ban} />
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-emerald-400">{data.avgLatency.toFixed(0)}ms</div>
            <div className="text-sm text-slate-400 mt-0.5">Avg Latency</div>
          </div>
          <Activity className="w-8 h-8 text-emerald-500 opacity-60" />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-orange-400">
              {criticalIncidents > 0 ? `${criticalIncidents} Critical` : 'None'}
            </div>
            <div className="text-sm text-slate-400 mt-0.5">Active Incidents</div>
          </div>
          <ShieldAlert className="w-8 h-8 text-orange-400 opacity-60" />
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* API Overuse by Target Application */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Server className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-slate-100">API Overuse by Target Application</h2>
          </div>
          {overuseData.length > 0 ? (
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={overuseData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="app" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} label={{ value: 'RPM', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '12px', color: '#94a3b8' }} />
                  <Bar dataKey="limit" name="Limit RPM" fill="#475569" radius={[4, 4, 0, 0]} barSize={24} />
                  <Bar dataKey="current" name="Current RPM" radius={[4, 4, 0, 0]} barSize={24}>
                    {overuseData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.current > entry.limit ? '#ef4444' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-72 text-slate-500 text-sm">No data</div>
          )}
        </div>

        {/* Most Abused API Endpoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <ShieldAlert className="w-5 h-5 text-red-400" />
            <h2 className="text-lg font-semibold text-slate-100">Most Abused API Endpoints</h2>
          </div>
          {abusedEndpoints.length > 0 ? (
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={abusedEndpoints} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis dataKey="endpoint" type="category" width={180} stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 10, fontWeight: 500 }} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="count" name="Violations" radius={[0, 4, 4, 0]} barSize={22}>
                    {abusedEndpoints.map((entry, idx) => (
                      <Cell key={idx} fill={
                        entry.severity === 'critical' ? '#ef4444' :
                        entry.severity === 'high' ? '#f97316' : '#eab308'
                      } />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-72 text-slate-500 text-sm">No endpoint abuse data</div>
          )}
        </div>
      </div>

      {/* Bottom Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top Consumers by Target App */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-400" />
              Top Consumers by Target App
            </h2>
            <button className="text-xs text-slate-400 hover:text-white transition-colors">View All</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-5 py-3">Consumer</th>
                  <th className="px-5 py-3">Target App</th>
                  <th className="px-5 py-3">Calls</th>
                  <th className="px-5 py-3">Cost</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {topConsumers.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-3 font-mono text-slate-300 text-xs">{row.consumer}</td>
                    <td className="px-5 py-3 text-blue-400 text-xs">{row.app}</td>
                    <td className="px-5 py-3 text-xs">{row.calls}</td>
                    <td className={`px-5 py-3 font-medium text-xs ${row.isOveruse ? 'text-red-400' : 'text-slate-300'}`}>
                      {row.cost}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleBlockRoute(row.app.replace(/\[|\]/g, ''), row.path)}
                        className={`text-xs px-3 py-1 rounded border transition-all ${
                          row.actionType === 'warning'
                            ? 'border-orange-500 text-orange-500 hover:bg-orange-500/10'
                            : row.actionType === 'critical'
                              ? 'border-red-500 text-red-500 hover:bg-red-500/10'
                              : 'border-slate-600 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {row.actionLabel}
                      </button>
                    </td>
                  </tr>
                ))}
                {topConsumers.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500 text-xs">No consumer data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active API Mitigation Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="p-6 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Lock className="w-5 h-5 text-emerald-400" />
              Active API Mitigation Feed
            </h2>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-xs text-red-400 font-medium">Live</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-5 py-3">Target / Offender</th>
                  <th className="px-5 py-3">Violation</th>
                  <th className="px-5 py-3 text-right">Mitigation Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {mitigationFeed.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-blue-400 font-medium text-sm mb-1">{row.target}</div>
                      <div className="font-mono text-xs text-slate-500">{row.offender}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-200 font-medium text-sm">{row.violation}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{row.details}</div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {row.actionColor === 'red' ? (
                        <button
                          onClick={() => handleBlockRoute(row.app, row.path)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-all flex items-center gap-1.5 ml-auto"
                        >
                          <Ban className="w-3 h-3" />
                          {row.actionLabel}
                        </button>
                      ) : (
                        <button className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-all ml-auto">
                          {row.actionLabel}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {mitigationFeed.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-500 text-xs">
                    All routes operating normally — no active mitigations
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
