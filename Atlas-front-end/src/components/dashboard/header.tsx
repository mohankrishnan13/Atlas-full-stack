'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  LogOut,
  Settings,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, getSeverityClassNames } from '@/lib/utils';
import { Badge } from '../ui/badge';
import type { RecentAlert, User as UserType, Application } from '@/lib/types';
import { Skeleton } from '../ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useEnvironment } from '@/context/EnvironmentContext';
import { apiFetch } from '@/lib/api';

function AlertItem({ alert }: { alert: RecentAlert }) {
  const severityClasses = getSeverityClassNames(alert.severity);
  return (
    <div className="flex items-start gap-3 p-4 border-b border-border last:border-b-0 hover:bg-muted/50">
      <div
        className={cn(
          'mt-1 h-2.5 w-2.5 rounded-full',
          severityClasses.bg.replace('bg-', '')
        )}
      />
      <div className="flex-1">
        <div className="flex justify-between items-center">
          <p className="font-semibold">{alert.app}</p>
          <p className="text-xs text-muted-foreground">{alert.timestamp}</p>
        </div>
        <p className="text-sm text-muted-foreground">{alert.message}</p>
        <Badge variant="outline" className={cn('mt-2', severityClasses.badge)}>
          {alert.severity}
        </Badge>
      </div>
    </div>
  );
}

type HeaderData = {
  user: UserType;
  recentAlerts: RecentAlert[];
  applications: Application[];
};

export function DashboardHeader() {
  const [data, setData] = useState<HeaderData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const { environment, setEnvironment } = useEnvironment();
  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const res = await apiFetch(`/header-data?env=${environment}`);
        if (!res.ok) {
          const errorData = await res
            .json()
            .catch(() => ({ message: 'An unknown API error occurred.' }));
          throw new Error(
            errorData.details ||
              errorData.message ||
              `API call failed with status: ${res.status}`
          );
        }
        const result = await res.json();
        setData(result);
      } catch (error: any) {
        console.error('Failed to fetch header data', error);
        toast({
          variant: 'destructive',
          title: 'Failed to Load Header Data',
          description: error.message,
        });
        setData(null);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [toast, environment]);

  const handleLogout = () => {
    // In a real app, you would also clear auth tokens here
    if (typeof window !== 'undefined') {
        localStorage.removeItem('atlas_auth_token');
    }
    router.push('/login');
  };

  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center justify-between border-b border-slate-800 bg-background px-4 text-slate-200 md:flex md:px-6">
      {/* Left Side: Branding */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div className="flex items-center text-lg font-semibold tracking-wide">
          <span className="text-white">ATLAS</span>
          <span className="mx-2 text-slate-600">|</span>
          <span className="text-slate-400 hidden lg:inline-block font-normal text-sm">
            Advanced Traffic Layer Anomaly System
          </span>
        </div>
      </div>

      {/* Right Side: Controls & Profile */}
      <div className="flex items-center gap-4">
        {/* Global Environment Switcher */}
        <Select
          value={environment}
          onValueChange={(value) => setEnvironment(value as 'cloud' | 'local')}
        >
          <SelectTrigger className="w-[120px] bg-card border-slate-700 focus:ring-slate-500">
            <SelectValue placeholder="Environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cloud">Cloud</SelectItem>
            <SelectItem value="local">Local</SelectItem>
          </SelectContent>
        </Select>

        {/* Notifications */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-slate-400 hover:text-white"
            >
              <Bell className="h-5 w-5" />
              {(data?.recentAlerts?.length ?? 0) > 0 && (
                <span className="absolute top-1 right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[400px] sm:w-[540px] p-0">
            <SheetHeader className="p-4 border-b border-border">
              <SheetTitle>Recent Alerts</SheetTitle>
            </SheetHeader>
            <div className="h-[calc(100vh-4.5rem)] overflow-y-auto">
              {isLoading && (
                <div className="p-4 text-center text-muted-foreground">
                  Loading alerts...
                </div>
              )}
              {!isLoading && (!data || data.recentAlerts.length === 0) && (
                <div className="p-4 text-center text-muted-foreground">
                  No recent alerts.
                </div>
              )}
              {data?.recentAlerts.map((alert) => (
                <AlertItem key={alert.id} alert={alert} />
              ))}
            </div>
          </SheetContent>
        </Sheet>

        {/* Vertical Divider */}
        <div className="h-6 w-px bg-slate-800"></div>

        {/* User Profile Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-10 w-10 rounded-full"
            >
              {isLoading || !data?.user ? (
                <Skeleton className="h-10 w-10 rounded-full" />
              ) : (
                <Avatar className="h-10 w-10">
                  <AvatarImage
                    src={data.user.avatar}
                    alt={data.user.name}
                    data-ai-hint="person face"
                  />
                  <AvatarFallback>
                    {data.user.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </AvatarFallback>
                </Avatar>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end" forceMount>
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {data?.user?.name || 'User'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {data?.user?.email || 'email@example.com'}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </Link>
            </DropdownMenuItem>
            {/* <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem> */}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="focus:bg-destructive/20 focus:text-red-400"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
