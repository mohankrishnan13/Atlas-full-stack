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
import { OverviewData, ApiBlockRouteRequest } from "../../../lib/types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useToast } from "../../../hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal } from "lucide-react";

export default function OverviewPage() {
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchOverviewData = async () => {
      try {
        setLoading(true);
        const data = await apiGet<OverviewData>("/overview?env=cloud"); // Assuming 'cloud' for now
        setOverviewData(data);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred.");
        }
        console.error("Failed to fetch overview data:", err);
        toast({
          title: "Error",
          description: `Failed to load overview data: ${error}`,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchOverviewData();
  }, [error, toast]);

  const handleMitigate = async (app: string, path: string = "/*") => {
    try {
      const payload: ApiBlockRouteRequest = { app, path };
      await apiPost("/api-monitoring/block-route", payload);
      toast({
        title: "Mitigation Action",
        description: `Successfully initiated mitigation for ${app}.`,
      });
      // Optionally refetch data to reflect changes
      // await fetchOverviewData();
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Failed to mitigate: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during mitigation.",
          variant: "destructive",
        });
      }
      console.error("Mitigation failed:", err);
    }
  };

  if (loading) {
    return <div className="p-4">Loading overview data...</div>;
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

  if (!overviewData) {
    return <div className="p-4">No overview data available.</div>;
  }

  // Helper to get current load for an app
  const getAppLoad = (appName: string) => {
    const appStat = overviewData.apiRequestsByApp.find(
      (item) => item.app === appName
    );
    return appStat ? appStat.requests : 0;
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">Overview Dashboard</h1>

      {/* Top Row: App Health Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {overviewData.microservices.map((service) => {
          const isFailing = service.status === "Failing";
          const appLoad = getAppLoad(service.name);
          return (
            <Card key={service.id} className={isFailing ? "border-red-500" : ""}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {service.name}
                </CardTitle>
                <span
                  className={`h-2 w-2 rounded-full ${
                    isFailing ? "bg-red-500" : "bg-green-500"
                  }`}
                />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">Load: {appLoad} RPS</div>
                <p className="text-xs text-muted-foreground">
                  Status: {service.status}
                </p>
                {isFailing && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-2"
                    onClick={() => handleMitigate(service.name)}
                  >
                    Mitigate
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Chart: Categorical Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle>API Requests by Application</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={overviewData.apiRequestsByApp}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="app" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="requests" fill="#8884d8" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Active Threats Feed */}
      <Card>
        <CardHeader>
          <CardTitle>Active System Anomalies</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overviewData.systemAnomalies.map((anomaly) => (
                <TableRow key={anomaly.id}>
                  <TableCell className="font-medium">{anomaly.service}</TableCell>
                  <TableCell>{anomaly.type}</TableCell>
                  <TableCell
                    className={
                      anomaly.severity === "Critical"
                        ? "text-red-500"
                        : anomaly.severity === "High"
                        ? "text-orange-500"
                        : ""
                    }
                  >
                    {anomaly.severity}
                  </TableCell>
                  <TableCell>{anomaly.timestamp}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMitigate(anomaly.service)}
                    >
                      Throttle App
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
