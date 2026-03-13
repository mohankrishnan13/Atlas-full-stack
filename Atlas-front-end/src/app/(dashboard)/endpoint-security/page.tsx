'use client';

import React, { useEffect, useState } from 'react';
import {
  Shield, AlertTriangle, Lock, Ban, UserX,
  Activity, ShieldAlert, Laptop, Info, TrendingUp,
  ChevronDown, ChevronUp, LoaderCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, CartesianGrid, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent, PolicyViolator } from '@/lib/types';

// --- Reusable Components ---
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-slate-500 hover:text-blue-400 transition-colors" aria-label="More information"><Info className="w-4 h-4" /></button>
      {open && <div className="absolute z-50 left-6 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">{text}</div>}
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, tooltipText }: { icon: React.ReactNode; title: string; subtitle: string; tooltipText: string; }) {
  return (
    <div className="mb-5 px-5 pt-5">
      <div className="flex items-center gap-2 mb-1">{icon}<h2 className="text-base font-semibold text-slate-100">{title}</h2><InfoTooltip text={tooltipText} /></div>
      <p className="text-xs text-slate-500 leading-relaxed pl-7">{subtitle}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: 'Critical' | 'High' | 'Medium' | 'Low' | string }) {
  const map: Record<string, string> = { Critical: 'text-red-400 bg-red-500/10 border-red-500/40', High: 'text-orange-400 bg-orange-500/10 border-orange-500/40', Medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40', Low: 'text-blue-400 bg-blue-500/10 border-blue-500/40' };
  return <span className={`text-xs px-2 py-0.5 rounded border font-semibold whitespace-nowrap ${map[severity] ?? 'text-slate-400 border-slate-600'}`}>{severity}</span>;
}

function EventRow({ ev, onQuarantine }: { ev: WazuhEvent; onQuarantine: (id: string, employee: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className={`hover:bg-slate-800/40 transition-colors cursor-pointer border-b border-slate-800 ${ev.severity === 'Critical' ? 'bg-red-950/20' : ''}`} onClick={() => setExpanded(!expanded)}>
        <td className="px-5 py-4 whitespace-nowrap"><span className="text-slate-400 font-mono text-xs">{new Date(ev.timestamp).toLocaleTimeString()}</span></td>
        <td className="px-5 py-4"><div className="font-mono text-sm">{ev.workstation_id}</div><div className="text-xs text-slate-400">{ev.employee_name}</div></td>
        <td className="px-5 py-4"><div className="flex items-start gap-2"><AlertTriangle className={`w-4 h-4 ${ev.severity === 'Critical' ? 'text-red-500' : 'text-orange-500'} mt-0.5 flex-shrink-0`} /><span className={`text-sm ${ev.severity === 'Critical' ? 'text-red-300' : 'text-slate-300'}`}>{ev.description}</span></div></td>
        <td className="px-5 py-4"><SeverityBadge severity={ev.severity} /></td>
        <td className="px-5 py-4 text-right"><div className="flex justify-end items-center gap-2"><button onClick={(e) => { e.stopPropagation(); onQuarantine(ev.workstation_id, ev.employee_name); }} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1.5"><Ban className="w-3 h-3" />QUARANTINE</button>{expanded ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}</div></td>
      </tr>
      {expanded && <tr className="bg-slate-950/50 border-b border-slate-800"><td colSpan={5} className="p-4 bg-slate-900"><pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono bg-slate-950 p-2 rounded-md">{JSON.stringify(ev.full_log, null, 2)}</pre></td></tr>}
    </>
  );
}

export default function EndpointSecurityPage() {
  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<EndpointSecurityData>(`/endpoint-security`).then(setData).catch((err) => toast.error('Failed to load endpoint security data', { description: err.message })).finally(() => setLoading(false));
  }, [environment]);

  const handleQuarantine = async (workstation_id: string, employee: string) => {
    try {
      await apiPost('/endpoint-security/quarantine', { workstation_id, employee_name: employee });
      toast.success('Device Quarantined', { description: `${workstation_id} (${employee}) has been isolated from the network.` });
    } catch (err) { 
      toast.error('Failed to Quarantine Device', { description: err instanceof ApiError ? err.message : 'Could not connect to EDR agent.' });
     }
  };

  if (loading) return <div className="p-6"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No endpoint security data available from backend.</div>;

  // Safe Variable Parsing
  const { malwareAlerts, policyViolations, highRiskUsers, wazuhEvents } = data;
  const safeMonitored = Number(data.monitoredEndpoints) || 0;
  const safeOffline = Number(data.offlineEndpoints) || 0;

  const formattedVulnerable = data.vulnerableEndpoints.map(e => ({
    ...e, vulnerability_count: Number(e.vulnerability_count) || 0
  }));

  const formattedViolators = data.policyViolators.map(e => ({
    ...e, violation_count: Number(e.violation_count) || 0
  }));

  const criticalEvents = wazuhEvents.filter(ev => ev.severity === 'Critical');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Endpoint Security</h1>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time monitoring of managed endpoints, policy compliance, and threats from the EDR agent schema.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400" />{safeMonitored.toLocaleString()} Monitored</span><span className="text-slate-700">|</span><span className="flex items-center gap-1.5 text-orange-400"><span className="w-2 h-2 rounded-full bg-orange-400" />{safeOffline.toLocaleString()} Offline</span></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="bg-slate-900 border border-red-900/50 rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-1"><ShieldAlert className="w-4 h-4 text-red-500" /><h2 className="text-base font-semibold text-slate-100">Active Malware Infections</h2></div>
            <p className="text-xs text-slate-500 leading-relaxed pl-7 mb-3">Devices with confirmed malicious process activity.</p>
            <div className="text-3xl font-extrabold text-red-400 mb-3">{malwareAlerts} <span className="text-lg font-medium text-slate-400">Devices Compromised</span></div>
            <button onClick={() => handleQuarantine(criticalEvents[0].workstation_id, criticalEvents[0].employee_name)} disabled={criticalEvents.length === 0} className="w-full py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center justify-center gap-2 disabled:bg-red-900/50 disabled:cursor-not-allowed"><Ban className="w-4 h-4" />ISOLATE ALL</button>
        </div>
        <div className="bg-slate-900 border border-orange-900/50 rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-1"><Lock className="w-4 h-4 text-orange-500" /><h2 className="text-base font-semibold text-slate-100">Critical Policy Violations</h2></div>
            <p className="text-xs text-slate-500 leading-relaxed pl-7 mb-3">Devices violating mandatory security policies.</p>
            <div className="text-3xl font-extrabold text-orange-400 mb-3">{policyViolations} <span className="text-lg font-medium text-slate-400">Non-Compliant Devices</span></div>
            <button onClick={() => toast.info('Force-enabling endpoint protection for all non-compliant devices…')} className="w-full py-2 text-sm font-bold text-orange-300 border border-orange-500/40 hover:bg-orange-900/20 rounded-lg flex items-center justify-center gap-2"><Shield className="w-4 h-4" />FORCE ENABLE PROTECTION</button>
        </div>
        <div className="bg-slate-900 border border-yellow-900/50 rounded-xl p-5 flex flex-col justify-between">
            <div className="flex items-center gap-2 mb-1"><UserX className="w-4 h-4 text-yellow-500" /><h2 className="text-base font-semibold text-slate-100">High-Risk Users</h2></div>
            <p className="text-xs text-slate-500 leading-relaxed pl-7 mb-3">Users with significant behavioral anomalies.</p>
            <div className="text-3xl font-extrabold text-yellow-400 mb-3">{highRiskUsers} <span className="text-lg font-medium text-slate-400">Users Flagged</span></div>
             <button onClick={() => toast.info('Temporarily locking all high-risk user accounts…')} className="w-full py-2 text-sm font-bold text-yellow-300 border border-yellow-500/40 hover:bg-yellow-900/20 rounded-lg flex items-center justify-center gap-2"><Lock className="w-4 h-4" />LOCK ACCOUNTS</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Laptop className="w-4 h-4 text-red-400" />} title="Most Vulnerable Endpoints" subtitle="Endpoints with the most detected CVEs." tooltipText="Endpoints ranked by vulnerability count from the CVE index. Red bars require immediate patching." />
          <div className="px-5 pb-5">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" data={formattedVulnerable} margin={{ top: 0, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} >
                <Label value="CVE Count" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
              </XAxis>
              <YAxis dataKey="workstation_id" type="category" stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 12 }} width={115} tickLine={false} />
              <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="vulnerability_count" name="Vulnerabilities" radius={[0, 4, 4, 0]} barSize={24}>{formattedVulnerable.map((e, i) => <Cell key={i} fill={e.vulnerability_count > 10 ? '#ef4444' : e.vulnerability_count > 5 ? '#f97316' : '#eab308'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<AlertTriangle className="w-4 h-4 text-orange-400" />} title="Top Policy Violators" subtitle="Users with the most security policy violations." tooltipText="Frequent violators may indicate intentional evasion or lack of security training." />
          <div className="px-5 pb-5">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={formattedViolators} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="employee_name" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} >
                <Label value="Employee Name" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
              </XAxis>
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} >
                 <Label value="Violation Count" angle={-90} position="left" offset={-5} className="fill-slate-500 text-xs"/>
              </YAxis>
              <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155'}} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="violation_count" name="Violations" radius={[4, 4, 0, 0]} barSize={40}>{formattedViolators.map((e: PolicyViolator, i: number) => <Cell key={i} fill={i === 0 ? '#f97316' : '#fb923c'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <SectionHeader icon={<Activity className="w-4 h-4 text-blue-400" />} title="Endpoint Event Log & Response" subtitle="Real-time stream of EDR agent alerts from the wazuh_events schema." tooltipText="Click a row to expand the full JSON log. Critical events require immediate quarantine action." />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]"><thead><tr className="bg-slate-950 border-b border-slate-800"><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Timestamp</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Endpoint & User</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Threat Description</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Severity</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400 text-right">Actions</th></tr></thead>
            <tbody>{wazuhEvents.map((ev) => <EventRow key={ev.id} ev={ev} onQuarantine={handleQuarantine} />)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}