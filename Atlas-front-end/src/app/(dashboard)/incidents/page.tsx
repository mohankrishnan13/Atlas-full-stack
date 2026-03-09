"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles, Shield, Clock, AlertTriangle, Filter, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { useEnvironment } from "@/context/EnvironmentContext";

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

export default function CaseManagementPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [data, setData] = useState<CaseManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const { environment } = useEnvironment();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<CaseManagementResponse>("/case-management")
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => {
        toast.error("Failed to load cases.", { description: err instanceof ApiError ? err.message : "Request failed." });
        if (!cancelled) setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [environment]);

  const getStatusColor = (status: string) => {
    switch (status?.toUpperCase?.()) {
      case "OPEN":
      case "ACTIVE":
        return "bg-red-500 text-white border-red-500";
      case "INVESTIGATING":
      case "CONTAINED":
        return "bg-transparent text-yellow-400 border-yellow-500";
      case "RESOLVED":
      case "CLOSED":
        return "bg-slate-700/50 text-slate-400 border-slate-600";
      default:
        return "bg-slate-700/50 text-slate-400 border-slate-600";
    }
  };

  const getPlaybookButtonClass = (label: string) => {
    if (label === "Execute Total Lockdown Playbook") {
      return "bg-red-600 hover:bg-red-700 text-white border-red-600";
    }
    if (label === "Assign to Me") {
      return "bg-blue-600 hover:bg-blue-700 text-white border-blue-600";
    }
    if (label === "Quarantine Endpoint & Drop MAC") {
      return "bg-transparent hover:bg-orange-600/10 text-orange-400 border-orange-600";
    }
    if (label === "View AI Timeline") {
      return "bg-transparent hover:bg-blue-600/10 text-blue-400 border-blue-600";
    }
    return "bg-transparent hover:bg-slate-700 text-slate-400 border-slate-600";
  };

  const filteredCases = useMemo(() => {
    const cases = data?.cases ?? [];
    if (!searchQuery.trim()) return cases;
    const q = searchQuery.toLowerCase();
    return cases.filter((c) => (
      c.caseId.toLowerCase().includes(q)
      || c.targetApp.toLowerCase().includes(q)
      || c.assigneeName.toLowerCase().includes(q)
      || c.scopeTags.some((t) => String(t).toLowerCase().includes(q))
      || c.aiThreatNarrative.toLowerCase().includes(q)
    ));
  }, [data, searchQuery]);

  const inferWorkstationId = (scopeTags: string[]) => {
    return scopeTags.find((t) => String(t).startsWith("LAPTOP-") || String(t).startsWith("WKST-") || String(t).startsWith("SRV-")) || "";
  };

  const handlePlaybook = async (caseData: CaseManagementCase, actionLabel: string) => {
    const actionKey = `${caseData.caseId}:${actionLabel}`;
    setRunningAction(actionKey);
    try {
      if (actionLabel === "Quarantine Endpoint & Drop MAC") {
        const ws = inferWorkstationId(caseData.scopeTags);
        if (!ws) throw new Error("No workstation_id found in case scope tags.");
        await apiPost("/endpoint-security/quarantine", { workstationId: ws });
        toast.success("Quarantine Action Executed", { description: `Endpoint ${ws} has been quarantined.` });
        return;
      }
      await apiPost("/incidents/remediate", { incidentId: caseData.caseId, action: actionLabel });
      toast.success("Playbook Executed", { description: `${actionLabel} initiated for ${caseData.caseId}.` });
    } catch (err) {
      toast.error("Playbook Failed", { description: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setRunningAction(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 rounded animate-pulse" />
        <div className="h-16 bg-slate-800 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-20 bg-slate-800 rounded animate-pulse" />
          <div className="h-20 bg-slate-800 rounded animate-pulse" />
          <div className="h-20 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="h-64 bg-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-200">Case Management</h1>
        <p className="text-sm text-slate-400 mt-1">Enterprise threat correlation and active case orchestration</p>
      </div>

      {/* Action Bar */}
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
          <Button variant="outline" className="bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-200">
            <Filter className="w-4 h-4 mr-2" />
            Filter by Target App
          </Button>
        </div>
      </div>

      {/* KPI Row - Workflow Metrics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg relative">
              <Shield className="w-5 h-5 text-red-500" />
              <div className="absolute inset-0 rounded-lg bg-red-500 opacity-20 animate-pulse"></div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-red-400">{data?.kpis.criticalOpenCases ?? 0}</div>
              <div className="text-sm text-slate-400">Critical Open Cases</div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Clock className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-green-400">{data?.kpis.mttr ?? "—"}</div>
              <div className="text-sm text-slate-400">Mean Time to Resolve (MTTR)</div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-orange-400">{data?.kpis.unassignedEscalations ?? 0}</div>
              <div className="text-sm text-slate-400">Unassigned Escalations</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Case Board - Threat Correlation Table */}
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
          {filteredCases.map((caseData) => (
            <div
              key={caseData.caseId}
              className="grid grid-cols-[180px_1fr_200px_300px] gap-4 px-6 py-5 hover:bg-slate-800/30 transition-colors"
            >
              <div className="space-y-2">
                <div className="text-sm font-semibold text-blue-400 font-mono">{caseData.caseId}</div>
                <div className="flex flex-col gap-1.5">
                  {caseData.scopeTags.map((tag, idx) => (
                    <Badge
                      key={idx}
                      className="bg-purple-500/20 text-purple-300 border border-purple-500/50 text-xs w-fit"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-slate-300 leading-relaxed">{caseData.aiThreatNarrative}</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {caseData.assigneeName === "System (Auto)" ? (
                    <>
                      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-slate-400" />
                      </div>
                      <span className="text-sm text-slate-400">System (Auto)</span>
                    </>
                  ) : caseData.assigneeName && caseData.assigneeName !== "Unassigned" ? (
                    <>
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-blue-600 text-white text-xs">
                          {caseData.assigneeInitials || caseData.assigneeName.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-slate-200">{caseData.assigneeName}</span>
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

                <Badge className={cn("text-xs font-semibold w-fit", getStatusColor(caseData.status))}>
                  {caseData.status.toUpperCase()}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                {caseData.playbookActions.map((label) => {
                  const key = `${caseData.caseId}:${label}`;
                  return (
                    <button
                      key={label}
                      onClick={() => handlePlaybook(caseData, label)}
                      disabled={runningAction === key}
                      className={cn(
                        "px-3 py-2 text-xs font-semibold rounded border transition-colors",
                        getPlaybookButtonClass(label),
                        runningAction === key && "opacity-60 cursor-not-allowed"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {filteredCases.length === 0 && (
            <div className="px-6 py-10 text-center text-slate-500 text-sm">
              No cases match your search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
