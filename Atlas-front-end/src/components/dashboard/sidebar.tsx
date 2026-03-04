"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShieldCheck,
  LayoutDashboard,
  RadioTower,
  Network,
  Laptop,
  Database,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { NavItem } from '@/lib/types';
import { Sheet, SheetContent, SheetTrigger } from '../ui/sheet';

const navItems: NavItem[] = [
  { title: 'Overview', href: '/overview', icon: LayoutDashboard },
  { title: 'API Monitoring', href: '/api-monitoring', icon: RadioTower },
  { title: 'Network Traffic', href: '/network-traffic', icon: Network },
  { title: 'Endpoint Security', href: '/endpoint-security', icon: Laptop },
  { title: 'Database Monitoring', href: '/database-monitoring', icon: Database },
  { title: 'Incidents', href: '/incidents', icon: ShieldCheck },
  { title: 'Reports', href: '/reports', icon: FileText },
  { title: 'Settings', href: '/settings', icon: Settings },
];

const NavLinks = ({ isCollapsed }: { isCollapsed: boolean }) => {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-2 px-2">
      {navItems.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <TooltipProvider key={item.title} delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant={isActive ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start',
                    isCollapsed && 'justify-center'
                  )}
                >
                  <Link href={item.href}>
                    <item.icon className={cn('h-5 w-5', !isCollapsed && 'mr-3')} />
                    <span className={cn(isCollapsed && 'sr-only')}>{item.title}</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              {isCollapsed && (
                <TooltipContent side="right">
                  <p>{item.title}</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </nav>
  );
};

export function DashboardSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <>
      {/* Mobile Sidebar */}
      <div className="md:hidden sticky top-0 h-16 bg-card border-b border-border flex items-center px-4">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-6 w-6" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 bg-card border-r-0">
             <div className="flex h-full flex-col">
              <div className="h-16 flex items-center px-4 border-b border-border">
                <ShieldCheck className="h-7 w-7 text-primary" />
                <h1 className="ml-2 text-xl font-bold">ATLAS</h1>
              </div>
              <div className="py-4">
                <NavLinks isCollapsed={false} />
              </div>
            </div>
          </SheetContent>
        </Sheet>
         <div className="flex items-center gap-2 ml-4">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <h1 className="text-xl font-bold">ATLAS</h1>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col sticky top-0 h-screen bg-card border-r border-border transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-20' : 'w-64'
        )}
      >
        <div className="flex items-center justify-between h-16 border-b border-border px-4">
          <Link href="/overview" className={cn('flex items-center gap-2 overflow-hidden', isCollapsed && 'justify-center w-full')}>
            <ShieldCheck className="h-7 w-7 text-primary flex-shrink-0" />
            <span className={cn('text-xl font-bold', isCollapsed && 'sr-only')}>ATLAS</span>
          </Link>
        </div>
        <div className="flex-1 py-4 overflow-y-auto">
          <NavLinks isCollapsed={isCollapsed} />
        </div>
        <div className="p-4 border-t border-border">
          <Button variant="ghost" onClick={toggleSidebar} className="w-full justify-center">
            {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            <span className="sr-only">Toggle sidebar</span>
          </Button>
        </div>
      </aside>
    </>
  );
}
