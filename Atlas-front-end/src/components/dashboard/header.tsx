'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEnvironment } from '@/context/EnvironmentContext';
import { apiGet } from '@/lib/api';
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

const PAGE_TITLES: Record<string, string> = {
  '/overview': 'Overview',
  '/api-monitoring': 'API Monitoring',
  '/network-traffic': 'Network Traffic',
  '/endpoint-security': 'Endpoint Security',
  '/database-monitoring': 'Database Monitoring',
  '/incidents': 'Case Management',
  '/reports': 'Reports',
  '/settings': 'Settings',
};

export function DashboardHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  const { environment, setEnvironment } = useEnvironment();
  const [headerData, setHeaderData] = useState<HeaderData | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const pageTitle =
    Object.entries(PAGE_TITLES).find(([key]) => pathname.startsWith(key))?.[1] ??
    'Dashboard';

  useEffect(() => {
    apiGet<HeaderData>(`/header-data?env=${environment}`)
      .then(setHeaderData)
      .catch(() => {});
  }, [environment]);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const userInitials = headerData?.user?.name
    ? headerData.user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'JD';

  const hasAlerts = (headerData?.recentAlerts?.length ?? 0) > 0;

  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-6">
        <h1 className="text-base font-medium text-slate-50">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Environment Selector */}
        <Select
          value={environment}
          onValueChange={(v) => setEnvironment(v as 'cloud' | 'local')}
        >
          <SelectTrigger className="w-[120px] bg-slate-950 border-slate-800 text-slate-200 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            <SelectItem value="local" className="text-slate-200 focus:bg-slate-800">Local</SelectItem>
            <SelectItem value="cloud" className="text-slate-200 focus:bg-slate-800">Cloud</SelectItem>
          </SelectContent>
        </Select>

        {/* Notifications */}
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

        {/* User Avatar + Logout */}
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
