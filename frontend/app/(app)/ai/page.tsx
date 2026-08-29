'use client';

/**
 * Module 5 — AI Ecosystem Monitoring.
 *
 * The page is honest about what it is. The inference *contract* is real —
 * preprocessing description, class vocabulary, softmax probability vector,
 * argmax label, severity mapping, auto-escalation rule — but the logits come
 * from a deterministic surrogate rather than trained weights. That was the
 * scope agreed at the Week-6 assessor review, and the interface says so
 * rather than implying a capability that is not there.
 *
 * The full probability vector is shown, not just the winning label: a
 * classifier that is 88% sure is a different thing from one that is 34% sure,
 * and hiding that is how AI features mislead the people relying on them.
 */

import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ScanEye, Upload, Sparkles, TriangleAlert, CheckCircle2, XCircle, Cpu,
  ImageIcon, Info, Siren, FlaskConical,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { MetricTile } from '@/components/shared/score-badge';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, LoadingState, EmptyState, SkeletonCards } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAiTasks, useAiGallery, useAiStats, useAnalyzeImage, useReviewDetection,
} from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { AiTask, AnalyzeResponse } from '@/lib/types';

const TASK_META: Record<AiTask, { label: string; icon: typeof ScanEye; blurb: string }> = {
  'tree-disease': { label: 'Tree Disease', icon: TriangleAlert, blurb: 'Identify infection and decline from foliage and bark' },
  'plant-id': { label: 'Plant ID', icon: Sparkles, blurb: 'Name a plant and flag invasives' },
  wildlife: { label: 'Wildlife', icon: ScanEye, blurb: 'Recognise animals from citizen or camera-trap photos' },
  waste: { label: 'Waste Detection', icon: XCircle, blurb: 'Spot dumping and overflowing bins' },
  fire: { label: 'Fire & Smoke', icon: Siren, blurb: 'Early detection of grass and canopy fire' },
};

const SEVERITY_TONE: Record<string, string> = {
  low: 'bg-success/15 text-success border-success/30',
  medium: 'bg-warning/15 text-warning border-warning/30',
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  critical: 'bg-destructive/25 text-destructive border-destructive/50',
};

/** Sample imagery so the module can be demonstrated without a camera to hand. */
const SAMPLE_IMAGES = [
  'https://images.pexels.com/photos/1671325/pexels-photo-1671325.jpeg',
  'https://images.pexels.com/photos/4653778/pexels-photo-4653778.jpeg',
  'https://images.pexels.com/photos/326900/pexels-photo-326900.jpeg',
  'https://images.pexels.com/photos/2662774/pexels-photo-2662774.jpeg',
  'https://images.pexels.com/photos/2699483/pexels-photo-2699483.jpeg',
];

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

export default function AiPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Ecosystem Monitoring"
        description="Vision analysis for tree disease, plant identification, wildlife recognition, waste and fire — with automatic escalation to an incident when a finding is both dangerous and confident."
        icon="ScanEye"
      />

      <Alert className="border-info/20 bg-info/5">
        <FlaskConical className="h-4 w-4 text-info" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>Prototype-stage models.</strong> The inference pipeline is fully implemented —
          class vocabulary, softmax probability vector, argmax prediction, severity mapping and the
          escalation rule all run for real — but the logits come from a deterministic surrogate
          rather than trained weights. Swapping in a served model is a one-function change; set{' '}
          <code className="rounded bg-muted px-1">AI_MODEL_ENDPOINT</code> and the same code path
          calls it instead.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="analyze" className="space-y-4">
        <TabsList>
          <TabsTrigger value="analyze">Analyse</TabsTrigger>
          <TabsTrigger value="gallery">Detections</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="analyze"><AnalyzeTab /></TabsContent>
        <TabsContent value="gallery"><GalleryTab /></TabsContent>
        <TabsContent value="models"><ModelsTab /></TabsContent>
        <TabsContent value="performance"><PerformanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

function AnalyzeTab() {
  const [task, setTask] = useState<AiTask>('tree-disease');
  const [imageUrl, setImageUrl] = useState(SAMPLE_IMAGES[0]);
  const [park, setPark] = useState(ALL_PARKS);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const analyze = useAnalyzeImage();

  const run = async () => {
    if (!imageUrl.trim()) return;
    const response = await analyze.mutateAsync({
      task,
      imageUrl: imageUrl.trim(),
      imageName: imageUrl.split('/').pop()?.split('?')[0],
      park: parkParam(park),
    });
    setResult(response);
  };

  /**
   * Read a local file as a data URL.
   *
   * Data URLs are sent inline in the request body — which is why the API's
   * JSON body limit is raised to 8 MB. A production deployment would upload
   * to object storage and send a reference instead.
   */
  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* --- Input --- */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Submit an image</CardTitle>
          <CardDescription>Choose the task, then paste a URL or upload a photo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Task</Label>
            <div className="grid grid-cols-1 gap-1.5">
              {(Object.keys(TASK_META) as AiTask[]).map((key) => {
                const meta = TASK_META[key];
                const active = task === key;
                return (
                  <button
                    key={key}
                    onClick={() => setTask(key)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                      active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                    )}
                  >
                    <meta.icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <p className="text-[11px] text-muted-foreground">{meta.blurb}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="imageUrl">Image URL</Label>
            <Input id="imageUrl" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="file">…or upload</Label>
            <Input id="file" type="file" accept="image/*" onChange={onFile} />
          </div>

          <div className="space-y-1.5">
            <Label>Park (needed for auto-escalation)</Label>
            <ParkFilter value={park} onChange={setPark} allLabel="Not specified" className="w-full" />
            <p className="text-[11px] text-muted-foreground">
              Without a park an incident has no location, so a dangerous finding is queued for human
              review instead of opened automatically.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sample images</Label>
            <div className="flex gap-1.5">
              {SAMPLE_IMAGES.map((url) => (
                <button
                  key={url}
                  onClick={() => setImageUrl(url)}
                  className={cn(
                    'h-12 w-12 overflow-hidden rounded-lg border-2 transition-all',
                    imageUrl === url ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Sample" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          <Button onClick={run} disabled={analyze.isPending || !imageUrl.trim()} className="w-full">
            {analyze.isPending ? (
              <><Cpu className="mr-2 h-4 w-4 animate-pulse" />Running inference…</>
            ) : (
              <><Upload className="mr-2 h-4 w-4" />Analyse image</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* --- Result --- */}
      <div className="space-y-4 lg:col-span-3">
        {imageUrl && (
          <Card className="overflow-hidden">
            <div className="relative h-64 bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Submitted" className="h-full w-full object-cover" />
            </div>
          </Card>
        )}

        {!result ? (
          <Card>
            <CardContent>
              <EmptyState
                title="No analysis yet"
                description="Choose a task and submit an image. The full class-probability vector is shown, not just the winning label."
                icon="ScanEye"
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-lg">{result.inference.prediction}</CardTitle>
                    <CardDescription>
                      {result.inference.model.name} {result.inference.model.version} ·{' '}
                      {result.inference.model.backbone} · {result.inference.inferenceMs} ms
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 capitalize', SEVERITY_TONE[result.inference.severity])}>
                    {result.inference.severity}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Confidence</span>
                    <span className="text-2xl font-bold tabular-nums">{result.inference.confidence}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        result.inference.confidence >= 85 ? 'bg-success'
                        : result.inference.confidence >= 60 ? 'bg-warning'
                        : 'bg-destructive'
                      )}
                      style={{ width: `${result.inference.confidence}%` }}
                    />
                  </div>
                </div>

                {/* The full softmax output. */}
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    Class probabilities
                    <span className="text-[11px] font-normal text-muted-foreground">
                      (softmax — sums to 1)
                    </span>
                  </p>
                  <div className="space-y-1.5">
                    {result.inference.probabilities.map((entry, index) => (
                      <div key={entry.label} className="flex items-center gap-2">
                        <span className={cn('min-w-0 flex-1 truncate text-xs', index === 0 && 'font-medium')}>
                          {entry.label}
                        </span>
                        <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground/40')}
                            style={{ width: `${entry.probability * 100}%` }}
                          />
                        </div>
                        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                          {(entry.probability * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-primary/5 p-3">
                  <p className="text-xs font-medium">Recommended action</p>
                  <p className="mt-1 text-sm leading-relaxed">{result.inference.recommendedAction}</p>
                </div>
              </CardContent>
            </Card>

            {/* --- The escalation decision, explained --- */}
            <Card className={cn(result.escalated && 'border-destructive/40')}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Siren className={cn('h-4 w-4', result.escalated ? 'text-destructive' : 'text-muted-foreground')} />
                  Escalation decision
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{result.escalationRule.reason}</p>

                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: 'Dangerous', value: result.escalationRule.dangerous },
                    { label: 'Confident', value: result.escalationRule.confident },
                    { label: 'Escalated', value: result.escalationRule.applied },
                  ].map((check) => (
                    <div key={check.label} className="rounded-lg border p-2.5">
                      {check.value ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-success" />
                      ) : (
                        <XCircle className="mx-auto h-4 w-4 text-muted-foreground" />
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">{check.label}</p>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  A high or critical finding opens an incident automatically only above{' '}
                  {result.escalationRule.confidenceFloor}% confidence. Below the floor it is queued
                  for a human, because a false fire alarm is expensive.
                </p>

                {result.escalated && (
                  <div className="rounded-lg bg-destructive/10 p-3">
                    <p className="text-sm font-medium text-destructive">
                      Incident {result.escalated.referenceCode} opened at {result.escalated.priority} priority
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function GalleryTab() {
  const { can } = useAuth();
  const [task, setTask] = useState<string>('all');
  const gallery = useAiGallery(task === 'all' ? undefined : (task as AiTask));
  const review = useReviewDetection();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={task} onValueChange={setTask}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tasks</SelectItem>
            {(Object.keys(TASK_META) as AiTask[]).map((key) => (
              <SelectItem key={key} value={key}>{TASK_META[key].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {can('ecologist') && (
          <p className="text-xs text-muted-foreground">
            Confirming or overturning a prediction builds the ground-truth set a retraining
            pipeline would consume.
          </p>
        )}
      </div>

      <QueryState
        query={gallery}
        isEmpty={(data) => data.length === 0}
        emptyTitle="No detections yet"
        emptyIcon="ScanEye"
        skeleton={<LoadingState label="Loading detections…" />}
      >
        {(detections) => (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {detections.map((detection) => (
              <Card key={detection.id} className="overflow-hidden">
                <div className="relative h-40 bg-muted">
                  {detection.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={detection.imageUrl} alt={detection.prediction} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <Badge className="absolute left-2 top-2 text-[10px]" variant="secondary">
                    {TASK_META[detection.task]?.label ?? detection.task}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn('absolute right-2 top-2 text-[10px] capitalize', SEVERITY_TONE[detection.severity])}
                  >
                    {detection.severity}
                  </Badge>
                </div>

                <CardContent className="space-y-2.5 p-4">
                  <div>
                    <p className="text-sm font-medium leading-snug">{detection.prediction}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {detection.confidence}% confidence ·{' '}
                      {typeof detection.park === 'object' && detection.park ? detection.park.name : 'No park'}
                    </p>
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground">{detection.recommendedAction}</p>

                  <div className="flex items-center justify-between gap-2 border-t pt-2.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] capitalize',
                        detection.reviewStatus === 'confirmed' && 'border-success/30 bg-success/10 text-success',
                        detection.reviewStatus === 'rejected' && 'border-destructive/30 bg-destructive/10 text-destructive'
                      )}
                    >
                      {detection.reviewStatus}
                    </Badge>

                    {can('ecologist') && detection.reviewStatus === 'pending' && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-success"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: detection.id, verdict: 'confirmed' })}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Correct
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: detection.id, verdict: 'rejected' })}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" />Wrong
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function ModelsTab() {
  const tasks = useAiTasks();

  return (
    <QueryState query={tasks} skeleton={<LoadingState label="Loading model cards…" />}>
      {(data) => (
        <div className="space-y-4">
          <Card className="border-dashed">
            <CardContent className="flex items-start gap-2.5 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <p>
                  <strong className="text-foreground">Intended production pipeline.</strong> Decode →
                  resize to 224×224 → normalise to ImageNet mean/σ → frozen backbone → global average
                  pooling → dropout(0.2) → dense head of C classes → softmax.
                </p>
                <p>
                  Transfer learning rather than training from scratch: the few thousand labelled
                  images a municipal deployment can realistically gather are far too few to train a
                  network from nothing, but ample to fine-tune a head on ImageNet features.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.map((entry) => (
              <Card key={entry.task}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{entry.model.name}</CardTitle>
                      <CardDescription>
                        {entry.model.backbone} · {entry.model.version} · {entry.model.inputSize}×{entry.model.inputSize} input
                      </CardDescription>
                    </div>
                    <Badge variant="outline">{TASK_META[entry.task]?.label ?? entry.task}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Output classes ({entry.classes.length})
                  </p>
                  <div className="space-y-1">
                    {entry.classes.map((cls) => (
                      <div key={cls.label} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
                        <span className="min-w-0 truncate text-xs">{cls.label}</span>
                        <Badge variant="outline" className={cn('shrink-0 text-[10px] capitalize', SEVERITY_TONE[cls.severity])}>
                          {cls.severity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function PerformanceTab() {
  const stats = useAiStats();

  return (
    <QueryState query={stats} skeleton={<SkeletonCards count={4} />}>
      {(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile label="Total detections" value={data.total} />
            <MetricTile label="Awaiting review" value={data.review.pending} tone={data.review.pending > 0 ? 'warning' : undefined} />
            <MetricTile label="Confirmed" value={data.review.confirmed} tone="success" />
            <MetricTile
              label="Observed precision"
              value={data.review.precision !== null ? `${data.review.precision}%` : '—'}
              hint={data.review.precision !== null ? 'Confirmed ÷ reviewed' : 'No reviews yet'}
              tone={
                data.review.precision === null ? undefined
                : data.review.precision >= 80 ? 'success'
                : data.review.precision >= 60 ? 'warning'
                : 'destructive'
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Detections by Task</CardTitle>
                <CardDescription>Volume and mean confidence per model</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byTask}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="task"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      tickFormatter={(t: AiTask) => TASK_META[t]?.label ?? t}
                    />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar yAxisId="left" dataKey="count" name="Detections" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="avgConfidence" name="Mean confidence %" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Confidence Distribution</CardTitle>
                <CardDescription>
                  A model producing mostly low-confidence output needs retraining, not more data
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.confidenceDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="band" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Detections" radius={[4, 4, 0, 0]}>
                      {data.confidenceDistribution.map((entry, index) => (
                        <Cell
                          key={entry.band}
                          fill={
                            index >= 3 ? 'hsl(var(--success))'
                            : index === 2 ? 'hsl(var(--warning))'
                            : 'hsl(var(--destructive))'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Findings by Severity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {data.bySeverity.map((row) => (
                  <div key={row.severity} className={cn('rounded-xl border p-4', SEVERITY_TONE[row.severity])}>
                    <p className="text-2xl font-bold tabular-nums">{row.count}</p>
                    <p className="text-xs capitalize">{row.severity}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
