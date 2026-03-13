'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, ShieldAlert, Server, Lock, Ban,
  TrendingUp, AlertTriangle, Info, LoaderCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import { APIMonitoringData, MostAbusedEndpoints } from '@/lib/types';

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

function SectionHeader({ icon, title, subtitle, tooltipText }: { icon: React.ReactNode; title: string; subtitle: string; tooltipText: string; }) {
  return (
    <div className="mb-4 px-5 pt-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <InfoTooltip text={tooltipText} />
      </div>
      <p className="text-[11px] text-slate-500 mt-1 pl-6 leading-relaxed">{subtitle}</p>
    </div>
  );
}

function StatCard({ value, label, subtitle, tooltipText, color = 'default', icon: Icon }: { value: string | number; label: string; subtitle: string; tooltipText: string; color?: 'default' | 'red' | 'green' | 'orange'; icon?: React.ComponentType<{ className?: string }>; }) {
  const colors = { default: 'text-slate-200', red: 'text-red-400', green: 'text-emerald-400', orange: 'text-orange-400' };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-2"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1">{label}<InfoTooltip text={tooltipText} /></div>{Icon && <Icon className={`w-6 h-6 ${colors[color]} opacity-50`} />}</div>
      <div className={`text-2xl font-extrabold ${colors[color]} leading-tight`}>{value}</div>
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
    </div>
  );
}


export default function ApiMonitoringPage() {
  const [data, setData] = useState<APIMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<APIMonitoringData>(`/api-monitoring`).then(setData).catch(err => toast.error('Failed to load API data.', { description: err instanceof ApiError ? err.message : 'Request failed.' })).finally(() => setLoading(false));
  }, [environment]);

  const handleBlockRoute = async (app_name: string, path: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app_name, path });
      toast.success('Hard Block Applied', { description: `Route ${path} for ${app_name} has been blocked.` });
    } catch (err) {
      toast.error('Block action failed.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  if (loading) return <div className="p-6"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No API monitoring data available from backend.</div>;
  
  const { totalApiCalls, blockedThreats, globalAvailability, activeIncidents, apiOveruse, mostAbusedEndpoints, topConsumers, activeMitigations } = data;

  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-400" />API Monitoring</h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time request volume, rate limit enforcement, and threat detection from the application_telemetry schema.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard value={totalApiCalls.toLocaleString()} label="Total API Calls" subtitle="Cumulative requests today" tooltipText="Total API requests processed across all monitored applications since midnight UTC, sourced from api_logs." icon={Activity} />
        <StatCard value={blockedThreats.toLocaleString()} label="Blocked Threats" subtitle="Malicious requests blocked" tooltipText="Requests blocked by WAF rules for suspicious payloads or flagged IPs, based on the security_events schema." color="red" icon={Ban} />
        <StatCard value={`${globalAvailability}%`} label="Global API Availability" subtitle="Successful response rate" tooltipText="Percentage of successful (2xx/3xx) API requests. Below 99% suggests a systemic issue." color="green" icon={TrendingUp} />
        <StatCard value={activeIncidents} label="Active Incidents" subtitle="Security events requiring attention" tooltipText="Open security incidents escalated from anomaly detection that require human review or mitigation." color="orange" icon={ShieldAlert} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Server className="w-4 h-4 text-blue-400" />} title="API Overuse by Application" subtitle="Request rate vs. configured rate limit" tooltipText="Shows current requests per minute (RPM) vs. the hard-coded rate limit for each application." />
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={apiOveruse} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="application_name" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                  <Label value="Application Name" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                   <Label value="Requests per Minute" angle={-90} position="left" offset={-5} className="fill-slate-500 text-xs"/>
                </YAxis>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
                <Legend wrapperStyle={{ paddingTop: '12px', fontSize: '11px' }} />
                <Bar dataKey="limitRpm" name="Rate Limit (RPM)" fill="#334155" radius={[4, 4, 0, 0]} barSize={22} />
                <Bar dataKey="currentRpm" name="Current RPM" radius={[4, 4, 0, 0]} barSize={22}>{apiOveruse.map((e, i) => <Cell key={i} fill={e.currentRpm > e.limitRpm ? '#ef4444' : '#3b82f6'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Most Abused API Endpoints" subtitle="API routes with the most suspicious requests" tooltipText="Ranks API endpoints by detected abuse attempts based on security event logs." />
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mostAbusedEndpoints} layout="vertical" margin={{ top: 5, right: 30, left: 30, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                  <Label value="Violation Count" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis dataKey="endpoint" type="category" width={150} stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 10 }} tickLine={false} axisLine={false} >
                  <Label value="Endpoint Path" angle={-90} position="left" offset={-20} className="fill-slate-500 text-xs"/>
                </YAxis>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="violations" name="Abuse Violations" radius={[0, 4, 4, 0]} barSize={22}>{mostAbusedEndpoints.map((e: MostAbusedEndpoints, i: number) => <Cell key={i} fill={e.severity === 'critical' ? '#ef4444' : e.severity === 'high' ? '#f97316' : '#eab308'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Activity className="w-4 h-4 text-purple-400" />} title="Top API Consumers" subtitle="Clients making the most API calls" tooltipText="Lists high-volume API consumers. Red rows indicate quota overuse. Use actions to mitigate." />
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-950 text-slate-500 uppercase text-xs"><th className="px-5 py-3 font-semibold">Consumer (IP)</th><th className="px-5 py-3 font-semibold">Target App</th><th className="px-5 py-3 font-semibold">Total Calls</th><th className="px-5 py-3 font-semibold">Avg Cost</th><th className="px-5 py-3 font-semibold text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-800">{topConsumers.map((row, i) => <tr key={i} className={row.is_overuse ? 'bg-red-950/20' : ''}><td className="px-5 py-3 font-mono text-xs">{row.consumer}</td><td className="px-5 py-3 text-blue-400 text-xs">{row.application_name}</td><td className="px-5 py-3 text-xs">{row.total_calls.toLocaleString()}</td><td className={`px-5 py-3 text-xs ${row.is_overuse ? 'text-red-400' : ''}`}>{row.average_cost.toFixed(2)}</td><td className="px-5 py-3 text-right"><button onClick={() => handleBlockRoute(row.application_name, '/*')} className={`text-xs px-3 py-1 rounded border ${row.is_overuse ? 'border-red-500 text-red-400' : 'border-slate-600 text-slate-400'}`}>HARD BLOCK</button></td></tr>)}</tbody></table></div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Lock className="w-4 h-4 text-emerald-400" />} title="Active Mitigation Feed" subtitle="Live feed of ongoing security mitigations" tooltipText="Shows active mitigations like blocks or rate limits sourced from the incidents schema. Actions can be reversed in Incident Management." />
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="bg-slate-950 text-slate-500 uppercase text-xs"><th className="px-5 py-3 font-semibold">Target & Offender</th><th className="px-5 py-3 font-semibold">Violation Type</th><th className="px-5 py-3 font-semibold text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-800">{activeMitigations.map((row, i) => <tr key={i}><td className="px-5 py-4"><div className="font-semibold text-blue-400">{row.target}</div><div className="text-xs text-slate-500 font-mono">External IP (Public): {row.offender}</div></td><td className="px-5 py-4"><div className="font-semibold">{row.violation_type}</div><div className="text-xs text-slate-500">{row.details}</div></td><td className="px-5 py-4 text-right"><button className={`text-xs font-semibold px-3 py-1.5 rounded ${row.action === 'BLOCK' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>{row.action}</button></td></tr>)}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}
