'use client';

import React, { useEffect, useState } from 'react';
import {
  Shield, AlertTriangle, Lock, Ban, Zap, UserX,
  Activity, ShieldAlert, Laptop,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, CartesianGrid,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent } from '@/lib/types';

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 p-3 rounded shadow-lg">
      <p className="text-slate-200 font-semibold mb-1 text-sm">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color ?? '#94a3b8' }} className="text-xs">
          {entry.name}: {entry.value}
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

export default function EndpointSecurityPage() {
  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const fetchData = () => {
    setLoading(true);
    apiGet<EndpointSecurityData>(`/endpoint-security`)
      .then(setData)
      .catch((err) => {
        toast.error('Failed to load endpoint data.', {
          description: err instanceof ApiError ? err.message : 'Request failed.',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleQuarantine = async (workstationId: string) => {
    try {
      const res = await apiPost<{ success: boolean; message: string }>(
        '/endpoint-security/quarantine',
        { workstationId }
      );
      toast.success('Device Quarantined', { description: res.message });
    } catch (err) {
      toast.error('Quarantine action failed.', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No endpoint security data available.
    </div>
  );

  // Derive "most vulnerable endpoints" from alertTypes
  const vulnerableEndpoints = data.alertTypes
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map((t, idx) => ({
      name: data.wazuhEvents?.[idx]?.workstationId ?? `WKST-${String(1000 + idx)}`,
      cves: t.value,
    }));

  // Policy violators from wazuhEvents
  const policyViolators = data.wazuhEvents
    .reduce((acc: Record<string, number>, ev) => {
      acc[ev.employee] = (acc[ev.employee] ?? 0) + 1;
      return acc;
    }, {});
  const policyViolatorsData = Object.entries(policyViolators)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([user, violations]) => ({ user, violations }));

  // Compromised devices (Critical severity wazuh events)
  const compromisedDevices = data.wazuhEvents.filter(
    (ev) => ev.severity === 'Critical'
  );

  // Devices with AV disabled (High severity)
  const avDisabledDevices = data.wazuhEvents.filter(
    (ev) => ev.severity === 'High' && ev.alert.toLowerCase().includes('antivirus')
  );

  // High-risk users
  const riskUsers = data.wazuhEvents
    .reduce((acc: Record<string, { score: number; color: string }>, ev) => {
      const pts = ev.severity === 'Critical' ? 30 : ev.severity === 'High' ? 20 : 10;
      if (!acc[ev.employee]) acc[ev.employee] = { score: 0, color: 'text-orange-400' };
      acc[ev.employee].score += pts;
      if (acc[ev.employee].score > 60) acc[ev.employee].color = 'text-red-400';
      return acc;
    }, {});
  const topRiskUsers = Object.entries(riskUsers)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 2);

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-300">Endpoint Security</div>
      </div>

      {/* Top Row: Threat KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Active Malware */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <ShieldAlert className="w-16 h-16 text-red-500" />
          </div>
          <div>
            <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-500" />
              Active Malware Infections
            </h3>
            <div className="text-3xl font-bold text-slate-100 mt-3">
              <span className="text-red-500">{data.malwareAlerts} Device{data.malwareAlerts !== 1 ? 's' : ''}</span> Compromised
            </div>
          </div>
          <button
            onClick={() =>
              compromisedDevices[0] &&
              handleQuarantine(compromisedDevices[0].workstationId)
            }
            className="mt-5 w-full py-2 text-[12px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center justify-center gap-2"
          >
            <Ban className="w-4 h-4" />
            Isolate Devices
          </button>
        </div>

        {/* Policy Violations */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-10">
            <Lock className="w-16 h-16 text-orange-500" />
          </div>
          <div>
            <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide flex items-center gap-2">
              <Lock className="w-4 h-4 text-orange-500" />
              Critical Policy Violations
            </h3>
            <div className="mt-3 space-y-2">
              {avDisabledDevices.length > 0 ? (
                avDisabledDevices.slice(0, 2).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-2 text-slate-200 font-mono text-sm">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    {ev.workstationId}
                  </div>
                ))
              ) : (
                data.wazuhEvents.slice(0, 2).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-2 text-slate-200 font-mono text-sm">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    {ev.workstationId}
                  </div>
                ))
              )}
              {data.offlineDevices > 0 && (
                <div className="text-xs text-orange-400 mt-1 font-medium">
                  {data.offlineDevices} device{data.offlineDevices !== 1 ? 's' : ''} offline
                </div>
              )}
            </div>
          </div>
          <button className="mt-5 w-fit px-4 py-1.5 text-[11px] font-bold text-orange-300 border border-orange-500/30 rounded-md hover:bg-orange-900/20 transition-colors flex items-center gap-2">
            <Shield className="w-3 h-3" />
            Force Enable AV
          </button>
        </div>

        {/* High-Risk Users */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide flex items-center gap-2">
              <UserX className="w-4 h-4 text-yellow-500" />
              Users with High Anomaly Scores
            </h3>
            <div className="mt-3 flex flex-col gap-2">
              {topRiskUsers.map(([user, info]) => (
                <div key={user} className="bg-slate-800/50 p-2 rounded border border-slate-700 flex items-center justify-between">
                  <span className="text-slate-200 font-mono text-sm">{user}</span>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${info.color} ${
                    info.color === 'text-red-400' ? 'bg-red-950/30' : 'bg-orange-950/30'
                  }`}>
                    Score: {info.score}
                  </span>
                </div>
              ))}
              {topRiskUsers.length === 0 && (
                <div className="text-slate-500 text-sm">No risk scores available</div>
              )}
            </div>
          </div>
          <div className="text-xs text-slate-600 mt-3">
            Based on {data.wazuhEvents.length} endpoint events
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Most Vulnerable Endpoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Laptop className="w-5 h-5 text-red-400" />
            <h2 className="text-lg font-semibold text-slate-100">Most Vulnerable Endpoints</h2>
          </div>
          {vulnerableEndpoints.length > 0 ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart
                  layout="vertical"
                  data={vulnerableEndpoints}
                  margin={{ top: 5, right: 20, left: 30, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 11 }} width={90} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="cves" name="Risk Events" radius={[0, 4, 4, 0]} barSize={22}>
                    {vulnerableEndpoints.map((_, idx) => (
                      <Cell key={idx} fill={idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : '#eab308'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">No data</div>
          )}
        </div>

        {/* Top Policy Violators */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-semibold text-slate-100">Top Endpoint Policy Violators</h2>
          </div>
          {policyViolatorsData.length > 0 ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={policyViolatorsData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="user" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                  <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="violations" name="Violations" fill="#f97316" radius={[4, 4, 0, 0]} barSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">No violations data</div>
          )}
        </div>
      </div>

      {/* Endpoint Event Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-slate-200">Endpoint Event Log & Response</h2>
          <span className="ml-auto text-xs text-slate-500">{data.wazuhEvents.length} events</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Endpoint & User</th>
                <th className="px-6 py-4">Threat Description</th>
                <th className="px-6 py-4">Severity</th>
                <th className="px-6 py-4 text-right">Context-Aware Mitigation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.wazuhEvents.length > 0 ? (
                data.wazuhEvents.map((ev: WazuhEvent) => (
                  <tr key={ev.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-semibold text-sm">{ev.workstationId}</span>
                        <span className="text-xs text-slate-500 font-mono">{ev.employee}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-2">
                        {ev.severity === 'Critical' ? (
                          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                        )}
                        <span className={`text-sm ${ev.severity === 'Critical' ? 'text-red-300' : 'text-slate-300'}`}>
                          {ev.alert}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                        ev.severity === 'Critical'
                          ? 'text-red-400 bg-red-500/10 border-red-500/30'
                          : ev.severity === 'High'
                            ? 'text-orange-400 bg-orange-500/10 border-orange-500/30'
                            : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
                      }`}>
                        {ev.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {ev.severity === 'Critical' && (
                          <button
                            onClick={() => handleQuarantine(ev.workstationId)}
                            className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                          >
                            <Ban className="w-3 h-3" />
                            Quarantine Device
                          </button>
                        )}
                        <button className="text-orange-500 border border-orange-500/50 hover:bg-orange-500/10 text-xs font-medium px-3 py-1.5 rounded transition-colors flex items-center gap-1.5">
                          <Zap className="w-3 h-3" />
                          Investigate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500 text-sm">
                    No endpoint events detected
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
