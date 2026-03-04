"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar as CalendarIcon, Bot, FileText, Download } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { addDays } from "date-fns";
import React from "react";
import { useToast } from "@/hooks/use-toast";

export default function ReportsPage() {
    const { toast } = useToast();
    const [date, setDate] = React.useState<DateRange | undefined>({
        from: new Date(2024, 4, 20),
        to: addDays(new Date(2024, 4, 20), 7),
    });

    const handleGenerate = () => {
        toast({
            title: "Report Generation Started",
            description: "Your report is being generated and will appear in recent downloads shortly.",
        });
    }

    return (
        <div className="space-y-8">
            <h1 className="text-3xl font-bold">Reports</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Generate New Report</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="date-range">Date Range</Label>
                             <Popover>
                                <PopoverTrigger asChild>
                                <Button
                                    id="date"
                                    variant={"outline"}
                                    className="w-full justify-start text-left font-normal"
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date?.from ? (
                                    date.to ? (
                                        <>
                                        {format(date.from, "LLL dd, y")} -{" "}
                                        {format(date.to, "LLL dd, y")}
                                        </>
                                    ) : (
                                        format(date.from, "LLL dd, y")
                                    )
                                    ) : (
                                    <span>Pick a date</span>
                                    )}
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={date?.from}
                                    selected={date}
                                    onSelect={setDate}
                                    numberOfMonths={2}
                                />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="data-source">Data Source</Label>
                            <Select>
                                <SelectTrigger id="data-source"><SelectValue placeholder="Select source" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="incidents">Incidents</SelectItem>
                                    <SelectItem value="api">API Monitoring</SelectItem>
                                    <SelectItem value="network">Network Traffic</SelectItem>
                                    <SelectItem value="endpoints">Endpoint Security</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                             <Label htmlFor="export-format">Export Format</Label>
                            <Select>
                                <SelectTrigger id="export-format"><SelectValue placeholder="Select format" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="pdf">PDF</SelectItem>
                                    <SelectItem value="csv">CSV</SelectItem>
                                    <SelectItem value="json">JSON</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                         <div className="flex items-end">
                            <Button className="w-full" onClick={handleGenerate}>Generate</Button>
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="ai-report">Ask AI to generate a report...</Label>
                         <div className="relative">
                            <Bot className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                            <Input id="ai-report" placeholder="e.g., 'a summary of all critical incidents this week related to the payment-service'" className="pl-10" />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <Card>
                    <CardHeader>
                        <CardTitle>Scheduled Reports</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                            <div>
                                <h4 className="font-semibold">Weekly SOC Summary</h4>
                                <p className="text-sm text-muted-foreground">Every Monday at 9:00 AM</p>
                            </div>
                            <Switch defaultChecked />
                        </div>
                         <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                            <div>
                                <h4 className="font-semibold">Daily Endpoint Health</h4>
                                <p className="text-sm text-muted-foreground">Daily at 8:00 AM</p>
                            </div>
                            <Switch defaultChecked />
                        </div>
                         <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                            <div>
                                <h4 className="font-semibold">Monthly Compliance Report</h4>
                                <p className="text-sm text-muted-foreground">1st of every month</p>
                            </div>
                            <Switch />
                        </div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader>
                        <CardTitle>Recent Downloads</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                         <div className="flex items-center justify-between p-3 hover:bg-muted rounded-lg">
                            <div className="flex items-center gap-3">
                               <FileText className="h-5 w-5 text-muted-foreground"/>
                               <div>
                                    <h4 className="font-semibold">incidents_2024-05-20.pdf</h4>
                                    <p className="text-sm text-muted-foreground">Generated 1 day ago</p>
                               </div>
                            </div>
                            <Button variant="ghost" size="icon"><Download className="h-5 w-5" /></Button>
                        </div>
                        <div className="flex items-center justify-between p-3 hover:bg-muted rounded-lg">
                            <div className="flex items-center gap-3">
                               <FileText className="h-5 w-5 text-muted-foreground"/>
                               <div>
                                    <h4 className="font-semibold">api_traffic_q1_2024.csv</h4>
                                    <p className="text-sm text-muted-foreground">Generated 3 days ago</p>
                               </div>
                            </div>
                            <Button variant="ghost" size="icon"><Download className="h-5 w-5" /></Button>
                        </div>
                         <div className="flex items-center justify-between p-3 hover:bg-muted rounded-lg">
                            <div className="flex items-center gap-3">
                               <FileText className="h-5 w-5 text-muted-foreground"/>
                               <div>
                                    <h4 className="font-semibold">endpoint_health_weekly.pdf</h4>
                                    <p className="text-sm text-muted-foreground">Generated 5 days ago</p>
                               </div>
                            </div>
                            <Button variant="ghost" size="icon"><Download className="h-5 w-5" /></Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
