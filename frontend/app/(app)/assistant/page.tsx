'use client';

/**
 * Module 11 — AI Environmental Assistant.
 *
 * Retrieval-augmented question answering over the live database. The retrieval
 * half is genuinely implemented — TF-IDF weighting with cosine similarity over
 * a corpus rebuilt from MongoDB — while the generation half composes answers
 * from templates rather than an LLM.
 *
 * That is the honest scope for a prototype, and it buys something a language
 * model would not: every figure in an answer is traceable to the record it
 * came from, and the citations panel shows exactly which documents the
 * retrieval step surfaced and how strongly they matched.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bot, Send, User, Sparkles, Loader2, Database, Clock, Search, RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { useAssistantSuggestions, useAskAssistant } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { Citation } from '@/lib/types';

/** Where a cited entity lives, so a citation can be followed. */
const ENTITY_ROUTES: Record<string, string> = {
  Park: '/map',
  Species: '/biodiversity',
  Asset: '/assets',
  Sensor: '/sensors',
  Incident: '/incidents',
  CitizenReport: '/citizen',
  WorkOrder: '/maintenance',
};

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  intentConfidence?: number;
  citations?: Citation[];
  latencyMs?: number;
  at: Date;
}

const WELCOME: Turn = {
  id: 'welcome',
  role: 'assistant',
  content:
    "I answer questions from the live park database — ecosystem health, air and water quality, " +
    "biodiversity indices, open incidents, maintenance, assets and sensors.\n\n" +
    "Every answer is computed from current records, and I show which documents I drew on. " +
    "Name a park to narrow the scope.",
  at: new Date(),
};

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
  const [turns, setTurns] = useState<Turn[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();

  const suggestions = useAssistantSuggestions();
  const ask = useAskAssistant();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, ask.isPending]);

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || ask.isPending) return;

    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: trimmed, at: new Date() },
    ]);
    setInput('');

    try {
      const response = await ask.mutateAsync({ question: trimmed, sessionId });
      setSessionId(response.sessionId);
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
          at: new Date(),
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
    setTurns([WELCOME]);
    setSessionId(undefined);
  };

  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant' && t.citations?.length);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Environmental Assistant"
        description="Ask about parks, species, air quality, incidents or maintenance in plain language. Answers are computed from live records and cite their sources."
        icon="Bot"
        action={
          turns.length > 1 && (
            <Button variant="outline" onClick={reset}>
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

                <div className={cn('min-w-0 max-w-[85%] space-y-1.5', turn.role === 'user' && 'items-end')}>
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

                  {/* Provenance for the answer. */}
                  {turn.role === 'assistant' && turn.intent && (
                    <div className="flex flex-wrap items-center gap-1.5 px-1">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {turn.intent.replace(/([A-Z])/g, ' $1').trim()}
                      </Badge>
                      {turn.intentConfidence !== undefined && (
                        <span className="text-[10px] text-muted-foreground">
                          intent confidence {(turn.intentConfidence * 100).toFixed(0)}%
                        </span>
                      )}
                      {turn.latencyMs !== undefined && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {turn.latencyMs} ms
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

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
                placeholder="How diverse are the species at Banyan Forest Park?"
                disabled={ask.isPending}
              />
              <Button type="submit" size="icon" disabled={ask.isPending || !input.trim()}>
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
              {(suggestions.data?.suggestions ?? []).map((question) => (
                <button
                  key={question}
                  onClick={() => void send(question)}
                  disabled={ask.isPending}
                  className="w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
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
                Documents the retrieval step surfaced, ranked by TF-IDF cosine similarity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!lastAnswer?.citations?.length ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Ask something and the records behind the answer appear here.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {lastAnswer.citations.map((citation) => (
                    <Link
                      key={`${citation.entity}-${citation.entityId}`}
                      href={ENTITY_ROUTES[citation.entity] ?? '/dashboard'}
                      className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors hover:bg-muted"
                    >
                      <Badge variant="outline" className="shrink-0 text-[9px]">{citation.entity}</Badge>
                      <span className="min-w-0 flex-1 truncate">{citation.label}</span>
                      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                        {citation.score.toFixed(3)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Search className="h-3.5 w-3.5" />
                How it works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                Your question is tokenised, classified into an intent, and matched against a corpus
                rebuilt from the database. Documents are ranked by
              </p>
              <code className="block rounded bg-muted px-2 py-1.5 text-[10px]">
                cos(q,d) = Σ qₜ·dₜ ⁄ (‖q‖₂ · ‖d‖₂)
              </code>
              <p>
                where each weight is tf·idf. Cosine rather than a raw dot product because document
                lengths here vary by an order of magnitude — a species description dwarfs an
                incident title, and without length normalisation the long documents would always win.
              </p>
              <p>
                The answer is then composed from the retrieved records. Figures are read from the
                database, never invented — which is the advantage of this approach over a language
                model at prototype stage.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
