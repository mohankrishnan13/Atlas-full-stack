"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import { Ban, Search, ShieldX, CheckCircle, LoaderCircle } from "lucide-react";
import { cn, getSeverityClassNames } from "@/lib/utils";
import type { Severity, Incident } from "@/lib/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { aiInvestigatorSummary, AiInvestigatorSummaryOutput, AiInvestigatorSummaryInput } from '@/ai/flows/ai-investigator-summary';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useEnvironment } from '@/context/EnvironmentContext';
import { apiFetch } from '@/lib/api';


function IncidentDetailSheet({ incident, open, onOpenChange }: { incident: Incident | null, open: boolean, onOpenChange: (open: boolean) => void }) {
    const { toast } = useToast();
    const [summary, setSummary] = useState<AiInvestigatorSummaryOutput | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (incident && open) {
            setIsLoading(true);
            setSummary(null);
            const input: AiInvestigatorSummaryInput = {
                eventName: incident.eventName,
                timestamp: incident.timestamp,
                severity: incident.severity,
                sourceIp: incident.sourceIp,
                destinationIp: incident.destIp,
                targetApplication: incident.targetApp,
                eventDetails: incident.eventDetails,
            };

            aiInvestigatorSummary(input)
                .then(setSummary)
                .catch(err => {
                    console.error("AI summary failed:", err);
                    toast({
                        title: "AI Summary Failed",
                        description: "Could not generate AI summary.",
                        variant: "destructive",
                    });
                    setSummary({ summaryText: "Could not generate AI summary.", attackVector: "N/A", potentialImpact: "N/A", context: "N/A" });
                })
                .finally(() => setIsLoading(false));
        }
    }, [incident, open, toast]);

    const handleRemediation = async (action: string) => {
        if (!incident) return;
        try {
            const response = await apiFetch('/incidents/remediate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ incidentId: incident.id, action: action }),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Remediation action failed' }));
                throw new Error(errorData.details || errorData.message);
            }
            toast({
                title: `Action: ${action}`,
                description: `Action taken for incident ${incident.id}`,
            });
            onOpenChange(false);
        } catch(error: any) {
             console.error(`Remediation action '${action}' failed:`, error);
             toast({
                title: "Error",
                description: error.message || `Failed to perform action '${action}' for incident ${incident.id}.`,
                variant: 'destructive',
            });
        }
    };

    if (!incident) return null;

    const severityClasses = getSeverityClassNames(incident.severity);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[500px] sm:w-[640px] p-0">
                <SheetHeader className="p-6 border-b">
                    <SheetTitle className="text-2xl">{incident.id}: {incident.eventName}</SheetTitle>
                    <SheetDescription>
                        <span className={cn("font-semibold", severityClasses.text)}>{incident.severity}</span>
                        <span className="text-muted-foreground"> | {incident.timestamp}</span>
                    </SheetDescription>
                </SheetHeader>
                <div className="p-6 space-y-6 overflow-y-auto h-[calc(100vh-8rem)]">
                    <Card>
                        <CardHeader>
                            <CardTitle>AI Investigator Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><LoaderCircle className="animate-spin h-4 w-4" /> Generating...</div>}
                            {summary && (
                                <>
                                    <div>
                                        <h4 className="font-semibold mb-1">Summary</h4>
                                        <p className="text-sm text-muted-foreground">{summary.summaryText}</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold mb-1">Attack Vector</h4>
                                        <p className="text-sm text-muted-foreground">{summary.attackVector}</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold mb-1">Potential Impact</h4>
                                        <p className="text-sm text-muted-foreground">{summary.potentialImpact}</p>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold mb-1">Context</h4>
                                        <p className="text-sm text-muted-foreground">{summary.context}</p>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Remediation Actions</CardTitle>
                        </CardHeader>
                        <CardContent className="flex gap-2">
                             <Button variant="outline" onClick={() => handleRemediation('Block IP')}><Ban className="mr-2 h-4 w-4" /> Block IP</Button>
                             <Button variant="outline" onClick={() => handleRemediation('Isolate Endpoint')}><ShieldX className="mr-2 h-4 w-4" /> Isolate Endpoint</Button>
                             <Button variant="secondary" onClick={() => handleRemediation('Dismiss')}><CheckCircle className="mr-2 h-4 w-4" /> Dismiss</Button>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Raw Event Details</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm font-mono bg-muted p-4 rounded-md text-muted-foreground break-words">
                            {incident.eventDetails}
                        </CardContent>
                    </Card>
                </div>
            </SheetContent>
        </Sheet>
    );
}

export default function IncidentsPage() {
    const [search, setSearch] = useState("");
    const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { toast } = useToast();
    const { environment } = useEnvironment();

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const response = await apiFetch(`/incidents?env=${environment}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
                    throw new Error(errorData.details || errorData.message || `API call failed with status: ${response.status}`);
                }
                const result = await response.json();
                setIncidents(result);
            } catch (error: any) {
                console.error("Failed to fetch incidents:", error);
                 toast({
                    variant: "destructive",
                    title: "Failed to Load Incidents Data",
                    description: error.message,
                });
                setIncidents([]);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [toast, environment]);

    const filteredIncidents = incidents.filter(inc =>
        Object.values(inc).some(val =>
            String(val).toLowerCase().includes(search.toLowerCase())
        )
    );

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold">Incidents</h1>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                    placeholder='Search incidents... (e.g., source="firewall" status="failure")'
                    className="pl-10"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Incident ID</TableHead>
                                <TableHead>Event</TableHead>
                                <TableHead>Severity</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Timestamp</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && Array.from({length: 5}).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                                </TableRow>
                            ))}
                            {!isLoading && filteredIncidents.map((incident) => {
                                const severityClasses = getSeverityClassNames(incident.severity as Severity);
                                return (
                                <TableRow key={incident.id} onClick={() => setSelectedIncident(incident)} className="cursor-pointer">
                                    <TableCell className="font-medium text-primary">{incident.id}</TableCell>
                                    <TableCell>{incident.eventName}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={cn(severityClasses.badge)}>{incident.severity}</Badge>
                                    </TableCell>
                                     <TableCell>
                                        <Badge
                                            className={cn(
                                                incident.status === 'Active' && 'bg-red-500/20 text-red-400 border-red-500/30',
                                                incident.status === 'Contained' && 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
                                                incident.status === 'Closed' && 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                                            )}
                                            variant="outline"
                                        >
                                            {incident.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{incident.timestamp}</TableCell>
                                </TableRow>
                            )})}
                            {!isLoading && filteredIncidents.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center text-muted-foreground">No incidents found.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <IncidentDetailSheet incident={selectedIncident} open={!!selectedIncident} onOpenChange={(open) => !open && setSelectedIncident(null)} />
        </div>
    );
}
