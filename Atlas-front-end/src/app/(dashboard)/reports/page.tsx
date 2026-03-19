'use client';

import React, { useEffect, useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { toast } from 'sonner';
import { Download, Calendar, Activity, FileText, LoaderCircle } from 'lucide-react';
import type { HeaderData, Application } from '@/lib/types';

// ── Types (matching backend schemas.py exactly) ───────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>('');
  const [reportType, setReportType] = useState<string>('pdf');
  const [overview, setOverview] = useState<ReportsOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const fetchData = async () => {
      try {
        // Both calls use the same AbortSignal so navigation cancels them together
        const [header, overviewData] = await Promise.all([
          // GET /header-data — provides the application list
          apiGet<HeaderData>('/header-data', controller.signal),
          // GET /reports/overview — scheduled reports + recent downloads
          apiGet<ReportsOverviewResponse>('/reports/overview', controller.signal),
        ]);
        setApplications(header.applications);
        if (header.applications.length > 0) {
          setSelectedApp(header.applications[0].id);
        }
        setOverview(overviewData);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          toast.error('Failed to load reports data.', {
            description: err instanceof ApiError ? err.message : 'Request failed.',
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, []);

  const handleGenerateReport = async () => {
    if (!selectedApp || !reportType) {
      toast.error('Please select an application and export format.');
      return;
    }
    setIsGenerating(true);
    try {
      // Matches backend GenerateReportRequest: { dataSource, template, exportFormat, dateRange }
      const resp = await apiPost<{ success: boolean; message: string; download?: RecentDownloadRow }>(
        '/reports/generate',
        {
          dataSource: selectedApp,
          template: 'General Security Summary',
          exportFormat: reportType.toUpperCase(),
          dateRange: 'Last 7 Days',
        },
      );
      toast.success('Report Generated Successfully', { description: resp.message });
      if (resp.download) {
        setOverview((prev) =>
          prev
            ? { ...prev, recentDownloads: [resp.download!, ...prev.recentDownloads] }
            : null,
        );
      }
    } catch (err) {
      toast.error('Failed to generate report.', {
        description: err instanceof ApiError ? err.message : 'An unexpected error occurred.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-slate-400">
        <LoaderCircle className="w-5 h-5 animate-spin inline-block mr-2" />
        Loading report data...
      </div>
    );
  }

  return (
    <div className="space-y-8 p-4 md:p-6 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-400" />Reports & Downloads
        </h1>
        <p className="text-sm text-slate-500 mt-1 ml-8">
          Generate, schedule, and download security reports.
        </p>
      </header>

      {/* Generate Report */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-slate-200">
            <Download className="w-5 h-5" />Generate New Report
          </CardTitle>
          <CardDescription>
            Customize and generate a one-time security report for a specific application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-grow min-w-[200px]">
              <Label className="text-xs text-slate-400">Data Source</Label>
              <Select value={selectedApp} onValueChange={setSelectedApp}>
                <SelectTrigger className="bg-slate-950 border-slate-700">
                  <SelectValue placeholder="Select Application" />
                </SelectTrigger>
                <SelectContent>
                  {applications.map((app) => (
                    <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-grow min-w-[150px]">
              <Label className="text-xs text-slate-400">Export Format</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger className="bg-slate-950 border-slate-700">
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
              disabled={isGenerating || !selectedApp}
              className="flex-grow md:flex-grow-0 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isGenerating ? (
                <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Generating...</>
              ) : (
                'Generate Report'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scheduled Reports */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-slate-400" />Scheduled Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(overview?.scheduledReports ?? []).length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No scheduled reports configured.</p>
            ) : (
              <ul className="space-y-3">
                {overview!.scheduledReports.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800"
                  >
                    <div>
                      <p className="font-semibold text-slate-200">{r.title}</p>
                      <p className="text-xs text-slate-500">{r.schedule}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          r.active
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-slate-700 text-slate-400'
                        }`}
                      >
                        {r.active ? 'Active' : 'Paused'}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-700 hover:bg-slate-800"
                      >
                        Configure
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent Downloads */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-slate-400" />Recent Downloads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800">
                    <TableHead>File</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.recentDownloads ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-slate-500 py-6">
                        No downloads available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    overview!.recentDownloads.slice(0, 5).map((d) => (
                      <TableRow key={d.id} className="border-slate-800">
                        <TableCell>
                          <p className="font-medium text-slate-300">{d.fileName}</p>
                          <p className="text-xs text-blue-400">{d.targetAppScope}</p>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{d.size}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => d.downloadUrl && window.open(d.downloadUrl, '_blank')}
                            disabled={!d.downloadUrl}
                            className="text-emerald-400 hover:text-emerald-300"
                          >
                            Download
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
