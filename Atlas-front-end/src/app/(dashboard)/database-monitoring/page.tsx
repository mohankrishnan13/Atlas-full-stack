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
  DbMonitoringData,
  DbKillQueryRequest,
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

export default function DatabaseMonitoringPage() {
  const [dbMonitoringData, setDbMonitoringData] = useState<DbMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchDbMonitoringData = async () => {
    try {
      setLoading(true);
      const data = await apiGet<DbMonitoringData>("/db-monitoring?env=cloud"); // Assuming 'cloud' for now
      setDbMonitoringData(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
      console.error("Failed to fetch DB monitoring data:", err);
      toast({
        title: "Error",
        description: `Failed to load database monitoring data: ${error}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDbMonitoringData();
  }, [error, toast]);

  const handleKillQuery = async (
    activityId: number,
    app: string,
    user: string
  ) => {
    try {
      const payload: DbKillQueryRequest = { activityId, app, user };
      await apiPost("/db-monitoring/kill-query", payload);
      toast({
        title: "Mitigation Action",
        description: `Successfully sent kill query command for activity ID ${activityId} on app ${app} by user ${user}.`,
      });
      // Optionally refetch data to reflect changes
      // await fetchDbMonitoringData();
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Failed to kill query: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during kill query action.",
          variant: "destructive",
        });
      }
      console.error("Kill query failed:", err);
    }
  };

  if (loading) {
    return <div className="p-4">Loading database monitoring data...</div>;
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

  if (!dbMonitoringData) {
    return <div className="p-4">No database monitoring data available.</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">Database Monitoring (DLP Focus)</h1>

      {/* Top KPIs */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active DB Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dbMonitoringData.activeConnections}</div>
            <p className="text-xs text-muted-foreground">
              Overall active connections across monitored databases.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Query Latency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dbMonitoringData.avgQueryLatency.toFixed(2)} ms</div>
            <p className="text-xs text-muted-foreground">
              Average query response time.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Export Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dbMonitoringData.dataExportVolume.toFixed(2)} GB</div>
            <p className="text-xs text-muted-foreground">
              Critical data movement to external destinations.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chart: Data Exfiltration Risk by Database */}
      <Card>
        <CardHeader>
          <CardTitle>Data Exfiltration Risk by Database</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={dbMonitoringData.dlpByTargetApp}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="app" />
              <YAxis label={{ value: "DLP Count", angle: -90, position: "insideLeft" }} />
              <Tooltip />
              <Bar dataKey="count" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Suspicious DB Activity Table */}
      <Card>
        <CardHeader>
          <CardTitle>Suspicious Database Activity</CardTitle>
          <p className="text-sm text-muted-foreground">
            Note: Only 'Kill Query' action is available via API. Other actions are for future implementation.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target DB & Table</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Anomaly Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Mitigation Controls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dbMonitoringData.suspiciousActivity.length > 0 ? (
                dbMonitoringData.suspiciousActivity.map((activity) => (
                  <TableRow key={activity.id}>
                    <TableCell className="font-medium">
                      {activity.app} / {activity.table}
                    </TableCell>
                    <TableCell>{activity.user}</TableCell>
                    <TableCell>{activity.type}</TableCell>
                    <TableCell>{activity.reason}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          handleKillQuery(activity.id, activity.app, activity.user)
                        }
                      >
                        Kill Query
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No suspicious database activity detected.
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
