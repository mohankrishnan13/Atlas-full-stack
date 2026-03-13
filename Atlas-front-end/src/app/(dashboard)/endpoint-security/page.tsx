'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield, AlertTriangle, Lock, Ban, UserX,
  Activity, Laptop, Info, LoaderCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, CartesianGrid, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent } from '@/lib/types';

// --- Enhanced Components ---
const InfoTooltip = React.memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-slate-500 hover:text-blue-400 transition-colors" aria-label="More information"><Info className="w-4 h-4" /></button>
      {open && <div className="absolute z-50 left-6 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">{text}</div>}
    </div>
  );
});
InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(({ icon, title, subtitle, tooltipText }: { icon: React.ReactNode; title: string; subtitle: string; tooltipText: string; }) => (
    <div className="mb-5 px-5 pt-5">
      <div className="flex items-center gap-2 mb-1">{icon}<h2 className="text-base font-semibold text-slate-100">{title}</h2><InfoTooltip text={tooltipText} /></div>
      <p className="text-xs text-slate-500 leading-relaxed pl-7">{subtitle}</p>
    </div>
));
SectionHeader.displayName = 'SectionHeader';

const SeverityBadge = React.memo(({ severity }: { severity: string }) => {
  const map: Record<string, string> = { Critical: 'text-red-400 bg-red-500/10 border-red-500/40', High: 'text-orange-400 bg-orange-500/10 border-orange-500/40', Medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40', Low: 'text-blue-400 bg-blue-500/10 border-blue-500/40' };
  return <span className={`text-xs px-2 py-0.5 rounded border font-semibold whitespace-nowrap ${map[severity] ?? 'text-slate-400 border-slate-600'}`}>{severity}</span>;
});
SeverityBadge.displayName = 'SeverityBadge';

const EventRow = ({ ev, onQuarantine }: { ev: WazuhEvent; onQuarantine: (id: string, employee: string) => void }) => {
    const [expanded, setExpanded] = useState(false);
    const safeEv = ev || {};
    return (
      <>
        <tr className={`hover:bg-slate-800/40 transition-colors cursor-pointer border-b border-slate-800 ${safeEv.severity === 'Critical' ? 'bg-red-950/20' : ''}`} onClick={() => setExpanded(!expanded)}>
          <td className="px-5 py-4 whitespace-nowrap"><span className="text-slate-400 font-mono text-xs">{safeEv.timestamp ? new Date(safeEv.timestamp).toLocaleTimeString() : 'N/A'}</span></td>
          <td className="px-5 py-4"><div className="font-mono text-sm">{safeEv.workstationId || 'Unknown ID'}</div><div className="text-xs text-slate-400">{safeEv.employee || 'Unknown User'}</div></td>
          <td className="px-5 py-4"><div className="flex items-start gap-2"><AlertTriangle className={`w-4 h-4 ${safeEv.severity === 'Critical' ? 'text-red-500' : 'text-orange-500'} mt-0.5 flex-shrink-0`} /><span className={`text-sm ${safeEv.severity === 'Critical' ? 'text-red-300' : 'text-slate-300'}`}>{safeEv.alert || 'No description'}</span></div></td>
          <td className="px-5 py-4"><SeverityBadge severity={safeEv.severity || 'Info'} /></td>
          <td className="px-5 py-4 text-right"><div className="flex justify-end items-center gap-2"><button onClick={(e) => { e.stopPropagation(); onQuarantine(safeEv.workstationId || '', safeEv.employee || ''); }} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1.5"><Ban className="w-3 h-3" />QUARANTINE</button>{expanded ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}</div></td>
        </tr>
        {expanded && <tr className="bg-slate-950/50 border-b border-slate-800"><td colSpan={5} className="p-4 bg-slate-900"><pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono bg-slate-950 p-2 rounded-md">{JSON.stringify(safeEv, null, 2)}</pre></td></tr>}
      </>
    );
  }

// --- Utilities and Chart Tooltips ---
const truncateLabel = (label: string, maxLength = 10) => {
  if (typeof label !== 'string') return '';
  return label.length > maxLength ? `${label.substring(0, maxLength)}...` : label;
};

const CustomTooltipContent = ({ active, payload, label, fullLabels }: any) => {
  if (active && payload && payload.length) {
    const fullLabel = fullLabels?.[label] || label;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl max-w-xs">
        <p className="font-bold text-slate-200 truncate" title={fullLabel}>{fullLabel}</p>
        <p className="text-slate-300 mt-1" style={{ color: payload[0].fill }}>{`${payload[0].name}: ${Number(payload[0].value || 0).toLocaleString()}`}</p>
      </div>
    );
  }
  return null;
};

export default function EndpointSecurityPage() {
  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<EndpointSecurityData>(`/endpoint-security`).then(setData).catch((err) => toast.error('Failed to load endpoint data', { description: err.message })).finally(() => setLoading(false));
  }, [environment]);

  const handleQuarantine = async (workstation_id: string, employee: string) => {
    if (!workstation_id) {
      toast.error('Missing workstation ID for quarantine action.');
      return;
    }
    try {
      await apiPost('/endpoint-security/quarantine', { workstation_id, employee_name: employee });
      toast.success('Device Quarantined', { description: `${workstation_id} has been isolated.` });
    } catch (err) { 
      toast.error('Failed to Quarantine Device', { description: err instanceof ApiError ? err.message : 'Could not connect to EDR agent.' });
     }
  };

  const { 
    safeMonitored, safeOffline, safeMalwareAlerts, 
    osDistribution, osFullLabels,
    alertTypes, alertTypesFullLabels,
    safeWazuhEvents 
  } = useMemo(() => {
    const epData = data || {};
    const osDist = (epData.osDistribution || []).map(d => ({ ...d, name: d.name || 'Unknown', value: Number(d.value) || 0 }));
    const alertDist = (epData.alertTypes || []).map(d => ({ ...d, name: d.name || 'Unknown', value: Number(d.value) || 0 }));

    return {
        safeMonitored: Number(epData.monitoredLaptops) || 0,
        safeOffline: Number(epData.offlineDevices) || 0,
        safeMalwareAlerts: Number(epData.malwareAlerts) || 0,
        osDistribution: osDist,
        osFullLabels: osDist.reduce((acc, i) => ({ ...acc, [truncateLabel(i.name)]: i.name }), {}),
        alertTypes: alertDist,
        alertTypesFullLabels: alertDist.reduce((acc, i) => ({ ...acc, [truncateLabel(i.name)]: i.name }), {}),
        safeWazuhEvents: (epData.wazuhEvents || []),
    }
  }, [data]);

  const criticalEvents = useMemo(() => safeWazuhEvents.filter(ev => ev.severity === 'Critical'), [safeWazuhEvents]);

  if (loading) return <div className="p-6 flex justify-center"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No endpoint security data available.</div>;

  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Endpoint Security</h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time monitoring of managed endpoints, policy compliance, and threats.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-semibold text-slate-400 mb-1">Monitored Laptops</h3><div className="text-3xl font-bold text-green-400">{safeMonitored}</div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-semibold text-slate-400 mb-1">Offline Devices</h3><div className="text-3xl font-bold text-orange-400">{safeOffline}</div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-semibold text-slate-400 mb-1">Malware Alerts (24h)</h3><div className="text-3xl font-bold text-red-400">{safeMalwareAlerts}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Laptop className="w-4 h-4 text-blue-400" />} title="OS Distribution" subtitle="Distribution of operating systems across all endpoints" tooltipText="Provides an overview of the OS landscape, which can be crucial for vulnerability management."/>
          <div className="px-5 pb-5">
          {osDistribution.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={osDistribution} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(val) => truncateLabel(val)} tickLine={false} axisLine={{ stroke: '#334155' }} interval={0} >
                    <Label value="Operating System" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis stroke="#475569" width={60} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                    <Label value="Count" angle={-90} position="insideLeft" style={{textAnchor: 'middle'}} className="fill-slate-500 text-xs"/>
                </YAxis>
                <RechartsTooltip content={<CustomTooltipContent fullLabels={osFullLabels} />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]} barSize={30}>{(osDistribution || []).map((e, i) => <Cell key={`cell-${i}`} fill={e.fill || '#3b82f6'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-slate-500">No OS distribution data available.</div>
          )}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<AlertTriangle className="w-4 h-4 text-orange-400" />} title="Alert Types by Category" subtitle="Breakdown of all alerts by their category" tooltipText="Helps identify the most common types of threats or policy violations occurring in the environment."/>
          <div className="px-5 pb-5">
          {alertTypes.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart layout="vertical" data={alertTypes} margin={{ top: 0, right: 30, left: 20, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155'}}>
                    <Label value="Alert Count" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis dataKey="name" type="category" stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 12 }} width={110} tickLine={false} interval={0} tickFormatter={(val) => truncateLabel(val, 15)} />
                <RechartsTooltip content={<CustomTooltipContent fullLabels={alertTypesFullLabels} />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="value" name="Alerts" radius={[0, 4, 4, 0]} barSize={16}>{(alertTypes || []).map((e, i) => <Cell key={i} fill={e.fill || '#f97316'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-slate-500">No alert category data available.</div>
          )}
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <SectionHeader icon={<Activity className="w-4 h-4 text-red-400" />} title="Endpoint Event Log & Response" subtitle={`Live stream of ${safeWazuhEvents.length} EDR agent alerts`} tooltipText="Click a row to expand the full JSON log. Critical events require immediate quarantine action." />
        {safeWazuhEvents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[800px]"><thead><tr className="bg-slate-950 border-b border-slate-800"><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Timestamp</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Endpoint & User</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Threat Description</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400">Severity</th><th className="px-5 py-3 text-xs uppercase font-medium text-slate-400 text-right">Actions</th></tr></thead>
              <tbody>{(safeWazuhEvents || []).map((ev, i) => <EventRow key={ev.id || i} ev={ev} onQuarantine={handleQuarantine} />)}</tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500">No endpoint events logged.</div>
        )}
      </div>
    </div>
  );
}
