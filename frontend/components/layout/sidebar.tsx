'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Leaf, X, LogIn } from 'lucide-react';
import { cn } from '@/lib/utils';
import { navFor, APP_NAME, APP_TAGLINE } from '@/lib/nav';
import { useAuth } from '@/components/providers/auth-provider';
import { useDashboard } from '@/lib/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  // Navigation is filtered by role, so an officer never sees an admin link
  // they cannot use. The API enforces the same rule independently.
  const items = navFor(user?.role ?? null);
  const groups = Array.from(new Set(items.map((i) => i.group)));

  // The footer reports what is actually being monitored rather than a
  // hard-coded "6 parks" that silently goes stale.
  const { data: overview } = useDashboard();

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Leaf className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <p className="font-display text-base font-bold tracking-tight">{APP_NAME}</p>
          <p className="text-[11px] text-muted-foreground">{APP_TAGLINE}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-auto rounded-md p-1.5 hover:bg-muted lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
        {groups.map((group) => (
          <div key={group} className="mb-5">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group}
            </p>
            <div className="space-y-1">
              {items
                .filter((i) => i.group === group)
                .map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      title={item.description}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                        />
                      )}
                      <item.icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="truncate">{item.label}</span>

                      {/* Live counts on the two queues that need attention. */}
                      {item.href === '/incidents' && (overview?.counts.openIncidents ?? 0) > 0 && (
                        <Badge variant="outline" className="ml-auto h-5 border-destructive/30 bg-destructive/10 px-1.5 text-[10px] text-destructive">
                          {overview!.counts.openIncidents}
                        </Badge>
                      )}
                      {item.href === '/citizen' && (overview?.counts.pendingReports ?? 0) > 0 && (
                        <Badge variant="outline" className="ml-auto h-5 border-warning/30 bg-warning/10 px-1.5 text-[10px] text-warning">
                          {overview!.counts.pendingReports}
                        </Badge>
                      )}
                    </Link>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-3 border-t p-4">
        {/* A signed-out visitor can browse, but the operational modules are
            hidden — so tell them why rather than leaving the gap unexplained. */}
        {!user && (
          <Button asChild size="sm" className="w-full">
            <Link href="/login" onClick={onClose}>
              <LogIn className="mr-2 h-4 w-4" />
              Sign in for full access
            </Link>
          </Button>
        )}

        <div className="rounded-xl bg-gradient-to-br from-primary/10 to-accent/10 p-3.5">
          <p className="text-xs font-semibold text-foreground">Smart City v1.0</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {overview
              ? `${overview.parkRanking.length} parks · ${overview.counts.sensorsOnline} sensors online`
              : 'Connecting…'}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r bg-card lg:block">
        {content}
      </aside>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-y-0 left-0 z-50 w-64 border-r bg-card lg:hidden"
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
