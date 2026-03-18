'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield,
  AlertTriangle,
  Ban,
  Activity,
  Laptop,
  Info,
  LoaderCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  Label
} from 'recharts';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { useEnvironment } from '@/context/EnvironmentContext';
import { toast } from 'sonner';
import type { EndpointSecurityData, WazuhEvent } from '@/lib/types';

const InfoTooltip = React.memo(({ text }: { text: string }) => {
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
});

InfoTooltip.displayName = 'InfoTooltip';

const SectionHeader = React.memo(
  ({ icon, title, subtitle, tooltipText }: any) => (
    <div className="mb-5 px-5 pt-5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        <InfoTooltip text={tooltipText} />
      </div>
      <p className="text-xs text-slate-500 leading-relaxed pl-7">{subtitle}</p>
    </div>
  )
);

SectionHeader.displayName = 'SectionHeader';

const SeverityBadge = ({ severity }: { severity: string }) => {
  const map: Record<string, string> = {
    Critical: 'text-red-400 bg-red-500/10 border-red-500/40',
    High: 'text-orange-400 bg-orange-500/10 border-orange-500/40',
    Medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/40',
    Low: 'text-blue-400 bg-blue-500/10 border-blue-500/40'
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

const truncateLabel = (label: string, maxLength = 10) => {
  if (typeof label !== 'string') return '';
  return label.length > maxLength ? `${label.substring(0, maxLength)}...` : label;
};

const CustomTooltipContent = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const name = payload[0].payload?.name;

    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs shadow-xl">
        <p className="font-bold text-slate-200 truncate">{name}</p>
        <p style={{ color: payload[0].fill }}>
          {payload[0].name}: {Number(payload[0].value || 0).toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

const EventRow = ({
  ev,
  onQuarantine
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
        <td className="px-5 py-4 text-xs text-slate-400 font-mono">
          {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'N/A'}
        </td>

        <td className="px-5 py-4">
          <div className="font-mono text-sm">{ev.workstationId}</div>
          <div className="text-xs text-slate-400">{ev.employee}</div>
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

        <td className="px-5 py-4 text-right">
          <button
            disabled={ev.severity !== 'Critical'}
            onClick={(e) => {
              e.stopPropagation();
              if (ev.severity === 'Critical')
                onQuarantine(ev.workstationId || '', ev.employee || '');
            }}
            className={`text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1.5 ${
              ev.severity === 'Critical'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-slate-700 cursor-not-allowed'
            }`}
          >
            <Ban className="w-3 h-3" /> QUARANTINE
          </button>

          {expanded ? (
            <ChevronUp className="w-3 h-3 inline ml-2" />
          ) : (
            <ChevronDown className="w-3 h-3 inline ml-2" />
          )}
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

export default function EndpointSecurityPage() {
  const { environment } = useEnvironment();

  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    apiGet<EndpointSecurityData>('/endpoint-security', {
      signal: controller.signal
    })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          toast.error('Failed to load endpoint data', {
            description: err.message
          });
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [environment]);

  const handleQuarantine = async (workstation_id: string, employee: string) => {
    if (!workstation_id) {
      toast.error('Missing workstation ID');
      return;
    }

    try {
      // Payload matches backend QuarantineRequest schema: { workstationId: string }
      await apiPost('/endpoint-security/quarantine', {
        workstationId: workstation_id,
      });

      toast.success('Device Quarantined', {
        description: `${workstation_id} isolated`
      });
    } catch (err) {
      toast.error('Failed to Quarantine', {
        description:
          err instanceof ApiError ? err.message : 'Could not connect to EDR'
      });
    }
  };

  const {
    safeMonitored,
    safeOffline,
    safeMalwareAlerts,
    osDistribution,
    alertTypes,
    safeWazuhEvents
  } = useMemo(() => {
    const epData = data || {};

    const osDist = (epData.osDistribution || []).map((d) => ({
      ...d,
      name: d.name || 'Unknown',
      value: Number(d.value) || 0
    }));

    const alertDist = (epData.alertTypes || []).map((d) => ({
      ...d,
      name: d.name || 'Unknown',
      value: Number(d.value) || 0
    }));

    return {
      safeMonitored: Number(epData.monitoredLaptops) || 0,
      safeOffline: Number(epData.offlineDevices) || 0,
      safeMalwareAlerts: Number(epData.malwareAlerts) || 0,
      osDistribution: osDist,
      alertTypes: alertDist,
      safeWazuhEvents: epData.wazuhEvents || []
    };
  }, [data]);

  if (loading)
    return (
      <div className="p-6 flex justify-center">
        <LoaderCircle className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );

  if (error)
    return <div className="text-red-400 p-6 text-center">{error}</div>;

  if (!data)
    return (
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
          <div className="text-3xl font-bold text-red-400">
            {safeMalwareAlerts}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader
            icon={<Laptop className="w-4 h-4 text-blue-400" />}
            title="OS Distribution"
            subtitle="Distribution of operating systems"
            tooltipText="Overview of OS landscape"
          />

          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={osDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tickFormatter={(v) => truncateLabel(v)} />
                <YAxis />
                <RechartsTooltip content={<CustomTooltipContent />} />
                <Bar dataKey="value">
                  {osDistribution.map((e, i) => (
                    <Cell key={i} fill={e.fill || '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <SectionHeader
            icon={<AlertTriangle className="w-4 h-4 text-orange-400" />}
            title="Alert Types"
            subtitle="Breakdown of alert categories"
            tooltipText="Most common threats"
          />

          <div className="px-5 pb-5">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart layout="vertical" data={alertTypes}>
                <XAxis type="number" />
                <YAxis
                  dataKey="name"
                  type="category"
                  tickFormatter={(v) => truncateLabel(v, 15)}
                />
                <RechartsTooltip content={<CustomTooltipContent />} />
                <Bar dataKey="value">
                  {alertTypes.map((e, i) => (
                    <Cell key={i} fill={e.fill || '#f97316'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <SectionHeader
          icon={<Activity className="w-4 h-4 text-red-400" />}
          title="Endpoint Event Log"
          subtitle={`Live stream of ${safeWazuhEvents.length} alerts`}
          tooltipText="Expand row for full JSON"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800">
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Endpoint</th>
                <th className="px-5 py-3">Threat</th>
                <th className="px-5 py-3">Severity</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {safeWazuhEvents.map((ev) => (
                <EventRow
                  key={ev.id ?? `${ev.timestamp}-${ev.workstationId}`}
                  ev={ev}
                  onQuarantine={handleQuarantine}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}