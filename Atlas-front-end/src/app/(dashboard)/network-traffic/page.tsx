"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge, Users, XCircle, ShieldBan, LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { NetworkTrafficData, NetworkAnomaly } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiGet, apiPost, ApiError } from "@/lib/api";

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

function BandwidthGauge({ bandwidth, isLoading }: { bandwidth?: number, isLoading: boolean }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Bandwidth</CardTitle>
                <Gauge className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-4 w-full" />
                    </div>
                ) : (
                    <>
                        <div className="text-2xl font-bold mb-2">{bandwidth}%</div>
                        <Progress value={bandwidth} />
                    </>
                )}
            </CardContent>
        </Card>
    )
}

const anomalyChartConfig = { count: { label: "Anomalies", color: "hsl(var(--chart-2))" } };

/** Categorical: anomalies by target app (from live data). */
function AnomaliesByAppChart({ anomalies, isLoading }: { anomalies?: NetworkAnomaly[]; isLoading: boolean }) {
  const byApp = useMemo(() => {
    if (!anomalies?.length) return [];
    const map = new Map<string, number>();
    anomalies.forEach((a) => map.set(a.app, (map.get(a.app) ?? 0) + 1));
    return Array.from(map.entries()).map(([app, count]) => ({ app, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  }, [anomalies]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Network Anomalies by Target Application</CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        {isLoading ? <Skeleton className="h-full w-full" /> : !byApp.length ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">No anomaly data by app.</div>
        ) : (
          <ChartContainer config={anomalyChartConfig} className="h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byApp} margin={{ top: 5, right: 20, left: -10, bottom: 5 }} layout="vertical" barCategoryGap="12%">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border) / 0.5)" />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="app" width={100} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} name="Anomalies" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** Categorical: anomalies by source IP. */
function AnomaliesBySourceIpChart({ anomalies, isLoading }: { anomalies?: NetworkAnomaly[]; isLoading: boolean }) {
  const byIp = useMemo(() => {
    if (!anomalies?.length) return [];
    const map = new Map<string, number>();
    anomalies.forEach((a) => map.set(a.sourceIp, (map.get(a.sourceIp) ?? 0) + 1));
    return Array.from(map.entries()).map(([sourceIp, count]) => ({ sourceIp, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [anomalies]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Network Anomalies by Source IP</CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        {isLoading ? <Skeleton className="h-full w-full" /> : !byIp.length ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">No anomaly data.</div>
        ) : (
          <ChartContainer config={anomalyChartConfig} className="h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byIp} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                <XAxis dataKey="sourceIp" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} name="Anomalies" />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function NetworkTrafficPage() {
  const [data, setData] = useState<NetworkTrafficData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blockingKey, setBlockingKey] = useState<string | null>(null);
  const { toast } = useToast();
  const { environment } = useEnvironment();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    apiGet<NetworkTrafficData>(`/network-traffic?env=${environment}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: ApiError) => {
        if (!cancelled) {
          toast({ variant: "destructive", title: "Failed to Load Network Traffic Data", description: err.message });
          setData(null);
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [toast, environment]);

  const handleApplyHardBlock = async (anomaly: NetworkAnomaly) => {
    const key = `${anomaly.sourceIp}-${anomaly.app}`;
    setBlockingKey(key);
    try {
      await apiPost<{ success: boolean; message: string }>("/network-traffic/block", { sourceIp: anomaly.sourceIp, app: anomaly.app });
      toast({ title: "Hard Block Applied", description: `Block applied for source ${anomaly.sourceIp} (app: ${anomaly.app}).` });
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Block Failed", description: err instanceof Error ? err.message : "Apply hard block failed." });
    } finally {
      setBlockingKey(null);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Network Traffic</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BandwidthGauge bandwidth={data?.bandwidth} isLoading={isLoading} />
        <StatCard title="Active Connections" value={data?.activeConnections?.toLocaleString()} icon={Users} isLoading={isLoading} />
        <StatCard title="Dropped Packets" value={data?.droppedPackets?.toLocaleString()} icon={XCircle} isLoading={isLoading} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <AnomaliesByAppChart anomalies={data?.networkAnomalies} isLoading={isLoading} />
        <AnomaliesBySourceIpChart anomalies={data?.networkAnomalies} isLoading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Network Anomalies (Source IP → Destination App)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source IP</TableHead>
                <TableHead>Destination IP</TableHead>
                <TableHead>Target Application</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Anomaly Type</TableHead>
                <TableHead className="text-right">Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ))}
              {!isLoading && data?.networkAnomalies.map((anomaly) => {
                const key = `${anomaly.sourceIp}-${anomaly.app}`;
                return (
                  <TableRow key={anomaly.id}>
                    <TableCell className="font-mono">{anomaly.sourceIp}</TableCell>
                    <TableCell className="font-mono">{anomaly.destIp}</TableCell>
                    <TableCell><Badge variant="outline">{anomaly.app}</Badge></TableCell>
                    <TableCell>{anomaly.port}</TableCell>
                    <TableCell><Badge variant="destructive">{anomaly.type}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="destructive" size="sm" disabled={blockingKey === key} onClick={() => handleApplyHardBlock(anomaly)}>
                        {blockingKey === key ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldBan className="mr-2 h-4 w-4" />}
                        {blockingKey === key ? "Applying..." : "Apply Hard Block"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && (!data || data.networkAnomalies.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No network anomalies detected.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
