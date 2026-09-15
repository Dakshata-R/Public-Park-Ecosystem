'use client';

/**
 * Module 7 — Citizen Engagement Portal.
 *
 * The flow this page implements end to end:
 *
 *   citizen submits → officer reviews → accepted
 *                                        ├─ issue    → Incident opened
 *                                        └─ sighting → verified Observation
 *
 * Acceptance is the single gate where public input enters the operational and
 * scientific record. Keeping it in one handler — rather than spread across the
 * incident and biodiversity modules — is what makes the citizen-to-resolution
 * trail auditable.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Megaphone, Plus, ThumbsUp, MessageSquare, Bird, Lightbulb, TriangleAlert,
  CheckCircle2, XCircle, MapPin, Loader2, Trophy, LogIn, Ban,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { StatusBadge } from '@/components/shared/status-badges';
import { MetricTile, NO_DATA } from '@/components/shared/score-badge';
import { SourceBadge } from '@/components/shared/data-source';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useCitizenReports, useCitizenStats, useMyReports, useMyUpvotes, useParks, usePublicSettings, useSpeciesList,
  useCreateReport, useUpvoteReport, useReviewReport,
} from '@/lib/hooks/use-api';
import { makePoint } from '@/lib/api/geo';
import { ApiError, mediaUrl } from '@/lib/api/client';
import { integrationApi } from '@/lib/api/endpoints';
import { cn } from '@/lib/utils';
import type { CitizenReport, ReportCategory, Species } from '@/lib/types';

const CATEGORY_META: Record<ReportCategory, { label: string; icon: typeof Megaphone; tone: string }> = {
  issue: { label: 'Issue', icon: TriangleAlert, tone: 'text-destructive' },
  'wildlife-sighting': { label: 'Wildlife sighting', icon: Bird, tone: 'text-success' },
  feedback: { label: 'Feedback', icon: MessageSquare, tone: 'text-info' },
  suggestion: { label: 'Suggestion', icon: Lightbulb, tone: 'text-warning' },
};

const INCIDENT_TYPES = [
  'tree-fall', 'illegal-dumping', 'fire', 'water-pollution',
  'dead-animal', 'vandalism', 'infrastructure-damage', 'air-pollution',
];

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

const reportSchema = z
  .object({
    category: z.enum(['issue', 'wildlife-sighting', 'feedback', 'suggestion']),
    title: z.string().min(4, 'Give the report a descriptive title').max(200),
    description: z.string().min(10, 'Please describe it in at least 10 characters').max(2000),
    park: z.string().min(1, 'Select a park'),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    species: z.string().optional(),
  })
  // The API rejects [0, 0]; say so before the request rather than after.
  .refine((v) => !(v.lat === 0 && v.lng === 0), { message: 'Pick a location — choose a park to use its centre', path: ['lat'] });

type ReportValues = z.infer<typeof reportSchema>;

type PortalTab = 'reports' | 'mine' | 'impact';
const PORTAL_TABS: PortalTab[] = ['reports', 'mine', 'impact'];
const tabFromParam = (value: string | null): PortalTab =>
  PORTAL_TABS.includes(value as PortalTab) ? (value as PortalTab) : 'reports';

const parkName = (park: CitizenReport['park']) => (typeof park === 'object' && park ? park.name : '');
/** About 108 catalogued species have no English common name. */
const speciesLabel = (species: Pick<Species, 'commonName' | 'scientificName'>) =>
  species.commonName || species.scientificName;

/**
 * `useSearchParams()` opts a route out of static rendering unless it is read
 * inside a Suspense boundary, so the portal lives in its own component.
 */
export default function CitizenPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading the citizen portal…" />}>
      <CitizenPortal />
    </Suspense>
  );
}

function CitizenPortal() {
  const { signedIn, can, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');

  // `?tab=mine` (the navbar's "My contributions" link) opens that tab directly.
  const [tab, setTab] = useState<PortalTab>(() => tabFromParam(tabParam));
  useEffect(() => {
    setTab(tabFromParam(tabParam));
  }, [tabParam]);

  const changeTab = (value: string) => {
    const next = tabFromParam(value);
    setTab(next);
    router.replace(next === 'reports' ? '/citizen' : `/citizen?tab=${next}`, { scroll: false });
  };

  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<CitizenReport | null>(null);

  const settings = usePublicSettings();
  const isStaff = can('officer');
  const publicReportingOff = settings.data?.enablePublicReporting === false;
  // Staff can still log reports on someone's behalf when the portal is closed.
  const reportingClosed = publicReportingOff && !isStaff;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Citizen Engagement Portal"
        description="Report park issues, log wildlife sightings and give feedback. Accepted reports become operational incidents or verified biodiversity records."
        icon="Megaphone"
        action={
          signedIn ? (
            reportingClosed ? (
              <Button disabled>
                <Ban className="mr-2 h-4 w-4" />
                Reporting paused
              </Button>
            ) : (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Submit a report
              </Button>
            )
          ) : (
            <Button asChild>
              <Link href="/login?next=/citizen"><LogIn className="mr-2 h-4 w-4" />Sign in to report</Link>
            </Button>
          )
        }
      />

      {publicReportingOff && (
        <Alert className="border-warning/30 bg-warning/5">
          <Ban className="h-4 w-4 text-warning" />
          <AlertDescription className="text-xs">
            {isStaff
              ? 'Public reporting is switched off by the administrator, so citizens cannot submit new reports. Staff can still log reports.'
              : 'Public reporting is currently switched off by the administrator. You can still browse and upvote reports, but new submissions are paused.'}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={changeTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="reports">All reports</TabsTrigger>
          {signedIn && <TabsTrigger value="mine">My contributions</TabsTrigger>}
          <TabsTrigger value="impact">Community impact</TabsTrigger>
        </TabsList>

        <TabsContent value="reports">
          <ReportsTab onReview={isStaff ? setReviewing : undefined} />
        </TabsContent>

        <TabsContent value="mine">
          {signedIn ? (
            <MyReportsTab />
          ) : loading ? (
            <LoadingState label="Checking your session…" />
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon="LogIn"
                  title="Sign in to see your contributions"
                  description="Your submitted reports, their status and the upvotes they received are listed here once you sign in."
                  action={
                    <Button asChild size="sm">
                      <Link href={`/login?next=${encodeURIComponent('/citizen?tab=mine')}`}>Sign in</Link>
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="impact"><ImpactTab /></TabsContent>
      </Tabs>

      {signedIn && (
        <ReportFormDialog
          open={creating}
          reportingClosed={reportingClosed}
          onForbidden={() => void settings.refetch()}
          onClose={() => setCreating(false)}
        />
      )}
      {/* Keyed by report so every field starts fresh for each report reviewed —
          nothing chosen for one report can be submitted for another. */}
      <ReviewDialog key={reviewing?.id ?? 'closed'} report={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports list
// ---------------------------------------------------------------------------

function ReportsTab({ onReview }: { onReview?: (report: CitizenReport) => void }) {
  const { signedIn, loading, can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [park, setPark] = useState(ALL_PARKS);

  const query = useCitizenReports({
    page,
    limit: 12,
    q: search || undefined,
    category: category === 'all' ? undefined : category,
    status: status === 'all' ? undefined : status,
    park: parkParam(park),
  });

  // One upvote per account: the toggle state comes from the server.
  const myUpvotes = useMyUpvotes(signedIn);
  const upvotedIds = useMemo(() => new Set(myUpvotes.data ?? []), [myUpvotes.data]);
  const upvote = useUpvoteReport();
  // Until the account's upvotes are known, a toggle could send the wrong direction.
  const upvoteStateUnknown = signedIn && (myUpvotes.isPending || myUpvotes.isError);
  // After a toggle, hold the buttons until the refreshed state arrives.
  const upvoteRefreshing = upvote.isSuccess && myUpvotes.isFetching;

  const applyFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterBar
          search={search}
          onSearch={applyFilter(setSearch)}
          searchPlaceholder="Search reports…"
          filters={[
            {
              label: 'Category',
              value: category,
              onChange: applyFilter(setCategory),
              options: [
                { label: 'All categories', value: 'all' },
                ...(Object.keys(CATEGORY_META) as ReportCategory[]).map((c) => ({
                  label: CATEGORY_META[c].label,
                  value: c,
                })),
              ],
            },
            {
              label: 'Status',
              value: status,
              onChange: applyFilter(setStatus),
              options: [
                { label: 'All statuses', value: 'all' },
                ...['submitted', 'in-review', 'accepted', 'resolved', 'rejected'].map((s) => ({ label: s, value: s })),
              ],
            },
          ]}
        />
        <ParkFilter value={park} onChange={applyFilter(setPark)} />
      </div>

      {!signedIn && !loading && (
        <p className="text-xs text-muted-foreground">
          <Link href="/login?next=/citizen" className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>{' '}
          to upvote reports — one upvote per account, and upvotes on an issue raise the priority of the incident it becomes.
        </p>
      )}
      {signedIn && myUpvotes.isError && (
        <p className="text-xs text-destructive">
          Could not load your upvotes, so upvoting is unavailable.{' '}
          <button type="button" className="underline" onClick={() => void myUpvotes.refetch()}>Retry</button>
        </p>
      )}

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No reports match those filters"
        emptyIcon="Megaphone"
        skeleton={<LoadingState label="Loading reports…" />}
      >
        {(data) => (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.items.map((report) => {
                const meta = CATEGORY_META[report.category];
                const Icon = meta.icon;
                const hasUpvoted = upvotedIds.has(report.id);
                const upvoteBusy = upvote.isPending && upvote.variables?.id === report.id;

                return (
                  <Card key={report.id} className="overflow-hidden">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex items-start gap-3">
                        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted', meta.tone)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-snug">{report.title}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            {report.referenceCode}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {report.demo && <SourceBadge source="demo" compact />}
                          <StatusBadge status={report.status} />
                        </div>
                      </div>

                      <p className="line-clamp-2 text-sm text-muted-foreground">{report.description}</p>

                      {report.images[0] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl(report.images[0])} alt={report.title} className="h-32 w-full rounded-lg object-cover" />
                      )}

                      {/* When an accepted issue became an incident, say so — that
                          link is the whole point of the module. Incident records
                          are officer-only, so only staff get a link. */}
                      {report.linkedIncident && typeof report.linkedIncident === 'object' && (() => {
                        const body = (
                          <div className={cn(
                            'flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-xs',
                            can('officer') && 'transition-colors hover:bg-primary/10'
                          )}>
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span>
                              Became incident{' '}
                              <span className="font-mono">{report.linkedIncident.referenceCode}</span> —{' '}
                              {report.linkedIncident.status}
                            </span>
                          </div>
                        );
                        return can('officer') ? <Link href="/incidents">{body}</Link> : body;
                      })()}

                      {report.officialResponse && (
                        <div className="rounded-lg bg-muted p-3">
                          <p className="text-[11px] font-medium text-muted-foreground">Official response</p>
                          <p className="mt-0.5 text-xs">{report.officialResponse}</p>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        <span className="truncate">{parkName(report.park)}</span>
                        <span>·</span>
                        <span>{report.submittedByName}</span>
                        <span>·</span>
                        <span>{new Date(report.createdAt).toLocaleDateString()}</span>

                        <div className="ml-auto flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant={hasUpvoted ? 'secondary' : 'ghost'}
                            className={cn('h-7 gap-1 px-2', hasUpvoted && 'text-primary')}
                            disabled={!signedIn || upvoteStateUnknown || upvoteBusy || upvoteRefreshing}
                            aria-pressed={hasUpvoted}
                            aria-label={
                              !signedIn ? 'Sign in to upvote'
                              : hasUpvoted ? `Remove your upvote (${report.upvotes})`
                              : `Upvote (${report.upvotes})`
                            }
                            title={!signedIn ? 'Sign in to upvote' : hasUpvoted ? 'You upvoted this — click to remove' : 'Upvote'}
                            onClick={() => upvote.mutate({ id: report.id, upvoted: hasUpvoted })}
                          >
                            {upvoteBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ThumbsUp className={cn('h-3.5 w-3.5', hasUpvoted && 'fill-current')} />
                            )}
                            {report.upvotes}
                          </Button>

                          {onReview && ['submitted', 'in-review'].includes(report.status) && (
                            <Button size="sm" className="h-7 px-2.5" onClick={() => onReview(report)}>
                              Review
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My contributions
// ---------------------------------------------------------------------------

function MyReportsTab() {
  const query = useMyReports();

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={4} height="h-24" />}>
      {(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile label="Reports submitted" value={data.summary.total} />
            <MetricTile label="Upvotes received" value={data.summary.totalUpvotes} tone="success" />
            <MetricTile
              label="Accepted"
              value={(data.summary.byStatus.accepted ?? 0) + (data.summary.byStatus.resolved ?? 0)}
              hint="Acted on by officers"
              tone="success"
            />
            <MetricTile label="Contributions" value={data.summary.contributions} hint="Submissions credited to your account" />
          </div>

          {!data.reports.length ? (
            <Card>
              <CardContent>
                <EmptyState
                  title="You have not submitted anything yet"
                  description="Report an issue or log a wildlife sighting — verified sightings feed straight into the biodiversity indices."
                  icon="Megaphone"
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {data.reports.map((report) => (
                <Card key={report.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{report.title}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{report.referenceCode}</span> ·{' '}
                        {parkName(report.park)} · {new Date(report.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    {report.demo && <SourceBadge source="demo" compact />}
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground" title="Upvotes received">
                      <ThumbsUp className="h-3.5 w-3.5" />
                      {report.upvotes}
                    </div>
                    <StatusBadge status={report.status} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

function ImpactTab() {
  const query = useCitizenStats();

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={4} />}>
      {(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile label="Total submissions" value={data.total} />
            <MetricTile
              label="Acceptance rate"
              value={data.total ? `${data.acceptanceRate}%` : NO_DATA}
              hint="Share officers acted on"
              tone={
                !data.total ? undefined
                : data.acceptanceRate >= 60 ? 'success'
                : data.acceptanceRate >= 35 ? 'warning'
                : 'destructive'
              }
            />
            <MetricTile
              label="Sightings"
              value={data.byCategory.find((c) => c.category === 'wildlife-sighting')?.count ?? 0}
              hint="Feed the biodiversity record"
            />
            <MetricTile
              label="Issues raised"
              value={data.byCategory.find((c) => c.category === 'issue')?.count ?? 0}
              hint="Candidates for incidents"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Submissions by Category</CardTitle>
              </CardHeader>
              <CardContent>
                {!data.byCategory.length ? (
                  <EmptyState title="No submissions yet" icon="Megaphone" className="py-8" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={240}>
                      <PieChart>
                        <Pie
                          data={data.byCategory}
                          dataKey="count"
                          nameKey="category"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          innerRadius={48}
                          paddingAngle={2}
                        >
                          {data.byCategory.map((_, index) => (
                            <Cell key={index} fill={`hsl(var(--chart-${(index % 6) + 1}))`} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex flex-wrap justify-center gap-3">
                      {data.byCategory.map((entry, index) => (
                        <div key={entry.category} className="flex items-center gap-1.5 text-[11px]">
                          <span className="h-2 w-2 rounded-full" style={{ background: `hsl(var(--chart-${(index % 6) + 1}))` }} />
                          <span className="text-muted-foreground">
                            {CATEGORY_META[entry.category as ReportCategory]?.label ?? entry.category}
                          </span>
                          <span className="font-medium">{entry.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Participation by Park</CardTitle>
                <CardDescription>Where the public is most engaged</CardDescription>
              </CardHeader>
              <CardContent>
                {!data.byPark.length ? (
                  <EmptyState title="No submissions yet" icon="MapPin" className="py-8" />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.byPark} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                      <YAxis type="category" dataKey="park" width={130} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Bar dataKey="reports" name="Reports" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Trophy className="h-5 w-5 text-warning" />
                Top Contributors
              </CardTitle>
              <CardDescription>Citizens ranked by the number of reports they have submitted</CardDescription>
            </CardHeader>
            <CardContent>
              {!data.topContributors.length ? (
                <EmptyState title="No contributors yet" icon="Users" className="py-8" />
              ) : (
                <div className="space-y-2">
                  {data.topContributors.map((contributor, index) => (
                    <div key={contributor.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                          index === 0 ? 'bg-warning/20 text-warning'
                          : index === 1 ? 'bg-muted-foreground/20 text-muted-foreground'
                          : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {index + 1}
                      </div>
                      <p className="min-w-0 flex-1 truncate font-medium">{contributor.name}</p>
                      <Badge variant="outline">
                        {contributor.contributions} report{contributor.contributions === 1 ? '' : 's'} submitted
                      </Badge>
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

// ---------------------------------------------------------------------------
// Species picker
// ---------------------------------------------------------------------------

/**
 * The catalogue holds ~600 species, too many for one dropdown, so the list is
 * searched on the server by common or scientific name.
 */
function SpeciesPicker({
  value,
  onChange,
  placeholder,
  selectedLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  /** Label for a preselected species that is not in the current results. */
  selectedLabel?: string;
}) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);

  // Wait for a pause in typing before querying.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useSpeciesList({ limit: 50, q: term.length >= 2 ? term : undefined });
  const items = query.data?.items ?? [];
  const selectedMissing = Boolean(value) && !items.some((entry) => entry.id === value);

  return (
    <div className="space-y-1.5">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by common or scientific name…"
      />
      <Select
        value={value}
        onValueChange={(id) => {
          onChange(id);
          const entry = items.find((item) => item.id === id);
          if (entry) setPicked({ id, label: speciesLabel(entry) });
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={query.isPending ? 'Loading species…' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {selectedMissing && (
            <SelectItem value={value}>
              {(picked?.id === value ? picked.label : selectedLabel) ?? 'Selected species'}
            </SelectItem>
          )}
          {items.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {speciesLabel(entry)}
              {entry.commonName && <span className="italic text-muted-foreground"> ({entry.scientificName})</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.isError ? (
        <p className="text-[11px] text-destructive">
          Could not load species: {query.error.message}{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : query.data ? (
        <p className="text-[11px] text-muted-foreground">
          {query.data.meta.total === 0
            ? 'No species match that search.'
            : query.data.meta.total > items.length
            ? `Showing ${items.length} of ${query.data.meta.total} — search to narrow the list.`
            : `${query.data.meta.total} species`}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function ReportFormDialog({
  open,
  reportingClosed,
  onForbidden,
  onClose,
}: {
  open: boolean;
  /** Public reporting is switched off and the user is not staff. */
  reportingClosed: boolean;
  /** The API refused the submission (e.g. reporting was switched off meanwhile). */
  onForbidden: () => void;
  onClose: () => void;
}) {
  const { data: parks } = useParks();
  const createReport = useCreateReport();

  const [address, setAddress] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const form = useForm<ReportValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: { category: 'issue', title: '', description: '', park: '', lat: 0, lng: 0, species: '' },
  });

  const category = form.watch('category');
  const selectedPark = form.watch('park');

  /** Default the pin to the park centre so a report never lands at 0,0. */
  const applyParkCentre = (parkId: string) => {
    const park = parks?.items.find((p) => p.id === parkId);
    if (park) {
      form.setValue('lng', park.location.coordinates[0]);
      form.setValue('lat', park.location.coordinates[1], { shouldValidate: form.formState.isSubmitted });
      void lookupAddress(park.location.coordinates[1], park.location.coordinates[0]);
    }
  };

  /**
   * Reverse geocode through the server's Nominatim proxy, so the citizen sees
   * a street name rather than a coordinate pair. Failure is silent — an
   * address is a convenience, not a requirement.
   */
  const lookupAddress = async (lat: number, lng: number) => {
    setLocating(true);
    try {
      const result = await integrationApi.geocode(lat, lng);
      setAddress(result.ok ? result.displayName ?? null : null);
    } catch {
      setAddress(null);
    } finally {
      setLocating(false);
    }
  };

  /** Use the browser's own position, where the visitor allows it. */
  const locateMe = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.setValue('lat', position.coords.latitude);
        form.setValue('lng', position.coords.longitude, { shouldValidate: form.formState.isSubmitted });
        void lookupAddress(position.coords.latitude, position.coords.longitude);
      },
      () => setLocating(false),
      { timeout: 8000 }
    );
  };

  const submit = form.handleSubmit(async (values) => {
    if (reportingClosed) return;
    try {
      await createReport.mutateAsync({
        category: values.category,
        title: values.title,
        description: values.description,
        park: values.park,
        location: makePoint(values.lat, values.lng),
        species: values.category === 'wildlife-sighting' ? values.species || undefined : undefined,
      });
      form.reset();
      setAddress(null);
      onClose();
    } catch (err) {
      // Toast already shown. A 403 means the portal was closed meanwhile —
      // refresh the switch so the notice appears.
      if (err instanceof ApiError && err.isForbidden) onForbidden();
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit a report</DialogTitle>
          <DialogDescription>
            An officer reviews every submission. Accepted issues become tracked incidents;
            accepted sightings become verified biodiversity records.
          </DialogDescription>
        </DialogHeader>

        {reportingClosed && (
          <Alert className="border-warning/30 bg-warning/5">
            <Ban className="h-4 w-4 text-warning" />
            <AlertDescription className="text-xs">
              Public reporting has been switched off by the administrator, so new reports cannot be submitted right now.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>What are you reporting?</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(CATEGORY_META) as ReportCategory[]).map((key) => {
                const meta = CATEGORY_META[key];
                const active = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => form.setValue('category', key)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      active ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                    )}
                  >
                    <meta.icon className={cn('h-4 w-4 shrink-0', active ? meta.tone : 'text-muted-foreground')} />
                    <span className="truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Broken bench near the play area" {...form.register('title')} />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={4} placeholder="What did you see? Where exactly?" {...form.register('description')} />
            {form.formState.errors.description && (
              <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Park</Label>
            <Select
              value={selectedPark}
              onValueChange={(v) => {
                form.setValue('park', v, { shouldValidate: form.formState.isSubmitted });
                applyParkCentre(v);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select a park" /></SelectTrigger>
              <SelectContent>
                {parks?.items.map((park) => (
                  <SelectItem key={park.id} value={park.id}>{park.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.park && (
              <p className="text-xs text-destructive">{form.formState.errors.park.message}</p>
            )}
          </div>

          {category === 'wildlife-sighting' && (
            <div className="space-y-1.5">
              <Label>Species (if you know it)</Label>
              <SpeciesPicker
                value={form.watch('species') ?? ''}
                onChange={(id) => form.setValue('species', id)}
                placeholder="Optional — an ecologist can identify it"
              />
              <p className="text-[11px] text-muted-foreground">
                A sighting can only be accepted once a species is identified — that is what admits
                it into the diversity indices.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Location</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => applyParkCentre(selectedPark)}
                  disabled={!selectedPark}
                >
                  Park centre
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={locateMe}>
                  {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Use my location'}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" step="any" placeholder="Latitude" {...form.register('lat')} />
              <Input type="number" step="any" placeholder="Longitude" {...form.register('lng')} />
            </div>
            {form.formState.errors.lat && (
              <p className="text-xs text-destructive">{form.formState.errors.lat.message}</p>
            )}
            {address && (
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                {address}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createReport.isPending || reportingClosed}>
              {createReport.isPending ? 'Submitting…' : 'Submit report'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Officer review
// ---------------------------------------------------------------------------

/**
 * The acceptance gate.
 *
 * Accepting an issue needs a severity and an exposure estimate because those
 * are inputs to the incident's triage score — the officer is not just saying
 * "yes", they are supplying the facts that determine where it lands in the
 * queue.
 *
 * The parent keys this component by report id, so all of its state starts
 * fresh for each report.
 */
function ReviewDialog({ report, onClose }: { report: CitizenReport | null; onClose: () => void }) {
  const review = useReviewReport();

  const [decision, setDecision] = useState<'accepted' | 'rejected' | 'in-review'>('accepted');
  const [response, setResponse] = useState('');
  const [incidentType, setIncidentType] = useState('infrastructure-damage');
  const [severity, setSeverity] = useState('3');
  const [affected, setAffected] = useState('50');
  const [speciesId, setSpeciesId] = useState('');
  const [count, setCount] = useState('1');

  const isIssue = report?.category === 'issue';
  const isSighting = report?.category === 'wildlife-sighting';

  const existingSpecies = report && typeof report.species === 'object' ? report.species : null;
  const existingSpeciesId =
    report && typeof report.species === 'string' ? report.species : existingSpecies?.id ?? '';
  const chosenSpecies = speciesId || existingSpeciesId;

  const affectedNumber = Number(affected);
  const affectedInvalid = !Number.isInteger(affectedNumber) || affectedNumber < 0 || affected.trim() === '';
  const countNumber = Number(count);
  const countInvalid = !Number.isInteger(countNumber) || countNumber < 1;

  const needsSpecies = decision === 'accepted' && isSighting && !chosenSpecies;
  const invalid =
    needsSpecies ||
    (decision === 'accepted' && isIssue && affectedInvalid) ||
    (decision === 'accepted' && isSighting && countInvalid);

  const submit = async () => {
    if (!report || invalid) return;
    try {
      await review.mutateAsync({
        id: report.id,
        body: {
          decision,
          officialResponse: response || undefined,
          ...(decision === 'accepted' && isIssue
            ? { incidentType, severity: Number(severity), affectedPeople: affectedNumber }
            : {}),
          ...(decision === 'accepted' && isSighting
            ? { species: chosenSpecies || undefined, count: countNumber }
            : {}),
        },
      });
      onClose();
    } catch {
      /* toast already shown */
    }
  };

  return (
    <Dialog open={Boolean(report)} onOpenChange={(o) => !o && !review.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review report</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{report?.referenceCode}</span> · {report?.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {report?.demo && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <SourceBadge source="demo" />
              This report is a demonstration record.
            </div>
          )}

          <p className="rounded-lg bg-muted p-3 text-sm">{report?.description}</p>

          <div className="space-y-2">
            <Label>Decision</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { value: 'accepted', label: 'Accept', icon: CheckCircle2, tone: 'text-success' },
                { value: 'in-review', label: 'Hold', icon: Loader2, tone: 'text-warning' },
                { value: 'rejected', label: 'Reject', icon: XCircle, tone: 'text-destructive' },
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDecision(option.value)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs transition-colors',
                    decision === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                  )}
                >
                  <option.icon className={cn('h-4 w-4', decision === option.value ? option.tone : 'text-muted-foreground')} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {decision === 'accepted' && isIssue && (
            <Alert className="border-primary/20 bg-primary/5">
              <TriangleAlert className="h-4 w-4 text-primary" />
              <AlertDescription className="text-xs">
                Accepting opens a tracked incident. Severity and the number of people affected feed
                the triage score directly, so they determine where it lands in the queue. The
                report&apos;s {report?.upvotes ?? 0} upvote{report?.upvotes === 1 ? '' : 's'} carry
                over as the community signal.
              </AlertDescription>
            </Alert>
          )}

          {decision === 'accepted' && isIssue && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Incident type</Label>
                <Select value={incidentType} onValueChange={setIncidentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCIDENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type} className="capitalize">
                        {type.replace(/-/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Severity (1–5)</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['1', '2', '3', '4', '5'].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>People affected</Label>
                  <Input type="number" min={0} step={1} value={affected} onChange={(e) => setAffected(e.target.value)} />
                  {affectedInvalid && <p className="text-xs text-destructive">A whole number, 0 or more.</p>}
                </div>
              </div>
            </div>
          )}

          {decision === 'accepted' && isSighting && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Species</Label>
                <SpeciesPicker
                  value={chosenSpecies}
                  onChange={setSpeciesId}
                  placeholder="Identify the species"
                  selectedLabel={existingSpecies ? speciesLabel(existingSpecies) : undefined}
                />
                {needsSpecies && (
                  <p className="text-xs text-destructive">Identify the species before accepting this sighting.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Individuals observed</Label>
                <Input type="number" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
                {countInvalid && <p className="text-xs text-destructive">At least one individual.</p>}
                <p className="text-[11px] text-muted-foreground">
                  This becomes the abundance term nᵢ in the diversity indices.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Response to the citizen</Label>
            <Textarea
              rows={3}
              value={response}
              maxLength={2000}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Thank you — a crew has been scheduled for Thursday."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={review.isPending}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={review.isPending || invalid}>
            {review.isPending ? 'Saving…' : 'Submit decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
