"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, DollarSign, Gauge, Ban, BarChart3, LoaderCircle, ShieldBan } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart as RechartsBarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiMonitoringData, ApiRoute } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";

const consumptionChartConfig = {
  actual: { label: "Actual", color: "hsl(var(--primary))" },
  limit: { label: "Limit", color: "hsl(var(--muted-foreground))" },
};

function StatCard({ title, value, icon: Icon, isLoading }: { title: string, value?: string | number, icon: React.ElementType, isLoading: boolean }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-2xl font-bold">{value}</div>}
            </CardContent>
        </Card>
    )
}

export default function ApiMonitoringPage() {
  const [data, setData] = useState<ApiMonitoringData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blockingRouteId, setBlockingRouteId] = useState<number | null>(null);
  const { toast } = useToast();
  const { environment } = useEnvironment();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    apiGet<ApiMonitoringData>(`/api-monitoring?env=${environment}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: ApiError) => {
        if (!cancelled) {
          toast({ variant: "destructive", title: "Failed to Load API Monitoring Data", description: err.message });
          setData(null);
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [toast, environment]);

  const handleApplyHardBlock = async (route: ApiRoute) => {
    setBlockingRouteId(route.id);
    try {
      await apiPost<{ success: boolean; message: string }>("/api-monitoring/block-route", { app: route.app, path: route.path });
      toast({ title: "Hard Block Applied", description: `Route ${route.app} ${route.path} has been blocked.` });
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Block Failed", description: err instanceof Error ? err.message : "Apply hard block failed." });
    } finally {
      setBlockingRouteId(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">API Monitoring</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="API Calls Today" value={data?.apiCallsToday?.toLocaleString()} icon={BarChart3} isLoading={isLoading} />
        <StatCard title="Blocked Requests" value={data?.blockedRequests?.toLocaleString()} icon={Ban} isLoading={isLoading} />
        <StatCard title="Average Latency" value={data ? `${data.avgLatency}ms` : undefined} icon={Gauge} isLoading={isLoading} />
        <StatCard title="Estimated 3rd-Party API Cost" value={data ? `$${data.estimatedCost.toFixed(2)}` : undefined} icon={DollarSign} isLoading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Consumption by Application (Current vs Limit)</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px]">
          {isLoading ? (
            <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
          ) : !data?.apiConsumptionByApp?.length ? (
            <div className="h-full flex items-center justify-center text-muted-foreground">No consumption data by app.</div>
          ) : (
            <ChartContainer config={consumptionChartConfig} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={data.apiConsumptionByApp} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                  <XAxis dataKey="app" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Legend />
                  <Bar dataKey="actual" name="Actual" fill="var(--color-actual)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="limit" name="Limit" fill="var(--color-limit)" radius={[4, 4, 0, 0]} />
                </RechartsBarChart>
              </ResponsiveContainer>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API Routing & Abuse (by Application)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application / Endpoint</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Cost/Call</TableHead>
                <TableHead>Trend (7d)</TableHead>
                <TableHead>Action Taken</TableHead>
                <TableHead className="text-right">Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))}
              {!isLoading && data?.apiRouting.map((route) => (
                <TableRow key={route.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs bg-secondary">{route.app}</Badge>
                      <span className="font-mono">{route.path}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{route.method}</Badge></TableCell>
                  <TableCell>${route.cost.toFixed(4)}</TableCell>
                  <TableCell>
                    <div className={cn("flex items-center", route.trend > 0 ? "text-red-500" : "text-emerald-500")}>
                      {route.trend > 0 ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                      {Math.abs(route.trend)}%
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        route.action === "Blocked" && "bg-red-500/20 text-red-400 border-red-500/30",
                        route.action === "Rate-Limited" && "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
                      )}
                      variant="outline"
                    >
                      {route.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={blockingRouteId === route.id}
                      onClick={() => handleApplyHardBlock(route)}
                    >
                      {blockingRouteId === route.id ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldBan className="mr-2 h-4 w-4" />}
                      {blockingRouteId === route.id ? "Applying..." : "Apply Hard Block"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (!data || data.apiRouting.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No API routing data available.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
