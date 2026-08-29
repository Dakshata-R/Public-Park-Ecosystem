'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun, Menu, Bell, Search, LogIn, Loader2, CornerDownLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers/auth-provider';
import { useAlerts, useAcknowledgeAlert } from '@/lib/hooks/use-api';
import { assistantApi } from '@/lib/api/endpoints';
import { cn } from '@/lib/utils';

/** Where each searchable entity type lives, so a hit can be linked. */
const ENTITY_ROUTES: Record<string, string> = {
  Park: '/map',
  Species: '/biodiversity',
  Asset: '/assets',
  Sensor: '/sensors',
  Incident: '/incidents',
  CitizenReport: '/citizen',
  WorkOrder: '/maintenance',
};

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

const relativeTime = (iso: string) => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
};

/**
 * Global search, backed by the assistant's TF-IDF retrieval endpoint.
 *
 * The same ranking that cites sources in the chat answers powers this box —
 * one retrieval implementation serving two features rather than a separate
 * search index that could drift out of agreement with it.
 */
function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ entity: string; id: string; label: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced so a five-word query is one request, not five.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const hits = await assistantApi.search(trimmed, 6);
        if (!cancelled) {
          setResults(hits);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setResults([]); // search failing must not break the page
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close when focus leaves the whole control, not just the input, so a click
  // on a result still registers.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative hidden flex-1 max-w-md md:block">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Search parks, species, incidents…"
        className="pl-9"
      />
      {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}

      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border bg-popover shadow-lg">
          {results.map((hit) => (
            <Link
              key={`${hit.entity}-${hit.id}`}
              href={ENTITY_ROUTES[hit.entity] ?? '/dashboard'}
              onClick={() => { setOpen(false); setQuery(''); }}
              className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted"
            >
              <Badge variant="outline" className="shrink-0 text-[10px]">{hit.entity}</Badge>
              <span className="min-w-0 flex-1 truncate">{hit.label}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {hit.score.toFixed(2)}
              </span>
            </Link>
          ))}
          <Link
            href="/assistant"
            onClick={() => { setOpen(false); setQuery(''); }}
            className="flex items-center gap-2 border-t bg-muted/40 px-3 py-2 text-xs font-medium text-primary hover:bg-muted"
          >
            <CornerDownLeft className="h-3 w-3" />
            Ask the Eco Assistant instead
          </Link>
        </div>
      )}
    </div>
  );
}

export function Navbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { user, signedIn, logout, can } = useAuth();
  const router = useRouter();

  const { data: alerts } = useAlerts({ status: 'active', limit: 6 });
  const acknowledge = useAcknowledgeAlert();

  // next-themes resolves on the client only; rendering the icon before mount
  // would produce a hydration mismatch.
  useEffect(() => setMounted(true), []);

  const activeCount = alerts?.meta.total ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur-md lg:px-6">
      <Button variant="ghost" size="icon" onClick={onMenuClick} className="lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
        >
          {mounted && theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-5 w-5" />
              {activeCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96">
            <DropdownMenuLabel className="flex items-center justify-between">
              Active Alerts
              <Badge variant="secondary" className="text-xs">{activeCount} active</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {!alerts?.items.length ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing needs attention right now.
              </div>
            ) : (
              alerts.items.map((alert) => (
                <DropdownMenuItem
                  key={alert.id}
                  className="flex flex-col items-start gap-1 py-2.5"
                  // Acknowledging from here saves a trip to the incidents page
                  // for the common case of "seen it, working on it".
                  onSelect={(e) => {
                    e.preventDefault();
                    if (can('officer')) acknowledge.mutate(alert.id);
                  }}
                >
                  <div className="flex w-full items-start gap-2">
                    <span
                      className={cn(
                        'mt-1 h-2 w-2 shrink-0 rounded-full',
                        alert.severity === 'critical' || alert.severity === 'high'
                          ? 'bg-destructive'
                          : alert.severity === 'medium'
                          ? 'bg-warning'
                          : 'bg-muted-foreground'
                      )}
                    />
                    <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{alert.title}</span>
                  </div>
                  <span className="pl-4 text-xs text-muted-foreground">
                    {typeof alert.park === 'object' && alert.park ? `${alert.park.name} · ` : ''}
                    {alert.module} · {relativeTime(alert.createdAt)}
                    {alert.occurrences > 1 && ` · ×${alert.occurrences}`}
                  </span>
                </DropdownMenuItem>
              ))
            )}

            <DropdownMenuSeparator />
            <Link href="/incidents" className="block">
              <DropdownMenuItem className="cursor-pointer justify-center text-sm font-medium text-primary">
                View the incident queue
              </DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>

        {signedIn && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-1 flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-muted">
                <Avatar className="h-8 w-8 border">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:block">{user.name.split(' ')[0]}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{user.name}</span>
                  <span className="text-xs capitalize text-muted-foreground">{user.role}</span>
                  <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{user.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {can('admin') && (
                <Link href="/admin">
                  <DropdownMenuItem className="cursor-pointer">Administration</DropdownMenuItem>
                </Link>
              )}
              <Link href="/citizen">
                <DropdownMenuItem className="cursor-pointer">My contributions</DropdownMenuItem>
              </Link>
              <Link href="/settings">
                <DropdownMenuItem className="cursor-pointer">Settings</DropdownMenuItem>
              </Link>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={logout}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button size="sm" onClick={() => router.push('/login')} className="ml-1">
            <LogIn className="mr-1.5 h-4 w-4" />
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
