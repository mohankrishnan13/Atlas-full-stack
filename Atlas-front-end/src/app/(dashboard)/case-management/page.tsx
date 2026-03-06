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
  Incident,
  RemediateRequest,
  RemediateResponse,
} from "../../../lib/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { useToast } from "../../../hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal, Search } from "lucide-react";

export default function CaseManagementPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const { toast } = useToast();

  const fetchIncidents = async () => {
    try {
      setLoading(true);
      const data = await apiGet<Incident[]>("/incidents?env=cloud"); // Assuming 'cloud' for now
      setIncidents(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
      console.error("Failed to fetch incidents data:", err);
      toast({
        title: "Error",
        description: `Failed to load incidents: ${error}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, [error, toast]);

  const handlePlaybookAction = async (incidentId: string, action: string) => {
    try {
      const payload: RemediateRequest = { incidentId, action };
      const response = await apiPost<RemediateResponse>("/incidents/remediate", payload);
      toast({
        title: "Playbook Action Initiated",
        description: response.message,
      });
      // Optionally refetch incidents to update status
      fetchIncidents();
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Playbook action failed: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during playbook execution.",
          variant: "destructive",
        });
      }
      console.error("Playbook action failed:", err);
    }
  };

  const filteredIncidents = incidents?.filter(
    (incident) =>
      incident.eventName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      incident.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      incident.targetApp.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate KPIs
  const criticalOpenCases = incidents?.filter(
    (inc) => inc.severity === "Critical" && inc.status === "Active"
  ).length || 0;

  // MTTR (Mean Time To Respond/Resolve) - Placeholder for now, as timestamps for resolution aren't explicit
  // This would require more complex logic and potentially additional fields in the Incident schema
  const mttr = "N/A"; // In a real scenario, calculate from timestamps

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

  if (!incidents) {
    return <div className="p-4">No case data available.</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">Case Management</h1>

      {/* Triage Section */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Open Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalOpenCases}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mean Time To Resolve (MTTR)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mttr}</div>
            <p className="text-xs text-muted-foreground">Requires incident resolution timestamps.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Search Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, Name, App..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Case Board */}
      <Card>
        <CardHeader>
          <CardTitle>Active Incident Cases</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case ID</TableHead>
                <TableHead>Event Name</TableHead>
                <TableHead>Target App</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>AI Narrative</TableHead>
                <TableHead className="text-right">Playbooks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredIncidents && filteredIncidents.length > 0 ? (
                filteredIncidents.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell className="font-medium">{incident.id}</TableCell>
                    <TableCell>{incident.eventName}</TableCell>
                    <TableCell>{incident.targetApp}</TableCell>
                    <TableCell
                      className={
                        incident.severity === "Critical"
                          ? "text-red-500"
                          : incident.severity === "High"
                          ? "text-orange-500"
                          : ""
                      }
                    >
                      {incident.severity}
                    </TableCell>
                    <TableCell>{incident.status}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {incident.eventDetails} {/* AI Threat Narrative */}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handlePlaybookAction(incident.id, "Block IP")}
                        className="mr-2"
                      >
                        Block IP Playbook
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handlePlaybookAction(incident.id, "Isolate Endpoint")}
                        className="mr-2"
                      >
                        Isolate Endpoint Playbook
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePlaybookAction(incident.id, "Dismiss")}
                      >
                        Dismiss Case
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    No incident cases found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
