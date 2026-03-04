import { NextResponse } from "next/server";
import type { RecentAlert, Application, User } from "@/lib/types";

const CLOUD_APPLICATIONS: Application[] = [
  { id: "all", name: "All Applications" },
  { id: "payment-gateway", name: "Payment Gateway" },
  { id: "auth-service", name: "Authentication Service" },
  { id: "product-catalog", name: "Product Catalog API" },
  { id: "shipping-api", name: "Shipping API" },
];

const LOCAL_APPLICATIONS: Application[] = [
  { id: "all", name: "All Systems" },
  { id: "hr-db", name: "HR Database" },
  { id: "fileserver-alpha", name: "Fileserver Alpha" },
  { id: "internal-wiki", name: "Internal Wiki" },
  { id: "domain-controller", name: "Domain Controller" },
];

const CLOUD_ALERTS: RecentAlert[] = [
  {
    id: "alert-1",
    app: "Payment Gateway",
    message: "High number of failed transactions from IP 192.168.1.100.",
    severity: "High",
    timestamp: "2m ago",
  },
  {
    id: "alert-2",
    app: "Auth-Service",
    message: "Potential credential stuffing attack detected.",
    severity: "Critical",
    timestamp: "5m ago",
  },
  {
    id: "alert-3",
    app: "Shipping API",
    message: "API latency has breached the 500ms threshold.",
    severity: "Medium",
    timestamp: "15m ago",
  },
];

const LOCAL_ALERTS: RecentAlert[] = [
  {
    id: "alert-loc-1",
    app: "Fileserver Alpha",
    message: "Anomalous access to sensitive project files by user 'j.doe'.",
    severity: "High",
    timestamp: "3m ago",
  },
  {
    id: "alert-loc-2",
    app: "Domain Controller",
    message: "Multiple failed login attempts for administrator account.",
    severity: "Critical",
    timestamp: "8m ago",
  },
  {
    id: "alert-loc-3",
    app: "HR-DB",
    message: "Unauthorized access attempt from workstation WKST-1088.",
    severity: "Medium",
    timestamp: "25m ago",
  },
];

const USER_DATA: User = {
  name: "Jane Doe",
  email: "jane.doe@atlas-sec.com",
  avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3NDE5ODJ8MHwxfHNlYXJjaHw2fHx3b21hbiUyMGZhY2V8ZW58MHx8fHwxNzcxNTIzMTE1fDA&ixlib=rb-4.1.0&q=80&w=1080",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const env = searchParams.get("env") || "cloud";

  let applications: Application[];
  let recentAlerts: RecentAlert[];

  if (env === "local") {
    applications = LOCAL_APPLICATIONS;
    recentAlerts = LOCAL_ALERTS;
  } else {
    applications = CLOUD_APPLICATIONS;
    recentAlerts = CLOUD_ALERTS;
  }

  const data = {
    user: USER_DATA,
    applications,
    recentAlerts,
  };

  return NextResponse.json(data);
}
