'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Sparkles, Shield, Zap, Server, AlertTriangle,
  TrendingUp, CheckCircle, Info, ArrowRight
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { OverviewData } from '@/lib/types';

type FigmaDashboardAppHealth = {
  targetApp: string;
  currentLoadLabel: string;
  status: 'healthy' | 'warning' | 'critical';
  actionLabel: string;
};

type FigmaDashboardResponse = {
  aiBriefing: string;
  appHealth: FigmaDashboardAppHealth[];
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
    <div className="mb-5">
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

function AppHealthCard({ appName, load, status, actionLabel, onAction }: { appName: string; load: string; status: 'critical' | 'warning' | 'healthy'; actionLabel: string; onAction: () => void; }) {
  const cfg = {
    critical: { badge: 'text-red-400 bg-red-500/10 border-red-500/30', label: 'Critical', btn: 'bg-red-600 hover:bg-red-700 text-white', border: 'border-red-900/30' },
    warning: { badge: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30', label: 'Warning', btn: 'bg-yellow-600 hover:bg-yellow-700 text-slate-950', border: 'border-slate-800' },
    healthy: { badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', label: 'Healthy', btn: 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200 border border-emerald-700/40', border: 'border-slate-800' },
  }[status];

  const expandedLoad = load?.replace(/req\/m/gi, 'Requests per Minute')?.replace(/(\d+)%\s*Cap/gi, '$1% Capacity')?.replace(/GB\/s/gi, 'GB/s');

  return (
    <div className={`bg-slate-900 border rounded-xl p-4 flex flex-col gap-3 ${cfg.border} h-full`}>
        <div className="flex items-center justify-between"><div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Target Application</div><span className={`text-[10px] px-2 py-0.5 rounded border font-medium ${cfg.badge}`}>{cfg.label}</span></div>
        <div className="text-sm font-bold text-slate-100 truncate">{appName}</div>
        <div className="flex-grow"><div className="text-xl font-bold text-slate-100 leading-tight">{expandedLoad}</div><div className="text-[11px] text-slate-500 mt-0.5">Current Load</div></div>
        <button onClick={onAction} className={`w-full py-2 text-[11px] font-bold rounded-lg transition-colors ${cfg.btn}`}>{actionLabel.toUpperCase()}</button>
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

// --- Dynamic Arrow Component ---
const DynamicArrow = ({ from, to, color, dashed, curved }: { from: React.RefObject<HTMLElement>, to: React.RefObject<HTMLElement>, color: string, dashed?: boolean, curved?: boolean }) => {
  const [path, setPath] = useState('');
  const calculatePath = useCallback(() => {
    if (from.current && to.current) {
      const fromRect = from.current.getBoundingClientRect();
      const toRect = to.current.getBoundingClientRect();
      const parentRect = from.current.closest('.relative')?.getBoundingClientRect() ?? { top: 0, left: 0 };

      const startX = fromRect.right - parentRect.left;
      const startY = fromRect.top - parentRect.top + fromRect.height / 2;
      const endX = toRect.left - parentRect.left;
      const endY = toRect.top - parentRect.top + toRect.height / 2;

      if(curved) {
          const midX = (startX + endX) / 2;
          setPath(`M${startX},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}`);
      } else {
        setPath(`M${startX},${startY} L${endX},${endY}`);
      }
    }
  }, [from, to, curved]);

  useEffect(() => {
    calculatePath();
    window.addEventListener('resize', calculatePath);
    return () => window.removeEventListener('resize', calculatePath);
  }, [calculatePath]);

  return <path d={path} stroke={color} strokeWidth="2" fill="none" strokeDasharray={dashed ? '5, 5' : 'none'} markerEnd={`url(#arrow-${color})`} />;
};


// --- Main Page Component ---
export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [figma, setFigma] = useState<FigmaDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const externalNodeRef = useRef<HTMLDivElement>(null);
  const wafNodeRef = useRef<HTMLDivElement>(null);
  const internalAppRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiGet<OverviewData>(`/overview`),
      apiGet<FigmaDashboardResponse>(`/figma/dashboard`),
    ])
      .then(([ov, dash]) => { setData(ov); setFigma(dash); })
      .catch(err => toast.error('Failed to load overview data.', { description: err instanceof ApiError ? err.message : 'Request failed.' }))
      .finally(() => setLoading(false));
  }, [environment]);

  const handleMitigate = async (app: string) => {
    try {
      await apiPost('/api-monitoring/block-route', { app, path: '/*' });
      toast.success('Mitigation Applied', { description: `Hard limit applied for ${app}.` });
    } catch (err) {
      toast.error('Mitigation failed.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No overview data available.</div>;

  const appCards = figma?.appHealth?.length ? figma.appHealth.map((row, idx) => ({ ...row, id: `${idx}` })) : data.microservices.slice(0, 3).map(svc => {
    const reqData = data.apiRequestsByApp.find(a => a.app.toLowerCase().includes(svc.name.toLowerCase().split('-')[0]));
    const rpm = reqData ? reqData.requests : svc.connections.length * 150;
    const status = svc.status === 'Failing' ? 'critical' : 'healthy';
    return { id: svc.id, appName: svc.name, load: `${rpm.toLocaleString()} req/m`, status, actionLabel: status === 'critical' ? 'Apply Hard Limit' : 'View Traffic' };
  });

  const anomalyChartData = data.apiRequestsByApp.slice(0, 6).map(a => ({ app: a.app, requests: a.requests }));
  const riskData = data.appAnomalies.filter(a => a.anomalies > 0).sort((a, b) => b.anomalies - a.anomalies).slice(0, 5).map(a => ({ name: a.name, score: a.anomalies }));

  return (
    <div className="space-y-6 pb-8">
      {/* Header & AI Briefing */}
      <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />Security Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">Cross-application security posture — live threat status, API health, and active anomalies</p>
      </div>
      <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-slate-800 rounded-xl px-6 py-5"><div className="flex items-start gap-3"><div className="w-9 h-9 bg-indigo-500/15 rounded-lg flex items-center justify-center flex-shrink-0 border border-indigo-500/25"><Sparkles className="w-4 h-4 text-indigo-300" /></div><div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><div className="text-sm font-semibold text-slate-100">ATLAS AI Daily Threat Briefing</div><span className="text-[10px] bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded border border-indigo-500/20">LIVE</span><InfoTooltip text="AI-generated daily summary of critical security events and recommended actions." /></div><p className="text-xs text-slate-300 mt-2 leading-relaxed">{figma?.aiBriefing ?? 'No briefing available.'}</p></div></div></div>

      {/* App Health Matrix */}
      <div>
        <SectionHeader icon={<Server className="w-4 h-4 text-slate-300" />} title="Application Health Matrix" subtitle="Live traffic load and security status for each monitored application." tooltip="Each card represents a monitored application's health. Critical status requires immediate action." />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {appCards.map(({ id, appName, load, status, actionLabel }) => <AppHealthCard key={id} appName={appName} load={load} status={status as any} actionLabel={actionLabel} onAction={() => handleMitigate(appName)} />)}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><SectionHeader icon={<TrendingUp className="w-4 h-4 text-blue-400" />} title="API Consumption by Application" subtitle="API requests per minute for each application." tooltip="Identifies which application is under the heaviest load." />
          <ResponsiveContainer width="100%" height={280}> 
            <BarChart data={anomalyChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="app" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
              <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} cursor={{ fill: '#1e293b' }} />
              <Bar dataKey="requests" name="RPM" radius={[4, 4, 0, 0]}><Cell fill="#3b82f6" /></Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5"><SectionHeader icon={<AlertTriangle className="w-4 h-4 text-red-400" />} title="Top Risk Applications" subtitle="Applications ranked by their cumulative anomaly score." tooltip="Higher scores indicate more suspicious behavior. Scores above 80 warrant investigation." />
          {riskData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#334155' }} />
                <YAxis dataKey="name" type="category" width={130} stroke="#475569" tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155'}} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="score" name="Anomaly Score" radius={[0, 4, 4, 0]}>{riskData.map((_, idx) => <Cell key={idx} fill={idx === 0 ? '#ef4444' : idx === 1 ? '#f97316' : '#eab308'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-full text-slate-500"><CheckCircle className="w-4 h-4 text-emerald-500 mr-2" />No anomalies detected.</div>}
        </div>
      </div>

      {/* Live Attack Surface Topology */}
      {/* <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <SectionHeader icon={<Zap className="w-4 h-4 text-emerald-400" />} title="Live Attack Surface" subtitle="Real-time visualization of traffic flow and security filtering." tooltip="Shows traffic from external sources, through the WAF, to internal applications." />
        <div className="relative w-full">
          <svg className="absolute top-0 left-0 w-full h-full" style={{ pointerEvents: 'none' }}>
            <defs>
              <marker id="arrow-#ef4444" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" /></marker>
              <marker id="arrow-#10b981" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" /></marker>
            </defs>
            {data.activeAlerts > 0 && <DynamicArrow from={externalNodeRef} to={wafNodeRef} color="#ef4444" dashed curved />}
            <DynamicArrow from={externalNodeRef} to={wafNodeRef} color="#10b981" curved />
            {data.microservices.slice(0, 2).map((svc, i) => (
              <DynamicArrow key={svc.id} from={wafNodeRef} to={{ current: internalAppRefs.current[i] }} color={svc.status === 'Failing' ? '#ef4444' : '#10b981'} dashed={svc.status === 'Failing'} curved />
            ))}
          </svg>
          <div className="flex flex-col md:flex-row justify-between items-center gap-8 md:gap-16 p-4">
            <div id="external-node" ref={externalNodeRef} className="flex flex-col items-center gap-2">
              <div className="font-bold text-slate-300">External Traffic</div>
              <div className="text-xs text-slate-400">{data.apiRequests?.toLocaleString() ?? 0} RPM</div>
            </div>
            <div className="hidden md:block"><ArrowRight className="text-slate-600"/></div>
            <div id="waf-node" ref={wafNodeRef} className="flex flex-col items-center gap-2">
                <div className="font-bold text-slate-300">WAF</div>
                <div className={`text-xs ${data.errorRate > 0 ? 'text-red-400' : 'text-green-400'}`}>{data.errorRate > 0 ? `${data.errorRate.toFixed(1)}% Blocked` : 'Healthy'}</div>
            </div>
            <div className="hidden md:block"><ArrowRight className="text-slate-600"/></div>
            <div className="flex flex-col gap-4">
              {data.microservices.slice(0, 2).map((svc, i) => (
                <div id={`internal-app-${i}`} key={svc.id} ref={el => internalAppRefs.current[i] = el} className={`p-3 rounded-lg border ${svc.status === 'Failing' ? 'border-red-500' : 'border-slate-700'}`}>
                  <div className="font-semibold text-slate-200">{svc.name}</div>
                  <div className={`text-sm ${svc.status === 'Failing' ? 'text-red-400' : 'text-green-400'}`}>{svc.status}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div> */}
    </div>
  );
}
