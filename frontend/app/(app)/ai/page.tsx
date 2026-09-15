'use client';

/**
 * Module 5 — AI Ecosystem Monitoring.
 *
 * Every result on this page is real inference: a trained MobileNetV2
 * (ImageNet-1k) runs on the server through TensorFlow.js, alongside colour
 * statistics measured over the image's pixels. A general ImageNet network was
 * not trained on park-management categories, so each task pools ImageNet class
 * groups and colour evidence into its own labels — and the page says where
 * that works (fire, foliage colour, wildlife) and where it does not (litter).
 *
 * The full probability vector, the evidence and the network's own top classes
 * are shown, not just the winning label: a finding that is 88% sure is a
 * different thing from one that is 34% sure, and hiding that is how AI
 * features mislead the people relying on them.
 */

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  ScanEye, Upload, CheckCircle2, XCircle, Cpu, ImageIcon, Info, Siren, Leaf, Flower2,
  Bird, Trash2, Flame, LogIn, TriangleAlert, Link2,
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
import { SourceBadge } from '@/components/shared/data-source';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import {
  QueryState, LoadingState, EmptyState, ErrorState, SkeletonCards,
} from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAiTasks, useAiGallery, useAiStats, useAnalyzeImage, useReviewDetection,
} from '@/lib/hooks/use-api';
import { mediaUrl } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { AiDetection, AiTask, AiTaskInfo, AnalyzeResponse } from '@/lib/types';

/** Presentation only — titles, methods and classes come from `GET /ai/tasks`. */
const TASK_ICON: Record<AiTask, typeof ScanEye> = {
  'tree-disease': Leaf,
  'plant-id': Flower2,
  wildlife: Bird,
  waste: Trash2,
  fire: Flame,
};

/**
 * Measured by `npm run eval:vision` over 22 labelled, openly licensed
 * photographs — the same set the task thresholds were calibrated on, so these
 * are optimistic. Update them when the evaluation is re-run.
 */
const MEASURED_ACCURACY: Record<AiTask, { correct: number; total: number }> = {
  fire: { correct: 9, total: 11 },
  'tree-disease': { correct: 3, total: 3 },
  wildlife: { correct: 3, total: 3 },
  'plant-id': { correct: 1, total: 2 },
  waste: { correct: 0, total: 3 },
};
const MEASURED_OVERALL = { correct: 16, total: 22 };

const SEVERITY_TONE: Record<string, string> = {
  low: 'bg-success/15 text-success border-success/30',
  medium: 'bg-warning/15 text-warning border-warning/30',
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  critical: 'bg-destructive/25 text-destructive border-destructive/50',
};

/** Confidence bands from `GET /ai/stats`, coloured by label rather than position. */
const BAND_COLOUR: Record<string, string> = {
  '<50%': 'hsl(var(--destructive))',
  '50–70%': 'hsl(var(--destructive))',
  '70–85%': 'hsl(var(--warning))',
  '85–95%': 'hsl(var(--success))',
  '95–100%': 'hsl(var(--success))',
};

/**
 * Uploads travel inline as base64 data URLs, which are a third larger than
 * the file, and the API's JSON body limit is 8 MB — so 6 MB is the largest
 * file that fits. A production deployment would upload to object storage.
 */
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

/** `fireEvidence` → "Fire evidence". */
function humanise(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Probability masses and pixel fractions read best as percentages; indices do not. */
function formatEvidence(key: string, value: number) {
  if (!Number.isFinite(value)) return '—';
  if (!/index/i.test(key) && value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(3);
}

const pct = (probability: number) => `${(probability * 100).toFixed(1)}%`;
const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
/** ImageNet labels list synonyms ("ashcan, trash can, …"); the first is the name. */
const imagenetName = (label: string) => label.split(',')[0];

export default function AiPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Ecosystem Monitoring"
        description="Image analysis for foliage health, plants and fungi, wildlife, litter and fire — computed by a trained ImageNet network on the server. Every finding goes to human review; only fire and smoke can open an incident automatically."
        icon="ScanEye"
      />

      <Alert className="border-info/20 bg-info/5">
        <Cpu className="h-4 w-4 text-info" />
        <AlertDescription className="space-y-1.5 text-xs leading-relaxed">
          <p>
            <strong>Real inference, with known limits.</strong> Each image is run through
            MobileNetV2 (ImageNet-1k, published by Google via TensorFlow Hub) on the server with
            TensorFlow.js, and its pixel colour statistics are measured. Each task pools groups of
            ImageNet classes and/or colour evidence into its own labels, so a result is a finding for
            a person to review, not a verdict. Only fire and smoke findings can open an incident
            automatically.
          </p>
          <p>
            <strong>Measured accuracy</strong> on {MEASURED_OVERALL.total} labelled photographs:{' '}
            {MEASURED_OVERALL.correct}/{MEASURED_OVERALL.total} (
            {Math.round((100 * MEASURED_OVERALL.correct) / MEASURED_OVERALL.total)}%) overall — fire
            &amp; smoke {MEASURED_ACCURACY.fire.correct}/{MEASURED_ACCURACY.fire.total}, tree &amp;
            foliage health {MEASURED_ACCURACY['tree-disease'].correct}/{MEASURED_ACCURACY['tree-disease'].total},
            wildlife {MEASURED_ACCURACY.wildlife.correct}/{MEASURED_ACCURACY.wildlife.total}, plants{' '}
            {MEASURED_ACCURACY['plant-id'].correct}/{MEASURED_ACCURACY['plant-id'].total}, litter{' '}
            {MEASURED_ACCURACY.waste.correct}/{MEASURED_ACCURACY.waste.total}. These are the same
            photographs the thresholds were calibrated on, so treat the figures as optimistic. Litter detection is weak
            because ImageNet does not recognise litter scenes. Tree health is a colour measurement,
            not a disease diagnosis, and species are named at ImageNet granularity, which does not
            include most Indian species.
          </p>
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="analyze" className="space-y-4">
        <TabsList>
          <TabsTrigger value="analyze">Analyse</TabsTrigger>
          <TabsTrigger value="gallery">Detections</TabsTrigger>
          <TabsTrigger value="models">Model</TabsTrigger>
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

interface UploadedImage {
  dataUrl: string;
  name: string;
  size: number;
}

function AnalyzeTab() {
  const { signedIn, loading: authLoading } = useAuth();
  const tasks = useAiTasks();

  const [task, setTask] = useState<AiTask>('tree-disease');
  const [upload, setUpload] = useState<UploadedImage | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [park, setPark] = useState(ALL_PARKS);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const analyze = useAnalyzeImage();

  const trimmedUrl = imageUrl.trim();
  const previewSrc = upload?.dataUrl ?? (/^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : '');
  const hasImage = Boolean(upload || trimmedUrl);

  const run = async () => {
    if (!hasImage) return;
    try {
      const response = await analyze.mutateAsync({
        task,
        imageUrl: upload ? upload.dataUrl : trimmedUrl,
        imageName: upload ? upload.name : trimmedUrl.split('/').pop()?.split('?')[0] || undefined,
        park: parkParam(park),
      });
      setResult(response);
    } catch {
      /* toast already shown; the message is also rendered below the button */
    }
  };

  /** Read a local JPEG or PNG as a data URL, after checking type and size. */
  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setFileError(null);
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError('Choose a JPEG or PNG image.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(`That file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setUpload({ dataUrl: String(reader.result), name: file.name, size: file.size });
      setImageUrl('');
    };
    reader.onerror = () => setFileError('The file could not be read.');
    reader.readAsDataURL(file);
  };

  const clearUpload = () => {
    setUpload(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* --- Input --- */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Submit an image</CardTitle>
          <CardDescription>Choose the task, then upload a photo or give an image URL</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Task</Label>
            {tasks.isPending ? (
              <LoadingState label="Loading tasks…" className="py-6" />
            ) : tasks.isError ? (
              <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {tasks.data.map((info) => {
                  const Icon = TASK_ICON[info.task] ?? ScanEye;
                  const active = task === info.task;
                  return (
                    <button
                      key={info.task}
                      type="button"
                      onClick={() => setTask(info.task)}
                      className={cn(
                        'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                        active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                      )}
                    >
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{info.title}</p>
                        <p className="text-[11px] text-muted-foreground">{info.method}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="file">Upload a photo</Label>
            <Input
              ref={fileInput}
              id="file"
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={onFile}
            />
            <p className="text-[11px] text-muted-foreground">
              JPEG or PNG, up to {formatBytes(MAX_UPLOAD_BYTES)}. The image is stored with the result.
            </p>
            {fileError && <p className="text-xs text-destructive">{fileError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="imageUrl" className="text-muted-foreground">…or analyse an image URL</Label>
            <Input
              id="imageUrl"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                if (e.target.value) clearUpload();
              }}
              placeholder="https://…"
            />
          </div>

          {previewSrc && (
            <div className="space-y-1">
              <div className="relative h-40 overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied image preview */}
                <img src={previewSrc} alt="Selected image" className="h-full w-full object-contain" />
              </div>
              {upload && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{upload.name} · {formatBytes(upload.size)}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clearUpload}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Park (needed for auto-escalation)</Label>
            <ParkFilter value={park} onChange={setPark} allLabel="Not specified" className="w-full" />
            <p className="text-[11px] text-muted-foreground">
              Without a park an incident has no location, so even a confident fire or smoke finding
              is queued for human review instead of opened automatically.
            </p>
          </div>

          {authLoading ? (
            <Button disabled className="w-full">
              <Cpu className="mr-2 h-4 w-4" />Analyse image
            </Button>
          ) : !signedIn ? (
            <div className="space-y-2 rounded-lg border border-dashed p-3 text-center">
              <p className="text-xs text-muted-foreground">
                Analysis requires an account: every result stores the image and can open an incident,
                so it must be attributable.
              </p>
              <Button asChild className="w-full">
                <Link href="/login?next=/ai"><LogIn className="mr-2 h-4 w-4" />Sign in to analyse</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button onClick={run} disabled={analyze.isPending || !hasImage || tasks.isPending} className="w-full">
                {analyze.isPending ? (
                  <><Cpu className="mr-2 h-4 w-4 animate-pulse" />Running inference…</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" />Analyse image</>
                )}
              </Button>
              {analyze.isError && !analyze.isPending && (
                <p className="text-xs text-destructive">{analyze.error.message}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Result --- */}
      <div className="space-y-4 lg:col-span-3">
        {!result ? (
          <Card>
            <CardContent>
              <EmptyState
                title="No analysis yet"
                description="Choose a task and submit an image. The full probability vector over the task's labels, the evidence behind it and the network's own top ImageNet classes are shown, not just the winning label."
                icon="ScanEye"
              />
            </CardContent>
          </Card>
        ) : (
          <ResultPanel result={result} />
        )}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: AnalyzeResponse }) {
  const { inference, detection, escalationRule, escalated } = result;
  const evidence = Object.entries(inference.evidence ?? {});

  return (
    <>
      <Card className="overflow-hidden">
        {detection.imageUrl && (
          <div className="relative h-64 bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- served by the API host */}
            <img src={mediaUrl(detection.imageUrl)} alt={inference.prediction} className="h-full w-full object-contain" />
            <span className="absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Stored copy · {inference.image.width}×{inference.image.height} {inference.image.format.toUpperCase()} ·{' '}
              {formatBytes(inference.image.bytes)}
            </span>
          </div>
        )}

        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{inference.title}</p>
              <CardTitle className="text-lg">{inference.prediction}</CardTitle>
              {inference.detail && <CardDescription>{inference.detail}</CardDescription>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge variant="outline" className={cn('capitalize', SEVERITY_TONE[inference.severity])}>
                {inference.severity}
              </Badge>
              <SourceBadge source="model" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Confidence</span>
              <span className="text-2xl font-bold tabular-nums">{inference.confidence}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700',
                  inference.confidence >= 85 ? 'bg-success'
                  : inference.confidence >= 60 ? 'bg-warning'
                  : 'bg-destructive'
                )}
                style={{ width: `${inference.confidence}%` }}
              />
            </div>
          </div>

          {/* The full probability vector over the task's labels. */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              Label probabilities
              <span className="text-[11px] font-normal text-muted-foreground">(normalised task scores — sum to 1)</span>
            </p>
            <div className="space-y-1.5">
              {inference.probabilities.map((entry, index) => (
                <div key={entry.label} className="flex items-center gap-2">
                  <span className={cn('min-w-0 flex-1 truncate text-xs', index === 0 && 'font-medium')} title={entry.label}>
                    {entry.label}
                  </span>
                  <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground/40')}
                      style={{ width: `${entry.probability * 100}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {pct(entry.probability)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-primary/5 p-3">
            <p className="text-xs font-medium">Recommended action</p>
            <p className="mt-1 text-sm leading-relaxed">{inference.recommendedAction}</p>
          </div>

          {inference.notes.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <TriangleAlert className="h-3.5 w-3.5" />
                Caveats
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed">
                {inference.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-medium">Evidence</p>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Signals the task score was built from: probability mass on ImageNet class groups, or
                pixel fractions
              </p>
              {evidence.length === 0 ? (
                <p className="text-xs text-muted-foreground">No evidence reported.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {evidence.map(([key, value]) => (
                      <tr key={key} className="border-b last:border-0">
                        <td className="py-1.5 text-muted-foreground">{humanise(key)}</td>
                        <td className="py-1.5 text-right font-medium tabular-nums">{formatEvidence(key, value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Top ImageNet classes</p>
              <p className="mb-2 text-[11px] text-muted-foreground">What the network itself saw, before task pooling</p>
              <table className="w-full text-xs">
                <tbody>
                  {inference.imagenet.map((entry) => (
                    <tr key={entry.label} className="border-b last:border-0">
                      <td className="max-w-0 truncate py-1.5 pr-2" title={entry.label}>{imagenetName(entry.label)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{pct(entry.probability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border p-3 text-[11px] text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">{inference.model.name}</span> ·{' '}
              <span className="font-mono">{inference.model.version}</span>
            </p>
            <p className="mt-0.5">
              {inference.model.source} · {inference.model.inputSize}×{inference.model.inputSize} input · TensorFlow.js
              backend: {inference.model.backend ?? 'not reported'}
            </p>
            <p className="mt-0.5 tabular-nums">
              Fetch {inference.timings.fetchMs} ms · decode {inference.timings.decodeMs} ms · colour statistics{' '}
              {inference.timings.statsMs} ms · inference {inference.timings.inferenceMs} ms
            </p>
          </div>
        </CardContent>
      </Card>

      {/* --- The escalation decision, explained --- */}
      <Card className={cn(escalated && 'border-destructive/40')}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Siren className={cn('h-4 w-4', escalated ? 'text-destructive' : 'text-muted-foreground')} />
            Escalation decision
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{escalationRule.reason}</p>

          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Fire or smoke finding', value: escalationRule.escalatable },
              { label: `Confident (≥ ${escalationRule.confidenceFloor}%)`, value: escalationRule.confident },
              { label: 'Incident opened', value: escalationRule.applied },
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
            Only a fire or smoke finding at or above {escalationRule.confidenceFloor}% confidence, with a
            park selected, opens an incident without review. Every other finding waits in the review
            queue for a person to confirm or correct it.
          </p>

          {escalated && (
            <div className="rounded-lg bg-destructive/10 p-3">
              <p className="text-sm font-medium text-destructive">
                Incident {escalated.referenceCode} opened at {escalated.priority} priority
              </p>
              <Link href="/incidents" className="text-xs text-destructive underline-offset-2 hover:underline">
                View incidents
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function GalleryTab() {
  const { can } = useAuth();
  const [task, setTask] = useState<string>('all');
  const tasks = useAiTasks();
  const gallery = useAiGallery(task === 'all' ? undefined : (task as AiTask));

  const taskInfo = (key: AiTask): AiTaskInfo | undefined => tasks.data?.find((t) => t.task === key);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={task} onValueChange={setTask}>
          <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tasks</SelectItem>
            {tasks.data?.map((info) => (
              <SelectItem key={info.task} value={info.task}>{info.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-muted-foreground">
          The latest 24 detections.{' '}
          {can('ecologist')
            ? 'Confirm a correct call, or mark it wrong and record the label it should have had — reviews produce the observed precision under Performance.'
            : 'Staff review each finding; the reviews produce the observed precision under Performance.'}
        </p>
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
              <DetectionCard
                key={detection.id}
                detection={detection}
                info={taskInfo(detection.task)}
                canReview={can('ecologist')}
              />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function DetectionCard({
  detection,
  info,
  canReview,
}: {
  detection: AiDetection;
  info: AiTaskInfo | undefined;
  canReview: boolean;
}) {
  const parkLabel =
    typeof detection.park === 'object' && detection.park
      ? detection.park.name
      : detection.imageCredit
      ? 'Sample photograph, not from a monitored park'
      : 'No park specified';
  const incident = typeof detection.linkedIncident === 'object' ? detection.linkedIncident : null;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative h-40 bg-muted">
        {detection.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API host
          <img src={mediaUrl(detection.imageUrl)} alt={detection.prediction} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
        <Badge className="absolute left-2 top-2 text-[10px]" variant="secondary">
          {info?.title ?? detection.task}
        </Badge>
        <Badge
          variant="outline"
          className={cn('absolute right-2 top-2 bg-background/80 text-[10px] capitalize', SEVERITY_TONE[detection.severity])}
        >
          {detection.severity}
        </Badge>
      </div>

      <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
        {detection.imageCredit && (
          <p className="text-[10px] leading-snug text-muted-foreground">Photo: {detection.imageCredit}</p>
        )}

        <div>
          <p className="text-sm font-medium leading-snug">{detection.prediction}</p>
          {detection.detail && <p className="text-xs text-muted-foreground">{detection.detail}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {detection.confidence}% confidence · {parkLabel}
          </p>
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground">{detection.recommendedAction}</p>

        {detection.linkedIncident && (
          <Link href="/incidents" className="flex items-center gap-1.5 text-xs text-destructive hover:underline">
            <Link2 className="h-3 w-3" />
            {incident
              ? `Incident ${incident.referenceCode} · ${incident.priority} priority${incident.status ? ` · ${incident.status}` : ''}`
              : 'Linked incident'}
          </Link>
        )}

        <div className="mt-auto space-y-2 border-t pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] capitalize',
                detection.reviewStatus === 'confirmed' && 'border-success/30 bg-success/10 text-success',
                detection.reviewStatus === 'rejected' && 'border-destructive/30 bg-destructive/10 text-destructive'
              )}
            >
              {detection.reviewStatus === 'pending' ? 'Awaiting review' : detection.reviewStatus}
            </Badge>
            {detection.reviewStatus === 'rejected' && detection.correctedLabel && (
              <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={detection.correctedLabel}>
                Should be: {detection.correctedLabel}
              </span>
            )}
          </div>

          {canReview && detection.reviewStatus === 'pending' && (
            <ReviewControls detection={detection} info={info} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Confirm a call, or reject it with the label it should have had. Staff only. */
function ReviewControls({ detection, info }: { detection: AiDetection; info: AiTaskInfo | undefined }) {
  const review = useReviewDetection();
  const [rejecting, setRejecting] = useState(false);
  const [correctedLabel, setCorrectedLabel] = useState('');

  const alternatives = (info?.classes ?? []).map((c) => c.label).filter((label) => label !== detection.prediction);

  const submit = async (verdict: 'confirmed' | 'rejected') => {
    try {
      await review.mutateAsync({
        id: detection.id,
        verdict,
        correctedLabel: verdict === 'rejected' ? correctedLabel : undefined,
      });
      setRejecting(false);
    } catch {
      /* toast already shown */
    }
  };

  if (rejecting) {
    return (
      <div className="space-y-2">
        <Select value={correctedLabel} onValueChange={setCorrectedLabel}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="What does the image show?" /></SelectTrigger>
          <SelectContent>
            {alternatives.map((label) => (
              <SelectItem key={label} value={label} className="text-xs">{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={review.isPending} onClick={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2"
            disabled={review.isPending || !correctedLabel}
            onClick={() => submit('rejected')}
          >
            {review.isPending ? 'Saving…' : 'Record correction'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-success"
        disabled={review.isPending}
        onClick={() => submit('confirmed')}
      >
        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />Correct
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-destructive"
        disabled={review.isPending || alternatives.length === 0}
        title={alternatives.length === 0 ? 'Task labels are unavailable' : undefined}
        onClick={() => { setCorrectedLabel(''); setRejecting(true); }}
      >
        <XCircle className="mr-1 h-3.5 w-3.5" />Wrong
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function ModelsTab() {
  const tasks = useAiTasks();

  return (
    <QueryState query={tasks} isEmpty={(data) => data.length === 0} emptyTitle="No tasks reported" skeleton={<LoadingState label="Loading model card…" />}>
      {(data) => {
        const model = data[0].model;
        return (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{model.name}</CardTitle>
                    <CardDescription className="break-all font-mono text-[11px]">{model.version}</CardDescription>
                  </div>
                  <SourceBadge source="model" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricTile label="Weights" value="ImageNet-1k" hint={model.source} />
                  <MetricTile label="Input" value={`${model.inputSize}×${model.inputSize}`} hint="RGB pixels" />
                  <MetricTile label="Runtime" value="TensorFlow.js" hint={model.backend ? `${model.backend} backend` : 'On the API server'} />
                  <MetricTile
                    label="Measured accuracy"
                    value={`${MEASURED_OVERALL.correct}/${MEASURED_OVERALL.total}`}
                    hint="Labelled photographs, all tasks"
                  />
                </div>
                <div className="flex items-start gap-2.5 rounded-lg border border-dashed p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <p>
                      <strong className="text-foreground">Pipeline.</strong> Decode the JPEG or PNG → resize
                      to {model.inputSize}×{model.inputSize} → MobileNetV2 forward pass → a probability
                      distribution over the 1,000 ImageNet classes. In parallel, colour statistics are
                      measured over the pixels (green, yellow and brown foliage fractions, flame and smoke
                      chromaticity).
                    </p>
                    <p>
                      The network was not trained on park-management categories. Each task below pools
                      ImageNet class groups (for example, all bird classes into one &ldquo;bird&rdquo; signal)
                      and/or colour evidence into scores for its own labels, then normalises them into a
                      probability vector. The weights are fixed, so results are findings for review.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.map((entry) => {
                const Icon = TASK_ICON[entry.task] ?? ScanEye;
                const accuracy = MEASURED_ACCURACY[entry.task];
                return (
                  <Card key={entry.task}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0">
                            <CardTitle className="text-base">{entry.title}</CardTitle>
                            <CardDescription>{entry.method}</CardDescription>
                          </div>
                        </div>
                        {accuracy && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'shrink-0 tabular-nums',
                              accuracy.correct === 0 && 'border-destructive/30 bg-destructive/10 text-destructive'
                            )}
                          >
                            {accuracy.correct}/{accuracy.total} correct
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Labels ({entry.classes.length})
                        {entry.task === 'fire' && ' · can open an incident automatically'}
                      </p>
                      <div className="space-y-1">
                        {entry.classes.map((cls) => (
                          <div key={cls.label} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
                            <span className="min-w-0 truncate text-xs" title={cls.label}>{cls.label}</span>
                            <Badge variant="outline" className={cn('shrink-0 text-[10px] capitalize', SEVERITY_TONE[cls.severity])}>
                              {cls.severity}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

function PerformanceTab() {
  const stats = useAiStats();
  const tasks = useAiTasks();
  const titleFor = (task: AiTask) => tasks.data?.find((t) => t.task === task)?.title ?? task;

  return (
    <QueryState query={stats} skeleton={<SkeletonCards count={4} />}>
      {(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile label="Total detections" value={data.total} />
            <MetricTile label="Awaiting review" value={data.review.pending} tone={data.review.pending > 0 ? 'warning' : undefined} />
            <MetricTile label="Confirmed" value={data.review.confirmed} hint={`${data.review.rejected} marked wrong`} tone="success" />
            <MetricTile
              label="Observed precision"
              value={data.review.precision !== null ? `${data.review.precision}%` : 'No reviews yet'}
              hint={data.review.precision !== null ? 'Confirmed ÷ reviewed' : 'Staff reviews produce this figure'}
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
                <CardDescription>Volume and mean confidence per task</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byTask.length === 0 ? (
                  <EmptyState title="No detections yet" icon="ScanEye" />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.byTask}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="task"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        tickFormatter={(t: AiTask) => titleFor(t)}
                      />
                      <YAxis yAxisId="left" allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(t) => titleFor(t as AiTask)} />
                      <Bar yAxisId="left" dataKey="count" name="Detections" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="avgConfidence" name="Mean confidence %" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Confidence Distribution</CardTitle>
                <CardDescription>
                  Confidence is the share of the task score on the winning label — not a measured
                  accuracy. Low-confidence findings deserve the closest review.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.confidenceDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="band" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Detections" radius={[4, 4, 0, 0]}>
                      {data.confidenceDistribution.map((entry) => (
                        <Cell key={entry.band} fill={BAND_COLOUR[entry.band] ?? 'hsl(var(--muted-foreground))'} />
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
              {data.bySeverity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No findings yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {data.bySeverity.map((row) => (
                    <div key={row.severity} className={cn('rounded-xl border p-4', SEVERITY_TONE[row.severity])}>
                      <p className="text-2xl font-bold tabular-nums">{row.count}</p>
                      <p className="text-xs capitalize">{row.severity}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
