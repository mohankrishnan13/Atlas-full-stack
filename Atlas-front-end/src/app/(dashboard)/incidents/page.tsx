'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Sparkles, Shield, Clock, AlertTriangle,
  Filter, Bot, Brain, ChevronDown, ChevronUp,
  RefreshCw, CheckCheck, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { useEnvironment } from '@/context/EnvironmentContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type CaseManagementKpis = {
  criticalOpenCases: number;
  mttr: string;
  unassignedEscalations: number;
};

type CaseManagementCase = {
  caseId: string;
  scopeTags: string[];
  aiThreatNarrative: string;
  assigneeName: string;
  assigneeInitials: string;
  status: string;
  playbookActions: string[];
  targetApp: string;
};

type CaseManagementResponse = {
  kpis: CaseManagementKpis;
  cases: CaseManagementCase[];
};

/** Shape returned by GET /anomalies */
type AnomalyEvent = {
  id: number;
  anomalyType: string;
  severity: string;
  targetApp: string;
  sourceIp: string;
  endpoint: string;
  description: string;
  metricsSnapshot: Record<string, unknown>;
  aiExplanation: string | null;
  status: string;
  detectedAt: string;
  resolvedAt: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const getSeverityStyle = (severity: string) => {
  switch (severity) {
    case 'Critical': return 'bg-red-500/10 text-red-400 border-red-500/40';
    case 'High':     return 'bg-orange-500/10 text-orange-400 border-orange-500/40';
    case 'Medium':   return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/40';
    default:         return 'bg-blue-500/10 text-blue-400 border-blue-500/40';
  }
};

const getStatusColor = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN': case 'ACTIVE':  return 'bg-red-500 text-white border-red-500';
    case 'INVESTIGATING': case 'CONTAINED': return 'bg-transparent text-yellow-400 border-yellow-500';
    case 'RESOLVED': case 'CLOSED':        return 'bg-slate-700/50 text-slate-400 border-slate-600';
    default: return 'bg-slate-700/50 text-slate-400 border-slate-600';
  }
};

const getPlaybookButtonClass = (label: string) => {
  if (label === 'Execute Total Lockdown Playbook') return 'bg-red-600 hover:bg-red-700 text-white border-red-600';
  if (label === 'Assign to Me')                    return 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600';
  if (label === 'Quarantine Endpoint & Drop MAC')  return 'bg-transparent hover:bg-orange-600/10 text-orange-400 border-orange-600';
  if (label === 'View AI Timeline')                return 'bg-transparent hover:bg-blue-600/10 text-blue-400 border-blue-600';
  return 'bg-transparent hover:bg-slate-700 text-slate-400 border-slate-600';
};

const inferWorkstationId = (scopeTags: string[]) =>
  scopeTags.find((t) => String(t).startsWith('LAPTOP-') || String(t).startsWith('WKST-') || String(t).startsWith('SRV-')) || '';

const formatRelativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

// ── AI Explanation Panel ──────────────────────────────────────────────────────

function AiExplanationPanel({ explanation, isLoading }: { explanation: string | null; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-lg">
        <Brain className="w-5 h-5 text-indigo-400 animate-pulse flex-shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="h-3 bg-slate-700 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-slate-700 rounded animate-pulse w-full" />
          <div className="h-3 bg-slate-700 rounded animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (!explanation) {
    return (
      <div className="flex items-center gap-2 p-3 bg-slate-800/50 border border-slate-700 rounded-lg text-xs text-slate-500">
        <Brain className="w-4 h-4 flex-shrink-0" />
        <span>AI explanation pending — the engine will enrich this anomaly within 60 seconds.</span>
      </div>
    );
  }

  // Parse the structured Gemini response
  const sections = {
    likelyCause: '',
    actions: [] as string[],
    urgency: '',
  };

  const causeMatch = explanation.match(/LIKELY CAUSE:\s*(.+?)(?=\n\n|IMMEDIATE ACTIONS:|$)/s);
  const actionsMatch = explanation.match(/IMMEDIATE ACTIONS:\s*([\s\S]+?)(?=\n\nURGENCY:|$)/s);
  const urgencyMatch = explanation.match(/URGENCY:\s*(.+)/s);

  if (causeMatch) sections.likelyCause = causeMatch[1].trim();
  if (actionsMatch) {
    sections.actions = actionsMatch[1]
      .split('\n')
      .filter((l) => l.match(/^\d+\./))
      .map((l) => l.replace(/^\d+\.\s*/, '').trim());
  }
  if (urgencyMatch) sections.urgency = urgencyMatch[1].trim();

  // Fallback: show raw text if parsing fails
  if (!sections.likelyCause && !sections.actions.length) {
    return (
      <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Brain className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
            Gemini AI Analysis
          </span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{explanation}</p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
          Gemini AI SOC Analysis
        </span>
      </div>

      {sections.likelyCause && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">
            Likely Cause
          </p>
          <p className="text-sm text-slate-200 leading-relaxed">{sections.likelyCause}</p>
        </div>
      )}

      {sections.actions.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
            Immediate Actions
          </p>
          <ol className="space-y-1.5">
            {sections.actions.map((action, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="flex-shrink-0 w-5 h-5 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5">
                  {i + 1}
                </span>
                {action}
              </li>
            ))}
          </ol>
        </div>
      )}

      {sections.urgency && (
        <div className="flex items-start gap-2 pt-1 border-t border-slate-700/50">
          <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-orange-300 leading-relaxed">
            <span className="font-semibold">Urgency: </span>{sections.urgency}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Anomaly Event Row ─────────────────────────────────────────────────────────

function AnomalyRow({
  event,
  onAcknowledge,
}: {
  event: AnomalyEvent;
  onAcknowledge: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCritical = event.severity === 'Critical';

  return (
    <>
      <tr
        onClick={() => setExpanded((p) => !p)}
        className={cn(
          'cursor-pointer hover:bg-slate-800/30 transition-colors border-b border-slate-800',
          isCritical && 'bg-red-950/10',
        )}
      >
        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            <span className={cn('text-xs px-2 py-0.5 rounded border font-semibold', getSeverityStyle(event.severity))}>
              {event.severity}
            </span>
            <span className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">
              {event.anomalyType}
            </span>
          </div>
        </td>
        <td className="px-5 py-4">
          <p className="text-sm text-slate-200 line-clamp-1">{event.description}</p>
          <p className="text-xs text-slate-500 mt-0.5">{event.targetApp}</p>
        </td>
        <td className="px-5 py-4">
          <div className="flex items-center gap-2">
            {event.aiExplanation ? (
              <span className="flex items-center gap-1 text-xs text-indigo-400">
                <Brain className="w-3 h-3" /> AI Ready
              </span>
            ) : (
              <span className="text-xs text-slate-600">Pending...</span>
            )}
          </div>
        </td>
        <td className="px-5 py-4 text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-slate-500">{formatRelativeTime(event.detectedAt)}</span>
            {event.status === 'Active' && (
              <button
                onClick={(e) => { e.stopPropagation(); onAcknowledge(event.id); }}
                className="text-xs text-emerald-400 border border-emerald-500/40 px-2 py-1 rounded hover:bg-emerald-500/10 transition-colors"
              >
                <CheckCheck className="w-3 h-3 inline mr-1" />Ack
              </button>
            )}
            {expanded
              ? <ChevronUp className="w-4 h-4 text-slate-500" />
              : <ChevronDown className="w-4 h-4 text-slate-500" />
            }
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-950/50 border-b border-slate-800">
          <td colSpan={4} className="px-5 py-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Metrics snapshot */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  Detection Metrics
                </p>
                <div className="space-y-1.5">
                  {Object.entries(event.metricsSnapshot || {}).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-mono">{k}</span>
                      <span className="text-slate-300 font-semibold">{String(v)}</span>
                    </div>
                  ))}
                  {event.sourceIp && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-mono">source_ip</span>
                      <span className="text-slate-300 font-mono font-semibold">{event.sourceIp}</span>
                    </div>
                  )}
                  {event.endpoint && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-mono">endpoint</span>
                      <span className="text-slate-300 font-mono font-semibold">{event.endpoint}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* AI Explanation */}
              <div>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  AI Explanation
                </p>
                <AiExplanationPanel explanation={event.aiExplanation} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CaseManagementPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [caseData, setCaseData] = useState<CaseManagementResponse | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'anomalies' | 'cases'>('anomalies');
  const { environment } = useEnvironment();

  // ── Fetch case management data ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<CaseManagementResponse>('/case-management')
      .then((res) => { if (!cancelled) setCaseData(res); })
      .catch((err) => {
        if (!cancelled) toast.error('Failed to load cases.', {
          description: err instanceof ApiError ? err.message : 'Request failed.',
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [environment]);

  // ── Fetch AI anomaly events ────────────────────────────────────────────────
  const fetchAnomalies = useCallback(async () => {
    setAnomaliesLoading(true);
    try {
      // GET /anomalies — returns AnomalyEvent[] from the engine
      const data = await apiGet<AnomalyEvent[]>('/anomalies?limit=50');
      setAnomalies(data);
    } catch (err) {
      toast.error('Failed to load anomalies.', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    } finally {
      setAnomaliesLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    fetchAnomalies();
    // Auto-refresh every 30 seconds to pick up new AI explanations
    const interval = setInterval(fetchAnomalies, 30_000);
    return () => clearInterval(interval);
  }, [fetchAnomalies]);

  // ── Acknowledge anomaly ────────────────────────────────────────────────────
  const handleAcknowledge = async (id: number) => {
    try {
      // PATCH /anomalies/{id}/acknowledge
      await apiPatch(`/anomalies/${id}/acknowledge`);
      setAnomalies((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'Acknowledged' } : a)),
      );
      toast.success('Anomaly acknowledged');
    } catch (err) {
      toast.error('Failed to acknowledge', {
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    }
  };

  // ── Playbook actions ───────────────────────────────────────────────────────
  const handlePlaybook = async (c: CaseManagementCase, actionLabel: string) => {
    const key = `${c.caseId}:${actionLabel}`;
    setRunningAction(key);
    try {
      if (actionLabel === 'Quarantine Endpoint & Drop MAC') {
        const ws = inferWorkstationId(c.scopeTags);
        if (!ws) throw new Error('No workstation_id found in case scope tags.');
        await apiPost('/endpoint-security/quarantine', { workstationId: ws });
        toast.success('Quarantine Executed', { description: `Endpoint ${ws} quarantined.` });
        return;
      }
      await apiPost('/incidents/remediate', { incidentId: c.caseId, action: actionLabel });
      toast.success('Playbook Executed', { description: `${actionLabel} for ${c.caseId}.` });
    } catch (err) {
      toast.error('Playbook Failed', { description: err instanceof Error ? err.message : 'Request failed.' });
    } finally {
      setRunningAction(null);
    }
  };

  const filteredCases = useMemo(() => {
    const cases = caseData?.cases ?? [];
    if (!searchQuery.trim()) return cases;
    const q = searchQuery.toLowerCase();
    return cases.filter(
      (c) =>
        c.caseId.toLowerCase().includes(q) ||
        c.targetApp.toLowerCase().includes(q) ||
        c.assigneeName.toLowerCase().includes(q) ||
        c.scopeTags.some((t) => String(t).toLowerCase().includes(q)) ||
        c.aiThreatNarrative.toLowerCase().includes(q),
    );
  }, [caseData, searchQuery]);

  const activeAnomalies = anomalies.filter((a) => a.status === 'Active');
  const criticalCount = activeAnomalies.filter((a) => a.severity === 'Critical').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-10">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-200 flex items-center gap-2">
            <Brain className="w-6 h-6 text-indigo-400" />
            Case Management
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            AI-powered threat correlation · Anomaly Engine · Active case orchestration
          </p>
        </div>
        <button
          onClick={fetchAnomalies}
          disabled={anomaliesLoading}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors px-3 py-2 border border-slate-700 rounded-lg hover:bg-slate-800"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', anomaliesLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg relative">
              <Shield className="w-5 h-5 text-red-500" />
              {criticalCount > 0 && (
                <div className="absolute inset-0 rounded-lg bg-red-500 opacity-20 animate-pulse" />
              )}
            </div>
            <div>
              <div className="text-2xl font-semibold text-red-400">{caseData?.kpis.criticalOpenCases ?? 0}</div>
              <div className="text-sm text-slate-400">Critical Cases</div>
            </div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Clock className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-green-400">{caseData?.kpis.mttr ?? '—'}</div>
              <div className="text-sm text-slate-400">MTTR</div>
            </div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-orange-400">{caseData?.kpis.unassignedEscalations ?? 0}</div>
              <div className="text-sm text-slate-400">Unassigned</div>
            </div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Brain className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-indigo-400">{activeAnomalies.length}</div>
              <div className="text-sm text-slate-400">Active Anomalies</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('anomalies')}
          className={cn(
            'px-4 py-2 rounded text-sm font-medium transition-all flex items-center gap-2',
            activeTab === 'anomalies'
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
              : 'text-slate-400 hover:text-slate-200',
          )}
        >
          <Brain className="w-4 h-4" />
          AI Anomalies
          {activeAnomalies.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              {activeAnomalies.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('cases')}
          className={cn(
            'px-4 py-2 rounded text-sm font-medium transition-all flex items-center gap-2',
            activeTab === 'cases'
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200',
          )}
        >
          <Shield className="w-4 h-4" />
          Case Board
          {(caseData?.cases.length ?? 0) > 0 && (
            <span className="bg-slate-700 text-slate-300 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
              {caseData?.cases.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Anomaly Engine Feed ────────────────────────────────────────────── */}
      {activeTab === 'anomalies' && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-indigo-400" />
                AI-Detected Anomalies
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically detected by the engine. Click any row to see the Gemini AI explanation.
              </p>
            </div>
          </div>

          {anomaliesLoading ? (
            <div className="space-y-0">
              {[0, 1, 2].map((i) => (
                <div key={i} className="px-5 py-4 border-b border-slate-800 animate-pulse">
                  <div className="flex gap-4">
                    <div className="h-5 w-20 bg-slate-800 rounded" />
                    <div className="h-5 w-64 bg-slate-800 rounded" />
                    <div className="h-5 w-16 bg-slate-800 rounded ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          ) : anomalies.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Brain className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">No anomalies detected yet</p>
              <p className="text-slate-600 text-xs mt-1">
                Use the <strong className="text-red-400">Simulate Attack</strong> button in the header to trigger a demo.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-slate-950 border-b border-slate-800">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium tracking-wider">Severity / Type</th>
                    <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium tracking-wider">Description</th>
                    <th className="px-5 py-3 text-left text-xs text-slate-500 uppercase font-medium tracking-wider">AI</th>
                    <th className="px-5 py-3 text-right text-xs text-slate-500 uppercase font-medium tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((event) => (
                    <AnomalyRow
                      key={event.id}
                      event={event}
                      onAcknowledge={handleAcknowledge}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Case Board ────────────────────────────────────────────────────── */}
      {activeTab === 'cases' && (
        <>
          {/* Search */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-slate-950 border-slate-800 text-slate-200"
                  placeholder="Search Case ID, App, or Analyst..."
                />
              </div>
              <Button variant="outline" className="bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800">
                <Filter className="w-4 h-4 mr-2" />Filter
              </Button>
            </div>
          </div>

          {/* Case table */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            <div className="border-b border-slate-800 bg-slate-950">
              <div className="grid grid-cols-[180px_1fr_200px_300px] gap-4 px-6 py-3 text-xs text-slate-400 uppercase font-medium tracking-wide">
                <div>Case ID & Scope</div>
                <div>AI Threat Narrative</div>
                <div>Assignee & Status</div>
                <div>Playbook Responses</div>
              </div>
            </div>

            <div className="divide-y divide-slate-800">
              {loading ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="px-6 py-5 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded w-full" />
                  </div>
                ))
              ) : filteredCases.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-500 text-sm">
                  {caseData ? 'No cases match your search.' : 'No cases available.'}
                </div>
              ) : (
                filteredCases.map((c) => (
                  <div
                    key={c.caseId}
                    className="grid grid-cols-[180px_1fr_200px_300px] gap-4 px-6 py-5 hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Case ID */}
                    <div className="space-y-2">
                      <div className="text-sm font-semibold text-blue-400 font-mono">{c.caseId}</div>
                      <div className="flex flex-col gap-1.5">
                        {c.scopeTags.map((tag, idx) => (
                          <Badge key={idx} className="bg-purple-500/20 text-purple-300 border border-purple-500/50 text-xs w-fit">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* AI Narrative */}
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-slate-300 leading-relaxed">{c.aiThreatNarrative}</p>
                    </div>

                    {/* Assignee */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        {c.assigneeName === 'System (Auto)' ? (
                          <>
                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                              <Bot className="w-4 h-4 text-slate-400" />
                            </div>
                            <span className="text-sm text-slate-400">System (Auto)</span>
                          </>
                        ) : c.assigneeName && c.assigneeName !== 'Unassigned' ? (
                          <>
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="bg-blue-600 text-white text-xs">
                                {c.assigneeInitials || c.assigneeName.split(' ').map((n) => n[0]).join('')}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm text-slate-200">{c.assigneeName}</span>
                          </>
                        ) : (
                          <>
                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                              <span className="text-xs text-slate-400">?</span>
                            </div>
                            <span className="text-sm text-slate-400">Unassigned</span>
                          </>
                        )}
                      </div>
                      <Badge className={cn('text-xs font-semibold w-fit', getStatusColor(c.status))}>
                        {c.status.toUpperCase()}
                      </Badge>
                    </div>

                    {/* Playbook */}
                    <div className="flex flex-wrap gap-2 justify-end">
                      {c.playbookActions.map((label) => {
                        const key = `${c.caseId}:${label}`;
                        return (
                          <button
                            key={label}
                            onClick={() => handlePlaybook(c, label)}
                            disabled={runningAction === key}
                            className={cn(
                              'px-3 py-2 text-xs font-semibold rounded border transition-colors',
                              getPlaybookButtonClass(label),
                              runningAction === key && 'opacity-60 cursor-not-allowed',
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
