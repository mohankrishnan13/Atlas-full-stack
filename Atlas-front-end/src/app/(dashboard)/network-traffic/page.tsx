"use client";

import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import {
  NetworkTrafficData,
  NetworkBlockRequest,
} from "../../../lib/types";
import {
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow
} from "../../../components/ui/table";
import { useToast } from "../../../hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Terminal } from "lucide-react";

export default function NetworkTrafficPage() {
  const [networkData, setNetworkData] = useState<NetworkTrafficData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchNetworkData = async () => {
    try {
      setLoading(true);
      const data = await apiGet<NetworkTrafficData>("/network-traffic?env=cloud");
      setNetworkData(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred.");
      }
      console.error("Failed to fetch network traffic data:", err);
      toast({
        title: "Error",
        description: `Failed to load network traffic data: ${error}`,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNetworkData();
  }, [error, toast]);

  const handleBlockIp = async (sourceIp: string, app: string) => {
    try {
      const payload: NetworkBlockRequest = { sourceIp, app };
      await apiPost("/network-traffic/block", payload);
      toast({
        title: "Network Block Action",
        description: `Successfully initiated hard block for IP ${sourceIp} targeting ${app}.`,
      });
      // Optionally refetch data to reflect changes
      // await fetchNetworkData();
    } catch (err) {
      if (err instanceof ApiError) {
        toast({
          title: "Error",
          description: `Failed to block IP: ${err.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: "An unexpected error occurred during IP blocking.",
          variant: "destructive",
        });
      }
      console.error("IP blocking failed:", err);
    }
  };

  if (loading) {
    return <div className="p-4">Loading network traffic data...</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-4">
        <Terminal className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!networkData) {
    return <div className="p-4">No network traffic data available.</div>;
  }

  // For the interactive topology and anomalies table, we'll process networkData.networkAnomalies
  // To uniquely identify attacker IPs and target apps from anomalies
  const externalIps = Array.from(
    new Set(networkData.networkAnomalies.map((a) => a.sourceIp))
  ).map((ip) => `External IP (Public): ${ip}`);
  const targetApps = Array.from(
    new Set(networkData.networkAnomalies.map((a) => a.app))
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-3xl font-bold">Network Traffic Monitoring</h1>

      {/* Top KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bandwidth</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{networkData.bandwidth} Mbps</div>
            <p className="text-xs text-muted-foreground">
              {/* Placeholder for app-specific bottleneck if available in future API */}
              Currently showing aggregated bandwidth.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{networkData.activeConnections}</div>
            <p className="text-xs text-muted-foreground">
              Monitor for unusual spikes.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dropped Packets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{networkData.droppedPackets}</div>
            <p className="text-xs text-muted-foreground">
              Indicates potential network issues or attacks.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Topology (Simplified) */}
      <Card>
        <CardHeader>
          <CardTitle>Network Attack Topology (Anomalies Based)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center p-4 border rounded-md">
            <div className="flex flex-col gap-2 w-1/3 border-r pr-4">
              <h3 className="text-lg font-semibold">External Attackers</h3>
              {externalIps.map((ip) => (
                <div key={ip} className="flex items-center justify-between p-2 rounded-md">
                  <span>{ip}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBlockIp(ip.replace("External IP (Public): ", ""), "*")}
                  >
                    Block at Firewall
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 w-2/3 pl-4">
              <h3 className="text-lg font-semibold">Internal Target Applications</h3>
              <div className="flex flex-wrap gap-2">
                {targetApps.map((app) => (
                  <span key={app} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                    {app}
                  </span>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Arrows represent anomalous traffic flow from external IPs to target applications.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Anomalies Table */}
      <Card>
        <CardHeader>
          <CardTitle>Network Anomalies Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source Endpoint</TableHead>
                <TableHead>Target Application</TableHead>
                <TableHead>Port</TableHead>
                <TableHead>Anomaly Type</TableHead>
                <TableHead className="text-right">Mitigation Controls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {networkData.networkAnomalies.length > 0 ? (
                networkData.networkAnomalies.map((anomaly, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                      {`External IP (Public): ${anomaly.sourceIp}`}
                    </TableCell>
                    <TableCell>{anomaly.app}</TableCell>
                    <TableCell>{anomaly.port}</TableCell>
                    <TableCell>{anomaly.type}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleBlockIp(anomaly.sourceIp, anomaly.app)}
                      >
                        Drop Connection
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No network anomalies detected.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
