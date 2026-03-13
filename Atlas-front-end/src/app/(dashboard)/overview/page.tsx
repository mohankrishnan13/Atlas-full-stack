'use client';

import React, { useEffect, useState } from 'react';
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

// --- Reusable Components (with Tooltip Enhancement) ---

// A more robust InfoTooltip that can be reused.
const InfoTooltip = React.memo(({ text }: { text: string }) => {
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
});
InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(({ icon, title, subtitle, tooltipText }: { icon: React.ReactNode; title: string; subtitle: string; tooltipText: string; }) => {
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
});
SectionHeader.displayName = 'SectionHeader';

const AppHealthCard = React.memo(({ appName, load, status, onAction }: { appName: string; load: string; status: 'Failing' | 'Healthy' | string; onAction: () => void; }) => {
  const isCritical = status === 'Failing';
  const cfg = {
    critical: { badge: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Critical', btn: 'bg-red-600 hover:bg-red-700 text-white', border: 'border-red-900/30' },
    healthy: { badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', label: 'Healthy', btn: 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-700/40', border: 'border-slate-800' },
  };
  const currentConfig = isCritical ? cfg.critical : cfg.healthy;

  return (
    <div className={`bg-slate-900 border rounded-xl p-4 flex flex-col gap-3 ${currentConfig.border} h-full`}>
        <div className="flex items-center justify-between"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Target Application</div><span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${currentConfig.badge}`}>{currentConfig.label}</span></div>
        <div className="text-sm font-bold text-slate-100 truncate" title={appName}>{appName}</div>
        <div className="flex-grow"><div className="text-xl font-bold text-slate-100 leading-tight">{load}</div><div className="text-[11px] text-slate-500 mt-0.5">Current Load</div></div>
        <button onClick={onAction} className={`w-full py-2 text-[11px] font-bold rounded-lg transition-colors ${currentConfig.btn}`}>{isCritical ? 'APPLY HARD LIMIT' : 'VIEW TRAFFIC'}</button>
    </div>
  );
});
AppHealthCard.displayName = 'AppHealthCard';

// --- Utility Functions ---
const truncateLabel = (label: string, maxLength = 10) => {
  if (typeof label !== 'string') return '';
  return label.length > maxLength ? `${label.substring(0, maxLength)}...` : label;
};

const CustomTooltipContent = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const name = data.name || data.app || label;
    const value = payload[0].value;
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl">
        <p className="font-bold text-slate-200 truncate" title={name}>{name}</p>
        <p className="text-slate-300 mt-1">{`${payload[0].name}: ${Number(value || 0).toLocaleString()}`}</p>
      </div>
    );
  }
  return null;
};

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

  if (loading) return <div className="p-6 flex justify-center"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No backend telemetry data available.</div>;

  // --- Defensive Data Parsing & Coercion ---
  const safeMicroservices = (data?.microservices || []).filter(svc => svc && typeof svc === 'object').map(svc => ({
    id: String(svc?.id || ''),
    name: String(svc?.name || 'Unknown Service'),
    type: String(svc?.type || 'Service'),
    status: String(svc?.status || 'Unknown'),
    position: {
      top: String(svc?.position?.top || '50%'),
      left: String(svc?.position?.left || '50%')
    },
    connections: Array.isArray(svc?.connections) ? svc.connections.filter(c => typeof c === 'string') : []
  }));

  const formattedApiRequests = (data?.apiRequestsByApp || [])
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      app: String(item?.app || 'Unknown'),
      requests: Number(item?.requests || 0)
    }))
    .filter(item => item.requests > 0);

  const riskData = (data?.appAnomalies || [])
    .filter(a => a && typeof a === 'object')
    .map(a => ({ 
      name: String(a?.name || 'Unknown'), 
      anomalies: Number(a?.anomalies || 0) 
    }))
    .filter(a => a.anomalies > 0)
    .sort((a, b) => b.anomalies - a.anomalies)
    .slice(0, 5);

  return (
    <div className="space-y-6 pb-8">
      <header>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Security Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">Cross-application security posture from live telemetry data.</p>
      </header>
      <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-slate-800 rounded-xl px-6 py-5"><div className="flex items-start gap-3"><div className="w-9 h-9 bg-indigo-500/15 rounded-lg flex items-center justify-center flex-shrink-0 border border-indigo-500/25"><Sparkles className="w-4 h-4 text-indigo-300" /></div><div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><div className="text-sm font-semibold text-slate-100">ATLAS AI Daily Threat Briefing</div><InfoTooltip text="AI-generated daily summary of critical security events and recommended actions." /></div><p className="text-xs text-slate-300 mt-2 leading-relaxed">{data.aiBriefing || 'No briefing available.'}</p></div></div></div>

      <div>
        <SectionHeader icon={<Server className="w-4 h-4 text-slate-300" />} title="Application Health Matrix" subtitle={`Live status for ${(safeMicroservices).length} monitored applications.`} tooltipText="Each card represents a monitored application's health, sourced from backend service status checks." />
        {safeMicroservices.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(safeMicroservices).map(svc => {
              const reqData = formattedApiRequests.find(a => 
                a?.app && svc?.name && 
                a.app.toLowerCase().includes(svc.name.toLowerCase().split('-')[0])
              );
              const rpm = Number(reqData?.requests) || 0;
              
              return (
                <AppHealthCard 
                  key={String(svc?.id || `svc-${Math.random()}`)}
                  appName={String(svc?.name || 'Unknown Service')}
                  load={`${rpm.toLocaleString()} req/m`}
                  status={String(svc?.status || 'Unknown')} 
                  onAction={() => handleMitigate(String(svc?.name || ''))} 
                />
              );
            })}
          </div>
        ) : (
          <div className="text-center py-10 text-slate-500 text-sm bg-slate-900 border border-slate-800 rounded-xl">No monitored microservices found.</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader icon={<TrendingUp className="w-4 h-4 text-blue-400" />} title="API Consumption by Application" subtitle="Total API requests per minute for top applications" tooltipText="This chart shows the total number of API requests processed by each application, indicating load and usage patterns."/>
          {formattedApiRequests.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}> 
              <BarChart data={formattedApiRequests} margin={{ top: 5, right: 20, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis 
                  dataKey="app" 
                  stroke="#475569" 
                  tick={{ fill: '#94a3b8', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={{ stroke: '#334155' }} 
                  interval={0}
                  tickFormatter={(value) => truncateLabel(String(value || ''), 10)}
                >
                  <Label value="Application" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis 
                  stroke="#475569" 
                  tick={{ fill: '#94a3b8', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={{ stroke: '#334155' }}
                  width={80}
                >
                  <Label value="Total Requests" angle={-90} position="insideLeft" offset={-10} style={{ textAnchor: 'middle'}} className="fill-slate-500 text-xs"/>
                </YAxis>
                <Tooltip content={<CustomTooltipContent />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="requests" name="Requests" radius={[4, 4, 0, 0]} fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-slate-500"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />No API request data available.</div>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader icon={<AlertTriangle className="w-4 h-4 text-red-400" />} title="Top Applications by Anomaly Score" subtitle="Applications ranked by cumulative anomaly score" tooltipText="Highlights applications with the most suspicious behavior. Scores above 80 warrant immediate investigation." />
          {riskData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }}>
                  <Label value="Cumulative Anomaly Score" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                </XAxis>
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={110} 
                  stroke="#475569" 
                  tick={{ fill: '#cbd5e1', fontSize: 11 }} 
                  tickLine={false} 
                  axisLine={false} 
                  interval={0}
                  tickFormatter={(value) => truncateLabel(value, 12)}
                />
                <Tooltip content={<CustomTooltipContent />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="anomalies" name="Anomaly Score" radius={[0, 4, 4, 0]}>
                  {(riskData || []).map((entry, idx) => <Cell key={`cell-${idx}`} fill={Number(entry?.anomalies) > 80 ? '#ef4444' : Number(entry?.anomalies) > 50 ? '#f97316' : '#eab308'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-[280px] text-slate-500"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />No anomalies detected.</div>}
        </div>
      </div>
    </div>
  );
}
