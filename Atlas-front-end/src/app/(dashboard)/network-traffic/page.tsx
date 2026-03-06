'use client';

import React, { useEffect, useState } from 'react';
import {
  Activity, ShieldAlert, Zap, Globe, Server,
  ShieldCheck, Ban, Network, Wifi, AlertTriangle,
} from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { useToast } from '@/hooks/use-toast';
import type { NetworkTrafficData, NetworkAnomaly } from '@/lib/types';

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-slate-800 rounded-lg" />)}
      </div>
      <div className="h-96 bg-slate-800 rounded-lg" />
      <div className="h-64 bg-slate-800 rounded-lg" />
    </div>
  );
}

export default function NetworkTrafficPage() {
  const [data, setData] = useState<NetworkTrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();
  const { toast } = useToast();

  const fetchData = () => {
    setLoading(true);
    apiGet<NetworkTrafficData>(`/network-traffic?env=${environment}`)
      .then(setData)
      .catch((err) => {
        toast({
          title: 'Error',
          description: err instanceof ApiError ? err.message : 'Failed to load network data.',
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleBlockIp = async (sourceIp: string, app: string) => {
    try {
      await apiPost('/network-traffic/block', { sourceIp, app });
      toast({ title: 'Network Block Applied', description: `Hard block applied for ${sourceIp} → ${app}.` });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof ApiError ? err.message : 'Block action failed.',
        variant: 'destructive',
      });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No network traffic data available.
    </div>
  );

  // Determine highest-bandwidth anomaly
  const highestBandwidthAnomaly = data.networkAnomalies?.[0];
  // Unauthorized MAC count from droppedPackets as proxy
  const unknownMacs = Math.ceil(data.droppedPackets / 50);

  // Unique internal targets and their statuses
  const internalTargets = [
    ...new Set(data.networkAnomalies?.map((a) => a.app) ?? []),
  ].slice(0, 3);

  return (
    <div className="space-y-6">

      {/* Top Row: Network KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Highest Bandwidth Consumer */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-5 h-5 text-red-500" />
              <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">
                Highest Bandwidth Consumer
              </h3>
            </div>
            <div className="text-xl font-bold text-red-400 mb-1 truncate">
              {highestBandwidthAnomaly?.app ?? 'No anomalies'}
            </div>
            <div className="text-sm text-slate-500">
              <span className="text-slate-200 font-semibold">
                {(data.bandwidth / 1024).toFixed(1)} GB/s
              </span>{' '}
              active bandwidth
            </div>
          </div>
          <button
            onClick={() =>
              highestBandwidthAnomaly &&
              handleBlockIp(highestBandwidthAnomaly.sourceIp, highestBandwidthAnomaly.app)
            }
            className="mt-5 w-fit px-3 py-1.5 text-xs font-semibold text-orange-400 border border-orange-500/50 rounded hover:bg-orange-900/20 transition-colors"
          >
            Throttle Bandwidth
          </button>
        </div>

        {/* Critical Packet Loss */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-orange-500" />
              <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">
                Critical Packet Loss
              </h3>
            </div>
            <div className="text-xl font-bold text-orange-400 mb-1">
              {data.networkAnomalies?.find((a) => a.type?.toLowerCase().includes('spike'))?.app
                ?? (data.droppedPackets > 100 ? 'Network Layer' : 'Nominal')}
            </div>
            <div className="text-sm text-slate-500">
              <span className="text-slate-200 font-semibold">{data.droppedPackets.toLocaleString()}</span>{' '}
              Dropped Packets
            </div>
          </div>
        </div>

        {/* Unauthorized Access */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wide">
                Unauthorized Network Access
              </h3>
            </div>
            <div className="text-xl font-bold text-red-500 mb-1">
              {data.activeConnections} Active Connections
            </div>
            <div className="text-sm text-slate-500">
              {data.networkAnomalies?.length ?? 0} anomalous sessions detected
            </div>
          </div>
          <button
            className="mt-5 w-fit px-3 py-1.5 text-xs font-semibold text-red-400 border border-red-600/50 rounded hover:bg-red-900/30 transition-colors flex items-center gap-2"
          >
            <Ban className="w-3 h-3" />
            Block Suspicious Sessions
          </button>
        </div>
      </div>

      {/* Traffic Flow Network Map */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-6">
          <Network className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg text-slate-200 font-semibold">Traffic Flow Network Map</h2>
        </div>

        <div className="relative h-[380px] bg-slate-950/50 rounded-xl border border-slate-800/50 overflow-hidden">
          {/* Grid Background */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.5)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />

          {/* SVG Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker id="arrowRed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#ef4444" />
              </marker>
              <marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
              </marker>
              <marker id="arrowBlue" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
              </marker>
            </defs>
            {data.networkAnomalies?.length > 0 && (
              <path d="M 280 120 C 350 120, 350 185, 490 195" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" markerEnd="url(#arrowRed)" />
            )}
            <path d="M 280 280 C 350 280, 350 210, 490 205" fill="none" stroke="#3b82f6" strokeWidth="2" markerEnd="url(#arrowBlue)" />
            <path d="M 620 200 C 720 200, 720 120, 820 120" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" markerEnd="url(#arrowRed)" />
            <path d="M 620 200 C 720 200, 720 200, 820 200" fill="none" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrowGreen)" />
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
                    <span className="text-red-400 font-mono text-xs truncate">
                      {data.networkAnomalies[0].sourceIp}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Suspicious Activity</span>
                    <button
                      onClick={() =>
                        handleBlockIp(
                          data.networkAnomalies[0].sourceIp,
                          data.networkAnomalies[0].app
                        )
                      }
                      className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 hover:bg-red-900/20 px-1.5 py-0.5 rounded transition-colors border border-transparent hover:border-red-500/30"
                    >
                      <ShieldAlert className="w-3 h-3" />
                      Block
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="bg-slate-900 border border-blue-500/30 p-3 rounded-lg w-60 opacity-80">
                <div className="flex items-center gap-2 mb-1.5">
                  <Globe className="w-4 h-4 text-blue-500" />
                  <span className="text-blue-400 font-mono text-xs">Authorized Traffic</span>
                </div>
                <div className="text-xs text-slate-500">
                  {data.activeConnections} active sessions
                </div>
              </div>
            </div>

            {/* Center: Firewall */}
            <div className="flex flex-col justify-center">
              <div className="bg-slate-900 border-2 border-emerald-500/50 p-5 rounded-xl shadow-[0_0_30px_rgba(16,185,129,0.1)] w-40 text-center relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-950 text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/50 uppercase tracking-wider font-semibold">
                  Active
                </div>
                <ShieldCheck className="w-9 h-9 text-emerald-500 mx-auto mb-1.5" />
                <div className="text-slate-200 font-semibold text-sm">Firewall</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {(data.bandwidth / 1024).toFixed(1)} GB/s
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
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                        hasAnomaly && idx === 0
                          ? 'bg-red-900/50 text-red-400 border-red-500/30'
                          : idx === 1
                            ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/20'
                            : 'bg-yellow-900/30 text-yellow-400 border-yellow-500/20'
                      }`}>
                        {hasAnomaly && idx === 0 ? 'CRITICAL' : idx === 1 ? 'HEALTHY' : 'WARNING'}
                      </span>
                    </div>
                    {hasAnomaly && idx === 0 && (
                      <button
                        onClick={() => handleBlockIp(data.networkAnomalies[0].sourceIp, target)}
                        className="text-xs text-red-400 hover:text-red-300 font-medium flex items-center gap-1"
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
                  <span className="text-[10px] text-emerald-400">HEALTHY</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Network Anomalies Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center gap-2">
          <Wifi className="w-5 h-5 text-red-500 animate-pulse" />
          <h2 className="text-lg font-semibold text-slate-200">Active Network Anomalies</h2>
          <span className="ml-auto text-xs text-slate-500">
            {data.networkAnomalies?.length ?? 0} events
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950 text-slate-500 uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="px-6 py-4">Source Endpoint</th>
                <th className="px-6 py-4">Target Application</th>
                <th className="px-6 py-4 w-20">Port</th>
                <th className="px-6 py-4">Anomaly Type</th>
                <th className="px-6 py-4 text-right">Mitigation Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.networkAnomalies?.length > 0 ? (
                data.networkAnomalies.map((row: NetworkAnomaly) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-slate-200 font-mono text-xs">{row.sourceIp}</td>
                    <td className="px-6 py-4 text-blue-400 text-xs font-semibold">{row.app}</td>
                    <td className="px-6 py-4 text-slate-400 font-mono text-xs">{row.port}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                        <span className="text-slate-300 text-xs">{row.type}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleBlockIp(row.sourceIp, row.app)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors"
                        >
                          Block Source
                        </button>
                        <button className="text-yellow-500 border border-yellow-500/50 hover:bg-yellow-500/10 text-xs font-medium px-3 py-1.5 rounded transition-colors">
                          Throttle
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-slate-500 text-sm">
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
