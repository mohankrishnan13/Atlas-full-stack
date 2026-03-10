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
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { HeaderData, Application } from "../../../lib/types";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal, Download } from "lucide-react";

type ScheduledReportRow = {
  id: number;
  title: string;
  description: string;
  schedule: string;
  active: boolean;
  configureLabel: string;
};

type RecentDownloadRow = {
  id: number;
  fileName: string;
  targetAppScope: string;
  generated: string;
  size: string;
  downloadUrl: string;
};

type ReportsOverviewResponse = {
  scheduledReports: ScheduledReportRow[];
  recentDownloads: RecentDownloadRow[];
};

export default function ReportsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>("");
  const [reportType, setReportType] = useState<string>("pdf");
  const [overview, setOverview] = useState<ReportsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const fetchApplications = async () => {
      try {
        setLoading(true);
        const data = await apiGet<HeaderData>("/header-data");
        setApplications(data.applications);
        if (data.applications.length > 0) {
          setSelectedApp(data.applications[0].id);
        }

        const ov = await apiGet<ReportsOverviewResponse>("/reports/overview");
        setOverview(ov);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred.");
        }
        console.error("Failed to fetch applications for reports:", err);
        toast.error("Failed to load reports data.", {
          description: err instanceof ApiError ? err.message : "Request failed.",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchApplications();
  }, []);

  const handleGenerateReport = async () => {
    if (!selectedApp || !reportType) {
      toast.error("Please select an application and export format.");
      return;
    }

    setIsGenerating(true);
    try {
      const exportFormat = reportType.toLowerCase() === "pdf" ? "PDF" : "CSV";
      const resp = await apiPost<{ success: boolean; message: string; download?: RecentDownloadRow }>(
        "/reports/generate",
        {
          dateRange: "",
          dataSource: selectedApp,
          template: "General Security Summary",
          exportFormat,
        }
      );

      toast.success("Report Generated", {
        description: resp.message || `Generated ${exportFormat} report for ${selectedApp}.`,
      });

      const ov = await apiGet<ReportsOverviewResponse>("/reports/overview");
      setOverview(ov);
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error("Failed to generate report.", { description: err.message });
      } else {
        toast.error("Failed to generate report.", {
          description: "An unexpected error occurred during report generation.",
        });
      }
      console.error("Report generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return <div className="p-4">Loading report data...</div>;
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

  return (
    <div className="space-y-6">
      <div className="text-sm font-medium text-slate-300">Reports</div>

      <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 mb-4">
          <Download className="w-4 h-4 text-slate-200" />
          Generate New Report
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_1fr_170px_200px] gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">Date Range</Label>
            <Input placeholder="Select date range" className="bg-slate-900/50 border-slate-800" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">Data Source</Label>
            <Select value={selectedApp} onValueChange={setSelectedApp}>
              <SelectTrigger className="bg-slate-900/50 border-slate-800">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                {applications.map((app) => (
                  <SelectItem key={app.id} value={app.id}>
                    {app.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">Consolidate / Report Template</Label>
            <Select value={'General Security Summary'} onValueChange={() => {}}>
              <SelectTrigger className="bg-slate-900/50 border-slate-800">
                <SelectValue placeholder="General Security Summary" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="General Security Summary">General Security Summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-slate-500">Export Format</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger className="bg-slate-900/50 border-slate-800">
                <SelectValue placeholder="PDF" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleGenerateReport}
            disabled={!selectedApp || !reportType || isGenerating}
            className="h-10 bg-blue-600 hover:bg-blue-700"
          >
            {isGenerating ? 'Generating...' : 'Generate Report'}
          </Button>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <div className="text-sm font-semibold text-slate-100">Scheduled Reports</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(overview?.scheduledReports || []).map((r) => (
            <div key={r.id} className="bg-slate-950/40 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-100">{r.title}</div>
                <div className={`w-8 h-4 rounded-full border ${r.active ? 'bg-emerald-600/30 border-emerald-500/30' : 'bg-slate-900 border-slate-700'} relative`}>
                  <div className={`w-3 h-3 rounded-full absolute top-0.5 transition-all ${r.active ? 'left-4 bg-emerald-400' : 'left-0.5 bg-slate-500'}`} />
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{r.description}</div>
              <div className="text-[11px] text-slate-500 mt-2">{r.schedule}</div>
              <div className="mt-3 flex items-center justify-between">
                <span className={r.active ? 'text-emerald-400 text-[11px]' : 'text-slate-500 text-[11px]'}>
                  {r.active ? 'Active' : 'Disabled'}
                </span>
                <button
                  className="text-[11px] text-blue-400 hover:text-blue-300"
                  onClick={() => toast.info('Configure', { description: 'Not implemented yet.' })}
                >
                  {r.configureLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center gap-2">
          <Download className="w-4 h-4 text-slate-300" />
          <div className="text-sm font-semibold text-slate-100">Recent Downloads</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-950 text-slate-500 uppercase text-[10px] border-b border-slate-800">
              <tr>
                <th className="px-6 py-3">FILE NAME</th>
                <th className="px-6 py-3">TARGET APP/SCOPE</th>
                <th className="px-6 py-3">GENERATED</th>
                <th className="px-6 py-3">SIZE</th>
                <th className="px-6 py-3 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {(overview?.recentDownloads || []).map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-200">{d.fileName}</td>
                  <td className="px-6 py-4 text-xs text-blue-400">{d.targetAppScope}</td>
                  <td className="px-6 py-4 text-xs text-slate-400">{d.generated}</td>
                  <td className="px-6 py-4 text-xs text-slate-400">{d.size}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="text-emerald-400 hover:text-emerald-300 text-[11px]"
                      onClick={() => window.open(d.downloadUrl, '_blank')}
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
