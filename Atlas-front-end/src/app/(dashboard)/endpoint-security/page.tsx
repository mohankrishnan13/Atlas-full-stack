"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Laptop, WifiOff, ShieldAlert, ShieldX } from "lucide-react";
import { cn, getSeverityClassNames } from "@/lib/utils";
import type { Severity, EndpointSecurityData, OsDistribution, AlertTypeDistribution } from "@/lib/types";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Pie, PieChart, Cell, ResponsiveContainer, Legend, Tooltip as RechartsTooltip } from "recharts"
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useEnvironment } from '@/context/EnvironmentContext';
import { apiFetch } from '@/lib/api';

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

function AlertTypesChart({ data, isLoading }: { data?: AlertTypeDistribution[], isLoading: boolean }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Alert Types</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
                {isLoading ? <Skeleton className="h-full w-full" /> :
                <ChartContainer config={{}} className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80}>
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

export default function EndpointSecurityPage() {
    const { toast } = useToast();
    const [data, setData] = useState<EndpointSecurityData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { environment } = useEnvironment();

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const response = await apiFetch(`/endpoint-security?env=${environment}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
                    throw new Error(errorData.details || errorData.message || `API call failed with status: ${response.status}`);
                }
                const result = await response.json();
                setData(result);
            } catch (error: any) {
                console.error("Failed to fetch endpoint security data:", error);
                toast({
                    variant: "destructive",
                    title: "Failed to Load Endpoint Security Data",
                    description: error.message,
                });
                setData(null);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [toast, environment]);

    const handleQuarantine = async (workstationId: string) => {
        try {
            const response = await apiFetch('/endpoint-security/quarantine', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workstationId }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Quarantine command failed' }));
                throw new Error(errorData.details || errorData.message);
            }
            
            toast({
                title: "Quarantine Action",
                description: `Device ${workstationId} has been sent to quarantine.`,
            });
        } catch (error: any) {
            console.error('Quarantine failed:', error);
             toast({
                title: "Error",
                description: error.message || `Failed to quarantine device ${workstationId}.`,
                variant: 'destructive',
            });
        }
    }

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

            <Card>
                <CardHeader>
                    <CardTitle>Wazuh Agent Event Log</CardTitle>
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
                                            onClick={() => handleQuarantine(event.workstationId)}
                                        >
                                            <ShieldX className="mr-2 h-4 w-4" />
                                            Quarantine Device
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
