"use client";
import { EnvironmentProvider } from "@/context/EnvironmentContext";
import { AuthProvider } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/toaster";

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <EnvironmentProvider>
        {children}
        <Toaster />
      </EnvironmentProvider>
    </AuthProvider>
  );
}
