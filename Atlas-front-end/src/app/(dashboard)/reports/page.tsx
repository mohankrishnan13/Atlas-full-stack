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
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { HeaderData, Application } from "../../../lib/types";
import { useToast } from "../../../hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal, Download } from "lucide-react";

export default function ReportsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>("");
  const [reportType, setReportType] = useState<string>("pdf");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchApplications = async () => {
      try {
        setLoading(true);
        const data = await apiGet<HeaderData>("/header-data?env=cloud");
        setApplications(data.applications);
        if (data.applications.length > 0) {
          setSelectedApp(data.applications[0].id);
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred.");
        }
        console.error("Failed to fetch applications for reports:", err);
        toast({
          title: "Error",
          description: `Failed to load applications: ${error}`,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchApplications();
  }, [error, toast]);

  const handleGenerateReport = async () => {
    if (!selectedApp || !reportType) {
      toast({
        title: "Validation Error",
        description: "Please select an application and report type.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      // This is a simulated API call as no explicit report generation endpoint is available.
      // In a real scenario, this would hit an endpoint like /api/reports/generate
      // which would return a file stream or a link to a generated report.
      console.log(`Simulating report generation for App: ${selectedApp}, Type: ${reportType}`);
      
      // For demonstration, we'll simulate a file download
      const dummyReportContent = `Report for ${selectedApp} in ${reportType} format.\n\nGenerated on: ${new Date().toLocaleString()}`; 
      const filename = `${selectedApp}_report.${reportType}`;
      const blob = new Blob([dummyReportContent], { type: reportType === "pdf" ? "application/pdf" : "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Report Generated",
        description: `Successfully generated a ${reportType.toUpperCase()} report for ${selectedApp}.`,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Failed to generate report: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during report generation.",
          variant: "destructive",
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
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">Reports</h1>

      <Card>
        <CardHeader>
          <CardTitle>Generate Custom Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="data-source">Data Source (Application)</Label>
            <Select value={selectedApp} onValueChange={setSelectedApp}>
              <SelectTrigger id="data-source">
                <SelectValue placeholder="Select an application" />
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

          <div className="space-y-2">
            <Label htmlFor="report-type">Report Type</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger id="report-type">
                <SelectValue placeholder="Select report type" />
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
            className="w-full"
          >
            {isGenerating ? "Generating..." : <><Download className="mr-2 h-4 w-4" /> Generate Report</>}
          </Button>
          <p className="text-sm text-muted-foreground">
            Note: Report generation is currently simulated. A backend endpoint for PDF/CSV generation would be integrated here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
