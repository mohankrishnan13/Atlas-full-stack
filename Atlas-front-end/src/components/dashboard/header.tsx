'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, LogOut, Zap, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEnvironment } from '@/context/EnvironmentContext';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import type { HeaderData } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn, getSeverityClassNames } from '@/lib/utils';
import { toast } from 'sonner';

// ── Attack type options shown in the dropdown ─────────────────────────────────

const ATTACK_TYPES = [
  { value: 'api_spike',        label: 'API Spike',          description: 'High-volume traffic burst' },
  { value: 'brute_force',      label: 'Brute Force',        description: '500+ auth failures on /login' },
  { value: 'high_latency',     label: 'High Latency',       description: 'Degraded API response times' },
  { value: 'network_spike',    label: 'Network Spike',      description: 'Large data transfer detected' },
  { value: 'port_scan',        label: 'Port Scan',          description: 'Multi-port reconnaissance' },
  { value: 'malware_outbreak', label: 'Malware Outbreak',   description: 'Multiple endpoint infections' },
] as const;

type AttackType = (typeof ATTACK_TYPES)[number]['value'];

// ── Page titles map ───────────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  '/api-monitoring':    'API Monitoring',
  '/network-traffic':   'Network Traffic',
  '/endpoint-security': 'Endpoint Security',
  '/incidents':         'Case Management',
  '/reports':           'Reports',
  '/settings':          'Settings',
  '/profile':           'Profile',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function DashboardHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const { environment, setEnvironment } = useEnvironment();
  const [headerData, setHeaderData] = useState<HeaderData | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const pageTitle =
    Object.entries(PAGE_TITLES).find(([key]) => pathname.startsWith(key))?.[1] ?? 'Dashboard';

  useEffect(() => {
    apiGet<HeaderData>(`/header-data?env=${environment}`)
      .then(setHeaderData)
      .catch(() => {});
  }, [environment]);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const handleSimulate = async (attackType: AttackType) => {
    if (simulating) return;
    setSimulating(true);

    const label = ATTACK_TYPES.find((a) => a.value === attackType)?.label ?? attackType;

    toast.loading(`Injecting ${label} simulation...`, { id: 'simulate' });

    try {
      // POST /api/simulate/anomaly — matches routes_simulation.py
      const result = await apiPost<{
        success: boolean;
        records_inserted: number;
        message: string;
      }>('/api/simulate/anomaly', {
        type: attackType,
        env: environment,
      });

      toast.success(`Simulation: ${label}`, {
        id: 'simulate',
        description: `${result.records_inserted.toLocaleString()} records injected. ${result.message}`,
        duration: 6000,
      });
    } catch (err) {
      toast.error('Simulation Failed', {
        id: 'simulate',
        description: err instanceof ApiError ? err.message : 'Request failed.',
      });
    } finally {
      setSimulating(false);
    }
  };

  const userInitials = headerData?.user?.name
    ? headerData.user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'JD';

  const hasAlerts = (headerData?.recentAlerts?.length ?? 0) > 0;

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
      {/* Page title */}
      <div className="flex items-center gap-6">
        <h1 className="text-base font-medium text-slate-50">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* ── Simulate Attack Button ─────────────────────────────────────── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={simulating}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                'bg-red-600 hover:bg-red-500 text-white border border-red-500',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                simulating && 'animate-pulse',
              )}
              title="Inject simulated attack telemetry to demo the Anomaly Engine"
            >
              <Zap className={cn('w-4 h-4', simulating && 'animate-spin')} />
              {simulating ? 'Simulating...' : 'Simulate Attack'}
              {!simulating && <ChevronDown className="w-3 h-3 opacity-70" />}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="bg-slate-900 border-slate-700 text-slate-200 w-60"
          >
            <DropdownMenuLabel className="text-slate-400 text-xs uppercase tracking-wider">
              Choose Attack Type
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-800" />

            {ATTACK_TYPES.map((attack) => (
              <DropdownMenuItem
                key={attack.value}
                onClick={() => handleSimulate(attack.value)}
                className="flex flex-col items-start gap-0.5 px-3 py-2.5 cursor-pointer focus:bg-slate-800 focus:text-slate-100"
              >
                <span className="text-sm font-medium text-slate-200">{attack.label}</span>
                <span className="text-xs text-slate-500">{attack.description}</span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator className="bg-slate-800" />
            <div className="px-3 py-2 text-[10px] text-slate-500 leading-relaxed">
              Injects anomalous records. The AI engine detects and explains within ~60s.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* ── Environment Selector ──────────────────────────────────────── */}
        <Select
          value={environment}
          onValueChange={(v) => setEnvironment(v as 'cloud' | 'local')}
        >
          <SelectTrigger className="w-[110px] bg-slate-950 border-slate-800 text-slate-200 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            <SelectItem value="cloud" className="text-slate-200 focus:bg-slate-800">Cloud</SelectItem>
            <SelectItem value="local" className="text-slate-200 focus:bg-slate-800">Local</SelectItem>
          </SelectContent>
        </Select>

        {/* ── Notification Bell ─────────────────────────────────────────── */}
        <Sheet open={alertsOpen} onOpenChange={setAlertsOpen}>
          <SheetTrigger asChild>
            <button className="relative p-2 hover:bg-slate-800 rounded-lg transition-colors">
              <Bell className="w-5 h-5 text-slate-400" />
              {hasAlerts && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </button>
          </SheetTrigger>
          <SheetContent className="bg-slate-900 border-slate-700 text-slate-200 w-[380px]">
            <SheetHeader className="border-b border-slate-800 pb-4">
              <SheetTitle className="text-slate-50">Recent Alerts</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-1">
              {headerData?.recentAlerts?.length ? (
                headerData.recentAlerts.map((alert) => {
                  const sc = getSeverityClassNames(alert.severity);
                  return (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      <div className={cn('mt-1.5 h-2 w-2 rounded-full flex-shrink-0', sc.bg)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-2">
                          <p className="font-medium text-sm text-slate-200 truncate">{alert.app}</p>
                          <p className="text-xs text-slate-500 flex-shrink-0">{alert.timestamp}</p>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{alert.message}</p>
                        <span className={cn('inline-block mt-1 text-xs px-1.5 py-0.5 rounded border', sc.badge)}>
                          {alert.severity}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-slate-500 text-center py-8">No recent alerts</p>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* ── User Avatar + Logout ──────────────────────────────────────── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-8 h-8 bg-slate-800 rounded-full flex items-center justify-center text-xs font-semibold text-slate-300 hover:ring-2 hover:ring-blue-500/50 transition-all">
              {userInitials}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700 text-slate-200 w-48">
            <DropdownMenuLabel className="text-slate-400 text-xs">
              {headerData?.user?.email ?? 'Analyst'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-800" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-red-400 focus:bg-slate-800 focus:text-red-400 cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
