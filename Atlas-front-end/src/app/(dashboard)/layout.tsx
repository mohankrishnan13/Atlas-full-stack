'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardHeader } from '@/components/dashboard/header';
import { AiCopilotWidget } from '@/components/dashboard/ai-copilot-widget';
import { DashboardProviders } from '@/components/dashboard/dashboard-providers';

/**
 * Dashboard layout — auth guard.
 *
 * The actual token validation happens inside <AuthProvider>: if /api/auth/me
 * returns 401, apiFetch clears localStorage and redirects to /login.
 *
 * We also do a fast local check here so users with no token are redirected
 * before any dashboard API calls are even attempted.
 */
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
        <div className="min-h-screen w-full flex bg-background">
          <DashboardSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <DashboardHeader />
            <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
              {children}
            </main>
          </div>
          <AiCopilotWidget />
        </div>
      </AuthGuard>
    </DashboardProviders>
  );
}
