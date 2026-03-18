'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { AlertTriangle, Radio, Shield, Wifi, Cpu, BrainCircuit, LoaderCircle } from 'lucide-react';
import { cn, getSeverityClassNames } from '@/lib/utils';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import { getEndpointSecurity, getNetworkTraffic } from '@/lib/apiClient';
import { mockThreatPulseData, mockAiExplanations } from '@/lib/mockData';
import type { EndpointSecurityData, NetworkTrafficData } from '@/lib/types';

type UnifiedAnomaly = {
  id: string;
  timestamp: string;
  source: string;
  threatType: string;
  severity: string;
  sourceTag: 'Wazuh' | 'Zeek';
  aiExplanation: string;
};

const SEVERITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

function PulseTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-slate-400 mb-1 font-mono">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-slate-300 capitalize">{p.name}:</span>
          <span className="text-slate-100 font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const sc = getSeverityClassNames(severity as Parameters<typeof getSeverityClassNames>[0]);
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border tracking-wide', sc.badge)}>
      {severity.toUpperCase()}
    </span>
  );
}

function SourceTag({ tag }: { tag: 'Wazuh' | 'Zeek' }) {
  const isWazuh = tag === 'Wazuh';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border',
      isWazuh
        ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
        : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
    )}>
      {isWazuh ? <Cpu className="w-2.5 h-2.5" /> : <Wifi className="w-2.5 h-2.5" />}
      {tag}
    </span>
  );
}

function KpiCard({ label, value, sub, accent = false }: {
  label: string; value: string | number; sub?: string; accent?: boolean;
}) {
  return (
    <div className={cn(
      'bg-slate-900 border rounded-xl px-5 py-4 flex flex-col gap-1',
      accent ? 'border-red-500/30' : 'border-slate-800'
    )}>
      <p className="text-[10px] text-slate-500 uppercase tracking-widest font-medium">{label}</p>
      <p className={cn('text-2xl font-bold', accent ? 'text-red-400' : 'text-slate-50')}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

export default function AnomalyCommandCenterPage() {
  const { environment } = useEnvironment();
  const [endpointData, setEndpointData] = useState<EndpointSecurityData | null>(null);
  const [networkData, setNetworkData]   = useState<NetworkTrafficData | null>(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([getEndpointSecurity(), getNetworkTraffic()])
      .then(([ep, net]) => {
        if (cancelled) return;
        setEndpointData(ep);
        setNetworkData(net);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load command center data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [environment]);

  const anomalyFeed = useMemo<UnifiedAnomaly[]>(() => {
    const endpointRows: UnifiedAnomaly[] = (endpointData?.wazuhEvents ?? []).map((evt) => ({
      id: String(evt.id),
      timestamp: evt.timestamp
        ? new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—',
      source: evt.workstationId,
      threatType: evt.alert,
      severity: String(evt.severity),
      sourceTag: 'Wazuh' as const,
      aiExplanation: mockAiExplanations[String(evt.id)] ?? 'AI analysis pending.',
    }));

    const networkRows: UnifiedAnomaly[] = (networkData?.networkAnomalies ?? []).map((n) => ({
      id: `net-${n.id}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      source: n.sourceIp,
      threatType: n.type,
      severity: String(n.severity ?? 'Medium'),
      sourceTag: 'Zeek' as const,
      aiExplanation: mockAiExplanations[`net-${n.id}`] ?? 'AI analysis pending.',
    }));

    return [...endpointRows, ...networkRows].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );
  }, [endpointData, networkData]);

  const criticalCount = anomalyFeed.filter((a) => a.severity === 'Critical').length;
  const highCount     = anomalyFeed.filter((a) => a.severity === 'High').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <LoaderCircle className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
            <Radio className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100">Anomaly Command Center</h1>
            <p className="text-[11px] text-slate-500">Live threat feed — Wazuh (Endpoint) · Zeek (Network)</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs font-semibold text-red-400">LIVE</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Critical Threats" value={criticalCount}        sub="Require immediate action" accent />
        <KpiCard label="High Severity"    value={highCount}            sub="Escalation candidates" />
        <KpiCard label="Total Anomalies"  value={anomalyFeed.length}   sub="Combined Wazuh + Zeek" />
        <KpiCard label="Active Incidents" value={networkData?.activeConnections ?? 0} sub="Active connections" />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-5">
          <Shield className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-100">Threat Pulse — Last 24 Hours</h2>
          <span className="ml-auto text-[11px] text-slate-500 font-mono">Endpoint (Wazuh) · Network (Zeek)</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={mockThreatPulseData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradEndpoint" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradNetwork" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              interval={3}
            />
            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<PulseTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
              formatter={(value) => (
                <span style={{ color: '#94a3b8' }}>
                  {value === 'endpoint' ? 'Endpoint (Wazuh)' : 'Network (Zeek)'}
                </span>
              )}
            />
            <Area type="monotone" dataKey="endpoint" stroke="#a78bfa" strokeWidth={2} fill="url(#gradEndpoint)" dot={false} activeDot={{ r: 4, fill: '#a78bfa', strokeWidth: 0 }} />
            <Area type="monotone" dataKey="network"  stroke="#22d3ee" strokeWidth={2} fill="url(#gradNetwork)"  dot={false} activeDot={{ r: 4, fill: '#22d3ee', strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <h2 className="text-sm font-semibold text-slate-100">Recent Critical Anomalies</h2>
          <span className="ml-auto text-[11px] text-slate-500">{anomalyFeed.length} events</span>
        </div>

        <div className="grid grid-cols-[90px_1fr_1fr_90px_80px_1fr] gap-3 px-5 py-2.5 border-b border-slate-800/60 bg-slate-950/40">
          {['Time', 'Source', 'Threat Type', 'Severity', 'Origin', 'AI Explanation'].map((h) => (
            <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</span>
          ))}
        </div>

        <div className="divide-y divide-slate-800/50">
          {anomalyFeed.map((row) => {
            const sc = getSeverityClassNames(row.severity as Parameters<typeof getSeverityClassNames>[0]);
            return (
              <div
                key={row.id}
                className={cn(
                  'grid grid-cols-[90px_1fr_1fr_90px_80px_1fr] gap-3 px-5 py-3.5 items-start',
                  'hover:bg-slate-800/40 transition-colors',
                  row.severity === 'Critical' && 'bg-red-500/[0.03]'
                )}
              >
                <span className="text-[11px] text-slate-500 font-mono pt-0.5">{row.timestamp}</span>
                <span className="text-[12px] font-semibold text-slate-200 font-mono">{row.source}</span>
                <div className="flex items-start gap-1.5">
                  <div className={cn('mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0', sc.bg)} />
                  <span className="text-[12px] text-slate-300 leading-snug">{row.threatType}</span>
                </div>
                <div className="pt-0.5"><SeverityBadge severity={row.severity} /></div>
                <div className="pt-0.5"><SourceTag tag={row.sourceTag} /></div>
                <div className="flex items-start gap-1.5">
                  <BrainCircuit className="w-3 h-3 text-slate-600 mt-0.5 flex-shrink-0" />
                  <span className="text-[11px] text-slate-500 leading-snug italic">{row.aiExplanation}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
