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
  ApiMonitoringData,
  ApiBlockRouteRequest,
  ApiConsumptionByApp,
  ApiRoute,
} from "../../../lib/types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
}
from "recharts";
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

export default function ApiMonitoringPage() {
  const [apiMonitoringData, setApiMonitoringData] = useState<ApiMonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchApiMonitoringData = async () => {
      try {
        setLoading(true);
        const data = await apiGet<ApiMonitoringData>("/api-monitoring?env=cloud"); // Assuming 'cloud' for now
        setApiMonitoringData(data);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("An unexpected error occurred.");
        }
        console.error("Failed to fetch API monitoring data:", err);
        toast({
          title: "Error",
          description: `Failed to load API monitoring data: ${error}`,
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    fetchApiMonitoringData();
  }, [error, toast]);

  const handleBlockRoute = async (app: string, path: string) => {
    try {
      const payload: ApiBlockRouteRequest = { app, path };
      await apiPost("/api-monitoring/block-route", payload);
      toast({
        title: "API Block Action",
        description: `Successfully initiated hard block for ${app} on route ${path}.`,
      });
      // Optionally refetch data to reflect changes
      // await fetchApiMonitoringData();
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Failed to block route: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during route blocking.",
          variant: "destructive",
        });
      }
      console.error("Route blocking failed:", err);
    }
  };

  if (loading) {
    return <div className="p-4">Loading API monitoring data...</div>;
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

  if (!apiMonitoringData) {
    return <div className="p-4">No API monitoring data available.</div>;
  }

  const topAbusedEndpoints = apiMonitoringData.apiRouting
    .sort((a, b) => b.cost - a.cost) // Assuming higher cost indicates more abuse
    .slice(0, 10); // Take top 10

  const activeMitigationFeed = apiMonitoringData.apiRouting.filter(
    (route) => route.action !== "OK"
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">API Monitoring</h1>

      {/* Top Row Charts */}
      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        {/* Top Left Chart: API Overuse by Target Application */}
        <Card>
          <CardHeader>
            <CardTitle>API Overuse by Target Application</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={apiMonitoringData.apiConsumptionByApp}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="app" />
                <YAxis label={{ value: "RPM", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="actual" fill="#8884d8" name="Actual RPM" />
                <Bar dataKey="limit" fill="#82ca9d" name="Hard Limit" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Right Chart: Most Abused Endpoints */}
        <Card>
          <CardHeader>
            <CardTitle>Most Abused Endpoints (by Cost)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart
                data={topAbusedEndpoints.map((e) => ({ ...e, name: `[${e.app}] ${e.path}` }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" label={{ value: "Cost", angle: 0, position: "insideBottom" }} />
                <YAxis type="category" dataKey="name" width={150} />
                <Tooltip />
                <Bar dataKey="cost" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Consumers Table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Consumers (Limited Data Available)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Note: Backend currently does not provide 'Consumer IP/User' directly. Displaying app and path instead.
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target App</TableHead>
                <TableHead>Endpoint Path</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiMonitoringData.apiRouting.map((route) => (
                <TableRow key={`${route.app}-${route.path}`}>
                  <TableCell className="font-medium">{route.app}</TableCell>
                  <TableCell>{route.path}</TableCell>
                  <TableCell>{route.cost.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleBlockRoute(route.app, route.path)}
                    >
                      Revoke Key / Block
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Active API Mitigation Feed */}
      <Card>
        <CardHeader>
          <CardTitle>Active API Mitigation Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target App</TableHead>
                <TableHead>Endpoint Path</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Current Action</TableHead>
                <TableHead className="text-right">Mitigation Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeMitigationFeed.length > 0 ? (
                activeMitigationFeed.map((route) => (
                  <TableRow key={`${route.app}-${route.path}-mitigation`}>
                    <TableCell className="font-medium">{route.app}</TableCell>
                    <TableCell>{route.path}</TableCell>
                    <TableCell>{route.method}</TableCell>
                    <TableCell>{route.action}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleBlockRoute(route.app, route.path)}
                      >
                        Enforce Hard Block
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No active API mitigations.
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
