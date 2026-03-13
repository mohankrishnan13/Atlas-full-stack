'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Shield,
  LayoutDashboard,
  Activity,
  Network,
  Laptop,
  Database,
  AlertTriangle,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { icon: LayoutDashboard, label: 'Overview', href: '/overview' },
  { icon: Activity, label: 'API Monitoring', href: '/api-monitoring' },
  { icon: Network, label: 'Network Traffic', href: '/network-traffic' },
  { icon: Laptop, label: 'Endpoint Security', href: '/endpoint-security' },
  // { icon: Database, label: 'Database Monitoring', href: '/database-monitoring' },
  { icon: AlertTriangle, label: 'Case Management', href: '/incidents' },
  { icon: FileText, label: 'Reports', href: '/reports' },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

export function DashboardSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col flex-shrink-0',
        collapsed ? 'w-20' : 'w-[260px]'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
        {!collapsed ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-50">ATLAS</div>
              <div className="text-[10px] text-slate-500 -mt-0.5">Anomaly System</div>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center mx-auto">
            <Shield className="w-5 h-5 text-blue-400" />
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 mb-1 rounded-lg transition-all relative',
                isActive
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r" />
              )}
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <div className="p-2 border-t border-slate-800">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-2 hover:bg-slate-800 rounded-lg transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronLeft className="w-5 h-5 text-slate-400" />
          )}
        </button>
      </div>
    </aside>
  );
}
