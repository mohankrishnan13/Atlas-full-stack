"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Hourglass, Users, PackageOpen } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { DbMonitoringData } from "@/lib/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts"
import { useToast } from "@/hooks/use-toast";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiFetch } from "@/lib/api";

const chartConfig = {
  SELECT: { label: "SELECT", color: "hsl(var(--chart-1))" },
  INSERT: { label: "INSERT", color: "hsl(var(--chart-2))" },
  UPDATE: { label: "UPDATE", color: "hsl(var(--chart-3))" },
  DELETE: { label: "DELETE", color: "hsl(var(--chart-5))" },
};

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
    const { toast } = useToast();
    const { environment } = useEnvironment();

     useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const response = await apiFetch(`/db-monitoring?env=${environment}`);
                 if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
                    throw new Error(errorData.details || errorData.message || `API call failed with status: ${response.status}`);
                }
                const result = await response.json();
                setData(result);
            } catch (error: any) {
                console.error("Failed to fetch database monitoring data:", error);
                toast({
                    variant: "destructive",
                    title: "Failed to Load Database Monitoring Data",
                    description: error.message,
                });
                setData(null);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [toast, environment]);

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold">Database Monitoring</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <StatCard title="Active Connections" value={data?.activeConnections} icon={Users} isLoading={isLoading} />
                <StatCard title="Avg Query Latency" value={data?.avgQueryLatency} unit="ms" icon={Hourglass} isLoading={isLoading} />
                <StatCard title="Data Export Volume (24h)" value={data?.dataExportVolume} unit="TB" icon={PackageOpen} isLoading={isLoading} />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Database Operations</CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                    {isLoading ? <Skeleton className="h-full w-full" /> :
                     <ChartContainer config={chartConfig} className="h-full w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data?.operationsChart} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                                <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} />
                                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => `${value / 1000}k`} />
                                <RechartsTooltip content={<ChartTooltipContent indicator="dot" />} />
                                <Legend />
                                <Area type="monotone" dataKey="SELECT" stackId="1" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1) / 0.1)" />
                                <Area type="monotone" dataKey="INSERT" stackId="1" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2) / 0.1)" />
                                <Area type="monotone" dataKey="UPDATE" stackId="1" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3) / 0.1)" />
                                <Area type="monotone" dataKey="DELETE" stackId="1" stroke="hsl(var(--chart-5))" fill="hsl(var(--chart-5) / 0.1)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartContainer>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Suspicious DB Activity</CardTitle>
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
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && Array.from({length: 4}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                                </TableRow>
                            ))}
                            {!isLoading && data?.suspiciousActivity.map((activity) => (
                                <TableRow key={activity.id}>
                                    <TableCell><Badge variant="outline">{activity.app}</Badge></TableCell>
                                    <TableCell className="font-mono">{activity.user}</TableCell>
                                    <TableCell><Badge variant="secondary">{activity.type}</Badge></TableCell>
                                    <TableCell className="font-mono">{activity.table}</TableCell>
                                    <TableCell className="text-yellow-400">{activity.reason}</TableCell>
                                </TableRow>
                            ))}
                            {!isLoading && (!data || data.suspiciousActivity.length === 0) && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">No suspicious activity detected.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
