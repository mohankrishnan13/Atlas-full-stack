'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Sparkles, Shield, Zap, Server, AlertTriangle,
  TrendingUp, CheckCircle, Info, ArrowRight, LoaderCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { OverviewData } from '@/lib/types';

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
    <div className="mb-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <InfoTooltip text={tooltipText} />
      </div>
      <p className="text-[11px] text-slate-500 mt-1 pl-6 leading-relaxed">{subtitle}</p>
    </div>
  );
}

function AppHealthCard({ appName, load, status, onAction }: { appName: string; load: string; status: 'Failing' | 'Healthy' | string; onAction: () => void; }) {
  const isCritical = status === 'Failing';
  const cfg = {
    critical: { badge: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Critical', btn: 'bg-red-600 hover:bg-red-700 text-white', border: 'border-red-900/30' },
    healthy: { badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', label: 'Healthy', btn: 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-700/40', border: 'border-slate-800' },
  };
  const currentConfig = isCritical ? cfg.critical : cfg.healthy;

  return (
    <div className={`bg-slate-900 border rounded-xl p-4 flex flex-col gap-3 ${currentConfig.border} h-full`}>
        <div className="flex items-center justify-between"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Target Application</div><span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${currentConfig.badge}`}>{currentConfig.label}</span></div>
        <div className="text-sm font-bold text-slate-100 truncate">{appName}</div>
        <div className="flex-grow"><div className="text-xl font-bold text-slate-100 leading-tight">{load}</div><div className="text-[11px] text-slate-500 mt-0.5">Current Load</div></div>
        <button onClick={onAction} className={`w-full py-2 text-[11px] font-bold rounded-lg transition-colors ${currentConfig.btn}`}>{isCritical ? 'APPLY HARD LIMIT' : 'VIEW TRAFFIC'}</button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-24 bg-slate-800 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="h-72 bg-slate-800 rounded-xl" />
        <div className="h-72 bg-slate-800 rounded-xl" />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<OverviewData>(`/overview`)
      .then(setData)
      .catch(err => toast.error('Failed to load overview data.', { description: err instanceof ApiError ? err.message : 'Request failed.' }))
      .finally(() => setLoading(false));
  }, [environment]);

  const handleMitigate = async (app: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app_name: app, path: '/*' });
      toast.success('Mitigation Applied', { description: `Hard rate limit applied for ${app}.` });
    } catch (err) {
      toast.error('Mitigation Failed', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  if (loading) return <div className="p-6"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No backend telemetry data available.</div>;

  const riskData = data.appAnomalies.filter(a => a.anomalies > 0).sort((a, b) => b.anomalies - a.anomalies).slice(0, 5);

  return (
    <div className="space-y-6 pb-8">
      <header>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Security Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">Cross-application security posture from live application_telemetry schema.</p>
      </header>
      <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-slate-800 rounded-xl px-6 py-5"><div className="flex items-start gap-3"><div className="w-9 h-9 bg-indigo-500/15 rounded-lg flex items-center justify-center flex-shrink-0 border border-indigo-500/25"><Sparkles className="w-4 h-4 text-indigo-300" /></div><div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><div className="text-sm font-semibold text-slate-100">ATLAS AI Daily Threat Briefing</div><InfoTooltip text="AI-generated daily summary of critical security events and recommended actions." /></div><p className="text-xs text-slate-300 mt-2 leading-relaxed">{data.aiBriefing}</p></div></div></div>

      <div>
        <SectionHeader icon={<Server className="w-4 h-4 text-slate-300" />} title="Application Health Matrix" subtitle={`Live status for ${data.microservices.length} monitored applications.`} tooltipText="Each card represents a monitored application's health, sourced from the microservice_status schema." />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.microservices.map(svc => {
            const reqData = data.apiRequestsByApp.find(a => a.app.toLowerCase().includes(svc.name.toLowerCase().split('-')[0]));
            const rpm = reqData ? reqData.requests : svc.connections.length * 150;
            return <AppHealthCard key={svc.id} appName={svc.name} load={`${rpm.toLocaleString()} req/m`} status={svc.status} onAction={() => handleMitigate(svc.name)} />
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader icon={<TrendingUp className="w-4 h-4 text-blue-400" />} title="API Consumption by Application" subtitle="Total API requests per minute for each application" tooltipText="Data fetched from the telemetry-service API, mapped to the ApiRequestsByApp schema." />
          <ResponsiveContainer width="100%" height={280}> 
            <BarChart data={data.apiRequestsByApp} margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="app" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                 <Label value="Application Name" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
              </XAxis>
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }}>
                 <Label value="Total Requests" angle={-90} position="left" offset={-5} className="fill-slate-500 text-xs"/>
              </YAxis>
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="requests" name="Requests" radius={[4, 4, 0, 0]}><Cell fill="#3b82f6" /></Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader icon={<AlertTriangle className="w-4 h-4 text-red-400" />} title="Top Risk Applications by Cumulative Anomaly Score" subtitle="Applications ranked by their cumulative anomaly score" tooltipText="Higher scores indicate more suspicious behavior. Scores above 80 warrant investigation." />
          {riskData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }}>
                  <Label value="Cumulative Anomaly Score" position="bottom" offset={15} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis dataKey="name" type="category" width={100} stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} axisLine={false} >
                  <Label value="Application Name" angle={-90} position="left" offset={-30} className="fill-slate-500 text-xs"/>
                </YAxis>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155'}} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="anomalies" name="Anomaly Score" radius={[0, 4, 4, 0]}>{riskData.map((_, idx) => <Cell key={idx} fill={idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : '#eab308'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-full text-slate-500"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />No anomalies detected from telemetry streams.</div>}
        </div>
      </div>
    </div>
  );
}
