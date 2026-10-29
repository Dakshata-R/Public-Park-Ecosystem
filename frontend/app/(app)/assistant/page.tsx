'use client';

/**
 * Module 11 — AI Environmental Assistant.
 *
 * One place to ask what would otherwise take a visit to several tabs: "what is
 * the climate condition of Cubbon Park?", "my high-priority tasks", "how many
 * reviews are pending?". Answers come from read-only lookups against the live
 * database, scoped to the signed-in user's role on the server.
 *
 * Two engines can answer. With a language model configured on the server
 * (GEMINI_API_KEY — free — or Groq, a local model or Claude), the model reads
 * the question (and the conversation so far) and calls those lookups as
 * tools; without one, the built-in engine routes the question by intent and
 * formats the same lookups itself. Each answer says which engine (and
 * provider) produced it, and the Sources panel lists the records behind it.
 *
 * The conversation id is kept in localStorage so a reload restores the thread
 * from `/assistant/history`.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight, Bot, Send, User, Sparkles, Loader2, Database, RotateCcw, RefreshCw, Cpu,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/providers/auth-provider';
import { useAssistantHistory, useAssistantSuggestions, useAskAssistant } from '@/lib/hooks/use-api';
import { cn, llmProviderName } from '@/lib/utils';
import type { AssistantEngine, ChatMessage, Citation, UserRole } from '@/lib/types';

/**
 * The module that holds each cited entity. Citations link to the module page;
 * those pages do not take a record id, so the link cannot open the record itself.
 */
const ENTITY_MODULES: Record<string, { href: string; name: string }> = {
  Park: { href: '/map', name: 'Map' },
  Species: { href: '/biodiversity', name: 'Biodiversity' },
  Observation: { href: '/biodiversity', name: 'Biodiversity' },
  Asset: { href: '/assets', name: 'Assets' },
  Sensor: { href: '/sensors', name: 'Sensors' },
  Incident: { href: '/incidents', name: 'Incidents' },
  CitizenReport: { href: '/citizen', name: 'Citizen portal' },
  WorkOrder: { href: '/maintenance', name: 'Maintenance' },
  AiDetection: { href: '/ai', name: 'AI monitoring' },
};

const FALLBACK_MODULE = { href: '/dashboard', name: 'Dashboard' };

/** Plain names for the server's lookups, shown under each answer. */
const TOOL_LABELS: Record<string, string> = {
  find_parks: 'parks',
  get_park_conditions: 'live conditions',
  get_ecosystem_health: 'ecosystem health',
  get_biodiversity: 'biodiversity',
  search_species: 'species',
  get_sensors: 'sensors',
  get_alerts: 'alerts',
  get_incidents: 'incidents',
  get_maintenance: 'maintenance',
  get_my_tasks: 'your tasks',
  get_pending_reviews: 'review queues',
  get_my_reports: 'your reports',
  search_records: 'search',
};

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
  engine?: AssistantEngine;
  /** Display name of the language model that answered, e.g. "Gemini". */
  providerName?: string;
  toolsUsed?: string[];
  /** When the message was sent or answered. The static welcome has none. */
  at?: Date;
}

/** What the assistant can do for this kind of user, for the opening message. */
const WELCOME_TEXT: Record<UserRole | 'guest', string> = {
  guest:
    'Ask me about the parks instead of opening each tab — for example:\n' +
    '• Current **weather and air quality** at a park\n' +
    '• **Ecosystem health**, species and biodiversity\n' +
    '• Active **alerts** and sensor readings\n\n' +
    'Sign in to ask about your own reports or tasks.',
  citizen:
    'Ask me about the parks instead of opening each tab — for example:\n' +
    '• Current **weather and air quality** at a park, or at your home park\n' +
    '• **Ecosystem health**, species and biodiversity\n' +
    '• The **status of your reports**\n\n' +
    'Partial park names work: "cubbon", "lalbagh".',
  officer:
    'Ask me instead of opening each tab — for example:\n' +
    '• **Your tasks**: "my high priority tasks", "what is overdue for me?"\n' +
    '• **Review queues**: "how many reviews are pending?"\n' +
    '• **Conditions**: "what is the climate condition of Cubbon Park?"\n' +
    '• Incidents, alerts, maintenance, species and park health',
  admin:
    'Ask me instead of opening each tab — for example:\n' +
    '• **Review queues** and **incidents** across all parks\n' +
    '• Anyone\'s tasks: "what is assigned to Rahul Patil?"\n' +
    '• **Conditions**: "what is the climate condition of Cubbon Park?"\n' +
    '• Maintenance, alerts, species and park health',
};

const welcomeFor = (role: UserRole | 'guest'): Turn => ({
  id: 'welcome',
  role: 'assistant',
  content: WELCOME_TEXT[role] ?? WELCOME_TEXT.guest,
});

const asEngine = (value: unknown): AssistantEngine | undefined =>
  value === 'llm' || value === 'claude' || value === 'built-in' ? value : undefined;

/** A language model answered (`claude` is the value on messages stored before providers were pluggable). */
const isLlmEngine = (engine: AssistantEngine | undefined) => engine === 'llm' || engine === 'claude';

/** A stored message as a thread turn. */
const toTurn = (message: ChatMessage): Turn => ({
  id: message.id,
  role: message.role,
  content: message.content,
  intent: message.intent || undefined,
  citations: message.citations,
  latencyMs: message.role === 'assistant' ? message.latencyMs : undefined,
  engine: message.role === 'assistant' ? asEngine(message.engine) : undefined,
  providerName: message.role === 'assistant' ? llmProviderName(message) : undefined,
  toolsUsed: message.toolsUsed,
  at: new Date(message.createdAt),
});

const clock = (date: Date | undefined) =>
  date && !Number.isNaN(date.getTime())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

// ---------------------------------------------------------------------------
// Answer rendering
// ---------------------------------------------------------------------------

/** `**bold**`, `*italic*` and `` `code` `` within one line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.8em]">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block =
  | { kind: 'p' | 'heading' | 'warn'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] };

const BULLET = /^\s*(?:[•\-*·])\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/** Group lines into paragraphs, headings, warnings and lists. */
function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const last = blocks[blocks.length - 1];

    if (BULLET.test(line)) {
      const item = line.replace(BULLET, '');
      if (last?.kind === 'ul') last.items.push(item);
      else blocks.push({ kind: 'ul', items: [item] });
    } else if (NUMBERED.test(line)) {
      const item = line.replace(NUMBERED, '');
      if (last?.kind === 'ol') last.items.push(item);
      else blocks.push({ kind: 'ol', items: [item] });
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') });
    } else if (line.trimStart().startsWith('⚠')) {
      blocks.push({ kind: 'warn', text: line.trim() });
    } else {
      blocks.push({ kind: 'p', text: line.trim() });
    }
  }
  return blocks;
}

/**
 * Light markdown rendering — bold, italics, inline code, bullet and numbered
 * lists, headings and ⚠ warnings — which covers everything either engine is
 * asked to produce, without shipping a markdown parser.
 */
function AnswerText({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {toBlocks(content).map((block, index) => {
        switch (block.kind) {
          case 'ul':
            return (
              <ul key={index} className="space-y-1 pl-4 [&>li]:relative [&>li]:before:absolute [&>li]:before:-left-3 [&>li]:before:text-muted-foreground [&>li]:before:content-['•']">
                {block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={index} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
                {block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}
              </ol>
            );
          case 'heading':
            return <p key={index} className="font-semibold">{inline(block.text)}</p>;
          case 'warn':
            return <p key={index} className="rounded-lg bg-warning/10 px-2.5 py-1.5 text-warning">{inline(block.text)}</p>;
          default:
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}

/** Which engine answered, and what it looked up. */
function AnswerMeta({ turn }: { turn: Turn }) {
  if (!turn.engine) return null;
  const looked = (turn.toolsUsed ?? []).map((t) => TOOL_LABELS[t] ?? t.replace(/_/g, ' '));
  const unique = Array.from(new Set(looked));
  const llm = isLlmEngine(turn.engine);
  const name = turn.providerName ?? 'AI';
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
      <Badge
        variant="outline"
        className={cn(
          'gap-1 px-1.5 py-0 text-[9px] font-medium',
          llm && 'border-primary/40 text-primary'
        )}
        title={llm ? `Answered by ${name} using live lookups` : 'Answered by the built-in engine using live lookups'}
      >
        {llm ? <Sparkles className="h-2.5 w-2.5" /> : <Cpu className="h-2.5 w-2.5" />}
        {llm ? name : 'Built-in engine'}
      </Badge>
      {unique.length > 0 && <span>Looked up {unique.join(', ')}</span>}
    </div>
  );
}

export default function AssistantPage() {
  const { user, loading: authLoading } = useAuth();
  const role: UserRole | 'guest' = user?.role ?? 'guest';
  const storageKey = `${SESSION_STORAGE_PREFIX}.${user?.id ?? 'guest'}`;
  const welcome = welcomeFor(role);

  const [turns, setTurns] = useState<Turn[]>([welcome]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  /** A stored session whose history has not been loaded into the thread yet. */
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const suggestions = useAssistantSuggestions(role);
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
    setTurns([welcomeFor(role)]);
    setSessionId(stored ?? undefined);
    setRestoreId(stored);
  }, [authLoading, storageKey, role]);

  // Replay the stored conversation into the thread.
  useEffect(() => {
    if (!restoreId || !history.data) return;
    if (!history.data.length) {
      // The server no longer knows this session (e.g. the database was reseeded).
      storage.remove(storageKey);
      setSessionId(undefined);
    } else {
      setTurns([welcomeFor(role), ...history.data.map(toTurn)]);
    }
    setRestoreId(null);
  }, [history.data, restoreId, storageKey, role]);

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
          engine: asEngine(response.engine),
          providerName: llmProviderName(response),
          toolsUsed: response.toolsUsed,
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
    setTurns([welcomeFor(role)]);
    setSessionId(undefined);
    setRestoreId(null);
  };

  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant' && t.citations?.length);
  const engine = suggestions.data?.engine;
  const providerName = suggestions.data ? llmProviderName(suggestions.data) : 'AI';

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Environmental Assistant"
        description="Ask about park conditions, your tasks, review queues, species, incidents or maintenance in plain language. Answers come from live records, scoped to your role."
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

                  {turn.role === 'assistant' && <AnswerMeta turn={turn} />}

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
                    {isLlmEngine(engine) ? `${providerName} is looking that up…` : 'Looking that up in the park database…'}
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
                placeholder={
                  role === 'officer' || role === 'admin'
                    ? 'e.g. "my high priority tasks" or "count of pending reviews"'
                    : 'e.g. "what is the climate condition of Cubbon Park?"'
                }
                disabled={ask.isPending || restoring}
                aria-label="Ask the Eco Assistant"
              />
              <Button type="submit" size="icon" disabled={ask.isPending || restoring || !input.trim()} aria-label="Send">
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
              {engine && (
                <CardDescription className="flex items-center gap-1.5 text-xs">
                  {isLlmEngine(engine) ? (
                    <>
                      <Sparkles className="h-3 w-3 text-primary" />
                      Answers by {providerName}, using live lookups.
                    </>
                  ) : (
                    <>
                      <Cpu className="h-3 w-3" />
                      Answers by the built-in engine. A language model takes over once a GEMINI_API_KEY (free) is set on the server.
                    </>
                  )}
                </CardDescription>
              )}
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
                        {/* A search match has a relevance score; a direct lookup is exact. */}
                        {citation.score < 1 && (
                          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground" title="Search relevance">
                            {citation.score.toFixed(3)}
                          </span>
                        )}
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
