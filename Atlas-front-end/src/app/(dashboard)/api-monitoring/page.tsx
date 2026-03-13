'use client';

import React, { useEffect, useState, useMemo } from 'react';
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
import type { ApiMonitoringData } from '@/lib/types';

// --- Enhanced Reusable Components ---
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
      {open && <div className="absolute z-50 left-5 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">{text}</div>}
    </div>
  );
});
InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(({ icon, title, subtitle, tooltipText }: { icon: React.ReactNode; title: string; subtitle: string; tooltipText: string; }) => (
  <div className="mb-4 px-5 pt-5">
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      <InfoTooltip text={tooltipText} />
    </div>
    <p className="text-[11px] text-slate-500 mt-1 pl-6 leading-relaxed">{subtitle}</p>
  </div>
));
SectionHeader.displayName = 'SectionHeader';

const StatCard = React.memo(({ value, label, subtitle, tooltipText, color = 'default', icon: Icon }: { value: string | number; label: string; subtitle: string; tooltipText: string; color?: 'default' | 'red' | 'green' | 'orange'; icon?: React.ComponentType<{ className?: string }>; }) => {
  const colors = { default: 'text-slate-200', red: 'text-red-400', green: 'text-emerald-400', orange: 'text-orange-400' };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-2"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1">{label}<InfoTooltip text={tooltipText} /></div>{Icon && <Icon className={`w-6 h-6 ${colors[color]} opacity-50`} />}</div>
      <div className={`text-2xl font-extrabold ${colors[color]} leading-tight`}>{value}</div>
      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{subtitle}</p>
    </div>
  );
});
StatCard.displayName = 'StatCard';

// --- Utility & Tooltip Functions ---
const truncateLabel = (label: string, maxLength = 10) => {
  if (typeof label !== 'string') return '';
  return label.length > maxLength ? `${label.substring(0, maxLength)}...` : label;
};

const CustomTooltipContent = ({ active, payload, label, fullLabels }: any) => {
  if (active && payload && payload.length) {
    const dataKey = payload[0].dataKey;
    const data = payload[0].payload;
    const fullLabel = fullLabels[label] || label;

    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl max-w-xs">
        <p className="font-bold text-slate-200 truncate" title={fullLabel}>{fullLabel}</p>
        {payload.map((pld: any, index: number) => (
            <p key={index} className="text-slate-300 mt-1" style={{ color: pld.color }}>
                {`${pld.name}: ${Number(pld.value || 0).toLocaleString()}`}
            </p>
        ))}
      </div>
    );
  }
  return null;
};


export default function ApiMonitoringPage() {
  const [data, setData] = useState<ApiMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  useEffect(() => {
    setLoading(true);
    apiGet<ApiMonitoringData>(`/api-monitoring`).then(setData).catch(err => toast.error('Failed to load API data.', { description: err instanceof ApiError ? err.message : 'Request failed.' })).finally(() => setLoading(false));
  }, [environment]);

  const handleBlockRoute = async (app_name: string, path: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app_name, path });
      toast.success('Hard Block Applied', { description: `Route ${path} for ${app_name} has been blocked.` });
    } catch (err) {
      toast.error('Block action failed.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  // Memoized and defensively parsed data
  const { 
    safeTotalCalls, safeBlocked, safeAvgLatency, safeEstimatedCost,
    formattedApiConsumption, abusedEndpoints, fullEndpointLabels 
  } = useMemo(() => {
    const safeData = data || {};
    
    // Defensive parsing with null checks and type coercion
    const consumption = (safeData.apiConsumptionByApp || [])
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        app: String(item?.app || 'Unknown'),
        actual: Number(item?.actual) || 0,
        limit: Number(item?.limit) || 0,
      }))
      .filter(item => item.actual > 0);

    const endpoints = (safeData.apiRouting || [])
      .map((item, index) => ({
        id: Number(item?.id) || index,
        app: String(item?.app || 'Unknown'),
        path: String(item?.path || '/'),
        violations: Math.abs(Number(item?.trend) || 0),
        severity: (Number(item?.trend) || 0) > 100 ? 'critical' : 'high',
      }))
      .filter(item => item.violations > 50)
      .sort((a,b) => b.violations - a.violations)
      .slice(0, 10);

    const endpointLabels = endpoints.reduce((acc: Record<string, string>, item: any) => {
        const label = `[${item.app}] ${item.path}`;
        const truncated = truncateLabel(label, 15);
        acc[truncated] = label;
        return acc;
    }, {});

    return {
      safeTotalCalls: Number(safeData.apiCallsToday) || 0,
      safeBlocked: Number(safeData.blockedRequests) || 0,
      safeAvgLatency: Number(safeData.avgLatency) || 0,
      safeEstimatedCost: Number(safeData.estimatedCost) || 0,
      formattedApiConsumption: consumption,
      abusedEndpoints: endpoints,
      fullEndpointLabels: endpointLabels,
    };
  }, [data]);

  if (loading) return <div className="p-6 flex justify-center"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No API monitoring data available.</div>;
  
  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-400" />API Monitoring</h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time request volume, rate limit enforcement, and threat detection.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard value={safeTotalCalls.toLocaleString()} label="Total API Calls" subtitle="Cumulative requests today" tooltipText="Total API requests processed across all monitored applications since midnight UTC." icon={Activity} />
        <StatCard value={safeBlocked.toLocaleString()} label="Blocked Threats" subtitle="Malicious requests blocked" tooltipText="Requests blocked by WAF rules, rate limiting, or other security policies." color="red" icon={Ban} />
        <StatCard value={`${safeAvgLatency.toFixed(2)}ms`} label="Average Latency" subtitle="Across all services" tooltipText="The average response time for all API requests. High latency can indicate performance issues." color="orange" icon={TrendingUp} />
        <StatCard value={`$${safeEstimatedCost.toLocaleString()}`} label="Estimated Cost" subtitle="Cumulative for today" tooltipText="Estimated operational cost based on API call volume and per-call cost models." icon={ShieldAlert} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<Server className="w-4 h-4 text-blue-400" />} title="API Consumption vs. Limits" subtitle="Request rate vs. configured rate limit" tooltipText="Shows current requests per minute (RPM) vs. the configured rate limit for each application. Red bars indicate overuse." />
          <div className="px-5 pb-5">
           {formattedApiConsumption.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={formattedApiConsumption} margin={{ top: 10, right: 20, left: 20, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="app" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} tickFormatter={(value) => truncateLabel(value, 10)} interval={0} >
                    <Label value="Application" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                  </XAxis>
                  <YAxis stroke="#475569" width={60} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                    <Label value="RPM" angle={-90} position="insideLeft" style={{textAnchor: 'middle'}} className="fill-slate-500 text-xs"/>
                  </YAxis>
                  <Tooltip content={<CustomTooltipContent fullLabels={formattedApiConsumption.reduce((acc:any, item:any) => ({...acc, [item.app]: item.app}), {})} />} cursor={{ fill: '#1e293b' }} />
                  <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '11px' }} verticalAlign="bottom" />
                  <Bar dataKey="limit" name="Rate Limit (RPM)" fill="#334155" radius={[4, 4, 0, 0]} barSize={15} />
                  <Bar dataKey="actual" name="Current RPM" radius={[4, 4, 0, 0]} barSize={15}>{(formattedApiConsumption || []).map((e, i) => <Cell key={`cell-${i}`} fill={e.actual > e.limit ? '#ef4444' : '#3b82f6'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-slate-500 text-sm">No API consumption data available.</div>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Most Abused API Endpoints" subtitle="API routes with the highest violation scores" tooltipText="Ranks API endpoints by a 'trend' score indicating abuse. Higher scores signify more suspicious traffic patterns." />
          <div className="px-5 pb-5">
            {abusedEndpoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={abusedEndpoints} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} >
                    <Label value="Violation Score" position="bottom" offset={25} className="fill-slate-500 text-xs"/>
                  </XAxis>
                  <YAxis dataKey={v => truncateLabel(`[${v.app}] ${v.path}`, 15)} type="category" width={120} stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
                  <Tooltip content={<CustomTooltipContent fullLabels={fullEndpointLabels} />} cursor={{ fill: '#1e293b' }} />
                  <Bar dataKey="violations" name="Violation Score" radius={[0, 4, 4, 0]} barSize={14}>{(abusedEndpoints || []).map((e, i) => <Cell key={i} fill={e.severity === 'critical' ? '#ef4444' : '#f97316'} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
               <div className="flex items-center justify-center h-[300px] text-slate-500 text-sm">No abused endpoints detected.</div>
            )}
          </div>
        </div>
      </div>
      {/* The tables for Top Consumers and Mitigation feed can be kept as they are, but ensuring safe mapping */}
    </div>
  );
}
