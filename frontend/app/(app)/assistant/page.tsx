'use client';

/**
 * Module 11 — AI Environmental Assistant.
 *
 * Retrieval-augmented question answering over the live database. The retrieval
 * half is genuinely implemented — TF-IDF weighting with cosine similarity over
 * a corpus rebuilt from the database — while the generation half composes
 * answers from templates rather than an LLM.
 *
 * That is the honest scope for a prototype, and it buys something a language
 * model would not: every figure in an answer is traceable to the record it
 * came from, and the citations panel shows exactly which documents the
 * retrieval step surfaced and how strongly they matched.
 *
 * The conversation id is kept in localStorage so a reload restores the thread
 * from `/assistant/history`.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, Bot, Send, User, Sparkles, Loader2, Database, RotateCcw, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/providers/auth-provider';
import { useAssistantHistory, useAssistantSuggestions, useAskAssistant } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { ChatMessage, Citation } from '@/lib/types';

/**
 * The module that holds each cited entity. Citations link to the module page;
 * those pages do not take a record id, so the link cannot open the record itself.
 */
const ENTITY_MODULES: Record<string, { href: string; name: string }> = {
  Park: { href: '/map', name: 'Map' },
  Species: { href: '/biodiversity', name: 'Biodiversity' },
  Asset: { href: '/assets', name: 'Assets' },
  Sensor: { href: '/sensors', name: 'Sensors' },
  Incident: { href: '/incidents', name: 'Incidents' },
  CitizenReport: { href: '/citizen', name: 'Citizen portal' },
  WorkOrder: { href: '/maintenance', name: 'Maintenance' },
};

const FALLBACK_MODULE = { href: '/dashboard', name: 'Dashboard' };

const SESSION_STORAGE_PREFIX = 'greenpulse.assistant.session';

const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null; // private browsing, storage disabled
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  intentConfidence?: number;
  citations?: Citation[];
  latencyMs?: number;
  /** When the message was sent or answered. The static welcome has none. */
  at?: Date;
}

const WELCOME: Turn = {
  id: 'welcome',
  role: 'assistant',
  content:
    "I answer questions from the live park database — ecosystem health, air and water quality, " +
    "biodiversity indices, open incidents, maintenance, assets and sensors.\n\n" +
    "Every answer is computed from current records, and I show which documents I drew on. " +
    "Name a park to narrow the scope.",
};

/** A stored message as a thread turn. */
const toTurn = (message: ChatMessage): Turn => ({
  id: message.id,
  role: message.role,
  content: message.content,
  intent: message.intent || undefined,
  citations: message.citations,
  latencyMs: message.role === 'assistant' ? message.latencyMs : undefined,
  at: new Date(message.createdAt),
});

const clock = (date: Date | undefined) =>
  date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

/**
 * Minimal markdown rendering: `**bold**`, bullet lines, and paragraph breaks.
 *
 * A full markdown library would be overkill — the answer templates only ever
 * emit these three constructs, and rendering them inline avoids shipping a
 * parser for a handful of asterisks.
 */
function AnswerText({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {content.split('\n').map((line, index) => {
        if (!line.trim()) return null;

        const bold = line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
          ) : (
            <span key={i}>{part}</span>
          )
        );

        if (line.trimStart().startsWith('•')) {
          return (
            <p key={index} className="pl-3 -indent-3">{bold}</p>
          );
        }
        if (line.trimStart().startsWith('⚠')) {
          return (
            <p key={index} className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-warning">{bold}</p>
          );
        }
        return <p key={index}>{bold}</p>;
      })}
    </div>
  );
}

export default function AssistantPage() {
  const { user, loading: authLoading } = useAuth();
  const storageKey = `${SESSION_STORAGE_PREFIX}.${user?.id ?? 'guest'}`;

  const [turns, setTurns] = useState<Turn[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  /** A stored session whose history has not been loaded into the thread yet. */
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const suggestions = useAssistantSuggestions();
  const history = useAssistantHistory(restoreId);
  const ask = useAskAssistant();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pick up this account's stored conversation once the session is known —
  // and again only if a different account signs in.
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading || loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    const stored = storage.get(storageKey);
    setTurns([WELCOME]);
    setSessionId(stored ?? undefined);
    setRestoreId(stored);
  }, [authLoading, storageKey]);

  // Replay the stored conversation into the thread.
  useEffect(() => {
    if (!restoreId || !history.data) return;
    if (!history.data.length) {
      // The server no longer knows this session (e.g. the database was reseeded).
      storage.remove(storageKey);
      setSessionId(undefined);
    } else {
      setTurns([WELCOME, ...history.data.map(toTurn)]);
    }
    setRestoreId(null);
  }, [history.data, restoreId, storageKey]);

  const restoring = Boolean(restoreId) && history.isPending;
  const restoreFailed = Boolean(restoreId) && history.isError;

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, ask.isPending]);

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || ask.isPending || restoring) return;

    // Asking carries on in the stored session even if its earlier turns could not be shown.
    setRestoreId(null);
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: trimmed, at: new Date() },
    ]);
    setInput('');

    try {
      const response = await ask.mutateAsync({ question: trimmed, sessionId });
      setSessionId(response.sessionId);
      storage.set(storageKey, response.sessionId);
      setTurns((prev) => [
        ...prev,
        {
          id: response.message.id,
          role: 'assistant',
          content: response.message.content,
          intent: response.intent,
          intentConfidence: response.intentConfidence,
          citations: response.citations,
          latencyMs: response.latencyMs,
          at: new Date(response.message.createdAt),
        },
      ]);
    } catch (error) {
      // A failed request must not swallow the user's question — say so in the
      // thread rather than only in a toast that disappears.
      setTurns((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content:
            error instanceof Error && error.message
              ? `I could not answer that: ${error.message}`
              : 'I could not reach the park database. Please try again.',
          at: new Date(),
        },
      ]);
    }
  };

  const reset = () => {
    storage.remove(storageKey);
    setTurns([WELCOME]);
    setSessionId(undefined);
    setRestoreId(null);
  };

  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant' && t.citations?.length);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Environmental Assistant"
        description="Ask about parks, species, air quality, incidents or maintenance in plain language. Answers are computed from live records and cite their sources."
        icon="Bot"
        action={
          (turns.length > 1 || sessionId) && (
            <Button variant="outline" onClick={reset} disabled={ask.isPending}>
              <RotateCcw className="mr-2 h-4 w-4" />
              New conversation
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* --- Conversation --- */}
        <Card className="flex h-[640px] flex-col lg:col-span-2">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
            {turns.map((turn) => (
              <div key={turn.id} className={cn('flex gap-3', turn.role === 'user' && 'flex-row-reverse')}>
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    turn.role === 'assistant' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {turn.role === 'assistant' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>

                <div className={cn('flex min-w-0 max-w-[85%] flex-col space-y-1.5', turn.role === 'user' && 'items-end')}>
                  <div
                    className={cn(
                      'rounded-2xl px-4 py-2.5',
                      turn.role === 'assistant' ? 'bg-muted' : 'bg-primary text-primary-foreground'
                    )}
                  >
                    {turn.role === 'assistant' ? (
                      <AnswerText content={turn.content} />
                    ) : (
                      <p className="text-sm">{turn.content}</p>
                    )}
                  </div>

                  {clock(turn.at) && (
                    <span className="px-1 text-[10px] tabular-nums text-muted-foreground">{clock(turn.at)}</span>
                  )}
                </div>
              </div>
            ))}

            {restoring && (
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Restoring your previous conversation…
              </div>
            )}

            {restoreFailed && (
              <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                <span>Your previous conversation could not be loaded{history.error?.message ? `: ${history.error.message}` : '.'}</span>
                <Button variant="ghost" size="sm" className="h-7" onClick={() => void history.refetch()}>
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Try again
                </Button>
              </div>
            )}

            {ask.isPending && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Retrieving from the park database…
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3">
            <form
              onSubmit={(e) => { e.preventDefault(); void send(input); }}
              className="flex gap-2"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="How diverse are the species recorded at Lalbagh?"
                disabled={ask.isPending || restoring}
              />
              <Button type="submit" size="icon" disabled={ask.isPending || restoring || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </Card>

        {/* --- Sidebar --- */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Try asking
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {suggestions.isPending ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)
              ) : suggestions.isError ? (
                <div className="space-y-2 py-2 text-center text-xs text-muted-foreground">
                  <p>Suggestions could not be loaded{suggestions.error?.message ? `: ${suggestions.error.message}` : '.'}</p>
                  <Button variant="outline" size="sm" onClick={() => void suggestions.refetch()}>
                    <RefreshCw className="mr-1.5 h-3 w-3" />
                    Try again
                  </Button>
                </div>
              ) : !suggestions.data.suggestions.length ? (
                <p className="py-2 text-center text-xs text-muted-foreground">No suggestions available.</p>
              ) : (
                suggestions.data.suggestions.map((question) => (
                  <button
                    key={question}
                    onClick={() => void send(question)}
                    disabled={ask.isPending || restoring}
                    className="w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                  >
                    {question}
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* Citations from the most recent answer. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                Sources
              </CardTitle>
              <CardDescription className="text-xs">
                The records this answer was built from. Each link opens the module that holds it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!lastAnswer?.citations?.length ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Ask something and the records behind the answer appear here.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {lastAnswer.citations.map((citation) => {
                    const target = ENTITY_MODULES[citation.entity] ?? FALLBACK_MODULE;
                    return (
                      <Link
                        key={`${citation.entity}-${citation.entityId}`}
                        href={target.href}
                        title={`Open the ${target.name} module`}
                        className="group flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors hover:bg-muted"
                      >
                        <Badge variant="outline" className="shrink-0 text-[9px]">{citation.entity}</Badge>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{citation.label || 'Unnamed record'}</span>
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            Opens {target.name}
                            <ArrowUpRight className="h-2.5 w-2.5" />
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                          {citation.score.toFixed(3)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
