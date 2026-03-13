"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal, Search } from "lucide-react";

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

type RemediateRequest = {
  incidentId: string;
  action: string;
};

type RemediateResponse = {
  success: boolean;
  message: string;
};

export default function CaseManagementPage() {
  const [data, setData] = useState<CaseManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");

  const fetchCases = async () => {
    try {
      setLoading(true);
      const resp = await apiGet<CaseManagementResponse>("/case-management");
      setData(resp);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
      console.error("Failed to fetch incidents data:", err);
      toast.error("Failed to load case management data.", {
        description: err instanceof ApiError ? err.message : "Request failed.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlaybookAction = async (incidentId: string, action: string) => {
    try {
      const payload: RemediateRequest = { incidentId, action };
      const response = await apiPost<RemediateResponse>("/incidents/remediate", payload);
      toast.success("Playbook Action Initiated", { description: response.message });
      // Optionally refetch incidents to update status
      fetchCases();
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error("Playbook action failed.", { description: err.message });
      } else {
        toast.error("Playbook action failed.", {
          description: "An unexpected error occurred during playbook execution.",
        });
      }
      console.error("Playbook action failed:", err);
    }
  };

  const filteredCases = data?.cases?.filter((c) => {
    const q = searchTerm.toLowerCase();
    return (
      c.caseId.toLowerCase().includes(q) ||
      c.targetApp.toLowerCase().includes(q) ||
      c.aiThreatNarrative.toLowerCase().includes(q) ||
      c.assigneeName.toLowerCase().includes(q)
    );
  });

  const kpis = data?.kpis;
  const cases = filteredCases || [];

  if (loading) {
    return <div className="p-4">Loading case data...</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-4">
        <Terminal className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return <div className="p-4">No case data available.</div>;
  }

  const statusPill = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('open')) return 'bg-red-600 text-white border-red-500';
    if (s.includes('investig')) return 'bg-yellow-600 text-slate-950 border-yellow-500';
    if (s.includes('resolved')) return 'bg-slate-800 text-slate-200 border-slate-700';
    return 'bg-slate-800 text-slate-200 border-slate-700';
  };

  const assigneeChip = (name: string, initials: string) => {
    if (!name || name.toLowerCase().includes('unassigned')) {
      return (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] text-slate-300">
            ?
          </div>
          <div className="text-xs text-slate-400">Unassigned</div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-[10px] text-blue-200 font-semibold">
          {initials || name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div className="text-xs text-slate-200">{name}</div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-lg font-semibold text-slate-100">Case Management</div>
        <div className="text-[11px] text-slate-500">Enterprise threat correlation and active case orchestration</div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search Case ID, App, or Analyst..."
            className="pl-9 bg-slate-900/60 border-slate-800"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          className="bg-slate-900 border border-slate-800 text-slate-200 hover:bg-slate-800"
          onClick={() => toast.info('Filter', { description: 'Filter by Target App not implemented yet.' })}
        >
          Filter by Target App
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4">
          <div className="text-2xl font-bold text-red-500">{kpis?.criticalOpenCases ?? 0}</div>
          <div className="text-[11px] text-slate-500 mt-1">Critical Open Cases</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4">
          <div className="text-2xl font-bold text-emerald-400">{kpis?.mttr ?? '—'}</div>
          <div className="text-[11px] text-slate-500 mt-1">Mean Time To Resolve (MTTR)</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg px-5 py-4">
          <div className="text-2xl font-bold text-yellow-400">{kpis?.unassignedEscalations ?? 0}</div>
          <div className="text-[11px] text-slate-500 mt-1">Unassigned Escalations</div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] border-b border-slate-800">
              <tr>
                <th className="px-6 py-3">CASE ID &amp; SCOPE</th>
                <th className="px-6 py-3">AI THREAT NARRATIVE</th>
                <th className="px-6 py-3">ASSIGNEE &amp; STATUS</th>
                <th className="px-6 py-3 text-right">PLAYBOOK RESPONSES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {cases.length > 0 ? (
                cases.map((c) => (
                  <tr key={c.caseId} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm font-semibold text-slate-100">{c.caseId}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.scopeTags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="text-xs text-slate-200 leading-relaxed">
                        {c.aiThreatNarrative}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      {assigneeChip(c.assigneeName, c.assigneeInitials)}
                      <div className={`mt-2 inline-flex text-[10px] px-2 py-0.5 rounded border font-semibold ${statusPill(c.status)}`}>
                        {c.status.toUpperCase()}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex flex-col gap-2 items-end">
                        {c.playbookActions.slice(0, 2).map((action) => {
                          const a = action.toLowerCase();
                          const cls = a.includes('lockdown') || a.includes('execute')
                            ? 'bg-red-600 hover:bg-red-700 text-white'
                            : a.includes('assign')
                              ? 'bg-blue-600 hover:bg-blue-700 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700';
                          return (
                            <button
                              key={action}
                              onClick={() => handlePlaybookAction(c.caseId, action)}
                              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${cls}`}
                            >
                              {action}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-slate-500 text-sm">
                    No cases found.
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
