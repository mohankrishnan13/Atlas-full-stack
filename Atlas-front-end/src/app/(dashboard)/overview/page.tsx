'use client';

import React, { useMemo } from 'react';
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
import { AlertTriangle, Radio, Shield, Wifi, Cpu, BrainCircuit } from 'lucide-react';
import { cn, getSeverityClassNames } from '@/lib/utils';
import {
  mockEndpointSecurityData,
  mockNetworkTrafficData,
  mockOverviewData,
} from '@/lib/mockData';

// ─── Types ────────────────────────────────────────────────────────────────────

type UnifiedAnomaly = {
  id: string;
  timestamp: string;
  source: string;
  threatType: string;
  severity: string;
  sourceTag: 'Wazuh' | 'Zeek';
  aiExplanation: string;
};

// ─── Severity order for sorting ───────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

// ─── Static time-series derived for the Threat Pulse chart ───────────────────
// 24 hourly buckets. Wazuh (endpoint) and Zeek (network) counts are approximated
// from the mock data totals spread across a realistic pattern.

const THREAT_PULSE_DATA = [
  { time: '00:00', endpoint: 0, network: 1 },
  { time: '01:00', endpoint: 0, network: 0 },
  { time: '02:00', endpoint: 1, network: 2 },
  { time: '03:00', endpoint: 0, network: 1 },
  { time: '04:00', endpoint: 0, network: 0 },
  { time: '05:00', endpoint: 1, network: 1 },
  { time: '06:00', endpoint: 0, network: 2 },
  { time: '07:00', endpoint: 1, network: 1 },
  { time: '08:00', endpoint: 2, network: 3 },
  { time: '09:00', endpoint: 1, network: 2 },
  { time: '10:00', endpoint: 3, network: 4 },
  { time: '11:00', endpoint: 2, network: 3 },
  { time: '12:00', endpoint: 1, network: 2 },
  { time: '13:00', endpoint: 3, network: 3 },
  { time: '14:00', endpoint: 4, network: 5 },
  { time: '15:00', endpoint: 3, network: 4 },
  { time: '16:00', endpoint: 5, network: 6 },
  { time: '17:00', endpoint: 4, network: 5 },
  { time: '18:00', endpoint: 3, network: 4 },
  { time: '19:00', endpoint: 2, network: 3 },
  { time: '20:00', endpoint: 4, network: 5 },
  { time: '21:00', endpoint: 3, network: 4 },
  { time: '22:00', endpoint: 2, network: 3 },
  { time: '23:00', endpoint: 1, network: 2 },
];

// ─── AI Explanation stubs (placeholder until Phase 2 AI integration) ─────────

const AI_EXPLANATIONS: Record<string, string> = {
  'evt-001': 'Known cryptomining binary signature. Suggests compromised user account or malicious download.',
  'evt-002': 'Firewall bypass via allow_all rule. Possible insider misconfiguration or targeted policy tampering.',
  'evt-003': 'Unauthorised removable media introduces exfiltration and malware ingestion risk.',
  'evt-004': 'Repeated sudo failures indicate automated privilege escalation tooling.',
  'evt-005': 'Port 4444 is a default Metasploit handler port — likely C2 callback attempt.',
  'net-1': 'High-volume SSH login attempts from Tor exit node. Classic credential-stuffing pattern.',
  'net-2': 'Sequential port sweep across /24 subnet. Reconnaissance phase preceding lateral movement.',
  'net-3': 'Large SFTP transfer to external IP outside business hours. High-confidence exfiltration.',
  'net-4': 'Unexpected egress from DB tier to public internet — violates network segmentation policy.',
};

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

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

// ─── Severity Badge ──────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const sc = getSeverityClassNames(severity as Parameters<typeof getSeverityClassNames>[0]);
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border tracking-wide', sc.badge)}>
      {severity.toUpperCase()}
    </span>
  );
}

// ─── Source Tag ──────────────────────────────────────────────────────────────

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

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent = false
}: {
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnomalyCommandCenterPage() {
  // Build unified anomaly feed from both data sources
  const anomalyFeed = useMemo<UnifiedAnomaly[]>(() => {
    const endpointRows: UnifiedAnomaly[] = mockEndpointSecurityData.wazuhEvents.map((evt) => ({
      id: evt.id,
      timestamp: new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      source: evt.workstationId,
      threatType: evt.alert,
      severity: evt.severity,
      sourceTag: 'Wazuh',
      aiExplanation: AI_EXPLANATIONS[evt.id] ?? 'AI analysis pending.',
    }));

    const networkRows: UnifiedAnomaly[] = mockNetworkTrafficData.networkAnomalies.map((n) => ({
      id: `net-${n.id}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      source: n.sourceIp,
      threatType: n.type,
      severity: n.severity,
      sourceTag: 'Zeek',
      aiExplanation: AI_EXPLANATIONS[`net-${n.id}`] ?? 'AI analysis pending.',
    }));

    return [...endpointRows, ...networkRows].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    );
  }, []);

  const criticalCount = anomalyFeed.filter((a) => a.severity === 'Critical').length;
  const highCount     = anomalyFeed.filter((a) => a.severity === 'High').length;
  const totalToday    = mockOverviewData.activeAlerts + mockNetworkTrafficData.networkAnomalies.length;

  return (
    <div className="space-y-6">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
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

      {/* ── KPI Strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Critical Threats"  value={criticalCount}  sub="Require immediate action" accent />
        <KpiCard label="High Severity"     value={highCount}      sub="Escalation candidates" />
        <KpiCard label="Total Anomalies"   value={anomalyFeed.length} sub="Combined Wazuh + Zeek" />
        <KpiCard label="Active Incidents"  value={totalToday}     sub="Open cases today" />
      </div>

      {/* ── Section 1: Threat Pulse Chart ───────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-5">
          <Shield className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-100">Threat Pulse — Last 24 Hours</h2>
          <span className="ml-auto text-[11px] text-slate-500 font-mono">Endpoint (Wazuh) · Network (Zeek)</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={THREAT_PULSE_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
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
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<PulseTooltip />} />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '12px' }}
              formatter={(value) => (
                <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>
                  {value === 'endpoint' ? 'Endpoint (Wazuh)' : 'Network (Zeek)'}
                </span>
              )}
            />
            <Area
              type="monotone"
              dataKey="endpoint"
              stroke="#a78bfa"
              strokeWidth={2}
              fill="url(#gradEndpoint)"
              dot={false}
              activeDot={{ r: 4, fill: '#a78bfa', strokeWidth: 0 }}
            />
            <Area
              type="monotone"
              dataKey="network"
              stroke="#22d3ee"
              strokeWidth={2}
              fill="url(#gradNetwork)"
              dot={false}
              activeDot={{ r: 4, fill: '#22d3ee', strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Section 2: Recent Critical Anomalies Feed ───────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <h2 className="text-sm font-semibold text-slate-100">Recent Critical Anomalies</h2>
          <span className="ml-auto text-[11px] text-slate-500">{anomalyFeed.length} events</span>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-[90px_1fr_1fr_90px_80px_1fr] gap-3 px-5 py-2.5 border-b border-slate-800/60 bg-slate-950/40">
          {['Time', 'Source', 'Threat Type', 'Severity', 'Origin', 'AI Explanation'].map((h) => (
            <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{h}</span>
          ))}
        </div>

        {/* Rows */}
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
                {/* Timestamp */}
                <span className="text-[11px] text-slate-500 font-mono pt-0.5">{row.timestamp}</span>

                {/* Source */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-semibold text-slate-200 font-mono">{row.source}</span>
                </div>

                {/* Threat Type */}
                <div className="flex items-start gap-1.5">
                  <div className={cn('mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0', sc.bg, `ring-1 ${sc.border}`)} />
                  <span className="text-[12px] text-slate-300 leading-snug">{row.threatType}</span>
                </div>

                {/* Severity */}
                <div className="pt-0.5">
                  <SeverityBadge severity={row.severity} />
                </div>

                {/* Source Tag */}
                <div className="pt-0.5">
                  <SourceTag tag={row.sourceTag} />
                </div>

                {/* AI Explanation */}
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
