'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  AlertTriangle, Database, ShieldAlert, Lock, Ban,
  Activity, WifiOff, Terminal, LoaderCircle, Info
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { DbMonitoringData, SuspiciousActivity } from '@/lib/types';

// --- Enhanced Components ---
const InfoTooltip = React.memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1">
      <button onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} className="text-slate-500 hover:text-blue-400 transition-colors" aria-label="More information">
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && <div className="absolute z-50 left-5 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">{text}</div>}
    </div>
  );
});
InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(({ icon, title, subtitle, tooltipText }: { icon: React.ReactNode; title: string; subtitle: string; tooltipText: string; }) => (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <InfoTooltip text={tooltipText} />
      </div>
      {subtitle && <p className="text-xs text-slate-500 mt-1 pl-7 leading-relaxed">{subtitle}</p>}
    </div>
));
SectionHeader.displayName = 'SectionHeader';

// --- Utilities and Chart Tooltips ---
const truncateLabel = (label: string, maxLength = 12) => {
  if (typeof label !== 'string') return '';
  return label.length > maxLength ? `${label.substring(0, maxLength)}...` : label;
};

const CustomTooltipContent = ({ active, payload, label, fullLabels }: any) => {
  if (active && payload && payload.length) {
    const fullLabel = fullLabels?.[label] || label;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl max-w-xs">
        <p className="font-bold text-slate-200 truncate" title={fullLabel}>{fullLabel}</p>
        {payload.map((pld: any, index: number) => (
            <p key={index} className="text-slate-300 mt-1" style={{ color: pld.fill }}>
                {`${pld.name}: ${Number(pld.value || 0).toLocaleString()}`}
            </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function DatabaseMonitoringPage() {
  const [data, setData] = useState<DbMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const fetchData = () => {
    setLoading(true);
    apiGet<DbMonitoringData>(`/db-monitoring`).then(setData).catch((err) => {
        toast.error('Failed to load database telemetry.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }).finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleKillQuery = async (activityId: number, app: string, user: string) => {
    try {
      await apiPost('/db-monitoring/kill-query', { activity_id: activityId, app_name: app, user_name: user });
      toast.success('Query Killed', { description: `Activity ${activityId} on ${app} has been terminated.` });
      fetchData(); // Refresh
    } catch (err) {
      toast.error('Kill Query Failed', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  const { 
    safeActiveConnections, safeAvgQueryLatency, safeDataExportVolume,
    dlpData, dlpFullLabels, 
    operationsData, operationsFullLabels,
    safeSuspiciousActivity 
  } = useMemo(() => {
    const dbData = data || {};
    const dlp = (dbData.dlpByTargetApp || []).map(item => ({
      app: item.app || 'Unknown',
      count: Number(item.count) || 0,
    })).sort((a,b) => b.count - a.count).slice(0, 7);

    const ops = (dbData.operationsByApp || []).map(item => ({
      name: item.app || 'Unknown',
      SELECT: Number(item.SELECT) || 0,
      INSERT: Number(item.INSERT) || 0,
      UPDATE: Number(item.UPDATE) || 0,
      DELETE: Number(item.DELETE) || 0,
    })).sort((a,b) => (b.INSERT + b.DELETE) - (a.INSERT + a.DELETE)).slice(0, 7);

    return {
        safeActiveConnections: Number(dbData.activeConnections) || 0,
        safeAvgQueryLatency: Number(dbData.avgQueryLatency) || 0,
        safeDataExportVolume: Number(dbData.dataExportVolume) || 0,
        dlpData: dlp,
        dlpFullLabels: dlp.reduce((acc, i) => ({ ...acc, [truncateLabel(i.app)]: i.app }), {}),
        operationsData: ops,
        operationsFullLabels: ops.reduce((acc, i) => ({ ...acc, [truncateLabel(i.name)]: i.name }), {}),
        safeSuspiciousActivity: dbData.suspiciousActivity || [],
    }
  }, [data]);

  if (loading) return <div className="p-6 flex justify-center"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No database monitoring data available.</div>;

  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Database className="w-5 h-5 text-blue-400" />Database Monitoring</h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time query analysis, anomaly detection, and data exfiltration monitoring.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-semibold text-slate-400 mb-1">Active Connections</h3><div className="text-3xl font-bold text-blue-400">{safeActiveConnections}</div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-semibold text-slate-400 mb-1">Avg. Query Latency</h3><div className="text-3xl font-bold text-orange-400">{safeAvgQueryLatency.toFixed(2)}ms</div></div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><h3 className="text-sm font-semibold text-slate-400 mb-1">Data Export Volume (24h)</h3><div className="text-3xl font-bold text-red-400">{safeDataExportVolume.toFixed(2)} TB</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <SectionHeader icon={<AlertTriangle className="w-4 h-4 text-red-400" />} title="DLP Events by Target Application" subtitle="Count of high-risk data loss prevention triggers" tooltipText="Monitors and counts events that indicate potential data exfiltration, such as large SELECT queries on sensitive tables." />
          {dlpData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dlpData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="app" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(val) => truncateLabel(val)} tickLine={false} axisLine={{ stroke: '#334155' }} interval={0}>
                  <Label value="Application" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis stroke="#94a3b8" width={50} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} label={{ value: 'DLP Events', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12, style: { textAnchor: 'middle' } }} />
                <Tooltip content={<CustomTooltipContent fullLabels={dlpFullLabels} />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="count" name="DLP Events" radius={[4, 4, 0, 0]} barSize={25}>{(dlpData || []).map((d, idx) => <Cell key={idx} fill={idx < 2 ? '#ef4444' : idx < 4 ? '#f97316' : '#eab308'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-slate-500">No data exfiltration events recorded.</div>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <SectionHeader icon={<Database className="w-4 h-4 text-blue-400" />} title="Database Operations by Application" subtitle="Breakdown of query types per application" tooltipText="Provides insight into the read/write behavior of applications. Anomalies here can indicate misuse or bugs." />
          {operationsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={operationsData} margin={{ top: 5, right: 20, left: 20, bottom: 30 }} stackOffset="expand">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(tick) => `${tick*100}%`} >
                  <Label value="Query Mix Percentage" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fill: '#cbd5e1', fontSize: 11 }} width={100} tickLine={false} interval={0} tickFormatter={val => truncateLabel(val)} />
                <Tooltip content={<CustomTooltipContent fullLabels={operationsFullLabels} />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="SELECT" name="SELECT" stackId="a" fill="#3b82f6" barSize={18} />
                <Bar dataKey="INSERT" name="INSERT" stackId="a" fill="#16a34a" barSize={18} />
                <Bar dataKey="UPDATE" name="UPDATE" stackId="a" fill="#f97316" barSize={18} />
                <Bar dataKey="DELETE" name="DELETE" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-slate-500">No operations data available.</div>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-800"><SectionHeader icon={<Terminal className="w-5 h-5 text-red-400" />} title="Suspicious DB Activity & Mitigation" subtitle={`${safeSuspiciousActivity.length} high-risk events logged`} tooltipText="Live feed of potentially malicious database activities, such as bulk deletes or inserts from non-application users." /></div>
        {safeSuspiciousActivity.length > 0 ? (
          <div className="overflow-x-auto">
              <table className="w-full text-left text-sm"><thead><tr className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800"><th className="px-6 py-4 font-semibold">Threat Actor (User)</th><th className="px-6 py-4 font-semibold">Target DB & Table</th><th className="px-6 py-4 font-semibold">Query Risk</th><th className="px-6 py-4 font-semibold text-right">Mitigation</th></tr></thead><tbody className="divide-y divide-slate-800">{(safeSuspiciousActivity || []).map((row: SuspiciousActivity) => <tr key={row.id} className="hover:bg-slate-800/30"><td className="px-6 py-4 font-mono text-sm">{row.user || 'N/A'}</td><td className="px-6 py-4"><div className="font-bold text-sm">[{row.app || 'N/A'}]</div><div className="text-xs text-slate-500 font-mono">➝ {row.table || 'N/A'}</div></td><td className="px-6 py-4"><div className="flex items-start gap-2"><ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" /><div><div className="text-sm font-medium">{row.type || 'Unknown'}</div><div className="text-xs text-slate-500">{row.reason || 'No reason specified'}</div></div></div></td><td className="px-6 py-4 text-right"><div className="flex justify-end gap-2"><button onClick={() => handleKillQuery(Number(row.id), row.app || '', row.user || '')} className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5"><Activity className="w-3 h-3" />KILL QUERY</button><button className="text-orange-500 border border-orange-500/50 hover:bg-orange-500/10 text-xs font-semibold px-3 py-1.5 rounded flex items-center gap-1.5"><Lock className="w-3 h-3" />LOCK DB USER</button></div></td></tr>)}</tbody></table>
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500">No suspicious activity logged.</div>
        )}
      </div>
    </div>
  );
}
