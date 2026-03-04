"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, DollarSign, Gauge, Ban, LineChart, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Line, LineChart as RechartsLineChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts"
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiMonitoringData } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiFetch } from "@/lib/api";

const chartConfig = {
  actual: {
    label: "Actual Usage",
    color: "hsl(var(--primary))",
  },
  predicted: {
    label: "AI Baseline",
    color: "hsl(var(--muted-foreground))",
  },
}

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
    const { toast } = useToast();
    const { environment } = useEnvironment();

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const response = await apiFetch(`/api-monitoring?env=${environment}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
                    throw new Error(errorData.details || errorData.message || `API call failed with status: ${response.status}`);
                }
                const result = await response.json();
                setData(result);
            } catch (error: any) {
                console.error("Failed to fetch API monitoring data:", error);
                toast({
                    variant: "destructive",
                    title: "Failed to Load API Monitoring Data",
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
            <h1 className="text-3xl font-bold">API Monitoring</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="API Calls Today" value={data?.apiCallsToday?.toLocaleString()} icon={LineChart} isLoading={isLoading} />
                <StatCard title="Blocked Requests" value={data?.blockedRequests?.toLocaleString()} icon={Ban} isLoading={isLoading} />
                <StatCard title="Average Latency" value={data ? `${data.avgLatency}ms` : undefined} icon={Gauge} isLoading={isLoading} />
                <StatCard title="Estimated 3rd-Party API Cost" value={data ? `$${data.estimatedCost.toFixed(2)}` : undefined} icon={DollarSign} isLoading={isLoading} />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>API Usage vs Expected AI Baseline</CardTitle>
                </CardHeader>
                <CardContent className="h-[400px]">
                    {isLoading ? <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-full w-full" /></div> :
                    <ChartContainer config={chartConfig} className="h-full w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <RechartsLineChart data={data?.apiUsageChart} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                                <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} />
                                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => `${value / 1000}k`} />
                                <RechartsTooltip
                                    content={<ChartTooltipContent hideLabel />}
                                    cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 2, strokeDasharray: '3 3' }}
                                />
                                <Legend />
                                <Line type="monotone" dataKey="actual" name="Actual Usage" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="predicted" name="AI Baseline" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                            </RechartsLineChart>
                        </ResponsiveContainer>
                    </ChartContainer>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>API Routing & Abuse</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Endpoint</TableHead>
                                <TableHead>Method</TableHead>
                                <TableHead>Cost/Call</TableHead>
                                <TableHead>Trend (7d)</TableHead>
                                <TableHead>Action Taken</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && Array.from({length: 5}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                                </TableRow>
                            ))}
                            {!isLoading && data?.apiRouting.map((route) => (
                                <TableRow key={route.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="font-mono text-xs bg-secondary">{route.app}</Badge>
                                            <span className="font-mono">{route.path}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary">{route.method}</Badge>
                                    </TableCell>
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
                                                route.action === 'Blocked' && 'bg-red-500/20 text-red-400 border-red-500/30',
                                                route.action === 'Rate-Limited' && 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
                                            )}
                                            variant="outline"
                                        >
                                            {route.action}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                             {!isLoading && (!data || data.apiRouting.length === 0) && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">No API routing data available.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
