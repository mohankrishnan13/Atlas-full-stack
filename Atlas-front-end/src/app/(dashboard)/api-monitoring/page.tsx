'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, Server, ShieldAlert, Ban, LoaderCircle,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, Label,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { ApiMonitoringData } from '@/lib/types';

// ── Reusable UI ───────────────────────────────────────────────────────────────

const SectionHeader = React.memo(
  ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div className="flex items-center gap-2 px-5 pt-5 mb-4">
      {icon}
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
    </div>
  ),
);
SectionHeader.displayName = 'SectionHeader';

const EmptyState = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center h-[300px] text-sm text-slate-500">
    {message}
  </div>
);

const truncate = (value: string, len = 12) =>
  value.length > len ? `${value.slice(0, len)}…` : value;

const TooltipContent = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-lg">
      <p className="text-slate-200 font-semibold mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {Number(p.value).toLocaleString()}
        </p>
      ))}
    </div>
  );
};

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ApiMonitoringPage() {
  const { environment } = useEnvironment();
  const [data, setData] = useState<ApiMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    // Endpoint matches backend route: GET /api-monitoring
    apiGet<ApiMonitoringData>('/api-monitoring', controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          toast.error('Failed to load API monitoring data', {
            description: err instanceof ApiError ? err.message : 'Unknown error',
          });
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [environment]);

  const { apiConsumption, abusedEndpoints, consumers, mitigations } = useMemo(() => {
    if (!data) return { apiConsumption: [], abusedEndpoints: [], consumers: [], mitigations: [] };

    const apiConsumption = (data.apiConsumptionByApp ?? []).map((d) => ({
      app: d.app ?? 'Unknown',
      actual: Number(d.actual) || 0,
      limit: Number(d.limit) || 0,
    }));

    const abusedEndpoints = (data.apiRouting ?? [])
      .filter((r) => r.path && r.path !== '/')
      .map((r, i) => ({
        id: `${r.app}-${r.path}-${i}`,
        endpoint: `[${r.app}] ${r.path}`,
        violations: Math.abs(Number(r.trend) || 0),
        severity: Number(r.trend) > 100 || r.action !== 'OK' ? 'critical' : 'high',
      }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 10);

    const consumers = (data.apiConsumptionByApp ?? []).map((c) => ({
      id: c.app,
      consumer: c.app,
      app: c.app,
      calls: Number(c.actual) || 0,
      // Cost is not in the backend schema; derive a proxy until it is exposed
      cost: (Number(c.actual) || 0) * 0.0001,
      isOveruse: Number(c.actual) > Number(c.limit),
    }));

    const mitigations = (data.apiRouting ?? [])
      .filter((r) => r.action && r.action !== 'OK')
      .map((r, i) => ({
        id: `${r.app}-${r.path}-${i}`,
        target: r.app,
        offender: r.path,
        violation: r.action,
        action: 'Enforce Hard Block',
      }));

    return { apiConsumption, abusedEndpoints, consumers, mitigations };
  }, [data]);

  async function handleAction(action: string, target: string) {
    try {
      // Matches backend ApiBlockRouteRequest: { app: string; path: string }
      await apiPost('/api-monitoring/block-route', { app: target, path: '/*' });
      toast.success('Mitigation applied', { description: `${action} executed for ${target}` });
    } catch (err) {
      toast.error('Action failed', {
        description: err instanceof ApiError ? err.message : 'Unknown error',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <LoaderCircle className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!data) {
    return <div className="text-center text-slate-500 p-6">No monitoring data available</div>;
  }

  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-100">
          <Activity className="w-5 h-5 text-blue-400" />
          API Monitoring
        </h1>
        <p className="text-xs text-slate-500 mt-1 ml-7">
          Real-time API usage, abuse detection, and mitigation controls
        </p>
      </header>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'API Calls Today', value: (data.apiCallsToday || 0).toLocaleString(), color: 'text-blue-400' },
          { label: 'Blocked Requests', value: (data.blockedRequests || 0).toLocaleString(), color: 'text-red-400' },
          { label: 'Avg Latency', value: `${(data.avgLatency || 0).toFixed(1)}ms`, color: 'text-orange-400' },
          { label: 'Estimated Cost', value: `$${(data.estimatedCost || 0).toFixed(2)}`, color: 'text-yellow-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-xs text-slate-500 mb-1">{label}</h3>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Server className="w-4 h-4 text-blue-400" />} title="API Consumption vs Limits" />
          <div className="px-5 pb-5">
            {apiConsumption.length === 0 ? (
              <EmptyState message="No consumption data available" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={apiConsumption}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="app" tickFormatter={(v) => truncate(v)} stroke="#475569" />
                  <YAxis stroke="#475569">
                    <Label value="RPM" angle={-90} position="insideLeft" />
                  </YAxis>
                  <Tooltip content={<TooltipContent />} />
                  <Bar dataKey="limit" name="Limit" fill="#334155" />
                  <Bar dataKey="actual" name="Actual">
                    {apiConsumption.map((d, i) => (
                      <Cell key={i} fill={d.actual > d.limit ? '#ef4444' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Most Abused API Endpoints" />
          <div className="px-5 pb-5">
            {abusedEndpoints.length === 0 ? (
              <EmptyState message="No abused endpoints detected" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={abusedEndpoints} layout="vertical">
                  <CartesianGrid stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#475569" />
                  <YAxis
                    type="category"
                    dataKey="endpoint"
                    tickFormatter={(v) => truncate(v, 18)}
                    width={140}
                  />
                  <Tooltip content={<TooltipContent />} />
                  <Bar dataKey="violations" name="Violations">
                    {abusedEndpoints.map((e) => (
                      <Cell key={e.id} fill={e.severity === 'critical' ? '#ef4444' : '#f97316'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Server className="w-4 h-4 text-violet-400" />} title="Top API Consumers" />
          <div className="px-3 pb-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-800 text-slate-500 uppercase">
                <tr>
                  <th className="py-2 text-left">Consumer</th>
                  <th>App</th>
                  <th>Calls</th>
                  <th>Est. Cost</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {consumers.map((c) => (
                  <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="py-3 font-mono">{c.consumer}</td>
                    <td className="text-blue-400">[{c.app}]</td>
                    <td>{c.calls.toLocaleString()}</td>
                    <td className={c.isOveruse ? 'text-red-400 font-semibold' : ''}>
                      ${c.cost.toFixed(4)}
                    </td>
                    <td className="text-center">
                      <button
                        onClick={() => handleAction('Throttle Limits', c.app)}
                        className="text-orange-400 border border-orange-500/50 px-3 py-1 rounded-md hover:bg-orange-500/10"
                      >
                        Throttle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-green-400" />} title="Active API Mitigations" />
          <div className="px-3 pb-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-800 text-slate-500 uppercase">
                <tr>
                  <th className="py-2 text-left">Target</th>
                  <th>Violation</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {mitigations.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center text-slate-500 py-6">
                      No active mitigations
                    </td>
                  </tr>
                ) : (
                  mitigations.map((m) => (
                    <tr key={m.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                      <td>
                        <div className="text-blue-400">[{m.target}]</div>
                        <div className="text-slate-500 font-mono text-[11px]">{m.offender}</div>
                      </td>
                      <td>{m.violation}</td>
                      <td className="text-center">
                        <button
                          onClick={() => handleAction(m.action, m.target)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md flex items-center gap-1 mx-auto"
                        >
                          <Ban size={12} />
                          {m.action}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
