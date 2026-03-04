"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Bug, LineChart, Server, Waves, LoaderCircle } from "lucide-react";
import { cn, getSeverityClassNames } from "@/lib/utils";
import type { Severity, OverviewData, Microservice, SystemAnomaly, TimeSeriesData, AppAnomaly } from "@/lib/types";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiFetch } from "@/lib/api";
import { generateDailyThreatBriefing } from "@/ai/flows/ai-daily-threat-briefing-flow";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Line, LineChart as RechartsLineChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar } from "recharts"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";


function AiDailyBriefing({ data, isLoading, environment }: { data: OverviewData | null, isLoading: boolean, environment: string }) {
    const [briefing, setBriefing] = useState("Generating briefing...");
    const [isBriefingLoading, setIsBriefingLoading] = useState(false);

    useEffect(() => {
        if (isLoading) {
            setBriefing("Briefing is unavailable while data is loading.");
            return;
        }
        if (!data) {
             setBriefing("Briefing is unavailable because dashboard data failed to load.");
             return;
        }

        const fetchBriefing = async () => {
            setIsBriefingLoading(true);
            const briefingInput = {
                totalApiRequests: data.apiRequests,
                errorRatePercentage: data.errorRate,
                activeAlerts: data.activeAlerts,
                costRiskMeter: data.costRisk,
                failingApplications: data.microservices.filter(s => s.status === 'Failing').map(s => s.name),
                recentSystemAnomalies: data.systemAnomalies.map(a => `${a.service}: ${a.type}`),
            };

            try {
                // Add context to the prompt for better briefings
                const result = await generateDailyThreatBriefing(briefingInput);
                setBriefing(result.briefing);
            } catch (error) {
                console.error("Failed to generate AI daily threat briefing:", error);
                setBriefing("AI briefing is currently unavailable. Please check system status.");
            } finally {
                setIsBriefingLoading(false);
            }
        };
        fetchBriefing();
    }, [data, isLoading, environment]);
    
    return (
        <Card className="col-span-1 md:col-span-2 xl:col-span-4 bg-card">
            <CardHeader>
                <CardTitle>AI Daily Threat Briefing</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-muted-foreground">
                    {isLoading || isBriefingLoading ? <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /></div> : briefing}
                </div>
            </CardContent>
        </Card>
    )
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

function MicroservicesTopology({ services, failingEndpoints, isLoading }: { services?: Microservice[], failingEndpoints?: Record<string, string>, isLoading: boolean }) {
    return (
        <Card className="col-span-1 md:col-span-2 xl:col-span-3">
            <CardHeader>
                <CardTitle>Microservices Health Topology</CardTitle>
            </CardHeader>
            <CardContent className="h-[400px] relative">
                {isLoading && <div className="flex items-center justify-center h-full"><LoaderCircle className="h-8 w-8 animate-spin" /></div>}
                {!isLoading && services?.map(service => (
                    <TooltipProvider key={service.id}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div
                                    className={cn(
                                        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center cursor-pointer p-2 w-28 h-28 text-center text-xs font-semibold",
                                        service.status === 'Healthy' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300',
                                        service.status === 'Failing' && 'pulse-red'
                                    )}
                                    style={{ top: service.position.top, left: service.position.left }}
                                >
                                    {service.name}
                                </div>
                            </TooltipTrigger>
                             <TooltipContent>
                                <p>Status: {service.status}</p>
                                {service.status === 'Failing' && failingEndpoints && <p>Failing Endpoint: {failingEndpoints[service.id]}</p>}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ))}
                 {!isLoading && (!services || services.length === 0) && (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-muted-foreground">No microservice data available.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

const apiChartConfig = {
  requests: { label: "API Requests", color: "hsl(var(--primary))" },
}

function ApiRequestsChart({ data, isLoading }: { data?: TimeSeriesData[], isLoading: boolean }) {
    return (
        <Card className="col-span-1 md:col-span-2 xl:col-span-2">
            <CardHeader>
                <CardTitle>API Requests Over Time</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
                {isLoading ? <div className="h-full flex items-center justify-center"><Skeleton className="h-full w-full" /></div> :
                !data || data.length === 0 ? <div className="h-full flex items-center justify-center text-muted-foreground">No API request data.</div> :
                <ChartContainer config={apiChartConfig} className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                            <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} />
                            <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} tickFormatter={(value) => `${value / 1000}k`} />
                            <RechartsTooltip 
                                content={<ChartTooltipContent />} 
                                cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 2, strokeDasharray: '3 3' }}
                            />
                            <Line type="monotone" dataKey="requests" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                        </RechartsLineChart>
                    </ResponsiveContainer>
                </ChartContainer>}
            </CardContent>
        </Card>
    )
}

function SystemAnomaliesTable({ anomalies, isLoading }: { anomalies?: SystemAnomaly[], isLoading: boolean }) {
    return (
        <Card className="col-span-1 md:col-span-2 xl:col-span-3">
            <CardHeader>
                <CardTitle>Recent System-Wide Anomalies</CardTitle>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Service</TableHead>
                            <TableHead>Anomaly Type</TableHead>
                            <TableHead>Severity</TableHead>
                            <TableHead>Timestamp</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading && Array.from({length: 4}).map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                            </TableRow>
                        ))}
                        {!isLoading && anomalies?.map((anomaly) => {
                            const severityClasses = getSeverityClassNames(anomaly.severity as Severity);
                            return (
                                <TableRow key={anomaly.id}>
                                    <TableCell>{anomaly.service}</TableCell>
                                    <TableCell>{anomaly.type}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={cn(severityClasses.badge)}>
                                            {anomaly.severity}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{anomaly.timestamp}</TableCell>
                                </TableRow>
                            )
                        })}
                        {!isLoading && (!anomalies || anomalies.length === 0) && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">No recent anomalies.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}

const appAnomaliesChartConfig = {
  anomalies: { label: "Anomalies", color: "hsl(var(--chart-2))" },
}

function AppAnomaliesChart({ data, isLoading }: { data?: AppAnomaly[], isLoading: boolean}) {
    return (
        <Card className="col-span-1 md:col-span-2 xl:col-span-2">
            <CardHeader>
                <CardTitle>Anomalies by Application</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
                {isLoading ? <div className="h-full flex items-center justify-center"><Skeleton className="h-full w-full" /></div> :
                !data || data.length === 0 ? <div className="h-full flex items-center justify-center text-muted-foreground">No anomaly data.</div> :
                <ChartContainer config={appAnomaliesChartConfig} className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                             <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border) / 0.5)" />
                            <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} />
                            <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} fontSize={12} />
                            <RechartsTooltip
                                content={<ChartTooltipContent hideLabel />}
                                cursor={{ fill: 'hsl(var(--muted))' }}
                            />
                            <Bar dataKey="anomalies" fill="var(--color-anomalies)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartContainer>}
            </CardContent>
        </Card>
    )
}


export default function OverviewPage() {
    const [data, setData] = useState<OverviewData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { environment } = useEnvironment();

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const response = await apiFetch(`/overview?env=${environment}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
                    throw new Error(errorData.details || errorData.message || `API call failed with status: ${response.status}`);
                }
                const result = await response.json();
                setData(result);
            } catch (error: any) {
                console.error("Failed to fetch overview data:", error);
                toast({
                    variant: "destructive",
                    title: "Failed to Load Overview Data",
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <AiDailyBriefing data={data} isLoading={isLoading} environment={environment} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Total API Requests" value={data?.apiRequests?.toLocaleString()} icon={LineChart} isLoading={isLoading} />
                <StatCard title="Error Rate" value={data ? `${data.errorRate}%` : undefined} icon={Waves} isLoading={isLoading} />
                <StatCard title="Active Alerts" value={data?.activeAlerts} icon={Bug} isLoading={isLoading} />
                <StatCard title="Cost Risk Meter" value={data ? `${data.costRisk}/10` : undefined} icon={Server} isLoading={isLoading} />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                <AppAnomaliesChart data={data?.appAnomalies} isLoading={isLoading} />
                <MicroservicesTopology services={data?.microservices} failingEndpoints={data?.failingEndpoints} isLoading={isLoading} />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                 <SystemAnomaliesTable anomalies={data?.systemAnomalies} isLoading={isLoading} />
                 <ApiRequestsChart data={data?.apiRequestsChart} isLoading={isLoading} />
            </div>
        </div>
    )
}
