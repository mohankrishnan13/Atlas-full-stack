"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import {
  EndpointSecurityData,
  QuarantineRequest,
  QuarantineResponse,
} from "../../../lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow
} from "../../../components/ui/table";
import { useToast } from "../../../hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal } from "lucide-react";

export default function EndpointSecurityPage() {
  const [endpointSecurityData, setEndpointSecurityData] = useState<EndpointSecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchEndpointSecurityData = async () => {
    try {
      setLoading(true);
      const data = await apiGet<EndpointSecurityData>("/endpoint-security?env=cloud");
      setEndpointSecurityData(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
      console.error("Failed to fetch endpoint security data:", err);
      toast({
        title: "Error",
        description: `Failed to load endpoint security data: ${error}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEndpointSecurityData();
  }, [error, toast]);

  const handleQuarantine = async (workstationId: string) => {
    try {
      const payload: QuarantineRequest = { workstationId };
      const response = await apiPost<QuarantineResponse>("/endpoint-security/quarantine", payload);
      toast({
        title: "Mitigation Action",
        description: response.message,
      });
      // Optionally refetch data to reflect changes
      // await fetchEndpointSecurityData();
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Failed to quarantine: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during quarantine.",
          variant: "destructive",
        });
      }
      console.error("Quarantine failed:", err);
    }
  };

  if (loading) {
    return <div className="p-4">Loading endpoint security data...</div>;
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

  if (!endpointSecurityData) {
    return <div className="p-4">No endpoint security data available.</div>;
  }

  // Aggregate data for "Most Vulnerable Endpoints" chart
  const workstationVulnerabilities: { [key: string]: number } = {};
  endpointSecurityData.wazuhEvents.forEach((event) => {
    workstationVulnerabilities[event.workstationId] = (
      workstationVulnerabilities[event.workstationId] || 0
    ) + 1;
  });

  const vulnerableEndpointsChartData = Object.entries(workstationVulnerabilities)
    .map(([workstationId, count]) => ({
      name: workstationId,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 most vulnerable

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">Endpoint Security Monitoring</h1>

      {/* Top KPIs */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monitored Laptops</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{endpointSecurityData.monitoredLaptops}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Offline Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{endpointSecurityData.offlineDevices}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Malware Infections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{endpointSecurityData.malwareAlerts}</div>
            <p className="text-xs text-muted-foreground">
              Critical threats requiring immediate attention.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actionable Chart: Most Vulnerable Endpoints */}
      <Card>
        <CardHeader>
          <CardTitle>Most Vulnerable Endpoints (by Alert Count)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart
              data={vulnerableEndpointsChartData}
              layout="vertical"
              margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" label={{ value: "Vulnerability Count", angle: 0, position: "insideBottom" }} />
              <YAxis type="category" dataKey="name" width={120} />
              <Tooltip />
              <Bar dataKey="count" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Endpoint Event Log */}
      <Card>
        <CardHeader>
          <CardTitle>Endpoint Event Log</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workstation ID</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Alert</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpointSecurityData.wazuhEvents.length > 0 ? (
                endpointSecurityData.wazuhEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-medium">{event.workstationId}</TableCell>
                    <TableCell>{event.employee}</TableCell>
                    <TableCell>{event.alert}</TableCell>
                    <TableCell
                      className={
                        event.severity === "Critical"
                          ? "text-red-500"
                          : event.severity === "High"
                          ? "text-orange-500"
                          : ""
                      }
                    >
                      {event.severity}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleQuarantine(event.workstationId)}
                      >
                        Quarantine Workstation
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No recent endpoint events.
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
