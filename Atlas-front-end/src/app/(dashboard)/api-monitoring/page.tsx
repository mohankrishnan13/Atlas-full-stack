'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, ShieldAlert, Server, Lock, Ban,
  TrendingUp, AlertTriangle, Info,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';

type FigmaApiOveruseByApp = { targetApp: string; currentRpm: number; limitRpm: number };
type FigmaAbusedEndpointRow = { endpoint: string; violations: number; severity: 'critical' | 'high' | 'medium' };
type FigmaTopConsumerRow = {
  consumer: string;
  targetApp: string;
  callsLabel: string;
  costLabel: string;
  isOveruse: boolean;
  actionLabel: string;
  actionType: 'warning' | 'critical' | 'neutral';
};
type FigmaApiMitigationFeedRow = {
  target: string;
  offender: string;
  violation: string;
  details: string;
  actionLabel: string;
  actionColor: 'red' | 'blue';
};
type FigmaApiMonitoringResponse = {
  totalApiCallsLabel: string;
  blockedThreatsLabel: string;
  globalAvailabilityLabel: string;
  activeIncidentsLabel: string;
  apiOveruseByTargetApp: FigmaApiOveruseByApp[];
  mostAbusedEndpoints: FigmaAbusedEndpointRow[];
  topConsumersByTargetApp: FigmaTopConsumerRow[];
  activeMitigationFeed: FigmaApiMitigationFeedRow[];
};

// ─── InfoTooltip ──────────────────────────────────────────────────────────────
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

// ─── SectionHeader ────────────────────────────────────────────────────────────
function SectionHeader({
  icon, title, subtitle, tooltip, right,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tooltip: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
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

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  value, label, subtitle, tooltip, color = 'default', icon: Icon,
}: {
  value: string | number;
  label: string;
  subtitle: string;
  tooltip: string;
  color?: 'default' | 'red' | 'green' | 'orange';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const colors = {
    default: 'text-slate-200',
    red: 'text-red-400',
    green: 'text-emerald-400',
    orange: 'text-orange-400',
  };
  // Expand abbreviations
  const expandedValue = String(value)
    .replace(/req\/m/gi, ' Requests/min')
    .replace(/(\d+)%\s*Cap/gi, '$1% of Capacity')
    .replace(/(\d+)%\s*Avail/gi, '$1% Available');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1">
          {label}
          <InfoTooltip text={tooltip} />
        </div>
        {Icon && <Icon className={`w-6 h-6 ${colors[color]} opacity-50`} />}
      </div>
      <div className={`text-2xl font-extrabold ${colors[color]} leading-tight`}>{expandedValue}</div>
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-96 bg-slate-800 rounded-xl" />
        <div className="h-96 bg-slate-800 rounded-xl" />
      </div>
    </div>
  );
}

export default function ApiMonitoringPage() {
  const [data, setData] = useState<FigmaApiMonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<FigmaApiMonitoringResponse>(`/figma/api-monitoring`)
      .then(setData)
      .catch((err) => {
        toast.error('Failed to load API monitoring data.', {
          description: err instanceof ApiError ? err.message : 'Request failed.',
        });
      })
      .finally(() => setLoading(false));
  }, [environment]);

  const handleBlockRoute = async (app: string, path: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app, path });
      toast.success('Hard Block Applied', { description: `Route ${app} ${path} has been blocked.` });
    } catch (err) {
      toast.error('Block action failed.', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">No API monitoring data available.</div>
  );

  const overuseData = data.apiOveruseByTargetApp.map((a) => ({
    app: a.targetApp,
    currentRPM: a.currentRpm,
    limitRPM: a.limitRpm,
  }));

  const abusedEndpoints = data.mostAbusedEndpoints.map((r) => ({
    endpoint: r.endpoint,
    violations: r.violations,
    severity: r.severity,
  }));

  const topConsumers = data.topConsumersByTargetApp.map((r) => ({
    consumer: r.consumer,
    app: r.targetApp,
    calls: r.callsLabel.replace(/req\/m/gi, 'req/min'),
    cost: r.costLabel,
    isOveruse: r.isOveruse,
    actionLabel: r.actionLabel,
    actionType: r.actionType,
    path: '/unknown',
  }));

  const mitigationFeed = data.activeMitigationFeed.map((r) => ({
    target: r.target,
    offender: r.offender,
    violation: r.violation,
    details: r.details,
    actionLabel: r.actionLabel,
    actionColor: r.actionColor,
    app: r.target.replace('[', '').replace(']', ''),
    path: '/unknown',
  }));

  return (
    <div className="space-y-6 pb-8">

      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          API Monitoring
        </h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">
          Real-time request volume, rate limit enforcement, and threat detection across all monitored APIs
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          value={data.totalApiCallsLabel}
          label="Total API Calls Today"
          subtitle="Cumulative count of all API requests processed across every monitored application today."
          tooltip="This is the total number of API requests made to all monitored applications since midnight. A sudden spike compared to recent averages could indicate abnormal or automated traffic."
          icon={Activity}
        />
        <StatCard
          value={data.blockedThreatsLabel}
          label="Blocked Threats"
          subtitle="Number of malicious or policy-violating requests blocked by rate limits and WAF rules."
          tooltip="Blocked threats include requests blocked for rate limit violations, suspicious payloads (SQL injection, XSS), and flagged IP addresses. Higher numbers are expected after a threat wave."
          color="red"
          icon={Ban}
        />
        <StatCard
          value={data.globalAvailabilityLabel}
          label="Global API Availability"
          subtitle="Percentage of API requests that successfully received a valid response (non-error)."
          tooltip="Global availability = (successful requests / total requests) × 100. Below 99% suggests a systemic issue. Below 95% is a critical incident requiring immediate action."
          color="green"
          icon={TrendingUp}
        />
        <StatCard
          value={data.activeIncidentsLabel}
          label="Active Incidents"
          subtitle="Number of ongoing security incidents currently requiring analyst attention or response."
          tooltip="Active incidents are open security events that have been escalated from anomaly detection. Each one represents a situation requiring human review or automated mitigation to be marked resolved."
          color="orange"
          icon={ShieldAlert}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* API Overuse by Target Application */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader
            icon={<Server className="w-4 h-4 text-blue-400" />}
            title="API Overuse by Target Application"
            subtitle="Current request rate vs. configured rate limit for each monitored application."
            tooltip="Each grouped bar pair shows an application's current traffic (Requests per Minute) vs. its configured rate limit. A red current-traffic bar means the application is exceeding its limit — this can cause service degradation or indicates an active abuse attempt."
          />
          <div className="mb-1 text-[11px] text-slate-600 pl-1">Y-axis: Requests per Minute (RPM) — red bars indicate limit exceeded</div>
          {overuseData.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={overuseData} margin={{ top: 20, right: 20, left: 0, bottom: 30 }}>
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
                      const entry = overuseData.find(d => d.app === label);
                      const isOver = entry && entry.currentRPM > entry.limitRPM;
                      return (
                        <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl">
                          <p className="text-slate-100 font-semibold text-sm mb-2">{label}</p>
                          <p className="text-blue-400 text-xs">Current Traffic: <span className="font-bold">{entry?.currentRPM?.toLocaleString()} Requests per Minute</span></p>
                          <p className="text-slate-400 text-xs">Configured Limit: {entry?.limitRPM?.toLocaleString()} Requests per Minute</p>
                          {isOver && <p className="text-red-400 text-xs mt-1 font-semibold">⚠ Rate limit exceeded — consider throttling</p>}
                        </div>
                      );
                    }}
                    cursor={{ fill: '#1e293b' }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: '12px', fontSize: '11px', color: '#94a3b8' }}
                    formatter={(value) => value === 'limitRPM' ? 'Configured Rate Limit (RPM)' : 'Current Traffic (RPM)'}
                  />
                  <Bar dataKey="limitRPM" name="limitRPM" fill="#334155" radius={[4, 4, 0, 0]} barSize={22} />
                  <Bar dataKey="currentRPM" name="currentRPM" radius={[4, 4, 0, 0]} barSize={22}>
                    {overuseData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.currentRPM > entry.limitRPM ? '#ef4444' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-72 text-slate-500 text-sm">No overuse data available</div>
          )}
        </div>

        {/* Most Abused API Endpoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader
            icon={<ShieldAlert className="w-4 h-4 text-red-400" />}
            title="Most Abused API Endpoints"
            subtitle="API routes receiving the highest volume of suspicious or policy-violating requests."
            tooltip="This chart ranks API endpoints by the number of abuse attempts detected. Red endpoints are Critical — they are actively being exploited or flooded. These endpoints should be reviewed for additional rate limiting, authentication enforcement, or temporary blocking."
          />
          <div className="mb-1 text-[11px] text-slate-600 pl-1">X-axis: Number of abuse violations detected in the last 24 hours</div>
          {abusedEndpoints.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={abusedEndpoints} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#475569"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Number of Abuse Violations Detected', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 11 }}
                  />
                  <YAxis
                    dataKey="endpoint"
                    type="category"
                    width={185}
                    stroke="#475569"
                    tick={{ fill: '#cbd5e1', fontSize: 10, fontFamily: 'monospace', fontWeight: 500 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={({ active, payload, label }: any) => {
                      if (!active || !payload?.length) return null;
                      const entry = abusedEndpoints.find(e => e.endpoint === label);
                      return (
                        <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl">
                          <p className="text-slate-100 font-mono font-bold text-sm mb-1">{label}</p>
                          <p className="text-red-400 text-xs font-semibold">{payload[0].value} abuse violations detected</p>
                          <p className="text-slate-400 text-xs mt-1 capitalize">
                            Severity: {entry?.severity === 'critical' ? '🔴 Critical' : entry?.severity === 'high' ? '🟠 High' : '🟡 Medium'}
                          </p>
                        </div>
                      );
                    }}
                    cursor={{ fill: '#1e293b' }}
                  />
                  <Bar dataKey="violations" name="Abuse Violations" radius={[0, 4, 4, 0]} barSize={22}>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top Consumers by Target App */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-800">
            <SectionHeader
              icon={<Activity className="w-4 h-4 text-purple-400" />}
              title="Top API Consumers by Target Application"
              subtitle="Clients or services making the most API calls, grouped by the application they are calling."
              tooltip="This table lists the highest-volume API consumers. The 'Cost' column reflects estimated compute cost of their API usage. Rows highlighted in red exceed their allocated quota. Use 'Rate Limit' to throttle abusive consumers without fully blocking them."
              right={<button className="text-xs text-slate-400 hover:text-white transition-colors">View All</button>}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400 min-w-[500px]">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium tracking-wider">Consumer / Client</th>
                  <th className="px-5 py-3 font-medium tracking-wider">Target Application</th>
                  <th className="px-5 py-3 font-medium tracking-wider">API Calls</th>
                  <th className="px-5 py-3 font-medium tracking-wider">Est. Cost</th>
                  <th className="px-5 py-3 font-medium tracking-wider text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {topConsumers.map((row, idx) => (
                  <tr key={idx} className={`hover:bg-slate-800/50 transition-colors ${row.isOveruse ? 'bg-red-950/10' : ''}`}>
                    <td className="px-5 py-3 font-mono text-slate-200 text-xs font-semibold">{row.consumer}</td>
                    <td className="px-5 py-3 text-blue-400 text-xs font-medium">{row.app}</td>
                    <td className="px-5 py-3 text-xs text-slate-300">{row.calls}</td>
                    <td className={`px-5 py-3 font-semibold text-xs ${row.isOveruse ? 'text-red-400' : 'text-slate-300'}`}>
                      {row.cost}
                      {row.isOveruse && <span className="ml-1 text-red-400">⚠ Over quota</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleBlockRoute(row.app.replace(/\[|\]/g, ''), row.path)}
                        className={`text-xs px-3 py-1 rounded border transition-all ${
                          row.actionType === 'warning'
                            ? 'border-orange-500 text-orange-400 hover:bg-orange-500/10'
                            : row.actionType === 'critical'
                              ? 'border-red-500 text-red-400 hover:bg-red-500/10'
                              : 'border-slate-600 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {row.actionLabel}
                      </button>
                    </td>
                  </tr>
                ))}
                {topConsumers.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500 text-xs">No consumer data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active API Mitigation Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-800">
            <SectionHeader
              icon={<Lock className="w-4 h-4 text-emerald-400" />}
              title="Active API Mitigation Feed"
              subtitle="Live feed of ongoing security mitigations applied to API routes and consumers."
              tooltip="Each row represents an active mitigation applied in response to a detected threat. 'Hard Block' means the request source has been completely banned from the route. 'Rate Limit' means requests are being throttled. These actions can be reversed from the Incident Management panel."
              right={
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  <span className="text-xs text-red-400 font-medium">Live</span>
                </div>
              }
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400 min-w-[440px]">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs">
                <tr>
                  <th className="px-5 py-3 font-medium tracking-wider">Affected App / Offender</th>
                  <th className="px-5 py-3 font-medium tracking-wider">Policy Violation</th>
                  <th className="px-5 py-3 font-medium tracking-wider text-right">Mitigation Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {mitigationFeed.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-blue-400 font-semibold text-sm mb-1">{row.target}</div>
                      <div className="font-mono text-xs text-slate-500">{row.offender}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-200 font-semibold text-sm">{row.violation}</div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{row.details}</div>
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
                    All routes operating normally — no active mitigations in effect
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
