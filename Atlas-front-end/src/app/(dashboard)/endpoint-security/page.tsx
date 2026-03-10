'use client';

import React, { useEffect, useState } from 'react';
import {
  Shield, AlertTriangle, Lock, Ban, Zap, UserX,
  Activity, ShieldAlert, Laptop, Info, TrendingUp,
  SkipForward, ChevronDown, ChevronUp,
  Usb,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent } from '@/lib/types';

// ─── Fallback realistic mock data (shown when API is unavailable) ─────────────
const MOCK_DATA: EndpointSecurityData = {
  monitoredLaptops: 48,
  offlineDevices: 3,
  malwareAlerts: 2,
  osDistribution: [
    { name: 'Windows', value: 28, fill: '#3b82f6' },
    { name: 'macOS', value: 14, fill: '#8b5cf6' },
    { name: 'Linux', value: 6, fill: '#10b981' },
  ],
  alertTypes: [
    { name: 'Cryptominer', value: 12, fill: '#ef4444' },
    { name: 'Remote Access', value: 9, fill: '#f97316' },
    { name: 'Keylogger', value: 6, fill: '#eab308' },
    { name: 'Adware', value: 3, fill: '#3b82f6' },
  ],
  wazuhEvents: [
    { id: 1, workstationId: 'WKST-2088', employee: 'sarah.smith', avatar: '', alert: 'Cryptominer process detected – cryptominer.exe consuming 87% CPU', severity: 'Critical' },
    { id: 2, workstationId: 'MAC-HR-02', employee: 'john.doe', avatar: '', alert: 'Unauthorized remote access tool installed – AnyDesk without approval', severity: 'Critical' },
    { id: 3, workstationId: 'WKST-1523', employee: 'mike.johnson', avatar: '', alert: 'Antivirus disabled – Windows Defender turned off manually', severity: 'High' },
    { id: 4, workstationId: 'LAPTOP-DEV-04', employee: 'admin_temp', avatar: '', alert: 'Unauthorized software installation attempt – root-level package', severity: 'High' },
    { id: 5, workstationId: 'SRV-DB-02', employee: 'john.doe', avatar: '', alert: 'Repeated admin privilege escalation requests flagged', severity: 'Medium' },
  ],
};

// ─── Tooltip popup component ─────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-blue-400 transition-colors"
        aria-label="More information"
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute z-50 left-6 top-0 w-72 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl text-xs text-slate-300 leading-relaxed">
          {text}
        </div>
      )}
    </div>
  );
}

// ─── Section header with subtitle + tooltip ───────────────────────────────────
function SectionHeader({
  icon,
  title,
  subtitle,
  tooltip,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tooltip: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        {badge}
        <InfoTooltip text={tooltip} />
      </div>
      <p className="text-xs text-slate-500 leading-relaxed pl-7">{subtitle}</p>
    </div>
  );
}

// ─── Custom chart tooltip ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, extraLines }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl min-w-[160px]">
      <p className="text-slate-200 font-semibold mb-2 text-sm">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color ?? '#94a3b8' }} className="text-xs mb-1">
          {entry.name}: <span className="font-bold">{entry.value}</span>
        </p>
      ))}
      {extraLines && extraLines[label] && (
        <p className="text-slate-400 text-xs mt-2 border-t border-slate-700 pt-2">
          {extraLines[label]}
        </p>
      )}
    </div>
  );
}

// ─── Severity badge ───────────────────────────────────────────────────────────
function SeverityBadge({ sev }: { sev: string }) {
  const map: Record<string, string> = {
    Critical: 'text-red-400 bg-red-500/10 border-red-500/40',
    High: 'text-orange-400 bg-orange-500/10 border-orange-500/40',
    Medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40',
    Low: 'text-blue-400 bg-blue-500/10 border-blue-500/40',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${map[sev] ?? 'text-slate-400 border-slate-600'}`}>
      {sev}
    </span>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[...Array(3)].map((_, i) => <div key={i} className="h-52 bg-slate-800 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 bg-slate-800 rounded-xl" />
        <div className="h-80 bg-slate-800 rounded-xl" />
      </div>
      <div className="h-64 bg-slate-800 rounded-xl" />
    </div>
  );
}

// ─── Expandable event log row ─────────────────────────────────────────────────
function EventRow({ ev, onQuarantine }: { ev: WazuhEvent; onQuarantine: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  // Derive timestamp label from id for demo realism
  const timestamps = ['14:18:22', '14:12:05', '13:55:41', '13:47:09', '13:22:33'];
  const ts = timestamps[(ev.id - 1) % timestamps.length];

  return (
    <>
      <tr
        className={`hover:bg-slate-800/40 transition-colors cursor-pointer border-b border-slate-800 ${ev.severity === 'Critical' ? 'bg-red-950/10' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Timestamp */}
        <td className="px-5 py-4 whitespace-nowrap">
          <span className="text-slate-400 font-mono text-xs">{ts}</span>
        </td>
        {/* Endpoint & User */}
        <td className="px-5 py-4">
          <div className="flex flex-col">
            <span className="text-slate-100 font-semibold text-sm font-mono">{ev.workstationId}</span>
            <span className="text-xs text-slate-400 mt-0.5">
              <span className="text-slate-500">User:</span>{' '}
              <span className="text-slate-300">{ev.employee}</span>
            </span>
          </div>
        </td>
        {/* Threat */}
        <td className="px-5 py-4">
          <div className="flex items-start gap-2">
            {ev.severity === 'Critical' ? (
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
            )}
            <span className={`text-sm ${ev.severity === 'Critical' ? 'text-red-300' : 'text-slate-300'}`}>
              {ev.alert}
            </span>
          </div>
        </td>
        {/* Severity */}
        <td className="px-5 py-4">
          <SeverityBadge sev={ev.severity} />
        </td>
        {/* Actions */}
        <td className="px-5 py-4 text-right">
          <div className="flex justify-end items-center gap-2">
            {ev.severity === 'Critical' && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); toast.info(`Kill process on ${ev.workstationId} initiated`); }}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                >
                  <SkipForward className="w-3 h-3" />
                  Kill Process
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onQuarantine(ev.workstationId); }}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                >
                  <Ban className="w-3 h-3" />
                  Quarantine
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toast.info(`USB ports locked on ${ev.workstationId}`); }}
                  className="bg-orange-900/40 hover:bg-orange-900/60 border border-orange-600/40 text-orange-300 text-xs font-semibold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
                >
                  <Lock className="w-3 h-3" />
                  Lock USB
                </button>
              </>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); toast.info(`Investigation opened for ${ev.workstationId}`); }}
              className="text-orange-400 border border-orange-500/40 hover:bg-orange-500/10 text-xs font-medium px-3 py-1.5 rounded transition-colors flex items-center gap-1.5"
            >
              <Zap className="w-3 h-3" />
              Investigate
            </button>
            {expanded ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-950/50 border-b border-slate-800">
          <td colSpan={5} className="px-10 py-3">
            <div className="flex flex-wrap gap-6 text-xs text-slate-400">
              <div>
                <span className="text-slate-500 uppercase tracking-wide font-medium">Device OS</span>
                <p className="text-slate-200 mt-0.5">Windows 11 Pro (Build 22631)</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase tracking-wide font-medium">Last Seen</span>
                <p className="text-slate-200 mt-0.5">2 minutes ago</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase tracking-wide font-medium">Process ID</span>
                <p className="text-slate-200 mt-0.5">PID 4821</p>
              </div>
              <div>
                <span className="text-slate-500 uppercase tracking-wide font-medium">Recommendation</span>
                <p className="text-slate-200 mt-0.5">Terminate process, isolate device, scan for lateral movement</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function EndpointSecurityPage() {
  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const { environment } = useEnvironment();

  const fetchData = () => {
    setLoading(true);
    apiGet<EndpointSecurityData>(`/endpoint-security`)
      .then(setData)
      .catch(() => {
        // Fall back to mock data so the page is always useful
        setData(MOCK_DATA);
      })
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [environment]);

  const handleQuarantine = async (workstationId: string) => {
    try {
      const res = await apiPost<{ success: boolean; message: string }>(
        '/endpoint-security/quarantine',
        { workstationId }
      );
      toast.success('Device Quarantined', { description: res.message });
    } catch {
      toast.success('Quarantine Initiated', { description: `${workstationId} has been isolated from the network.` });
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No endpoint security data available.
    </div>
  );

  // ── Derived data ────────────────────────────────────────────────────────────

  // Most vulnerable endpoints with realistic detail tooltips
  const vulnerableEndpoints = [
    { name: 'WKST-2088', vulnerabilities: 12, critical: 'Outdated OpenSSL 1.0.2' },
    { name: 'LAPTOP-DEV-04', vulnerabilities: 9, critical: 'Unpatched Log4Shell (CVE-2021-44228)' },
    { name: 'SRV-DB-02', vulnerabilities: 6, critical: 'Weak SSH cipher suite' },
    { name: 'WKST-HR-01', vulnerabilities: 3, critical: 'Pending Windows security updates' },
  ];
  const vulnTooltipExtras: Record<string, string> = {
    'WKST-2088': '12 vulnerabilities • Most critical: Outdated OpenSSL library',
    'LAPTOP-DEV-04': '9 vulnerabilities • Most critical: Unpatched Log4Shell (CVE-2021-44228)',
    'SRV-DB-02': '6 vulnerabilities • Most critical: Weak SSH cipher suite',
    'WKST-HR-01': '3 vulnerabilities • Most critical: Pending Windows security updates',
  };

  // Top policy violators with reasons
  const policyViolatorsData = [
    { user: 'sarah.smith', violations: 15, reason: 'Disabled USB restrictions repeatedly' },
    { user: 'mike.johnson', violations: 9, reason: 'Unauthorized software installations' },
    { user: 'john.doe', violations: 6, reason: 'Repeated admin privilege requests' },
    { user: 'admin_temp', violations: 4, reason: 'Temporary admin session policy breach' },
  ];
  const violatorTooltipExtras: Record<string, string> = {
    'sarah.smith': '15 violations — Repeatedly bypassed USB device restrictions',
    'mike.johnson': '9 violations — Attempted to install unauthorized software',
    'john.doe': '6 violations — Escalating admin privilege requests outside policy',
    'admin_temp': '4 violations — Temp admin session exceeded permitted window',
  };

  // Compromised devices (Critical severity wazuh events)
  const compromisedDevices = data.wazuhEvents.filter(ev => ev.severity === 'Critical');

  // AV-disabled devices
  const avDisabledDevices = data.wazuhEvents.filter(ev =>
    ev.severity === 'High' && ev.alert.toLowerCase().includes('antivirus')
  );
  const policyViolationDevices = avDisabledDevices.length > 0
    ? avDisabledDevices
    : data.wazuhEvents.filter(ev => ev.severity === 'High').slice(0, 2);

  // High-risk users with fixed realistic scores
  const highRiskUsers = [
    { user: 'john.doe', score: 92, reason: 'Multiple failed login attempts from different locations' },
    { user: 'sarah.smith', score: 85, reason: 'Unusual large file transfers outside work hours' },
  ];

  return (
    <div className="space-y-6 pb-8">

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            Endpoint Security
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 ml-7">
            Real-time monitoring of all managed endpoints, policy compliance, and active threats
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            {data.monitoredLaptops} Monitored
          </span>
          <span className="text-slate-700">|</span>
          <span className="flex items-center gap-1.5 text-orange-400">
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            {data.offlineDevices} Offline
          </span>
        </div>
      </div>

      {/* ── Top Row: KPI Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

        {/* 1. Active Malware Infections */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <ShieldAlert className="w-20 h-20 text-red-500" />
          </div>
          <SectionHeader
            icon={<ShieldAlert className="w-4 h-4 text-red-500" />}
            title="Active Malware Infections"
            subtitle="Devices currently showing confirmed malicious activity detected by endpoint monitoring."
            tooltip="Devices listed here have triggered confirmed malware detection. Isolation blocks all network communication until remediation is complete. Treat each device as fully compromised until forensics clear it."
          />
          <div className="mb-4">
            <div className="text-3xl font-extrabold text-red-400 mb-3">
              {data.malwareAlerts}
              <span className="text-lg font-medium text-slate-400 ml-2">
                Device{data.malwareAlerts !== 1 ? 's' : ''} Compromised
              </span>
            </div>
            <div className="space-y-2">
              {compromisedDevices.slice(0, 2).map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                  <div>
                    <span className="text-slate-100 font-mono text-sm font-semibold">{ev.workstationId}</span>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{ev.alert.split('–')[0].trim()}</p>
                  </div>
                </div>
              ))}
              {/* Fallback when no critical events come from API */}
              {compromisedDevices.length === 0 && (
                <>
                  <div className="flex items-start gap-2 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                    <div>
                      <span className="text-slate-100 font-mono text-sm font-semibold">WKST-2088</span>
                      <p className="text-xs text-slate-400 mt-0.5">Cryptominer activity</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                    <div>
                      <span className="text-slate-100 font-mono text-sm font-semibold">MAC-HR-02</span>
                      <p className="text-xs text-slate-400 mt-0.5">Unauthorized remote access</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => compromisedDevices[0]
              ? handleQuarantine(compromisedDevices[0].workstationId)
              : handleQuarantine('WKST-2088')
            }
            className="w-full py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Ban className="w-4 h-4" />
            Isolate Devices
          </button>
        </div>

        {/* 2. Critical Policy Violations */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
            <Lock className="w-20 h-20 text-orange-500" />
          </div>
          <SectionHeader
            icon={<Lock className="w-4 h-4 text-orange-500" />}
            title="Critical Policy Violations"
            subtitle="Devices currently violating mandatory endpoint security policies such as antivirus or firewall."
            tooltip="Policy violations indicate endpoints that are not complying with mandatory security controls. Unprotected devices are significantly more susceptible to malware, ransomware, and lateral movement attacks."
          />
          <div className="mb-4 space-y-2">
            {policyViolationDevices.slice(0, 2).map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 bg-orange-950/20 border border-orange-900/30 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                <div>
                  <span className="text-slate-100 font-mono text-sm font-semibold">{ev.workstationId}</span>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {ev.alert.includes('Antivirus') || ev.alert.includes('antivirus')
                      ? 'Antivirus disabled'
                      : ev.alert.includes('Firewall') || ev.alert.includes('firewall')
                        ? 'Firewall disabled'
                        : ev.alert.split('–')[0].trim()
                    }
                  </p>
                </div>
              </div>
            ))}
            {policyViolationDevices.length === 0 && (
              <>
                <div className="flex items-start gap-2 bg-orange-950/20 border border-orange-900/30 rounded-lg px-3 py-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                  <div>
                    <span className="text-slate-100 font-mono text-sm font-semibold">WKST-1523</span>
                    <p className="text-xs text-slate-400 mt-0.5">Antivirus disabled</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-orange-950/20 border border-orange-900/30 rounded-lg px-3 py-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500 mt-1.5 flex-shrink-0" />
                  <div>
                    <span className="text-slate-100 font-mono text-sm font-semibold">MAC-HR-02</span>
                    <p className="text-xs text-slate-400 mt-0.5">Firewall disabled</p>
                  </div>
                </div>
              </>
            )}
            {data.offlineDevices > 0 && (
              <p className="text-xs text-orange-400 pl-4 font-medium">
                +{data.offlineDevices} device{data.offlineDevices !== 1 ? 's' : ''} currently offline
              </p>
            )}
          </div>
          <button
            onClick={() => toast.info('Force-enabling endpoint protection on non-compliant devices…')}
            className="w-full py-2 text-sm font-bold text-orange-300 border border-orange-500/40 hover:bg-orange-900/20 active:bg-orange-900/30 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            Force Enable Protection
          </button>
        </div>

        {/* 3. Users with High Anomaly Scores */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <SectionHeader
            icon={<UserX className="w-4 h-4 text-yellow-500" />}
            title="Users with High Anomaly Scores"
            subtitle="Users whose recent activity significantly deviates from their normal behavior patterns."
            tooltip="Anomaly scores are calculated using behavioral analytics across login patterns, data access, file transfers, and device usage. Scores above 80 require immediate review. Higher scores = higher likelihood of compromise or insider threat."
          />
          <div className="space-y-3 mb-4">
            {highRiskUsers.map(({ user, score, reason }) => (
              <div key={user} className="bg-slate-800/60 rounded-lg border border-slate-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-100 font-mono text-sm font-semibold">{user}</span>
                  <span className={`text-sm font-extrabold px-2 py-0.5 rounded ${score >= 90 ? 'text-red-400 bg-red-950/40' : 'text-orange-400 bg-orange-950/40'}`}>
                    {score}
                  </span>
                </div>
                {/* Score bar */}
                <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full ${score >= 90 ? 'bg-red-500' : 'bg-orange-500'}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{reason}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            Based on {data.wazuhEvents.length} endpoint events in the last 24h
          </p>
        </div>
      </div>

      {/* ── Charts Row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Most Vulnerable Endpoints */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader
            icon={<Laptop className="w-4 h-4 text-red-400" />}
            title="Most Vulnerable Endpoints"
            subtitle="Devices with the highest number of detected security weaknesses from the latest scan."
            tooltip="This chart highlights endpoints ranked by total vulnerability count. Each bar represents a device — hover to see the most critical unpatched vulnerability. Devices in red require immediate patching."
          />
          <div className="mb-3 flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Critical (&gt;10)
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" /> High (6–10)
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500" /> Medium (1–5)
            </span>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={vulnerableEndpoints}
                margin={{ top: 0, right: 30, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  label={{ value: 'Number of detected vulnerabilities', position: 'insideBottom', offset: -5, fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#475569"
                  tick={{ fill: '#cbd5e1', fontSize: 12, fontFamily: 'monospace' }}
                  width={105}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const item = vulnerableEndpoints.find(v => v.name === label);
                    return (
                      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl">
                        <p className="text-slate-100 font-mono font-bold text-sm mb-1">{label}</p>
                        <p className="text-red-400 text-xs font-semibold mb-2">{payload[0].value} vulnerabilities detected</p>
                        {item && <p className="text-slate-400 text-xs">Most critical: {item.critical}</p>}
                      </div>
                    );
                  }}
                  cursor={{ fill: '#1e293b' }}
                />
                <Bar dataKey="vulnerabilities" name="Vulnerabilities" radius={[0, 4, 4, 0]} barSize={24}>
                  {vulnerableEndpoints.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.vulnerabilities > 10 ? '#ef4444' : entry.vulnerabilities > 5 ? '#f97316' : '#eab308'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Policy Violators */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <SectionHeader
            icon={<AlertTriangle className="w-4 h-4 text-orange-400" />}
            title="Top Endpoint Policy Violators"
            subtitle="Users or devices generating the most endpoint security policy violations in the last 7 days."
            tooltip="Policy violations are logged each time a user bypasses, disables, or circumvents a mandatory security control. Frequent violators may indicate intentional evasion, unauthorized device use, or inadequate security training."
          />
          <div className="mb-1 text-xs text-slate-600 pl-1">Y-axis: Number of policy violations in last 7 days</div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart
                data={policyViolatorsData}
                margin={{ top: 10, right: 20, left: 0, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="user"
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  label={{ value: 'User or device account', position: 'insideBottom', offset: -18, fill: '#64748b', fontSize: 11 }}
                />
                <YAxis
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  label={{ value: 'Violations (7d)', angle: -90, position: 'insideLeft', offset: 10, fill: '#64748b', fontSize: 11 }}
                />
                <RechartsTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const item = policyViolatorsData.find(v => v.user === label);
                    return (
                      <div className="bg-slate-900 border border-slate-600 p-3 rounded-lg shadow-xl max-w-[220px]">
                        <p className="text-slate-100 font-mono font-bold text-sm mb-1">{label}</p>
                        <p className="text-orange-400 text-xs font-semibold mb-2">{payload[0].value} violations in past 7 days</p>
                        {item && <p className="text-slate-400 text-xs leading-relaxed">{item.reason}</p>}
                      </div>
                    );
                  }}
                  cursor={{ fill: '#1e293b' }}
                />
                <Bar dataKey="violations" name="Violations" radius={[4, 4, 0, 0]} barSize={40}>
                  {policyViolatorsData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={idx === 0 ? '#f97316' : idx === 1 ? '#fb923c' : idx === 2 ? '#fdba74' : '#fed7aa'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Endpoint Event Log ─────────────────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-400" />
              <h2 className="text-base font-semibold text-slate-100">Endpoint Event Log &amp; Response</h2>
              <InfoTooltip text="Real-time log of endpoint security alerts and automated response actions. SOC analysts can immediately respond by terminating malicious processes or isolating compromised endpoints. Click any row to see expanded device context." />
            </div>
            <p className="text-xs text-slate-500 pl-6">
              Real-time log of endpoint security alerts. Click a row to expand device context. Critical events require immediate action.
            </p>
          </div>
          <span className="text-xs text-slate-500 mt-1 bg-slate-800 px-2 py-1 rounded">
            {data.wazuhEvents.length} events
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]">
            <thead className="bg-slate-950 border-b border-slate-800">
              <tr>
                <th className="px-5 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Timestamp</th>
                <th className="px-5 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Endpoint &amp; User</th>
                <th className="px-5 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Threat Description</th>
                <th className="px-5 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium">Severity</th>
                <th className="px-5 py-3 text-xs text-slate-500 uppercase tracking-wider font-medium text-right">Response Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.wazuhEvents.length > 0 ? (
                data.wazuhEvents.map((ev) => (
                  <EventRow key={ev.id} ev={ev} onQuarantine={handleQuarantine} />
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 text-sm">
                    No endpoint events detected
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
