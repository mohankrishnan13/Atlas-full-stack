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

// --- Reusable Components ---
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1">
      <button onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-slate-500 hover:text-blue-400 transition-colors" aria-label="More information">
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && <div className="absolute z-50 left-5 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">{text}</div>}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, tooltip, right }: { icon: React.ReactNode; title: string; subtitle: string; tooltip: string; right?: React.ReactNode; }) {
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

function StatCard({ value, label, subtitle, tooltip, color = 'default', icon: Icon }: { value: string | number; label: string; subtitle: string; tooltip: string; color?: 'default' | 'red' | 'green' | 'orange'; icon?: React.ComponentType<{ className?: string }>; }) {
  const colors = { default: 'text-slate-200', red: 'text-red-400', green: 'text-emerald-400', orange: 'text-orange-400' };
  const expandedValue = String(value).replace(/req\/m/gi, ' Req/min').replace(/(\d+)%\s*Cap/gi, '$1% Capacity').replace(/(\d+)%\s*Avail/gi, '$1% Available');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-2"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1">{label}<InfoTooltip text={tooltip} /></div>{Icon && <Icon className={`w-6 h-6 ${colors[color]} opacity-50`} />}</div>
      <div className={`text-2xl font-extrabold ${colors[color]} leading-tight`}>{expandedValue}</div>
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"><div className="h-28 bg-slate-800 rounded-xl" /><div className="h-28 bg-slate-800 rounded-xl" /><div className="h-28 bg-slate-800 rounded-xl" /><div className="h-28 bg-slate-800 rounded-xl" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><div className="h-96 bg-slate-800 rounded-xl" /><div className="h-96 bg-slate-800 rounded-xl" /></div>
    </div>
  );
}

export default function ApiMonitoringPage() {
  const [data, setData] = useState<FigmaApiMonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<FigmaApiMonitoringResponse>(`/figma/api-monitoring`).then(setData).catch(err => toast.error('Failed to load API data.', { description: err instanceof ApiError ? err.message : 'Request failed.' })).finally(() => setLoading(false));
  }, [environment]);

  const handleBlockRoute = async (app: string, path: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app, path });
      toast.success('Hard Block Applied', { description: `Route ${app} ${path} blocked.` });
    } catch (err) {
      toast.error('Block action failed.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No API monitoring data.</div>;

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-400" />API Monitoring</h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time request volume, rate limit enforcement, and threat detection</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard value={data.totalApiCallsLabel} label="Total API Calls" subtitle="Cumulative requests today" tooltip="Total API requests processed across all monitored applications since midnight." icon={Activity} />
        <StatCard value={data.blockedThreatsLabel} label="Blocked Threats" subtitle="Malicious requests blocked" tooltip="Requests blocked by rate limits and WAF rules for suspicious payloads or flagged IPs." color="red" icon={Ban} />
        <StatCard value={data.globalAvailabilityLabel} label="Global API Availability" subtitle="Successful response rate" tooltip="Percentage of successful API requests. Below 99% suggests a systemic issue." color="green" icon={TrendingUp} />
        <StatCard value={data.activeIncidentsLabel} label="Active Incidents" subtitle="Security events requiring attention" tooltip="Open security events escalated from anomaly detection that require human review or mitigation." color="orange" icon={ShieldAlert} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><SectionHeader icon={<Server className="w-4 h-4 text-blue-400" />} title="API Overuse by Application" subtitle="Request rate vs. rate limit for each application." tooltip="Shows current traffic vs. configured rate limits. Red bars indicate an application is exceeding its limit." />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.apiOveruseByTargetApp} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="targetApp" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
              <Legend wrapperStyle={{ paddingTop: '12px', fontSize: '11px' }} />
              <Bar dataKey="limitRpm" name="Rate Limit" fill="#334155" radius={[4, 4, 0, 0]} barSize={22} />
              <Bar dataKey="currentRpm" name="Current RPM" radius={[4, 4, 0, 0]} barSize={22}>{data.apiOveruseByTargetApp.map((e, i) => <Cell key={i} fill={e.currentRpm > e.limitRpm ? '#ef4444' : '#3b82f6'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><SectionHeader icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Most Abused API Endpoints" subtitle="API routes with the most suspicious requests." tooltip="Ranks API endpoints by detected abuse attempts. Red endpoints are critical and require review." />
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.mostAbusedEndpoints} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
              <YAxis dataKey="endpoint" type="category" width={185} stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="violations" name="Abuse Violations" radius={[0, 4, 4, 0]} barSize={22}>{data.mostAbusedEndpoints.map((e, i) => <Cell key={i} fill={e.severity === 'critical' ? '#ef4444' : e.severity === 'high' ? '#f97316' : '#eab308'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl"><SectionHeader icon={<Activity className="w-4 h-4 text-purple-400" />} title="Top API Consumers" subtitle="Clients making the most API calls." tooltip="Lists high-volume API consumers. Red rows indicate quota overuse. Use actions to mitigate." />
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-950 text-slate-500 uppercase text-xs"><th className="px-5 py-3">Consumer</th><th className="px-5 py-3">Target</th><th className="px-5 py-3">Calls</th><th className="px-5 py-3">Cost</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-800">{data.topConsumersByTargetApp.map((row, i) => <tr key={i} className={row.isOveruse ? 'bg-red-950/20' : ''}><td className="px-5 py-3 font-mono text-xs">{row.consumer}</td><td className="px-5 py-3 text-blue-400 text-xs">{row.targetApp}</td><td className="px-5 py-3 text-xs">{row.callsLabel}</td><td className={`px-5 py-3 text-xs ${row.isOveruse ? 'text-red-400' : ''}`}>{row.costLabel}</td><td className="px-5 py-3 text-right"><button onClick={() => handleBlockRoute(row.targetApp, '/*')} className={`text-xs px-3 py-1 rounded border ${row.actionType === 'critical' ? 'border-red-500 text-red-400' : 'border-slate-600 text-slate-400'}`}>{row.actionLabel}</button></td></tr>)}</tbody></table></div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl"><SectionHeader icon={<Lock className="w-4 h-4 text-emerald-400" />} title="Active Mitigation Feed" subtitle="Live feed of ongoing security mitigations." tooltip="Shows active mitigations like blocks or rate limits. Actions can be reversed in Incident Management." />
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-950 text-slate-500 uppercase text-xs"><th className="px-5 py-3">Target/Offender</th><th className="px-5 py-3">Violation</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-800">{data.activeMitigationFeed.map((row, i) => <tr key={i}><td className="px-5 py-4"><div className="font-semibold text-blue-400">{row.target}</div><div className="text-xs text-slate-500 font-mono">{row.offender}</div></td><td className="px-5 py-4"><div className="font-semibold">{row.violation}</div><div className="text-xs text-slate-500">{row.details}</div></td><td className="px-5 py-4 text-right"><button className={`text-xs font-semibold px-3 py-1.5 rounded ${row.actionColor === 'red' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>{row.actionLabel}</button></td></tr>)}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}
