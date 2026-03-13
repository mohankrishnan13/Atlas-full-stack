'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Activity, ShieldAlert, Server, Lock, Ban, Bell,
  BarChart as BarChartIcon, Info, LoaderCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { ApiMonitoringData } from '@/lib/types';

// --- Reusable Components ---
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
      {open && <div className="absolute z-50 left-5 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed z-[100]">{text}</div>}
    </div>
  );
});
InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode; }) => (
  <div className="mb-4 px-5 pt-5 flex justify-between items-center">
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
    </div>
    {children}
  </div>
));
SectionHeader.displayName = 'SectionHeader';

// --- Utility & Tooltip Functions ---
const truncateLabel = (label: string, maxLength = 10) => {
  if (typeof label !== 'string') return '';
  return label.length > maxLength ? `${label.substring(0, maxLength)}...` : label;
};

const CustomTooltipContent = ({ active, payload, label, fullLabels }: any) => {
  if (active && payload && payload.length) {
    const fullLabel = fullLabels[label] || label;

    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl max-w-xs z-[100]">
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

  // Fetch dynamic data (which returns mock data instantly via interceptor)
  useEffect(() => {
    setLoading(true);
    apiGet<ApiMonitoringData>(`/api-monitoring`)
      .then(setData)
      .catch(err => toast.error('Failed to load API data.', { description: err instanceof ApiError ? err.message : 'Request failed.' }))
      .finally(() => setLoading(false));
  }, [environment]);

  // Interactive handler for action buttons
  const handleAction = async (actionName: string, targetApp: string) => {
    try {
      await apiPost('/api-monitoring/action', { action: actionName, app_name: targetApp });
      toast.success('Action Applied', { description: `${actionName} enforced for ${targetApp}.` });
    } catch (err) {
      toast.error('Action failed.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  // Memoized and defensively parsed data mapping
  const { 
    formattedApiConsumption, abusedEndpoints, fullEndpointLabels,
    safeConsumers, safeMitigations
  } = useMemo(() => {
    const safeData = data || {};
    
    const consumption = (safeData.apiConsumptionByApp || [])
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        app: String(item?.app || 'Unknown'),
        actual: Number(item?.actual) || 0,
        limit: Number(item?.limit) || 0,
      }))
      .filter(item => item.actual > 0);

    const endpoints = (safeData.apiRouting || safeData.mostAbusedEndpoints || [])
      .map((item: any, index: number) => ({
        id: index,
        app: item?.app || (item?.endpoint ? item.endpoint.split('/')[2] : 'Unknown'),
        path: String(item?.path || item?.endpoint || '/'),
        violations: Math.abs(Number(item?.trend || item?.violations) || 0),
        severity: (item?.severity === 'critical' || Number(item?.trend) > 100) ? 'critical' : 'high',
      }))
      .filter(item => item.violations > 0)
      .sort((a,b) => b.violations - a.violations)
      .slice(0, 10);

    const endpointLabels = endpoints.reduce((acc: Record<string, string>, item: any) => {
        const label = `[${item.app}] ${item.path}`;
        const truncated = truncateLabel(label, 15);
        acc[truncated] = label;
        return acc;
    }, {});

    const consumers = (safeData.topConsumers || []).map(item => ({
      consumer: String(item?.consumer || 'Unknown'),
      app: String(item?.application_name || 'Unknown'),
      calls: Number(item?.total_calls) || 0,
      cost: Number(item?.average_cost) || 0,
      isOveruse: Boolean(item?.is_overuse),
      // Derive action based on overuse state
      action: Boolean(item?.is_overuse) ? 'Throttle Limits' : 'Audit Logs'
    }));

    const mitigations = (safeData.activeMitigations || []).map(item => ({
      target: String(item?.target || 'Unknown'),
      offender: String(item?.offender || 'Unknown'),
      violation: String(item?.violation_type || 'Unknown'),
      details: String(item?.details || ''),
      action: String(item?.action === 'BLOCK' ? 'Enforce Hard Block' : item?.action || 'Notify Team'),
    }));

    return {
      formattedApiConsumption: consumption,
      abusedEndpoints: endpoints,
      fullEndpointLabels: endpointLabels,
      safeConsumers: consumers,
      safeMitigations: mitigations,
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

      {/* Middle Chart Grid (Top Cards Removed per Figma Design) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
           <SectionHeader icon={<Server className="w-4 h-4 text-blue-400" />} title="API Consumption vs. Limits" />
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
            <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title="Most Abused API Endpoints" />
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

      {/* Bottom Tables Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* Top Consumers by Target App */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
            <SectionHeader icon={<BarChartIcon className="w-4 h-4 text-violet-400" />} title="Top Consumers by Target App">
                <button className="text-xs text-slate-400 hover:text-white transition-colors">View All</button>
            </SectionHeader>
            <div className="px-2 pb-2 overflow-x-auto">
                <table className="w-full text-left min-w-[450px]">
                    <thead>
                        <tr className="border-b border-slate-800">
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Consumer</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Target App</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Calls</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Cost</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(safeConsumers || []).map((item, index) => (
                            <tr key={index} className="border-b border-slate-800 last:border-none hover:bg-slate-800/30 transition-colors">
                                <td className="px-3 py-3.5 text-xs text-slate-300 font-mono whitespace-pre-wrap">{item.consumer}</td>
                                <td className="px-3 py-3.5 text-xs text-blue-400">[{item.app}]</td>
                                <td className="px-3 py-3.5 text-xs text-slate-300">{(item.calls / 1000).toFixed(0)}K</td>
                                <td className={`px-3 py-3.5 text-xs font-semibold ${item.isOveruse ? 'text-red-400' : 'text-slate-300'}`}>${item.cost > 10 ? item.cost.toLocaleString() : (item.cost * item.calls).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                                <td className="px-3 py-3.5 text-center">
                                     <button 
                                        onClick={() => handleAction(item.action, item.app)}
                                        className={`border px-3 py-1 rounded-md text-xs transition-all ${
                                        item.action === 'Throttle Limits' ? 'text-orange-400 border-orange-500/50 hover:bg-orange-500/10' :
                                        item.action === 'Revoke Key' ? 'text-red-400 border-red-500/50 hover:bg-red-500/10' :
                                        'text-slate-400 border-slate-500/50 hover:bg-slate-500/10 hover:text-white'
                                     }`}>
                                        {item.action}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Active API Mitigation Feed */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
             <SectionHeader icon={<ShieldAlert className="w-4 h-4 text-green-400" />} title="Active API Mitigation Feed">
                <span className="flex items-center gap-1.5 text-xs text-red-400">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    Live
                </span>
            </SectionHeader>
            <div className="px-2 pb-2 overflow-x-auto">
                 <table className="w-full text-left min-w-[450px]">
                    <thead>
                        <tr className="border-b border-slate-800">
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Target / Offender</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Violation</th>
                            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-center">Mitigation Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(safeMitigations || []).map((item, index) => (
                            <tr key={index} className="border-b border-slate-800 last:border-none hover:bg-slate-800/30 transition-colors">
                                <td className="px-3 py-3">
                                    <div className="text-xs text-blue-400">[{item.target}]</div>
                                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">{item.offender}</div>
                                </td>
                                <td className="px-3 py-3">
                                    <div className="text-xs font-bold text-slate-200">{item.violation}</div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">{item.details}</div>
                                </td>
                                <td className="px-3 py-3 text-center">
                                    <button 
                                      onClick={() => handleAction(item.action, item.target)}
                                      className={`text-white text-xs font-bold py-1.5 px-3 rounded-md flex items-center gap-1.5 w-full justify-center transition-colors ${
                                        item.action === 'Enforce Hard Block' || item.action === 'Lock Account' || item.action === 'Blacklist IP'
                                          ? 'bg-red-600 hover:bg-red-700'
                                          : 'bg-blue-600 hover:bg-blue-700'
                                      }`}>
                                        {item.action === 'Enforce Hard Block' && <Ban size={12}/>}
                                        {item.action === 'Lock Account' && <Lock size={12}/>}
                                        {item.action === 'Blacklist IP' && <ShieldAlert size={12}/>}
                                        {item.action === 'Notify Team' && <Bell size={12}/>}
                                        {item.action}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                 </table>
            </div>
        </div>
      </div>
    </div>
  );
}