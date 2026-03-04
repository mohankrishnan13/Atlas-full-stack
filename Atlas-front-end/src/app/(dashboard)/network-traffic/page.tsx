"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Gauge, Users, XCircle, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { NetworkTrafficData } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { useEnvironment } from "@/context/EnvironmentContext";
import { apiFetch } from "@/lib/api";

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

function TrafficFlowMap({ isLoading, environment }: { isLoading: boolean, environment: string }) {
    const isLocal = environment === 'local';
    return (
        <Card>
            <CardHeader>
                <CardTitle>App-Aware Traffic Flow</CardTitle>
            </CardHeader>
            <CardContent className="h-[400px] flex items-center justify-around bg-card p-8 rounded-lg">
                {isLoading ? <Skeleton className="h-full w-full" /> : 
                <>
                    <div className="text-center space-y-2">
                        <div className="font-bold text-muted-foreground">{isLocal ? "Employee Workstations" : "External IPs"}</div>
                        <div className="p-4 bg-muted rounded-lg">{isLocal ? "10.10.10.0/24" : "203.0.113.54"}</div>
                        <div className="p-4 bg-muted rounded-lg">{isLocal ? "10.10.20.0/24" : "198.51.100.2"}</div>
                    </div>
                    <ArrowRight className="h-8 w-8 text-muted-foreground mx-4" />
                    <div className="text-center space-y-2">
                        <div className="font-bold text-muted-foreground">{isLocal ? "Office Firewall" : "Cloud Firewall"}</div>
                        <div className="p-8 bg-blue-500/20 text-blue-300 rounded-full flex items-center justify-center">{isLocal ? "FW-CORP-01" : "FW-CLOUD-01"}</div>
                    </div>
                    <ArrowRight className="h-8 w-8 text-muted-foreground mx-4" />
                    <div className="space-y-4">
                        <div className="font-bold text-muted-foreground text-center">{isLocal ? "Internal Resources" : "Internal App Nodes"}</div>
                        <div className="p-4 bg-secondary rounded-lg">{isLocal ? "10.0.50.5 [HR-DB]" : "10.0.1.12 [Payment-Service]"}</div>
                        <div className="p-4 bg-secondary rounded-lg">{isLocal ? "10.0.60.10 [File-Server]" : "10.0.2.34 [User-DB]"}</div>
                        <div className="p-4 bg-secondary rounded-lg">{isLocal ? "10.0.70.15 [Intranet-Portal]" : "10.0.5.88 [Data-Pipeline]"}</div>
                    </div>
                </>}
            </CardContent>
        </Card>
    );
}

export default function NetworkTrafficPage() {
    const [data, setData] = useState<NetworkTrafficData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { environment } = useEnvironment();

     useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const response = await apiFetch(`/network-traffic?env=${environment}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
                    throw new Error(errorData.details || errorData.message || `API call failed with status: ${response.status}`);
                }
                const result = await response.json();
                setData(result);
            } catch (error: any) {
                console.error("Failed to fetch network traffic data:", error);
                toast({
                    variant: "destructive",
                    title: "Failed to Load Network Traffic Data",
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
            <h1 className="text-3xl font-bold">Network Traffic</h1>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <BandwidthGauge bandwidth={data?.bandwidth} isLoading={isLoading} />
                <StatCard title="Active Connections" value={data?.activeConnections.toLocaleString()} icon={Users} isLoading={isLoading} />
                <StatCard title="Dropped Packets" value={data?.droppedPackets.toLocaleString()} icon={XCircle} isLoading={isLoading} />
            </div>

            <TrafficFlowMap isLoading={isLoading} environment={environment} />

            <Card>
                <CardHeader>
                    <CardTitle>Active Network Anomalies</CardTitle>
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
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && Array.from({length: 4}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                                </TableRow>
                            ))}
                            {!isLoading && data?.networkAnomalies.map((anomaly) => (
                                <TableRow key={anomaly.id}>
                                    <TableCell className="font-mono">{anomaly.sourceIp}</TableCell>
                                    <TableCell className="font-mono">{anomaly.destIp}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{anomaly.app}</Badge>
                                    </TableCell>
                                    <TableCell>{anomaly.port}</TableCell>
                                    <TableCell>
                                        <Badge variant="destructive">{anomaly.type}</Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                             {!isLoading && (!data || data.networkAnomalies.length === 0) && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">No network anomalies detected.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
