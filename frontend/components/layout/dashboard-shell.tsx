'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Navbar } from './navbar';
import { usePublicSettings } from '@/lib/hooks/use-api';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-h-screen flex-col lg:pl-64">
        <Navbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-6 lg:py-8">
          {children}
        </main>
        <ShellFooter />
      </div>
    </div>
  );
}

/**
 * Data attribution, required by the licences of the open sources the
 * application is built on.
 */
function ShellFooter() {
  // The organisation name is optional decoration; a failed or pending
  // request simply leaves it out.
  const { data: settings } = usePublicSettings();
  const organisation = settings?.organisationName?.trim();

  return (
    <footer className="border-t px-4 py-3 lg:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {organisation && (
          <>
            <span className="font-medium text-foreground/80">{organisation}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span>
          Data: ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="hover:underline">
            OpenStreetMap contributors
          </a>
        </span>
        <span aria-hidden>·</span>
        <a href="https://www.gbif.org" target="_blank" rel="noreferrer" className="hover:underline">GBIF.org</a>
        <span aria-hidden>·</span>
        <a href="https://open-meteo.com" target="_blank" rel="noreferrer" className="hover:underline">Open-Meteo.com (CAMS)</a>
      </div>
    </footer>
  );
}
