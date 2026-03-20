'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield, AlertTriangle, Ban, Activity, Laptop,
  Info, LoaderCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Label,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent } from '@/lib/types';
import { getInitials, getAvatarColor, isValidAvatarUrl } from '@/lib/avatar-utils';

// ── Reusable UI ───────────────────────────────────────────────────────────────

const InfoTooltip = React.memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
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
});
InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(({ icon, title, subtitle, tooltipText }: any) => (
  <div className="mb-5 px-5 pt-5">
    <div className="flex items-center gap-2 mb-1">
      {icon}
      <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      <InfoTooltip text={tooltipText} />
    </div>
    <p className="text-xs text-slate-500 leading-relaxed pl-7">{subtitle}</p>
  </div>
));
SectionHeader.displayName = 'SectionHeader';

const SeverityBadge = ({ severity }: { severity: string }) => {
  const map: Record<string, string> = {
    Critical: 'text-red-400 bg-red-500/10 border-red-500/40',
    High:     'text-orange-400 bg-orange-500/10 border-orange-500/40',
    Medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/40',
    Low:      'text-blue-400 bg-blue-500/10 border-blue-500/40',
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded border font-semibold whitespace-nowrap ${
        map[severity] ?? 'text-slate-400 border-slate-600'
      }`}
    >
      {severity}
    </span>
  );
};

const truncateLabel = (label: string, maxLength = 10) =>
  typeof label === 'string' && label.length > maxLength
    ? `${label.substring(0, maxLength)}...`
    : label ?? '';

const CustomTooltipContent = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl">
        <p className="font-bold text-slate-200 truncate">{payload[0].payload?.name}</p>
        <p style={{ color: payload[0].fill }}>
          {payload[0].name}: {Number(payload[0].value || 0).toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

// ── Task 2: Timestamp formatter ───────────────────────────────────────────────
// Converts an ISO timestamp string into a compact, readable format.
// Output example: "Mar 20, 14:32:05"
// Returns "N/A" when the value is absent or unparseable.
const formatTimestamp = (raw: string | undefined | null): string => {
  if (!raw) return 'N/A';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return 'N/A';

  const datePart = date.toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${datePart}, ${timePart}`;
};

// ── Employee avatar ───────────────────────────────────────────────────────────
const EmployeeAvatar = ({ avatar, name }: { avatar: string; name: string }) => {
  if (isValidAvatarUrl(avatar)) {
    return (
      <img
        src={avatar}
        alt={name}
        className="w-8 h-8 rounded-full object-cover"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
      style={{ backgroundColor: getAvatarColor(name) }}
    >
      {getInitials(name)}
    </div>
  );
};

// ── Event row ─────────────────────────────────────────────────────────────────
const EventRow = ({
  ev,
  onQuarantine,
}: {
  ev: WazuhEvent;
  onQuarantine: (id: string, employee: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((p) => !p);

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => e.key === 'Enter' && toggle()}
        className={`hover:bg-slate-800/40 cursor-pointer border-b border-slate-800 ${
          ev.severity === 'Critical' ? 'bg-red-950/20' : ''
        }`}
      >
        {/* ── Task 2: formatted timestamp ──────────────────────────────── */}
        <td className="px-5 py-4 text-xs text-slate-400 font-mono whitespace-nowrap">
          {formatTimestamp(ev.timestamp)}
        </td>

        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            <EmployeeAvatar avatar={ev.avatar || ''} name={ev.employee || '?'} />
            <div>
              <div className="font-mono text-sm">{ev.workstationId}</div>
              <div className="text-xs text-slate-400">{ev.employee}</div>
            </div>
          </div>
        </td>

        <td className="px-5 py-4">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className={`w-4 h-4 ${
                ev.severity === 'Critical' ? 'text-red-500' : 'text-orange-500'
              }`}
            />
            <span>{ev.alert}</span>
          </div>
        </td>

        <td className="px-5 py-4">
          <SeverityBadge severity={ev.severity || 'Info'} />
        </td>

        {/* ── Task 3: quarantine button with updated onClick + toast ─────── */}
        <td className="px-5 py-4 text-right">
          <div className="flex items-center justify-end gap-2">
            <button
              disabled={ev.severity !== 'Critical'}
              onClick={(e) => {
                e.stopPropagation();
                if (ev.severity === 'Critical') {
                  onQuarantine(ev.workstationId || '', ev.employee || '');
                }
              }}
              className={`text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors ${
                ev.severity === 'Critical'
                  ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                  : 'bg-slate-700 cursor-not-allowed opacity-50'
              }`}
              title={
                ev.severity !== 'Critical'
                  ? 'Quarantine is only available for Critical severity events'
                  : `Isolate ${ev.workstationId} from the network`
              }
            >
              <Ban className="w-3 h-3" /> QUARANTINE
            </button>
            {expanded
              ? <ChevronUp className="w-3 h-3 text-slate-500" />
              : <ChevronDown className="w-3 h-3 text-slate-500" />
            }
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-950 border-b border-slate-800">
          <td colSpan={5} className="p-4">
            <pre className="text-xs text-slate-400 whitespace-pre-wrap font-mono bg-slate-950 p-2 rounded-md">
              {JSON.stringify(ev, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EndpointSecurityPage() {
  const { environment } = useEnvironment();
  const [data, setData]   = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiGet<EndpointSecurityData>('/endpoint-security', controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          toast.error('Failed to load endpoint data', { description: err.message });
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [environment]);

  // ── Task 3: quarantine handler ────────────────────────────────────────────
  // The API call is unchanged; only the toast messages are updated to match
  // the requested copy: "Endpoint [Name] has been isolated from the network."
  const handleQuarantine = async (workstationId: string, employee: string) => {
    if (!workstationId) {
      toast.error('Missing workstation ID');
      return;
    }
    try {
      await apiPost('/endpoint-security/quarantine', { workstationId });
      toast.success(`Endpoint ${workstationId} has been isolated from the network.`, {
        description: employee
          ? `User "${employee}" can no longer access network resources.`
          : undefined,
      });
    } catch (err) {
      toast.error(`Failed to quarantine ${workstationId}`, {
        description: err instanceof ApiError ? err.message : 'Could not connect to EDR',
      });
    }
  };

  const {
    safeMonitored, safeOffline, safeMalwareAlerts,
    osDistribution, alertTypes, safeWazuhEvents,
  } = useMemo(() => {
    const epData = data || {};
    return {
      safeMonitored:      Number(epData.monitoredLaptops)  || 0,
      safeOffline:        Number(epData.offlineDevices)    || 0,
      safeMalwareAlerts:  Number(epData.malwareAlerts)     || 0,
      osDistribution: (epData.osDistribution || []).map((d) => ({
        ...d, name: d.name || 'Unknown', value: Number(d.value) || 0,
      })),
      alertTypes: (epData.alertTypes || []).map((d) => ({
        ...d, name: d.name || 'Unknown', value: Number(d.value) || 0,
      })),
      safeWazuhEvents: epData.wazuhEvents || [],
    };
  }, [data]);

  if (loading) return (
    <div className="p-6 flex justify-center">
      <LoaderCircle className="w-6 h-6 animate-spin text-slate-500" />
    </div>
  );
  if (error) return <div className="text-red-400 p-6 text-center">{error}</div>;
  if (!data)  return (
    <div className="flex items-center justify-center h-48 text-slate-500">
      No endpoint security data available.
    </div>
  );

  return (
    <div className="space-y-6 pb-8">
      <header>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" /> Endpoint Security
        </h1>
      </header>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm text-slate-400">Monitored Laptops</h3>
          <div className="text-3xl font-bold text-green-400">{safeMonitored}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm text-slate-400">Offline Devices</h3>
          <div className="text-3xl font-bold text-orange-400">{safeOffline}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm text-slate-400">Malware Alerts (24h)</h3>
          <div className="text-3xl font-bold text-red-400">{safeMalwareAlerts}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Task 1a: OS Distribution — axis labels added ───────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader
            icon={<Laptop className="w-4 h-4 text-blue-400" />}
            title="OS Distribution"
            subtitle="Distribution of operating systems across monitored endpoints"
            tooltipText="Overview of the OS landscape helps identify unpatched or legacy systems."
          />
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={osDistribution}
                // Extra bottom margin so the XAxis label doesn't overlap the ticks.
                // Extra left margin so the rotated YAxis label has room.
                margin={{ top: 5, right: 20, left: 10, bottom: 48 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />

                <XAxis
                  dataKey="name"
                  tickFormatter={(v) => truncateLabel(v)}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  interval={0}
                >
                  {/* "Operating System" label sits below the axis ticks */}
                  <Label
                    value="Operating System"
                    position="insideBottom"
                    offset={-34}
                    style={{ fill: '#f8f407', fontSize: 11 }}
                  />
                </XAxis>

                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  width={55}
                >
                  {/* "Device Count" label rotated along the left edge */}
                  <Label
                    value="Device Count"
                    angle={-90}
                    position="insideLeft"
                    offset={10}
                    style={{ fill: '#f8f407', fontSize: 11, textAnchor: 'middle' }}
                  />
                </YAxis>

                <RechartsTooltip content={<CustomTooltipContent />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="value" name="Devices" radius={[4, 4, 0, 0]}>
                  {osDistribution.map((e, i) => (
                    <Cell key={i} fill={e.fill || '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Task 1b: Alert Types — axis labels added ───────────────────── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader
            icon={<AlertTriangle className="w-4 h-4 text-orange-400" />}
            title="Alert Types"
            subtitle="Breakdown of alert categories from Wazuh agent telemetry"
            tooltipText="Shows the most common threat categories across all monitored endpoints."
          />
          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                layout="vertical"
                data={alertTypes}
                // Extra bottom margin for the XAxis label; extra left margin for
                // the long category names on the YAxis.
                margin={{ top: 5, right: 20, left: 10, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />

                {/* Horizontal axis (numeric) sits at the bottom — label below it */}
                <XAxis
                  type="number"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                >
                  <Label
                    value="Alert Count"
                    position="insideBottom"
                    offset={-28}
                    style={{ fill: '#f8f407', fontSize: 11 }}
                  />
                </XAxis>

                {/* Vertical axis (category names) — label rotated on the left */}
                <YAxis
                  dataKey="name"
                  type="category"
                  tickFormatter={(v) => truncateLabel(v, 15)}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  width={110}
                >
                  <Label
                    value="Category"
                    angle={-90}
                    position="insideLeft"
                    offset={10}
                    style={{ fill: '#f8f407', fontSize: 11, textAnchor: 'middle' }}
                  />
                </YAxis>

                <RechartsTooltip content={<CustomTooltipContent />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                  {alertTypes.map((e, i) => (
                    <Cell key={i} fill={e.fill || '#f97316'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Endpoint event log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <SectionHeader
          icon={<Activity className="w-4 h-4 text-red-400" />}
          title="Endpoint Event Log"
          subtitle={`Live stream of ${safeWazuhEvents.length} alerts from Wazuh agents`}
          tooltipText="Expand any row to view the full event JSON payload."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800">
                <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium">Timestamp</th>
                <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium">Endpoint</th>
                <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium">Threat</th>
                <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium">Severity</th>
                <th className="px-5 py-3 text-right text-xs text-slate-500 uppercase font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {safeWazuhEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500 py-10">
                    No endpoint events available.
                  </td>
                </tr>
              ) : (
                safeWazuhEvents.map((ev) => (
                  <EventRow
                    key={ev.id ?? `${ev.timestamp}-${ev.workstationId}`}
                    ev={ev}
                    onQuarantine={handleQuarantine}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
