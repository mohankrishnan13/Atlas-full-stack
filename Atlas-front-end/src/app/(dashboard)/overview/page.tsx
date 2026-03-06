'use client';

import React, { useEffect, useState } from 'react';
import {
  Sparkles, Shield, Zap, Server, AlertTriangle,
  TrendingUp, CheckCircle, XCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { useToast } from '@/hooks/use-toast';
import type { OverviewData } from '@/lib/types';

// ─── Tooltip ────────────────────────────────────────────────────────────────
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

// ─── App Health Card ─────────────────────────────────────────────────────────
function AppHealthCard({
  appName, load, status, actionLabel, onAction,
}: {
  appName: string;
  load: string;
  status: 'critical' | 'warning' | 'healthy';
  actionLabel: string;
  onAction: () => void;
}) {
  const statusConfig = {
    critical: {
      dot: 'bg-red-500',
      badge: 'text-red-400 bg-red-500/10 border-red-500/30',
      label: 'Critical',
      btn: 'border-red-500 text-red-400 hover:bg-red-500/10',
      card: 'border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.15)]',
    },
    warning: {
      dot: 'bg-yellow-500',
      badge: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      label: 'Warning',
      btn: 'border-yellow-500 text-yellow-400 hover:bg-yellow-500/10',
      card: 'border-yellow-500/30',
    },
    healthy: {
      dot: 'bg-emerald-500',
      badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      label: 'Healthy',
      btn: 'border-emerald-500 text-emerald-400 hover:bg-emerald-500/10',
      card: 'border-slate-800',
    },
  };
  const cfg = statusConfig[status];

  return (
    <div className={`bg-slate-900 border rounded-lg p-6 flex flex-col gap-4 ${cfg.card}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${cfg.dot} ${status !== 'healthy' ? 'animate-pulse' : ''}`} />
          <span className="text-slate-200 font-semibold text-sm">{appName}</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-100">{load}</div>
        <div className="text-xs text-slate-500 mt-0.5">Current Load</div>
      </div>
      <button
        onClick={onAction}
        className={`w-full py-2 text-xs font-semibold rounded border transition-colors ${cfg.btn}`}
      >
        {actionLabel}
      </button>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 bg-slate-800 rounded-lg" />
      <div className="grid grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-slate-800 rounded-lg" />)}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-72 bg-slate-800 rounded-lg" />
        <div className="h-72 bg-slate-800 rounded-lg" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    apiGet<OverviewData>(`/overview?env=${environment}`)
      .then(setData)
      .catch((err) => {
        toast({
          title: 'Error',
          description: err instanceof ApiError ? err.message : 'Failed to load overview data.',
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  }, [environment, toast]);

  const handleMitigate = async (app: string, path = '/*') => {
    try {
      await apiPost('/api-monitoring/block-route', { app, path });
      toast({ title: 'Mitigation Applied', description: `Hard limit applied for ${app}.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof ApiError ? err.message : 'Mitigation failed.',
        variant: 'destructive',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No overview data available.
    </div>
  );

  // Map microservices to app health cards
  const appCards = data.microservices.slice(0, 3).map((svc) => {
    const reqData = data.apiRequestsByApp.find((a) =>
      a.app.toLowerCase().includes(svc.name.toLowerCase().split('-')[0])
    );
    const load = reqData
      ? `${reqData.requests.toLocaleString()} req/m`
      : svc.connections.length > 0
        ? `${svc.connections.length * 150} req/m`
        : 'Idle';
    const status: 'critical' | 'warning' | 'healthy' =
      svc.status === 'Failing' ? 'critical' : 'healthy';
    const actionLabel = svc.status === 'Failing' ? 'Apply Hard Limit' : 'View Traffic';
    return { svc, load, status, actionLabel };
  });

  // Anomaly bar chart data: app anomalies
  const anomalyChartData = data.appAnomalies.slice(0, 6);

  // Risk endpoints data: failing endpoints or anomalies
  const riskData = data.appAnomalies
    .filter((a) => a.anomalies > 0)
    .sort((a, b) => b.anomalies - a.anomalies)
    .slice(0, 5)
    .map((a) => ({ name: a.name, score: a.anomalies }));

  return (
    <div className="space-y-6">

      {/* AI Daily Threat Briefing */}
      <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-blue-500/5 blur-3xl opacity-20 pointer-events-none" />
        <div className="relative z-10 flex items-start gap-4">
          <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.5)]">
            <Sparkles className="w-5 h-5 text-blue-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-slate-50 mb-2 flex items-center gap-2">
              ATLAS AI Briefing
              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30">
                LIVE
              </span>
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              Monitoring{' '}
              <strong className="text-blue-400">{data.microservices.length} services</strong>{' '}
              across the environment.{' '}
              {data.activeAlerts > 0 ? (
                <>
                  Detected{' '}
                  <strong className="text-red-400">{data.activeAlerts} active alert{data.activeAlerts !== 1 ? 's' : ''}</strong>.{' '}
                </>
              ) : (
                <strong className="text-emerald-400">No critical alerts active. </strong>
              )}
              {data.microservices.filter((m) => m.status === 'Failing').length > 0 && (
                <>
                  <strong className="text-orange-400">
                    {data.microservices.filter((m) => m.status === 'Failing').length} service(s) in failing state
                  </strong>{' '}
                  — containment rules are active.{' '}
                </>
              )}
              API cost risk score:{' '}
              <strong className={data.costRisk > 70 ? 'text-red-400' : 'text-yellow-400'}>
                {data.costRisk}%
              </strong>.
            </p>
          </div>
        </div>
      </div>

      {/* App-Specific Health Matrix */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Server className="w-5 h-5 text-blue-400" />
          <h2 className="text-base font-semibold text-slate-50">App-Specific Health Matrix</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {appCards.map(({ svc, load, status, actionLabel }) => (
            <AppHealthCard
              key={svc.id}
              appName={svc.name}
              load={load}
              status={status}
              actionLabel={actionLabel}
              onAction={() => handleMitigate(svc.name)}
            />
          ))}
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API Consumption by Target App */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-semibold text-slate-50">API Consumption by Target App</h2>
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data.apiRequestsByApp} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="app" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="requests" name="Requests" radius={[4, 4, 0, 0]} barSize={32}>
                  {data.apiRequestsByApp.map((entry, idx) => {
                    const isHighest =
                      entry.requests === Math.max(...data.apiRequestsByApp.map((a) => a.requests));
                    return <Cell key={idx} fill={isHighest ? '#ef4444' : '#3b82f6'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Risk Endpoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h2 className="text-base font-semibold text-slate-50">Top Risk Endpoints / Services</h2>
          </div>
          {riskData.length > 0 ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={120} stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="score" name="Anomaly Score" radius={[0, 4, 4, 0]} barSize={22}>
                    {riskData.map((_, idx) => (
                      <Cell key={idx} fill={idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : '#eab308'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
              No anomaly data available
            </div>
          )}
        </div>
      </div>

      {/* Active Anomaly Mitigation Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h2 className="text-base font-semibold text-slate-50">Active Anomaly Mitigation</h2>
          </div>
          <span className="text-xs text-slate-500">{data.systemAnomalies.length} active</span>
        </div>
        {data.systemAnomalies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Target Application</th>
                  <th className="px-4 py-3">Source / Endpoint</th>
                  <th className="px-4 py-3">Issue Type</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3 text-right">Immediate Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.systemAnomalies.map((anomaly) => (
                  <tr key={anomaly.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-4">
                      <span className="text-blue-400 font-medium">[{anomaly.service}]</span>
                    </td>
                    <td className="px-4 py-4 font-mono text-slate-400 text-xs">
                      {data.failingEndpoints?.[anomaly.service] ?? 'Unknown endpoint'}
                    </td>
                    <td className="px-4 py-4 text-slate-300">{anomaly.type}</td>
                    <td className="px-4 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                        anomaly.severity === 'Critical'
                          ? 'text-red-400 bg-red-500/10 border-red-500/30'
                          : anomaly.severity === 'High'
                            ? 'text-orange-400 bg-orange-500/10 border-orange-500/30'
                            : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
                      }`}>
                        {anomaly.severity}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleMitigate(anomaly.service)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
                        >
                          Throttle App
                        </button>
                        <button className="border border-slate-600 text-slate-400 hover:bg-slate-700 text-xs font-medium px-3 py-1.5 rounded transition-colors">
                          Investigate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center justify-center h-24 text-slate-500 text-sm gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            No active anomalies detected
          </div>
        )}
      </div>

      {/* Live Attack Surface Topology */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-6 relative z-10">
          <Zap className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-slate-50">Live Attack Surface Topology</h2>
        </div>

        <div className="relative h-64 bg-slate-950/50 rounded-lg border border-slate-800/50 p-8 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800/20 via-slate-950/50 to-slate-950 pointer-events-none" />

          {/* External Traffic Node */}
          <div className="absolute left-8 top-1/2 -translate-y-1/2 z-10">
            <div className="bg-slate-800 border-2 border-slate-600 rounded-xl p-4 min-w-[140px] shadow-lg shadow-black/50">
              <div className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-bold">Source</div>
              <div className="text-sm text-slate-200 font-bold">External Traffic</div>
              {data.activeAlerts > 0 && (
                <div className="text-xs text-red-400 mt-1 font-mono">
                  {data.activeAlerts} Suspicious IPs
                </div>
              )}
            </div>
          </div>

          {/* WAF Node */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10">
            <div className="bg-emerald-500/10 border-2 border-emerald-500 rounded-xl p-4 min-w-[140px] shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-emerald-400" />
                <div className="text-xs text-emerald-400 font-bold">ACTIVE</div>
              </div>
              <div className="text-sm text-slate-50 font-bold">WAF Policy</div>
              <div className="text-xs text-emerald-400 mt-1 font-mono">
                {data.errorRate > 0 ? `Filtering: ${(100 - data.errorRate).toFixed(1)}%` : 'Filtering: 99.8%'}
              </div>
            </div>
          </div>

          {/* Internal Apps */}
          <div className="absolute right-8 top-1/2 -translate-y-1/2 space-y-3 z-10">
            {data.microservices.slice(0, 2).map((svc) => {
              const isFailing = svc.status === 'Failing';
              return (
                <div key={svc.id} className={`relative ${isFailing ? '' : 'opacity-60'}`}>
                  {isFailing && (
                    <div className="absolute inset-0 bg-red-500/30 blur-xl rounded-xl animate-pulse" />
                  )}
                  <div className={`relative rounded-lg p-3 min-w-[140px] flex items-center justify-between ${
                    isFailing
                      ? 'bg-red-950/40 border-2 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                      : 'bg-slate-800/50 border border-slate-700'
                  }`}>
                    <div>
                      <div className={`text-xs font-bold ${isFailing ? 'text-red-400' : 'text-slate-400'}`}>
                        {svc.name}
                      </div>
                      <div className={`text-[10px] font-mono ${isFailing ? 'text-red-300' : 'text-slate-500'}`}>
                        {isFailing ? 'Under Attack' : 'Normal Load'}
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${isFailing ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}`} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 pointer-events-none z-0" style={{ width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0" />
                <stop offset="50%" stopColor="#ef4444" stopOpacity="1" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M 170 130 Q 365 130 560 130" fill="none" stroke="url(#lineGradient)" strokeWidth="2" className="animate-pulse" />
            <path d="M 560 130 Q 655 130 750 140" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
