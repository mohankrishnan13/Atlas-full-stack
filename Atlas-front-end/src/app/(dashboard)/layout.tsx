'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardHeader } from '@/components/dashboard/header';
import { AiCopilotWidget } from '@/components/dashboard/ai-copilot-widget';
import { DashboardProviders } from '@/components/dashboard/dashboard-providers';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('atlas_auth_token')
        : null;

    if (!token) {
      router.replace('/login');
    }
  }, [router]);

  return <>{children}</>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProviders>
      <AuthGuard>
        <div className="h-screen flex bg-slate-950 overflow-hidden">
          <DashboardSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <DashboardHeader />
            <main className="flex-1 overflow-auto p-6 bg-slate-950">
              {children}
            </main>
          </div>
          <AiCopilotWidget />
        </div>
      </AuthGuard>
    </DashboardProviders>
  );
}
