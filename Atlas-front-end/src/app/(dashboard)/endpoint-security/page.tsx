"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Laptop, WifiOff, ShieldAlert, ShieldX, LoaderCircle } from "lucide-react";
import { cn, getSeverityClassNames } from "@/lib/utils";
import type { Severity, EndpointSecurityData, OsDistribution, AlertTypeDistribution, WazuhEvent } from "@/lib/types";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Pie, PieChart, Cell, ResponsiveContainer, Legend, Tooltip as RechartsTooltip } from "recharts";
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer as BarResponsive } from "recharts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
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

function OsDistributionChart({ data, isLoading }: { data?: OsDistribution[], isLoading: boolean }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>OS Distribution</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
                {isLoading ? <Skeleton className="h-full w-full" /> :
                <ChartContainer config={{}} className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                                {data?.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                            </Pie>
                            <RechartsTooltip content={<ChartTooltipContent hideLabel />} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </ChartContainer>}
            </CardContent>
        </Card>
    )
}

function AlertTypesChart({ data, isLoading }: { data?: AlertTypeDistribution[]; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>Alert Types</CardTitle></CardHeader>
      <CardContent className="h-[300px]">
        {isLoading ? <Skeleton className="h-full w-full" /> : (
          <ChartContainer config={{}} className="h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80}>
                  {data?.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                </Pie>
                <RechartsTooltip content={<ChartTooltipContent hideLabel />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const hostnameChartConfig = { count: { label: "Alerts", color: "hsl(var(--chart-3))" } };

/** Categorical bar chart: vulnerabilities/alerts by endpoint hostname (workstation ID). */
function AlertsByHostnameChart({ events, isLoading }: { events?: WazuhEvent[]; isLoading: boolean }) {
  const byHost = useMemo(() => {
    if (!events?.length) return [];
    const map = new Map<string, number>();
    events.forEach((e) => map.set(e.workstationId, (map.get(e.workstationId) ?? 0) + 1));
    return Array.from(map.entries()).map(([workstationId, count]) => ({ workstationId, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  }, [events]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vulnerabilities / Alerts by Endpoint Hostname</CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        {isLoading ? <Skeleton className="h-full w-full" /> : !byHost.length ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">No endpoint alert data.</div>
        ) : (
          <ChartContainer config={hostnameChartConfig} className="h-full w-full">
            <BarResponsive width="100%" height="100%">
              <BarChart data={byHost} margin={{ top: 5, right: 20, left: -10, bottom: 5 }} layout="vertical" barCategoryGap="12%">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border) / 0.5)" />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="workstationId" width={120} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltipContent hideLabel />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} name="Alerts" />
              </BarChart>
            </BarResponsive>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

export default function EndpointSecurityPage() {
  const { toast } = useToast();
  const [data, setData] = useState<EndpointSecurityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quarantiningId, setQuarantiningId] = useState<string | null>(null);
  const { environment } = useEnvironment();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    apiGet<EndpointSecurityData>(`/endpoint-security?env=${environment}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: ApiError) => {
        if (!cancelled) {
          toast({ variant: "destructive", title: "Failed to Load Endpoint Security Data", description: err.message });
          setData(null);
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [toast, environment]);

  const handleQuarantine = async (workstationId: string) => {
    setQuarantiningId(workstationId);
    try {
      await apiPost<{ success: boolean; message: string }>("/endpoint-security/quarantine", { workstationId });
      toast({ title: "Quarantine Action", description: `Device ${workstationId} has been quarantined.` });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Quarantine Failed",
        description: err instanceof Error ? err.message : `Failed to quarantine device ${workstationId}.`,
      });
    } finally {
      setQuarantiningId(null);
    }
  };

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold">Endpoint Security</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <StatCard title="Monitored Laptops" value={data?.monitoredLaptops} icon={Laptop} isLoading={isLoading} />
                <StatCard title="Offline Devices" value={data?.offlineDevices} icon={WifiOff} isLoading={isLoading} />
                <StatCard title="Malware Alerts" value={data?.malwareAlerts} icon={ShieldAlert} isLoading={isLoading} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <OsDistributionChart data={data?.osDistribution} isLoading={isLoading} />
                <AlertTypesChart data={data?.alertTypes} isLoading={isLoading} />
            </div>

            <AlertsByHostnameChart events={data?.wazuhEvents} isLoading={isLoading} />

            <Card>
                <CardHeader>
                    <CardTitle>Wazuh / Velociraptor Agent Event Log (by Workstation)</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Workstation ID</TableHead>
                                <TableHead>Employee</TableHead>
                                <TableHead>Alert Type</TableHead>
                                <TableHead>Severity</TableHead>
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && Array.from({length: 4}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                                </TableRow>
                            ))}
                            {!isLoading && data?.wazuhEvents.map((event) => {
                                const severityClasses = getSeverityClassNames(event.severity as Severity);
                                return (
                                <TableRow key={event.id}>
                                    <TableCell className="font-mono">{event.workstationId}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Avatar className="h-8 w-8">
                                                <AvatarImage src={event.avatar} alt={event.employee} data-ai-hint="person face" />
                                                <AvatarFallback>{event.employee.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <span>{event.employee}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{event.alert}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={cn(severityClasses.badge)}>
                                            {event.severity}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            disabled={quarantiningId === event.workstationId}
                                            onClick={() => handleQuarantine(event.workstationId)}
                                        >
                                            {quarantiningId === event.workstationId ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldX className="mr-2 h-4 w-4" />}
                                            {quarantiningId === event.workstationId ? "Quarantining..." : "Quarantine Device"}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )})}
                             {!isLoading && (!data || data.wazuhEvents.length === 0) && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">No Wazuh events to display.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
