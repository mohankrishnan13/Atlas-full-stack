'use client';

import React, { useEffect, useState } from 'react';
import {
  Sparkles, Shield, Zap, Server, AlertTriangle,
  TrendingUp, CheckCircle, Info,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { OverviewData } from '@/lib/types';

type FigmaDashboardAppHealth = {
  targetApp: string;
  currentLoadLabel: string;
  status: 'healthy' | 'warning' | 'critical';
  actionLabel: string;
};

type FigmaDashboardResponse = {
  aiBriefing: string;
  appHealth: FigmaDashboardAppHealth[];
};

// ─── Reusable InfoTooltip ──────────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-blue-400 transition-colors"
        aria-label="More information"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute z-50 left-5 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}

// ─── Section header with subtitle + tooltip ───────────────────────────────────
function SectionHeader({
  icon,
  title,
  subtitle,
  tooltip,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tooltip: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <InfoTooltip text={tooltip} />
        </div>
        {right}
      </div>
      <p className="text-[11px] text-slate-500 mt-1 pl-6 leading-relaxed">{subtitle}</p>
    </div>
  );
}

// ─── Chart tooltip with full context ─────────────────────────────────────────
function ChartTooltip({ active, payload, label, extras }: any) {
  if (!active || !payload?.length) return null;
  const extra = extras?.[label];
  return (
    <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl min-w-[180px]">
      <p className="text-slate-100 font-semibold mb-2 text-sm">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="text-xs mb-1">
          {entry.name}: <span className="font-bold">{entry.value.toLocaleString()}</span>
        </p>
      ))}
      {extra && (
        <div className="mt-2 pt-2 border-t border-slate-700 space-y-1">
          {Object.entries(extra).map(([k, v]: any) => (
            <p key={k} className="text-xs text-slate-400">{k}: <span className="text-slate-200">{v}</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── App Health Card ──────────────────────────────────────────────────────────
function AppHealthCard({
  appName, load, status, actionLabel, onAction,
}: {
  appName: string;
  load: string;
  status: 'critical' | 'warning' | 'healthy';
  actionLabel: string;
  onAction: () => void;
}) {
  const cfg = {
    critical: {
      dot: 'bg-red-500',
      badge: 'text-red-400 bg-red-500/10 border-red-500/30',
      label: 'Critical',
      btn: 'bg-red-600 hover:bg-red-700 text-white',
      border: 'border-red-900/30',
    },
    warning: {
      dot: 'bg-yellow-500',
      badge: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      label: 'Warning',
      btn: 'bg-yellow-600 hover:bg-yellow-700 text-slate-950',
      border: 'border-slate-800',
    },
    healthy: {
      dot: 'bg-emerald-500',
      badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      label: 'Healthy',
      btn: 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-700/40',
      border: 'border-slate-800',
    },
  }[status];

  // Expand vague load labels like "450 req/m" → "450 Requests per Minute"
  const expandedLoad = load
    .replace(/req\/m/gi, 'Requests per Minute')
    .replace(/(\d+)%\s*Cap/gi, '$1% of Allocated Capacity Used')
    .replace(/(\d+)%\s*Usage/gi, '$1% Resource Utilization')
    .replace(/GB\/s/gi, 'GB per Second');

  return (
    <div className={`bg-slate-900 border rounded-xl px-5 pt-5 pb-4 flex flex-col gap-3 ${cfg.border}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Target Application</div>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>
      <div className="text-sm font-bold text-slate-100 truncate">{appName}</div>
      <div>
        <div className="text-xl font-bold text-slate-100 leading-tight">{expandedLoad}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">Current Traffic Load</div>
      </div>
      <button onClick={onAction} className={`w-full py-2 text-[11px] font-bold rounded-lg transition-colors ${cfg.btn}`}>
        {actionLabel.toUpperCase()}
      </button>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 bg-slate-800 rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-72 bg-slate-800 rounded-xl" />
        <div className="h-72 bg-slate-800 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [figma, setFigma] = useState<FigmaDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiGet<OverviewData>(`/overview`),
      apiGet<FigmaDashboardResponse>(`/figma/dashboard`),
    ])
      .then(([ov, dash]) => {
        if (cancelled) return;
        setData(ov);
        setFigma(dash);
      })
      .catch((err) => {
        if (!cancelled) { setData(null); setFigma(null); }
        toast.error('Failed to load overview data.', {
          description: err instanceof ApiError ? err.message : 'Request failed.',
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [environment]);

  const handleMitigate = async (app: string, path = '/*') => {
    try {
      await apiPost('/api-monitoring/block-route', { app, path });
      toast.success('Mitigation Applied', { description: `Hard limit applied for ${app}.` });
    } catch (err) {
      toast.error('Mitigation failed.', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">No overview data available.</div>
  );

  const appCards =
    figma?.appHealth?.length
      ? figma.appHealth.map((row, idx) => ({
          id: `${idx}`,
          appName: row.targetApp,
          load: row.currentLoadLabel,
          status: row.status,
          actionLabel: row.actionLabel,
        }))
      : data.microservices.slice(0, 3).map((svc) => {
          const reqData = data.apiRequestsByApp.find((a) =>
            a.app.toLowerCase().includes(svc.name.toLowerCase().split('-')[0])
          );
          const rpm = reqData ? reqData.requests : svc.connections.length * 150;
          const load = `${rpm.toLocaleString()} Requests per Minute`;
          const status: 'critical' | 'warning' | 'healthy' =
            svc.status === 'Failing' ? 'critical' : 'healthy';
          return { id: svc.id, appName: svc.name, load, status, actionLabel: status === 'critical' ? 'Apply Hard Limit' : 'View Traffic' };
        });

  const anomalyChartData = data.apiRequestsByApp.slice(0, 6).map((a) => ({
    app: a.app,
    requests: a.requests,
  }));

  // Build tooltip extras for API chart
  const apiChartExtras: Record<string, any> = {};
  data.apiRequestsByApp.forEach((a) => {
    const isHighest = a.requests === Math.max(...data.apiRequestsByApp.map((x) => x.requests));
    apiChartExtras[a.app] = {
      'Requests per Minute': a.requests.toLocaleString(),
      ...(isHighest ? { Status: '⚠ Highest traffic — review rate limits' } : {}),
    };
  });

  const riskData = data.appAnomalies
    .filter((a) => a.anomalies > 0)
    .sort((a, b) => b.anomalies - a.anomalies)
    .slice(0, 5)
    .map((a) => ({ name: a.name, score: a.anomalies }));

  const riskChartExtras: Record<string, any> = {};
  riskData.forEach((r, i) => {
    riskChartExtras[r.name] = {
      'Anomaly Score': r.score,
      'Severity': i === 0 ? '🔴 Critical — immediate review required' : i === 1 ? '🟠 High risk' : '🟡 Medium risk',
    };
  });

  return (
    <div className="space-y-6 pb-8">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          Security Overview
        </h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">
          Cross-application security posture — live threat status, API health, and active anomalies
        </p>
      </div>

      {/* AI Daily Threat Briefing */}
      <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-slate-800 rounded-xl px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-indigo-500/15 rounded-lg flex items-center justify-center flex-shrink-0 border border-indigo-500/25">
            <Sparkles className="w-4 h-4 text-indigo-300" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-sm font-semibold text-slate-100">ATLAS AI Daily Threat Briefing</div>
              <span className="text-[10px] bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">LIVE</span>
              <InfoTooltip text="The AI briefing is generated daily by analyzing log patterns, anomaly scores, blocked requests, and behavioral deviations across all monitored applications. It highlights the most urgent threats and recommended actions for the shift." />
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Automated summary of the most critical security events detected in the past 24 hours.</p>
            <div className="text-[11px] text-slate-300 mt-2 leading-relaxed">
              {figma?.aiBriefing ?? 'No briefing available — check back after the next analysis cycle.'}
            </div>
          </div>
        </div>
      </div>

      {/* App-Specific Health Matrix */}
      <div>
        <SectionHeader
          icon={<Server className="w-4 h-4 text-slate-300" />}
          title="Application-Specific Health Matrix"
          subtitle="Live traffic load and security status for each monitored application. Critical applications require immediate rate limiting or isolation."
          tooltip="Each card represents a monitored application. 'Current Traffic Load' shows requests per minute compared to capacity. A Critical status means the app is under anomalous load or actively failing. Warning means elevated risk. Healthy means operating normally."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {appCards.map(({ id, appName, load, status, actionLabel }) => (
            <AppHealthCard
              key={id}
              appName={appName}
              load={load}
              status={status}
              actionLabel={actionLabel}
              onAction={() => handleMitigate(appName)}
            />
          ))}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* API Consumption by Target Application */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader
            icon={<TrendingUp className="w-4 h-4 text-blue-400" />}
            title="API Consumption by Target Application"
            subtitle="Number of API requests per minute hitting each protected application right now."
            tooltip="Higher bars indicate more traffic. A bar colored red means that application is receiving the most requests and may be near its rate limit. Use this to spot which application is being hammered — it could indicate a DDoS attempt or runaway client."
          />
          <div className="mb-1 text-[11px] text-slate-600 pl-1">Y-axis: Requests per Minute (RPM) hitting each application</div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={anomalyChartData} margin={{ top: 5, right: 20, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="app"
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  label={{ value: 'Target Application', position: 'insideBottom', offset: -18, fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  label={{ value: 'Requests per Minute (RPM)', angle: -90, position: 'insideLeft', offset: 10, fill: '#64748b', fontSize: 11 }}
                />
                <Tooltip
                  content={({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null;
                    const isHighest = payload[0]?.value === Math.max(...anomalyChartData.map(d => d.requests));
                    return (
                      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl">
                        <p className="text-slate-100 font-semibold text-sm mb-2">{label}</p>
                        <p className="text-blue-400 text-xs font-bold">
                          Current Traffic: {payload[0]?.value?.toLocaleString()} Requests per Minute
                        </p>
                        {isHighest && (
                          <p className="text-red-400 text-xs mt-1">⚠ Highest traffic — review rate limits</p>
                        )}
                      </div>
                    );
                  }}
                  cursor={{ fill: '#1e293b' }}
                />
                <Bar dataKey="requests" name="Requests per Minute" radius={[4, 4, 0, 0]} barSize={32}>
                  {anomalyChartData.map((entry, idx) => {
                    const isHighest = entry.requests === Math.max(...anomalyChartData.map((a) => a.requests));
                    return <Cell key={idx} fill={isHighest ? '#ef4444' : '#3b82f6'} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Risk Applications / Endpoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader
            icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
            title="Top Risk Applications by Anomaly Score"
            subtitle="Applications and endpoints ranked by their cumulative anomaly score — higher scores indicate more suspicious behavior patterns."
            tooltip="Anomaly scores are calculated by aggregating behavioral deviations: unusual request volumes, geographic access anomalies, failed auth spikes, and data transfer outliers. A score above 80 warrants immediate investigation."
          />
          <div className="mb-1 text-[11px] text-slate-600 pl-1">X-axis: Cumulative Anomaly Score (0–100 scale)</div>
          {riskData.length > 0 ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#475569"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Cumulative Anomaly Score', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 11 }}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={130}
                    stroke="#475569"
                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const score = payload[0]?.value;
                      return (
                        <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl">
                          <p className="text-slate-100 font-semibold text-sm mb-2">{label}</p>
                          <p className="text-red-400 text-xs font-bold">Anomaly Score: {score}</p>
                          <p className="text-slate-400 text-xs mt-1">
                            {score >= 80 ? '🔴 Critical — immediate investigation required'
                              : score >= 50 ? '🟠 High risk — review recent activity'
                              : '🟡 Medium — monitor for escalation'}
                          </p>
                        </div>
                      );
                    }}
                    cursor={{ fill: '#1e293b' }}
                  />
                  <Bar dataKey="score" name="Anomaly Score" radius={[0, 4, 4, 0]} barSize={22}>
                    {riskData.map((_, idx) => (
                      <Cell key={idx} fill={idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : '#eab308'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-60 text-slate-500 text-sm gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              No anomaly data — all applications within normal parameters
            </div>
          )}
        </div>
      </div>

      {/* Active Anomaly Mitigation Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800">
          <SectionHeader
            icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
            title="Active Anomaly Mitigation Log"
            subtitle="Live stream of detected anomalies across applications with available response actions."
            tooltip="This table shows security anomalies detected across all monitored services. Each row identifies the affected application, the source endpoint, the type of issue, and its severity. Use 'Throttle App' to apply a rate limit, or 'Investigate' to open a full incident review."
            right={
              <div className="flex items-center gap-3">
                <a className="text-[11px] text-slate-400 hover:text-slate-200" href="#">View All Logs</a>
                <span className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400">LIVE FEED</span>
              </div>
            }
          />
        </div>
        {data.systemAnomalies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[700px]">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium tracking-wider">Target Application</th>
                  <th className="px-4 py-3 font-medium tracking-wider">Source / Endpoint</th>
                  <th className="px-4 py-3 font-medium tracking-wider">Issue Type</th>
                  <th className="px-4 py-3 font-medium tracking-wider">Severity</th>
                  <th className="px-4 py-3 font-medium tracking-wider text-right">Immediate Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.systemAnomalies.map((anomaly) => (
                  <tr key={anomaly.id} className={`hover:bg-slate-800/40 transition-colors ${anomaly.severity === 'Critical' ? 'bg-red-950/10' : ''}`}>
                    <td className="px-4 py-4">
                      <span className="text-blue-400 font-semibold text-sm">{anomaly.service}</span>
                    </td>
                    <td className="px-4 py-4 font-mono text-slate-400 text-xs">
                      {data.failingEndpoints?.[anomaly.service] ?? 'Unknown endpoint'}
                    </td>
                    <td className="px-4 py-4 text-slate-300 text-sm">{anomaly.type}</td>
                    <td className="px-4 py-4">
                      <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${
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
          <div className="flex items-center justify-center h-24 text-slate-500 text-sm gap-2 px-6 py-6">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            No active anomalies detected — all applications operating within normal parameters
          </div>
        )}
      </div>

      {/* Live Attack Surface Topology */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 relative overflow-hidden">
        <SectionHeader
          icon={<Zap className="w-4 h-4 text-emerald-400" />}
          title="Live Attack Surface Topology"
          subtitle="Real-time visualization of incoming traffic flow and security filtering before requests reach protected applications."
          tooltip="This diagram shows how external traffic enters your environment. Traffic first passes through the WAF (Web Application Firewall), which blocks malicious requests. What passes through then reaches your applications. Red connections indicate suspicious or blocked traffic. Green connections indicate clean, authorized traffic."
        />

        <div className="relative h-64 bg-slate-950/50 rounded-xl border border-slate-800/50 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800/20 via-slate-950/50 to-slate-950 pointer-events-none" />

          {/* External Traffic Node */}
          <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10">
            <div className="bg-slate-800 border-2 border-slate-600 rounded-xl p-4 min-w-[145px] shadow-lg">
              <div className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider font-bold">Source</div>
              <div className="text-sm text-slate-200 font-bold">External Traffic</div>
              {data.activeAlerts > 0 && (
                <div className="text-xs text-red-400 mt-1 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping inline-block" />
                  {data.activeAlerts} Suspicious IPs
                </div>
              )}
              <div className="text-[10px] text-slate-500 mt-1">
                {data.apiRequests?.toLocaleString() ?? '—'} total requests/min
              </div>
            </div>
          </div>

          {/* WAF Node */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10 group">
            <div className="relative">
              <div className="bg-emerald-500/10 border-2 border-emerald-500 rounded-xl p-4 min-w-[148px] shadow-[0_0_20px_rgba(16,185,129,0.2)] cursor-help">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <div className="text-xs text-emerald-400 font-bold">ACTIVE</div>
                </div>
                <div className="text-sm text-slate-50 font-bold">WAF Filtering Layer</div>
                <div className="text-xs text-emerald-400 mt-1 font-mono">
                  {data.errorRate > 0 ? `Blocking: ${data.errorRate.toFixed(1)}% of traffic` : 'Filtering: Active'}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Blocks SQL injection, XSS, bot traffic
                </div>
              </div>
              {/* WAF tooltip on hover */}
              <div className="absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs text-slate-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
                <strong className="text-slate-100">WAF (Web Application Firewall)</strong><br />
                Inspects every incoming request and blocks malicious payloads such as SQL injection, cross-site scripting (XSS), and automated bot traffic before they reach protected applications.
              </div>
            </div>
          </div>

          {/* Internal Apps */}
          <div className="absolute right-6 top-1/2 -translate-y-1/2 space-y-3 z-10">
            {data.microservices.slice(0, 2).map((svc) => {
              const isFailing = svc.status === 'Failing';
              return (
                <div key={svc.id} className="relative">
                  {isFailing && <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-xl animate-pulse" />}
                  <div className={`relative rounded-lg p-3 min-w-[145px] flex items-center justify-between ${
                    isFailing
                      ? 'bg-red-950/40 border-2 border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                      : 'bg-slate-800/50 border border-slate-700'
                  }`}>
                    <div>
                      <div className={`text-xs font-bold ${isFailing ? 'text-red-400' : 'text-slate-300'}`}>{svc.name}</div>
                      <div className={`text-[10px] font-mono ${isFailing ? 'text-red-300' : 'text-slate-500'}`}>
                        {isFailing ? '⚠ Under Attack' : '✓ Normal Load'}
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
              <marker id="arrowRed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#ef4444" />
              </marker>
              <marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
              </marker>
            </defs>
            {/* External → WAF (suspicious) */}
            {data.activeAlerts > 0 && (
              <path d="M 175 110 Q 310 110, 440 130" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" markerEnd="url(#arrowRed)" className="animate-pulse" />
            )}
            {/* External → WAF (clean) */}
            <path d="M 175 160 Q 310 160, 440 150" fill="none" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrowGreen)" />
            {/* WAF → Apps */}
            <path d="M 590 130 Q 700 130, 810 110" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="4,4" markerEnd="url(#arrowRed)" />
            <path d="M 590 155 Q 700 155, 810 175" fill="none" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrowGreen)" />
          </svg>
        </div>
      </div>
    </div>
  );
}
