'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, ShieldAlert, Zap, Globe, Server,
  ShieldCheck, Ban, Network, Wifi, AlertTriangle, Info,
} from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { NetworkTrafficData, NetworkAnomaly } from '@/lib/types';

// ─── InfoTooltip ──────────────────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
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
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
function SectionHeader({
  icon, title, subtitle, tooltip, right,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tooltip: string;
  right?: React.ReactNode;
}) {
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

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon, title, subtitle, tooltip, value, valueColor, meta, action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tooltip: string;
  value: string;
  valueColor: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">{title}</span>
          <InfoTooltip text={tooltip} />
        </div>
        <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">{subtitle}</p>
        <div className={`text-xl font-extrabold ${valueColor} mb-1`}>{value}</div>
        {meta && <p className="text-xs text-slate-500">{meta}</p>}
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ─── Anomaly type severity badge ──────────────────────────────────────────────
function AnomalyBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  const isHigh = lower.includes('inject') || lower.includes('scan') || lower.includes('brute');
  const isCrit = lower.includes('exfil') || lower.includes('backdoor') || lower.includes('tunnel');
  const cls = isCrit
    ? 'text-red-400 bg-red-500/10 border-red-500/30'
    : isHigh
    ? 'text-orange-400 bg-orange-500/10 border-orange-500/30'
    : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
  return <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${cls}`}>{isCrit ? 'Critical' : isHigh ? 'High' : 'Medium'}</span>;
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="h-96 bg-slate-800 rounded-xl" />
      <div className="h-64 bg-slate-800 rounded-xl" />
    </div>
  );
}

export default function NetworkTrafficPage() {
  const [data, setData] = useState<NetworkTrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const fetchData = () => {
    setLoading(true);
    apiGet<NetworkTrafficData>(`/network-traffic`)
      .then(setData)
      .catch((err) => {
        toast.error('Failed to load network data.', {
          description: err instanceof ApiError ? err.message : 'Request failed.',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleBlockIp = async (sourceIp: string, app: string) => {
    try {
      await apiPost('/network-traffic/block', { sourceIp, app });
      toast.success('Network Block Applied', { description: `Hard block applied for ${sourceIp} → ${app}.` });
    } catch (err) {
      toast.error('Block action failed.', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">No network traffic data available.</div>
  );

  const highestBandwidthAnomaly = data.networkAnomalies?.[0];
  const unknownMacs = Math.max(1, Math.ceil(data.droppedPackets / 50));
  const internalTargets = [...new Set(data.networkAnomalies?.map((a) => a.app) ?? [])].slice(0, 3);

  // Bandwidth in human-readable form
  const bandwidthGBs = (data.bandwidth / 1024).toFixed(2);
  const droppedPct = data.activeConnections
    ? ((data.droppedPackets / (data.activeConnections * 100)) * 100).toFixed(1)
    : '—';

  return (
    <div className="space-y-6 pb-8">

      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" />
          Network Traffic
        </h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">
          Real-time network flow monitoring — bandwidth consumption, packet loss, and unauthorized access detection
        </p>
      </div>

      {/* Top Row: KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

        <KpiCard
          icon={<Activity className="w-4 h-4 text-red-500" />}
          title="Highest Bandwidth Consumer"
          subtitle="The application or source currently consuming the most network bandwidth."
          tooltip="Bandwidth is measured in Gigabytes per Second (GB/s). A single source consuming disproportionate bandwidth can degrade service for legitimate users or indicate a data exfiltration attempt. Use 'Throttle Bandwidth' to cap the offending source's traffic."
          value={highestBandwidthAnomaly?.app ?? 'No anomalies detected'}
          valueColor="text-red-400"
          meta={`${bandwidthGBs} GB per Second — current active bandwidth`}
          action={
            <button
              onClick={() =>
                highestBandwidthAnomaly &&
                handleBlockIp(highestBandwidthAnomaly.sourceIp, highestBandwidthAnomaly.app)
              }
              className="w-fit px-4 py-1.5 text-xs font-bold text-orange-300 border border-orange-500/30 rounded-lg hover:bg-orange-900/20 transition-colors"
            >
              Throttle Bandwidth
            </button>
          }
        />

        <KpiCard
          icon={<Zap className="w-4 h-4 text-orange-500" />}
          title="Critical Packet Loss"
          subtitle="Application or network layer experiencing the highest rate of dropped packets."
          tooltip="Dropped packets indicate failed transmissions — data that was sent but never received. High packet loss causes slowdowns and timeouts for users. It can result from network congestion, hardware failure, or a deliberate flood attack. Anything above 1% on a production network is worth investigating."
          value={
            data.networkAnomalies?.find((a) => a.type?.toLowerCase().includes('spike'))?.app
              ?? (data.droppedPackets > 100 ? 'Network Layer' : '✓ Within Normal Range')
          }
          valueColor="text-orange-400"
          meta={`${data.droppedPackets.toLocaleString()} dropped packets per minute${droppedPct !== '—' ? ` (${droppedPct}% of total traffic)` : ''}`}
        />

        <KpiCard
          icon={<ShieldAlert className="w-4 h-4 text-red-500" />}
          title="Unauthorized Network Access"
          subtitle="Unregistered devices detected attempting to access internal network segments."
          tooltip="Unknown MAC addresses represent devices not registered in your device inventory that are attempting to connect to the network. They could be rogue devices, personal hotspots, or attacker-controlled hardware. They should be blocked immediately to prevent lateral movement."
          value={`${unknownMacs} Unknown MAC Address${unknownMacs !== 1 ? 'es' : ''}`}
          valueColor="text-red-400"
          meta={`Detected on HR-Subnet — unauthorized segment access`}
          action={
            <button
              onClick={() => toast.info('MAC address block initiated for unauthorized devices')}
              className="w-fit px-4 py-1.5 text-xs font-bold text-red-300 border border-red-600/40 rounded-lg hover:bg-red-900/30 transition-colors flex items-center gap-2"
            >
              <Ban className="w-3 h-3" />
              Block MAC Addresses
            </button>
          }
        />
      </div>

      {/* Traffic Flow Network Map */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <SectionHeader
          icon={<Network className="w-4 h-4 text-blue-400" />}
          title="Traffic Flow Network Map"
          subtitle="Visual representation of live network connections — showing external sources, firewall filtering, and internal application targets."
          tooltip="This diagram shows where network traffic is coming from and where it is going. External sources on the left connect through the central firewall. Traffic reaching internal apps on the right has passed security checks. Red dashed lines indicate flagged or suspicious flows. Click 'Block Source' on any anomalous connection to cut it off immediately."
        />

        <div className="relative h-[380px] bg-slate-950/50 rounded-xl border border-slate-800/50 overflow-hidden">
          {/* Grid bg */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.5)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />

          {/* SVG Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker id="arrowRed2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#ef4444" />
              </marker>
              <marker id="arrowGreen2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
              </marker>
              <marker id="arrowBlue2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
              </marker>
            </defs>
            {data.networkAnomalies?.length > 0 && (
              <path d="M 280 120 C 350 120, 350 185, 490 195" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" markerEnd="url(#arrowRed2)" />
            )}
            <path d="M 280 280 C 350 280, 350 210, 490 205" fill="none" stroke="#3b82f6" strokeWidth="2" markerEnd="url(#arrowBlue2)" />
            <path d="M 620 200 C 720 200, 720 120, 820 120" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" markerEnd="url(#arrowRed2)" />
            <path d="M 620 200 C 720 200, 720 200, 820 200" fill="none" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrowGreen2)" />
            {internalTargets.length > 2 && (
              <path d="M 620 200 C 720 200, 720 285, 820 285" fill="none" stroke="#eab308" strokeWidth="2" strokeDasharray="5,5" />
            )}
          </svg>

          {/* Nodes */}
          <div className="relative z-10 w-full h-full flex justify-between items-center px-8">

            {/* Left: External Sources */}
            <div className="flex flex-col gap-10">
              {data.networkAnomalies?.length > 0 ? (
                <div className="bg-slate-900 border border-red-500/50 p-3 rounded-lg w-60 hover:border-red-500 transition-all shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Globe className="w-4 h-4 text-red-500" />
                    <span className="text-red-400 font-mono text-xs truncate">{data.networkAnomalies[0].sourceIp}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mb-1.5">Targeting: <span className="text-slate-200 font-medium">{data.networkAnomalies[0].app}</span></div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-red-400 font-medium">⚠ Suspicious Activity</span>
                    <button
                      onClick={() => handleBlockIp(data.networkAnomalies[0].sourceIp, data.networkAnomalies[0].app)}
                      className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 px-1.5 py-0.5 rounded transition-colors border border-transparent hover:border-red-500/30"
                    >
                      <ShieldAlert className="w-3 h-3" />
                      Block
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="bg-slate-900 border border-blue-500/30 p-3 rounded-lg w-60">
                <div className="flex items-center gap-2 mb-1.5">
                  <Globe className="w-4 h-4 text-blue-500" />
                  <span className="text-blue-400 font-mono text-xs">Authorized Traffic</span>
                </div>
                <div className="text-xs text-slate-500">{data.activeConnections.toLocaleString()} active sessions</div>
                <div className="text-[10px] text-slate-600 mt-0.5">All connections verified</div>
              </div>
            </div>

            {/* Center: Firewall */}
            <div className="flex flex-col justify-center">
              <div className="bg-slate-900 border-2 border-emerald-500/50 p-5 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.1)] w-40 text-center relative group">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-950 text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/50 uppercase tracking-wider font-semibold">
                  Active
                </div>
                <ShieldCheck className="w-9 h-9 text-emerald-500 mx-auto mb-1.5" />
                <div className="text-slate-200 font-bold text-sm">Firewall</div>
                <div className="text-xs text-slate-500 mt-0.5">{bandwidthGBs} GB/s throughput</div>
                {/* Hover tooltip */}
                <div className="absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 w-60 bg-slate-800 border border-slate-600 rounded-lg p-2 text-xs text-slate-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
                  Network Firewall — inspects all inbound and outbound traffic, blocks unauthorized access attempts and suspicious patterns.
                </div>
              </div>
            </div>

            {/* Right: Internal Targets */}
            <div className="flex flex-col gap-5">
              {internalTargets.length > 0 ? internalTargets.map((target, idx) => {
                const hasAnomaly = data.networkAnomalies?.some((a) => a.app === target);
                return (
                  <div key={idx} className={`bg-slate-900 border p-3 rounded-lg w-60 ${
                    hasAnomaly && idx === 0
                      ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
                      : idx === 1
                        ? 'border-emerald-500/30'
                        : 'border-yellow-500/30'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <Server className={`w-4 h-4 ${
                          hasAnomaly && idx === 0 ? 'text-red-500' :
                          idx === 1 ? 'text-emerald-500' : 'text-yellow-500'
                        }`} />
                        <span className="text-slate-200 font-semibold text-xs">{target}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${
                        hasAnomaly && idx === 0
                          ? 'bg-red-900/50 text-red-400 border-red-500/30'
                          : idx === 1
                            ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/20'
                            : 'bg-yellow-900/30 text-yellow-400 border-yellow-500/20'
                      }`}>
                        {hasAnomaly && idx === 0 ? '🔴 CRITICAL' : idx === 1 ? '✓ HEALTHY' : '⚠ WARNING'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mb-1.5">
                      {hasAnomaly && idx === 0 ? 'Receiving suspicious traffic from flagged IPs' : idx === 1 ? 'All connections within normal parameters' : 'Elevated traffic — monitoring closely'}
                    </div>
                    {hasAnomaly && idx === 0 && (
                      <button
                        onClick={() => handleBlockIp(data.networkAnomalies[0].sourceIp, target)}
                        className="text-xs text-red-400 hover:text-red-300 font-semibold flex items-center gap-1"
                      >
                        <Ban className="w-3 h-3" />
                        Isolate Node
                      </button>
                    )}
                  </div>
                );
              }) : (
                <div className="bg-slate-900 border border-emerald-500/30 p-3 rounded-lg w-60">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Server className="w-4 h-4 text-emerald-500" />
                    <span className="text-slate-200 font-semibold text-xs">Internal Network</span>
                  </div>
                  <span className="text-[10px] text-emerald-400">✓ HEALTHY — No active threats</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Network Anomalies Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800">
          <SectionHeader
            icon={<Wifi className="w-4 h-4 text-red-500 animate-pulse" />}
            title="Active Network Anomalies"
            subtitle="Real-time log of suspicious network connections detected across all monitored segments."
            tooltip="Each row represents a suspicious network connection that has been flagged by the IDS/IPS system. The source endpoint is the origin of the suspicious traffic. The anomaly type explains why it was flagged. Use 'Block Source' to immediately drop all traffic from that IP. 'Throttle' applies a bandwidth cap without fully blocking."
            right={<span className="text-xs text-slate-500">{data.networkAnomalies?.length ?? 0} active events</span>}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[700px]">
            <thead className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="px-5 py-4 font-medium tracking-wider">Source IP / Endpoint</th>
                <th className="px-5 py-4 font-medium tracking-wider">Target Application</th>
                <th className="px-5 py-4 font-medium tracking-wider w-24">Network Port</th>
                <th className="px-5 py-4 font-medium tracking-wider">Anomaly Type</th>
                <th className="px-5 py-4 font-medium tracking-wider w-28">Severity</th>
                <th className="px-5 py-4 font-medium tracking-wider text-right">Mitigation Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.networkAnomalies?.length > 0 ? (
                data.networkAnomalies.map((row: NetworkAnomaly) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="text-slate-100 font-mono text-xs font-semibold">{row.sourceIp}</div>
                      {row.destIp && <div className="text-slate-500 font-mono text-[10px] mt-0.5">→ {row.destIp}</div>}
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-blue-400 text-xs font-semibold">{row.app}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="text-slate-400 font-mono text-xs">{row.port}</span>
                      <div className="text-slate-600 text-[10px] mt-0.5">
                        {row.port === 443 ? 'HTTPS' : row.port === 80 ? 'HTTP' : row.port === 22 ? 'SSH' : row.port === 3306 ? 'MySQL' : 'TCP'}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                        <span className="text-slate-300 text-xs">{row.type}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <AnomalyBadge type={row.type} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleBlockIp(row.sourceIp, row.app)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
                        >
                          Block Source
                        </button>
                        <button
                          onClick={() => toast.info(`Throttling traffic from ${row.sourceIp}`)}
                          className="text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500/10 text-xs font-medium px-3 py-1.5 rounded transition-colors"
                        >
                          Throttle
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500 text-sm">
                    No active network anomalies detected
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
