'use client';

import React, { useEffect, useState } from 'react';
import {
  Shield, AlertTriangle, Lock, Ban, Zap, UserX,
  Activity, ShieldAlert, Laptop, Info, TrendingUp,
  SkipForward, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent } from '@/lib/types';

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

function SectionHeader({ icon, title, subtitle, tooltip, badge }: { icon: React.ReactNode; title: string; subtitle: string; tooltip: string; badge?: React.ReactNode; }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1">{icon}<h2 className="text-base font-semibold text-slate-100">{title}</h2>{badge}<InfoTooltip text={tooltip} /></div>
      <p className="text-xs text-slate-500 leading-relaxed pl-7">{subtitle}</p>
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const map: Record<string, string> = { Critical: 'text-red-400 bg-red-500/10 border-red-500/40', High: 'text-orange-400 bg-orange-500/10 border-orange-500/40', Medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40', Low: 'text-blue-400 bg-blue-500/10 border-blue-500/40' };
  return <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${map[sev] ?? 'text-slate-400 border-slate-600'}`}>{sev}</span>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"><div className="h-52 bg-slate-800 rounded-xl" /><div className="h-52 bg-slate-800 rounded-xl" /><div className="h-52 bg-slate-800 rounded-xl" /></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><div className="h-80 bg-slate-800 rounded-xl" /><div className="h-80 bg-slate-800 rounded-xl" /></div>
      <div className="h-64 bg-slate-800 rounded-xl" />
    </div>
  );
}

function EventRow({ ev, onQuarantine }: { ev: WazuhEvent; onQuarantine: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className={`hover:bg-slate-800/40 transition-colors cursor-pointer border-b border-slate-800 ${ev.severity === 'Critical' ? 'bg-red-950/10' : ''}`} onClick={() => setExpanded(!expanded)}>
        <td className="px-5 py-4 whitespace-nowrap"><span className="text-slate-400 font-mono text-xs">{new Date().toLocaleTimeString()}</span></td>
        <td className="px-5 py-4"><div className="font-mono text-sm">{ev.workstationId}</div><div className="text-xs text-slate-400">{ev.employee}</div></td>
        <td className="px-5 py-4"><div className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-red-500 mt-0.5" /><span className={`text-sm ${ev.severity === 'Critical' ? 'text-red-300' : 'text-slate-300'}`}>{ev.alert}</span></div></td>
        <td className="px-5 py-4"><SeverityBadge sev={ev.severity} /></td>
        <td className="px-5 py-4 text-right"><div className="flex justify-end items-center gap-2"><button onClick={(e) => { e.stopPropagation(); onQuarantine(ev.workstationId); }} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1.5"><Ban className="w-3 h-3" />Quarantine</button>{expanded ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}</div></td>
      </tr>
      {expanded && <tr className="bg-slate-950/50 border-b border-slate-800"><td colSpan={5} className="px-10 py-3"><div className="text-xs text-slate-400">Device OS: Windows 11 Pro | Last Seen: 2 mins ago | Process ID: 4821</div></td></tr>}
    </>
  );
}

export default function EndpointSecurityPage() {
  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<EndpointSecurityData>(`/endpoint-security`).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [environment]);

  const handleQuarantine = async (workstationId: string) => {
    try {
      await apiPost('/endpoint-security/quarantine', { workstationId });
      toast.success('Device Quarantined', { description: `${workstationId} has been isolated.` });
    } catch { toast.error('Failed to quarantine device.'); }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No endpoint security data.</div>;

  const vulnerableEndpoints = [{ name: 'WKST-2088', vulnerabilities: 12 }, { name: 'LAPTOP-DEV-04', vulnerabilities: 9 }, { name: 'SRV-DB-02', vulnerabilities: 6 }, { name: 'WKST-HR-01', vulnerabilities: 3 }];
  const policyViolatorsData = [{ user: 's.smith', violations: 15 }, { user: 'm.johnson', violations: 9 }, { user: 'j.doe', violations: 6 }, { user: 'admin_temp', violations: 4 }];
  const compromisedDevices = data.wazuhEvents.filter(ev => ev.severity === 'Critical');

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Endpoint Security</h1>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time monitoring of managed endpoints, policy compliance, and threats</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 animate-ping" />{data.monitoredLaptops} Monitored</span><span className="text-slate-700">|</span><span className="flex items-center gap-1.5 text-orange-400"><span className="w-2 h-2 rounded-full bg-orange-400" />{data.offlineDevices} Offline</span></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-red-500" />} title="Active Malware Infections" subtitle="Devices with confirmed malicious activity." tooltip="These devices have triggered malware detection and should be isolated immediately." />
            <div className="text-3xl font-extrabold text-red-400 mb-3">{data.malwareAlerts} <span className="text-lg font-medium text-slate-400">Devices Compromised</span></div>
            <button onClick={() => handleQuarantine(compromisedDevices[0].workstationId)} className="w-full py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg flex items-center justify-center gap-2"><Ban className="w-4 h-4" />Isolate All</button>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <SectionHeader icon={<Lock className="w-4 h-4 text-orange-500" />} title="Critical Policy Violations" subtitle="Devices violating mandatory security policies." tooltip="These endpoints are non-compliant with security controls like antivirus or firewalls." />
            <div className="text-3xl font-extrabold text-orange-400 mb-3">{data.wazuhEvents.filter(e => e.severity === 'High').length} <span className="text-lg font-medium text-slate-400">Non-Compliant Devices</span></div>
            <button onClick={() => toast.info('Force-enabling endpoint protection…')} className="w-full py-2 text-sm font-bold text-orange-300 border border-orange-500/40 hover:bg-orange-900/20 rounded-lg flex items-center justify-center gap-2"><Shield className="w-4 h-4" />Force Enable Protection</button>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <SectionHeader icon={<UserX className="w-4 h-4 text-yellow-500" />} title="High-Risk Users" subtitle="Users with significant behavioral anomalies." tooltip="Anomaly scores are based on login patterns, data access, and device usage. High scores may indicate compromise." />
            <div className="text-3xl font-extrabold text-yellow-400 mb-3">{data.wazuhEvents.filter(e => e.severity === 'Medium').length} <span className="text-lg font-medium text-slate-400">Users Flagged</span></div>
             <button onClick={() => toast.info('Locking high-risk user accounts…')} className="w-full py-2 text-sm font-bold text-yellow-300 border border-yellow-500/40 hover:bg-yellow-900/20 rounded-lg flex items-center justify-center gap-2"><Lock className="w-4 h-4" />Lock Accounts</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><SectionHeader icon={<Laptop className="w-4 h-4 text-red-400" />} title="Most Vulnerable Endpoints" subtitle="Devices with the most detected security weaknesses." tooltip="Endpoints ranked by vulnerability count. Red bars require immediate patching." />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart layout="vertical" data={vulnerableEndpoints} margin={{ top: 0, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis dataKey="name" type="category" stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 12 }} width={105} />
              <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="vulnerabilities" name="Vulnerabilities" radius={[0, 4, 4, 0]} barSize={24}>{vulnerableEndpoints.map((e, i) => <Cell key={i} fill={e.vulnerabilities > 10 ? '#ef4444' : e.vulnerabilities > 5 ? '#f97316' : '#eab308'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><SectionHeader icon={<AlertTriangle className="w-4 h-4 text-orange-400" />} title="Top Policy Violators" subtitle="Users with the most policy violations." tooltip="Frequent violators may indicate intentional evasion or lack of security training." />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={policyViolatorsData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="user" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <RechartsTooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155'}} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="violations" name="Violations" radius={[4, 4, 0, 0]} barSize={40}>{policyViolatorsData.map((e, i) => <Cell key={i} fill={i === 0 ? '#f97316' : '#fb923c'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden"><SectionHeader icon={<Activity className="w-4 h-4 text-blue-400" />} title="Endpoint Event Log & Response" subtitle="Real-time log of endpoint security alerts." tooltip="Click a row to expand context. Critical events require immediate action." />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]"><thead><tr className="bg-slate-950 border-b border-slate-800"><th className="px-5 py-3 text-xs uppercase font-medium">Timestamp</th><th className="px-5 py-3 text-xs uppercase font-medium">Endpoint & User</th><th className="px-5 py-3 text-xs uppercase font-medium">Threat</th><th className="px-5 py-3 text-xs uppercase font-medium">Severity</th><th className="px-5 py-3 text-xs uppercase font-medium text-right">Actions</th></tr></thead>
            <tbody>{data.wazuhEvents.map((ev) => <EventRow key={ev.id} ev={ev} onQuarantine={handleQuarantine} />)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
