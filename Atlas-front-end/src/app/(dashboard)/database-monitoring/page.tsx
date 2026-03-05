"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hourglass, Users, PackageOpen, LoaderCircle, Skull } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DbMonitoringData, SuspiciousActivity } from "@/lib/types";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";

const opsChartConfig = {
  SELECT: { label: "SELECT", color: "hsl(var(--chart-1))" },
  INSERT: { label: "INSERT", color: "hsl(var(--chart-2))" },
  UPDATE: { label: "UPDATE", color: "hsl(var(--chart-3))" },
  DELETE: { label: "DELETE", color: "hsl(var(--chart-5))" },
};
const dlpChartConfig = { count: { label: "Suspicious / DLP", color: "hsl(var(--destructive))" } };

function StatCard({ title, value, unit, icon: Icon, isLoading }: { title: string, value?: string | number, unit?: string, icon: React.ElementType, isLoading: boolean }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {isLoading ? <Skeleton className="h-8 w-24" /> : 
                <div className="text-2xl font-bold">
                    {value}
                    {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
                </div>}
            </CardContent>
        </Card>
    )
}

export default function DatabaseMonitoringPage() {
  const [data, setData] = useState<DbMonitoringData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [killingId, setKillingId] = useState<number | null>(null);
  const { toast } = useToast();
  const { environment } = useEnvironment();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    apiGet<DbMonitoringData>(`/db-monitoring?env=${environment}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: ApiError) => {
        if (!cancelled) {
          toast({ variant: "destructive", title: "Failed to Load Database Monitoring Data", description: err.message });
          setData(null);
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [toast, environment]);

  const handleKillQuery = async (activity: SuspiciousActivity) => {
    setKillingId(activity.id);
    try {
      await apiPost<{ success: boolean; message: string }>("/db-monitoring/kill-query", {
        activityId: activity.id,
        app: activity.app,
        user: activity.user,
      });
      toast({ title: "Kill Query Sent", description: `Kill-query command sent for activity (app: ${activity.app}).` });
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Kill Query Failed", description: err instanceof Error ? err.message : "Kill query failed." });
    } finally {
      setKillingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Database Monitoring (DLP)</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Active Connections" value={data?.activeConnections} icon={Users} isLoading={isLoading} />
        <StatCard title="Avg Query Latency" value={data?.avgQueryLatency} unit="ms" icon={Hourglass} isLoading={isLoading} />
        <StatCard title="Data Export Volume (24h)" value={data?.dataExportVolume} unit="TB" icon={PackageOpen} isLoading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Database Operations by Target Application</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px]">
          {isLoading ? <Skeleton className="h-full w-full" /> : !data?.operationsByApp?.length ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">No operations data by app.</div>
          ) : (
            <ChartContainer config={opsChartConfig} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.operationsByApp} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                  <XAxis dataKey="app" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltipContent indicator="dot" />} />
                  <Legend />
                  <Bar dataKey="SELECT" stackId="1" fill="var(--color-SELECT)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="INSERT" stackId="1" fill="var(--color-INSERT)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="UPDATE" stackId="1" fill="var(--color-UPDATE)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="DELETE" stackId="1" fill="var(--color-DELETE)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Exfiltration / DLP by Target Database (App)</CardTitle>
        </CardHeader>
        <CardContent className="h-[280px]">
          {isLoading ? <Skeleton className="h-full w-full" /> : !data?.dlpByTargetApp?.length ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">No DLP data by target app.</div>
          ) : (
            <ChartContainer config={dlpChartConfig} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.dlpByTargetApp} margin={{ top: 5, right: 20, left: -10, bottom: 5 }} layout="vertical" barCategoryGap="12%">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border) / 0.5)" />
                  <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="app" width={100} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} name="Suspicious" />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suspicious DB Activity (by Application / User)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Originating Application</TableHead>
                <TableHead>User/Service</TableHead>
                <TableHead>Query Type</TableHead>
                <TableHead>Target Table</TableHead>
                <TableHead>Reason for Flag</TableHead>
                <TableHead className="text-right">Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))}
              {!isLoading && data?.suspiciousActivity.map((activity) => (
                <TableRow key={activity.id}>
                  <TableCell><Badge variant="outline">{activity.app}</Badge></TableCell>
                  <TableCell className="font-mono">{activity.user}</TableCell>
                  <TableCell><Badge variant="secondary">{activity.type}</Badge></TableCell>
                  <TableCell className="font-mono">{activity.table}</TableCell>
                  <TableCell className="text-yellow-400">{activity.reason}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="destructive" size="sm" disabled={killingId === activity.id} onClick={() => handleKillQuery(activity)}>
                      {killingId === activity.id ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Skull className="mr-2 h-4 w-4" />}
                      {killingId === activity.id ? "Sending..." : "Kill Query"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (!data || data.suspiciousActivity.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No suspicious activity detected.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
