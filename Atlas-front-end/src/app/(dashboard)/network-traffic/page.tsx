'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Activity, AlertTriangle, Info, LoaderCircle, Network, Wifi } from 'lucide-react';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import { getNetworkTraffic, blockNetworkSource } from '@/lib/apiClient';
import type { NetworkTrafficData, NetworkAnomaly } from '@/lib/types';

// ─── Sub-components ───────────────────────────────────────────────────────────

const InfoTooltip = React.memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1">
      <button
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}       onBlur={() => setOpen(false)}
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

const SectionHeader = React.memo(({ icon, title, subtitle, tooltip, right }: {
  icon: React.ReactNode; title: string; subtitle: string; tooltip: string; right?: React.ReactNode;
}) => (
  <div className="mb-5">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">{icon}<h2 className="text-sm font-semibold text-slate-100">{title}</h2><InfoTooltip text={tooltip} /></div>
      {right}
    </div>
    <p className="text-[11px] text-slate-500 mt-1 pl-6 leading-relaxed">{subtitle}</p>
  </div>
));
SectionHeader.displayName = 'SectionHeader';

const KpiCard = React.memo(({ value, label, subtitle, color = 'default' }: {
  value: string | number; label: string; subtitle: string; color?: 'default' | 'red' | 'green' | 'orange';
}) => {
  const colors = { default: 'text-slate-200', red: 'text-red-400', green: 'text-emerald-400', orange: 'text-orange-400' };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-slate-400 mb-2">{label}</h3>
      <div className={`text-3xl font-bold ${colors[color]}`}>{value}</div>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
});
KpiCard.displayName = 'KpiCard';

const AnomalyRow = ({ row, onBlockIp }: { row: NetworkAnomaly; onBlockIp: (sourceIp: string, app: string) => void }) => (
  <tr className="hover:bg-slate-800/30 transition-colors">
    <td className="px-5 py-4"><div className="text-slate-100 font-mono text-xs font-semibold">{row.sourceIp || 'N/A'}</div></td>
    <td className="px-5 py-4"><span className="text-blue-400 text-xs font-semibold">{row.app || 'N/A'}</span></td>
    <td className="px-5 py-4"><span className="text-slate-400 font-mono text-xs">{row.port?.toString() || 'N/A'}</span></td>
    <td className="px-5 py-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
        <span className="text-slate-300 text-xs">{row.type || 'Unknown Anomaly'}</span>
      </div>
    </td>
    <td className="px-5 py-4 text-right">
      <button
        onClick={() => onBlockIp(row.sourceIp || '', row.app || '')}
        className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
      >
        Block Source
      </button>
    </td>
  </tr>
);

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NetworkTrafficPage() {
  const { environment } = useEnvironment();
  const [data, setData]       = useState<NetworkTrafficData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getNetworkTraffic()
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) toast.error('Failed to load network data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [environment]);

  const handleBlockIp = async (sourceIp: string, app: string) => {
    if (!sourceIp) { toast.error('Cannot block an empty IP address.'); return; }
    try {
      await blockNetworkSource({ sourceIp, app });
      toast.success('Network Block Applied', { description: `Hard block applied for ${sourceIp} → ${app}.` });
    } catch (err) {
      toast.error('Block action failed.', { description: err instanceof Error ? err.message : 'Request failed.' });
    }
  };

  const { safeBandwidth, safeActiveConnections, safeDroppedPackets, safeAnomalies } = useMemo(() => {
    const d = data ?? {} as Partial<NetworkTrafficData>;
    const anomalies = (Array.isArray(d.networkAnomalies) ? d.networkAnomalies : [])
      .filter((item): item is NetworkAnomaly => !!item && typeof item === 'object' && !!item.sourceIp);

    return {
      safeBandwidth:          Number(d.bandwidth)          || 0,
      safeActiveConnections:  Number(d.activeConnections)  || 0,
      safeDroppedPackets:     Number(d.droppedPackets)     || 0,
      safeAnomalies:          anomalies,
    };
  }, [data]);

  if (loading) return <div className="p-6 flex justify-center"><LoaderCircle className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data)   return <div className="flex items-center justify-center h-48 text-slate-500">No network traffic data available.</div>;

  const droppedPct = safeActiveConnections > 0
    ? ((safeDroppedPackets / (safeActiveConnections + safeDroppedPackets)) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" />Network Traffic Analysis
        </h1>
        <p className="text-xs text-slate-500 mt-0.5 ml-7">Real-time network flow monitoring, bandwidth consumption, and anomaly detection.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <KpiCard
          label="Network Bandwidth Utilisation"
          value={`${safeBandwidth}%`}
          subtitle="Current utilisation of total capacity"
          color={safeBandwidth > 80 ? 'red' : safeBandwidth > 60 ? 'orange' : 'green'}
        />
        <KpiCard label="Active Connections"  value={safeActiveConnections.toLocaleString()} subtitle="Concurrent established sessions" />
        <KpiCard
          label="Dropped Packets"
          value={`${safeDroppedPackets.toLocaleString()} (${droppedPct}%)`}
          subtitle="Indicating network congestion"
          color={parseFloat(droppedPct) > 1 ? 'red' : 'orange'}
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800">
          <SectionHeader
            icon={<Wifi className="w-4 h-4 text-red-500 animate-pulse" />}
            title="Active Network Anomalies"
            subtitle="Real-time log of suspicious network connections detected by the IDS/IPS system."
            tooltip="This feed shows traffic flagged as anomalous. Use 'Block Source' to immediately drop all traffic from a suspicious IP."
            right={<span className="text-xs text-slate-500">{safeAnomalies.length} active events</span>}
          />
        </div>

        {safeAnomalies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[700px]">
              <thead className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800">
                <tr>
                  <th className="px-5 py-4 font-medium tracking-wider">Source IP</th>
                  <th className="px-5 py-4 font-medium tracking-wider">Target Application</th>
                  <th className="px-5 py-4 font-medium tracking-wider w-24">Port</th>
                  <th className="px-5 py-4 font-medium tracking-wider">Anomaly Type</th>
                  <th className="px-5 py-4 font-medium tracking-wider text-right">Mitigation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {safeAnomalies.map((row, i) => (
                  <AnomalyRow key={row.id ?? i} row={row} onBlockIp={handleBlockIp} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-60 flex items-center justify-center">
            <p className="text-slate-500">No active network anomalies detected.</p>
          </div>
        )}
      </div>
    </div>
  );
}
