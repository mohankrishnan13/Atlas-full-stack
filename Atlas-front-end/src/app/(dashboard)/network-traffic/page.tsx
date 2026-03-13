'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Activity, ShieldAlert, Zap, Globe, Server,
  ShieldCheck, Ban, Network, Wifi, AlertTriangle, Info,
} from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { NetworkTrafficData, NetworkAnomaly } from '@/lib/types';

// --- Helper Components ---
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1">
      <button
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-blue-400 transition-colors" aria-label="More information"
      >
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

function KpiCard({ icon, title, subtitle, tooltip, value, valueColor, meta, action }: { icon: React.ReactNode; title: string; subtitle: string; tooltip: string; value: string; valueColor: string; meta?: string; action?: React.ReactNode; }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between h-full">
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

function AnomalyBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  const isHigh = lower.includes('inject') || lower.includes('scan') || lower.includes('brute');
  const isCrit = lower.includes('exfil') || lower.includes('backdoor') || lower.includes('tunnel');
  const cls = isCrit ? 'text-red-400 bg-red-500/10 border-red-500/30' : isHigh ? 'text-orange-400 bg-orange-500/10 border-orange-500/30' : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
  return <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${cls}`}>{isCrit ? 'Critical' : isHigh ? 'High' : 'Medium'}</span>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[...Array(3)].map((_, i) => <div key={i} className="h-44 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="h-96 bg-slate-800 rounded-xl" />
      <div className="h-64 bg-slate-800 rounded-xl" />
    </div>
  );
}

// --- Main Page Component ---
export default function NetworkTrafficPage() {
  const [data, setData] = useState<NetworkTrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  // --- Dynamic SVG Path State ---
  const [svgPaths, setSvgPaths] = useState<{[key: string]: string}>({});

  // --- DOM Element References ---
  const containerRef = useRef<HTMLDivElement>(null);
  const externalAnomalyRef = useRef<HTMLDivElement>(null);
  const externalAuthorizedRef = useRef<HTMLDivElement>(null);
  const firewallRef = useRef<HTMLDivElement>(null);
  const internalTargetRefs = useRef<(HTMLDivElement | null)[]>([]);

  const internalTargets = [...new Set(data?.networkAnomalies?.map((a) => a.app) ?? [])].slice(0, 3);

  // --- Path Calculation Logic ---
  const calculateAndSetPaths = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();

    const getCoords = (ref: React.RefObject<HTMLDivElement>, from: 'left' | 'right') => {
      if (!ref.current) return null;
      const rect = ref.current.getBoundingClientRect();
      const x = (from === 'right' ? rect.right : rect.left) - containerRect.left;
      const y = rect.top + rect.height / 2 - containerRect.top;
      return { x, y };
    };

    const firewallCoords = getCoords(firewallRef, 'left');
    const newPaths: {[key: string]: string} = {};

    // Path from External Anomaly to Firewall
    if (data?.networkAnomalies?.length ?? 0 > 0) {
        const externalAnomalyCoords = getCoords(externalAnomalyRef, 'right');
        if (externalAnomalyCoords && firewallCoords) {
            const { x: x1, y: y1 } = externalAnomalyCoords;
            const { x: x2, y: y2 } = firewallCoords;
            const midX = (x1 + x2) / 2;
            newPaths.anomalyToFirewall = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        }
    }

    // Path from External Authorized to Firewall
    const externalAuthorizedCoords = getCoords(externalAuthorizedRef, 'right');
    if (externalAuthorizedCoords && firewallCoords) {
      const { x: x1, y: y1 } = externalAuthorizedCoords;
      const { x: x2, y: y2 } = firewallCoords;
      const midX = (x1 + x2) / 2;
      newPaths.authorizedToFirewall = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    }

    const firewallRightCoords = getCoords(firewallRef, 'right');
    if(firewallRightCoords) {
      internalTargets.forEach((_, idx) => {
        const targetCoords = getCoords({ current: internalTargetRefs.current[idx] }, 'left');
        if (targetCoords) {
          const { x: x1, y: y1 } = firewallRightCoords;
          const { x: x2, y: y2 } = targetCoords;
          const midX = (x1 + x2) / 2;
          newPaths[`firewallToTarget${idx}`] = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        }
      });
    }
    
    setSvgPaths(newPaths);
  }, [data?.networkAnomalies, internalTargets.length]);

  // --- Effects for Data Fetching and Resize Handling ---
  useEffect(() => {
    setLoading(true);
    apiGet<NetworkTrafficData>(`/network-traffic`)
      .then(setData)
      .catch(err => toast.error('Failed to load network data.', { description: err instanceof ApiError ? err.message : 'Request failed.' }))
      .finally(() => setLoading(false));
  }, [environment]);

  useEffect(() => {
    const handleResize = () => setTimeout(calculateAndSetPaths, 100);
    window.addEventListener('resize', handleResize);
    // Also calculate on sidebar collapse/expand, assuming a custom event or other trigger.
    // For simplicity, a resize listener is a good proxy.
    return () => window.removeEventListener('resize', handleResize);
  }, [calculateAndSetPaths]);

  useEffect(() => {
    if (data) {
      // Allow DOM to update before calculating paths
      setTimeout(calculateAndSetPaths, 100);
    }
  }, [data, calculateAndSetPaths]);


  // --- Event Handlers ---
  const handleBlockIp = async (sourceIp: string, app: string) => {
    try {
      await apiPost('/network-traffic/block', { sourceIp, app });
      toast.success('Network Block Applied', { description: `Hard block applied for ${sourceIp} → ${app}.` });
    } catch (err) {
      toast.error('Block action failed.', { description: err instanceof ApiError ? err.message : 'Request failed.' });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return <div className="flex items-center justify-center h-48 text-slate-500">No network traffic data available.</div>;

  // Safe Variable Parsing
  const safeDropped = Number(data.droppedPackets) || 0;
  const safeActive = Number(data.activeConnections) || 0;
  const safeBandwidth = Number(data.bandwidth) || 0;

  const highestBandwidthAnomaly = data.networkAnomalies?.[0];
  const unknownMacs = Math.max(1, Math.ceil(safeDropped / 50));
  const bandwidthGBs = (safeBandwidth / 1024).toFixed(2);
  
  const droppedPct = safeActive > 0 ? ((safeDropped / safeActive) * 100).toFixed(1) : '—';

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" />
          Network Traffic
        </h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time network flow monitoring — bandwidth consumption, packet loss, and unauthorized access detection</p>
      </div>

      {/* Top Row: KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <KpiCard
          icon={<Activity className="w-4 h-4 text-red-500" />}
          title="Highest Bandwidth Consumer"
          subtitle="The application or source currently consuming the most network bandwidth."
          tooltip="Bandwidth is measured in Gigabytes per Second (GB/s). A single source consuming disproportionate bandwidth can degrade service for legitimate users or indicate a data exfiltration attempt."
          value={highestBandwidthAnomaly?.app ?? 'No anomalies detected'}
          valueColor="text-red-400"
          meta={`${bandwidthGBs} GB per Second — current active bandwidth`}
          action={
            <button
              onClick={() => highestBandwidthAnomaly && handleBlockIp(highestBandwidthAnomaly.sourceIp, highestBandwidthAnomaly.app)}
              disabled={!highestBandwidthAnomaly}
              className="w-fit px-4 py-1.5 text-xs font-bold text-orange-300 border border-orange-500/30 rounded-lg hover:bg-orange-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Throttle Bandwidth
            </button>
          }
        />
        <KpiCard
          icon={<Zap className="w-4 h-4 text-orange-500" />}
          title="Critical Packet Loss"
          subtitle="Application or network layer experiencing the highest rate of dropped packets."
          tooltip="Dropped packets indicate failed transmissions. High packet loss causes slowdowns and timeouts. Anything above 1% on a production network is worth investigating."
          value={data.networkAnomalies?.find((a) => a.type?.toLowerCase().includes('spike'))?.app ?? (safeDropped > 100 ? 'Network Layer' : '✓ Within Normal Range')}
          valueColor="text-orange-400"
          meta={`${safeDropped.toLocaleString()} dropped packets per minute${droppedPct !== '—' ? ` (${droppedPct}% of total traffic)` : ''}`}
        />
        <KpiCard
          icon={<ShieldAlert className="w-4 h-4 text-red-500" />}
          title="Unauthorized Network Access"
          subtitle="Unregistered devices detected attempting to access internal network segments."
          tooltip="Unknown MAC addresses represent unregistered devices. They should be blocked immediately to prevent lateral movement."
          value={`${unknownMacs} Unknown MAC Address${unknownMacs !== 1 ? 'es' : ''}`}
          valueColor="text-red-400"
          meta={`Detected on HR-Subnet — unauthorized segment access`}
          action={
            <button onClick={() => toast.info('MAC address block initiated for unauthorized devices')} className="w-fit px-4 py-1.5 text-xs font-bold text-red-300 border border-red-600/40 rounded-lg hover:bg-red-900/30 transition-colors flex items-center gap-2">
              <Ban className="w-3 h-3" />
              Block MAC Addresses
            </button>
          }
        />
      </div>

      {/* Traffic Flow Network Map */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <SectionHeader
          icon={<Network className="w-4 h-4 text-blue-400" />} title="Traffic Flow Network Map"
          subtitle="Visual representation of live network connections — showing external sources, firewall filtering, and internal application targets."
          tooltip="This diagram shows where network traffic is coming from and where it is going. Red dashed lines indicate flagged or suspicious flows."
        />
        <div ref={containerRef} className="relative min-h-[420px] md:min-h-[380px] bg-slate-950/50 rounded-xl border border-slate-800/50 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.5)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />
          
          {/* SVG Container for Dynamic Arrows */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker id="arrowRed" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#ef4444" /></marker>
              <marker id="arrowBlue" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" /></marker>
              <marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#10b981" /></marker>
              <marker id="arrowYellow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#eab308" /></marker>
            </defs>
            {svgPaths.anomalyToFirewall && <path d={svgPaths.anomalyToFirewall} fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" markerEnd="url(#arrowRed)" />}
            {svgPaths.authorizedToFirewall && <path d={svgPaths.authorizedToFirewall} fill="none" stroke="#3b82f6" strokeWidth="2" markerEnd="url(#arrowBlue)" />}
            {internalTargets.map((target, idx) => {
              const hasAnomaly = data.networkAnomalies?.some(a => a.app === target);
              const path = svgPaths[`firewallToTarget${idx}`];
              if (!path) return null;
              const color = hasAnomaly && idx === 0 ? "#ef4444" : idx === 1 ? "#10b981" : "#eab308";
              const marker = hasAnomaly && idx === 0 ? "url(#arrowRed)" : idx === 1 ? "url(#arrowGreen)" : "url(#arrowYellow)";
              return <path key={idx} d={path} fill="none" stroke={color} strokeWidth="2" strokeDasharray={idx !== 1 ? "5,5" : undefined} markerEnd={marker} />
            })}
          </svg>

          {/* Node Layout */}
          <div className="relative z-10 w-full h-full flex flex-col md:flex-row justify-between items-center px-8 py-4 md:py-0 gap-8 md:gap-0">
            {/* Left Column: External Sources */}
            <div className="flex flex-col gap-10 w-full md:w-auto">
              {(data.networkAnomalies?.length ?? 0) > 0 && (
                <div id="external-anomaly-node" ref={externalAnomalyRef} className="bg-slate-900 border border-red-500/50 p-3 rounded-lg w-full md:w-60 hover:border-red-500 transition-all shadow-[0_0_15px_rgba(239,68,68,0.1)]">
                  <div className="flex items-center gap-2 mb-1.5"><Globe className="w-4 h-4 text-red-500" /><span className="text-red-400 font-mono text-xs truncate">{data.networkAnomalies![0].sourceIp}</span></div>
                  <div className="text-[10px] text-slate-400 mb-1.5">Targeting: <span className="text-slate-200 font-medium">{data.networkAnomalies![0].app}</span></div>
                  <div className="flex items-center justify-between"><span className="text-xs text-red-400 font-medium">⚠ Suspicious Activity</span><button onClick={() => handleBlockIp(data.networkAnomalies![0].sourceIp, data.networkAnomalies![0].app)} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 px-1.5 py-0.5 rounded transition-colors border border-transparent hover:border-red-500/30"><ShieldAlert className="w-3 h-3" />Block</button></div>
                </div>
              )}
              <div id="external-authorized-node" ref={externalAuthorizedRef} className="bg-slate-900 border border-blue-500/30 p-3 rounded-lg w-full md:w-60">
                <div className="flex items-center gap-2 mb-1.5"><Globe className="w-4 h-4 text-blue-500" /><span className="text-blue-400 font-mono text-xs">Authorized Traffic</span></div>
                <div className="text-xs text-slate-500">{safeActive.toLocaleString()} active sessions</div>
              </div>
            </div>

            {/* Center Column: Firewall */}
            <div id="firewall-node" ref={firewallRef} className="bg-slate-900 border-2 border-emerald-500/50 p-5 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.1)] w-40 text-center relative group flex-shrink-0">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-950 text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/50 uppercase tracking-wider font-semibold">Active</div>
              <ShieldCheck className="w-9 h-9 text-emerald-500 mx-auto mb-1.5" />
              <div className="text-slate-200 font-bold text-sm">Firewall</div>
              <div className="text-xs text-slate-500 mt-0.5">{bandwidthGBs} GB/s</div>
            </div>

            {/* Right Column: Internal Targets */}
            <div className="flex flex-col gap-5 w-full md:w-auto">
              {internalTargets.length > 0 ? internalTargets.map((target, idx) => {
                const hasAnomaly = data.networkAnomalies?.some(a => a.app === target);
                const colorClass = hasAnomaly && idx === 0 ? 'red' : idx === 1 ? 'emerald' : 'yellow';
                return (
                  <div id={`internal-target-node-${idx}`} ref={el => internalTargetRefs.current[idx] = el} key={idx} className={`bg-slate-900 border p-3 rounded-lg w-full md:w-60 border-${colorClass}-500/${hasAnomaly ? '100' : '30'} ${hasAnomaly ? 'shadow-[0_0_15px_rgba(239,68,68,0.15)]':''}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2"><Server className={`w-4 h-4 text-${colorClass}-500`} /><span className="text-slate-200 font-semibold text-xs">{target}</span></div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold bg-${colorClass}-900/50 text-${colorClass}-400 border-${colorClass}-500/30`}>
                        {hasAnomaly && idx === 0 ? '🔴 CRITICAL' : idx === 1 ? '✓ HEALTHY' : '⚠ WARNING'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mb-1.5">{hasAnomaly && idx === 0 ? 'Receiving suspicious traffic' : idx === 1 ? 'Normal parameters' : 'Elevated traffic'}</div>
                  </div>
                );
              }) : (
                 <div ref={el => internalTargetRefs.current[0] = el} className="bg-slate-900 border border-emerald-500/30 p-3 rounded-lg w-60"><div className="flex items-center gap-2 mb-1.5"><Server className="w-4 h-4 text-emerald-500" /><span className="text-slate-200 font-semibold text-xs">Internal Network</span></div><span className="text-[10px] text-emerald-400">✓ HEALTHY</span></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Network Anomalies Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800">
          <SectionHeader
            icon={<Wifi className="w-4 h-4 text-red-500 animate-pulse" />} title="Active Network Anomalies"
            subtitle="Real-time log of suspicious network connections detected across all monitored segments."
            tooltip="Each row represents a suspicious network connection flagged by the IDS/IPS system. Use 'Block Source' to immediately drop all traffic from that IP."
            right={<span className="text-xs text-slate-500">{data.networkAnomalies?.length ?? 0} active events</span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[700px]">
            <thead className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800"><tr><th className="px-5 py-4 font-medium tracking-wider">Source IP / Endpoint</th><th className="px-5 py-4 font-medium tracking-wider">Target Application</th><th className="px-5 py-4 font-medium tracking-wider w-24">Port</th><th className="px-5 py-4 font-medium tracking-wider">Anomaly Type</th><th className="px-5 py-4 font-medium tracking-wider w-28">Severity</th><th className="px-5 py-4 font-medium tracking-wider text-right">Mitigation</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {(data.networkAnomalies?.length ?? 0) > 0 ? ( data.networkAnomalies!.map((row: NetworkAnomaly) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4"><div className="text-slate-100 font-mono text-xs font-semibold">{row.sourceIp}</div>{row.destIp && <div className="text-slate-500 font-mono text-[10px] mt-0.5">→ {row.destIp}</div>}</td>
                    <td className="px-5 py-4"><span className="text-blue-400 text-xs font-semibold">{row.app}</span></td>
                    <td className="px-5 py-4"><span className="text-slate-400 font-mono text-xs">{row.port}</span></td>
                    <td className="px-5 py-4"><div className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" /><span className="text-slate-300 text-xs">{row.type}</span></div></td>
                    <td className="px-5 py-4"><AnomalyBadge type={row.type} /></td>
                    <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><button onClick={() => handleBlockIp(row.sourceIp, row.app)} className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors">Block Source</button><button onClick={() => toast.info(`Throttling traffic from ${row.sourceIp}`)} className="text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500/10 text-xs font-medium px-3 py-1.5 rounded transition-colors">Throttle</button></div></td>
                  </tr>
                )) ) : ( <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500 text-sm">No active network anomalies detected</td></tr> )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}