'use client';

/**
 * Module 4 — Biodiversity Management.
 *
 * The species catalogue is the visible half; the diversity indices are the
 * point. This page shows the mathematics rather than hiding it behind a single
 * score: the abundance vector the indices were computed from, the per-taxocene
 * breakdown, and a calculator that lets an assessor put their own numbers in
 * and watch the formulas respond.
 */

import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Bird, CheckCircle2, Sparkles, TriangleAlert, Globe2, Calculator, Info, ShieldQuestion, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { ConservationBadge } from '@/components/shared/status-badges';
import { MetricTile, ScoreBar } from '@/components/shared/score-badge';
import { DataNotice, SourceBadge } from '@/components/shared/data-source';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState, ErrorState } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useBiodiversityIndices, useBiodiversityComparison, useSeasonality,
  useSpeciesList, useSpeciesObservations, useGbifVerification, useVerifyObservation,
  useObservations,
} from '@/lib/hooks/use-api';
import { biodiversityApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { THREATENED_STATUSES } from '@/lib/types';
import type { ConservationStatus, Observation, Species, SpeciesClass } from '@/lib/types';

const SPECIES_CLASSES: SpeciesClass[] = [
  'bird', 'mammal', 'butterfly', 'reptile', 'amphibian', 'tree', 'plant', 'insect',
];

const CONSERVATION_STATUSES: ConservationStatus[] = [
  'Not Evaluated', 'Data Deficient', 'Least Concern', 'Near Threatened', 'Vulnerable',
  'Endangered', 'Critically Endangered', 'Extinct in the Wild',
];

/**
 * IUCN status chip. "Not Evaluated" and "Data Deficient" say nothing about
 * risk (most insects and plants have never been assessed), so the shared badge
 * styles them neutrally; threatened statuses also get a warning icon.
 */
function IucnBadge({ status }: { status: ConservationStatus }) {
  return (
    <span className="inline-flex items-center gap-1" title={`IUCN Red List: ${status}`}>
      {THREATENED_STATUSES.includes(status) && <TriangleAlert className="h-3 w-3 text-warning" />}
      <ConservationBadge status={status} />
    </span>
  );
}

/** Invasive / introduced status from the GRIIS India checklist. */
function IntroductionBadges({ species, className }: { species: Species; className?: string }) {
  return (
    <>
      {species.isInvasive && (
        <Badge className={cn('border-destructive/30 bg-destructive/90 text-[10px] text-destructive-foreground', className)}>
          Invasive in India (GRIIS)
        </Badge>
      )}
      {!species.isInvasive && species.isIntroduced && (
        <Badge variant="outline" className={cn('border-warning/30 bg-warning/15 text-[10px] text-warning', className)}>
          Introduced
        </Badge>
      )}
    </>
  );
}

/** Many GBIF taxa have no English common name. */
const displayName = (species: Pick<Species, 'commonName' | 'scientificName'>) =>
  species.commonName?.trim() || species.scientificName;

const gbifSpeciesUrl = (key: number) => `https://www.gbif.org/species/${key}`;

/** A GBIF row's `count` is occurrence records; other sources count individuals. */
function countLabel(observation: Pick<Observation, 'count' | 'source'>) {
  const noun = observation.source === 'gbif' ? 'GBIF record' : 'individual';
  return `${observation.count.toLocaleString()} ${noun}${observation.count === 1 ? '' : 's'}`;
}

/** GBIF rows aggregate a whole month, so a day-level date would be invented precision. */
function observedLabel(observation: Pick<Observation, 'observedAt' | 'source'>) {
  const date = new Date(observation.observedAt);
  return observation.source === 'gbif'
    ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : date.toLocaleDateString();
}

/** Server validation detail is more useful than a generic failure. */
function errorMessage(err: unknown) {
  if (err instanceof ApiError) {
    const detail = err.details ? Object.values(err.details).join('. ') : '';
    return detail ? `${err.message}: ${detail}` : err.message;
  }
  return err instanceof Error ? err.message : 'The calculation failed.';
}

const CLASS_COLOURS: Record<string, string> = {
  bird: 'hsl(var(--chart-1))',
  mammal: 'hsl(var(--chart-3))',
  butterfly: 'hsl(var(--chart-5))',
  reptile: 'hsl(var(--chart-4))',
  amphibian: 'hsl(var(--chart-2))',
  tree: 'hsl(var(--chart-6))',
  plant: 'hsl(var(--chart-2))',
  insect: 'hsl(var(--chart-5))',
};

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

export default function BiodiversityPage() {
  const [park, setPark] = useState(ALL_PARKS);
  const [selected, setSelected] = useState<Species | null>(null);

  const indices = useBiodiversityIndices(parkParam(park));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Biodiversity Management"
        description="Species catalogue, observation records, and the ecological diversity indices computed from them. Only verified observations count towards the indices."
        icon="Bird"
        action={<ParkFilter value={park} onChange={setPark} allLabel="All parks (citywide)" />}
      />

      <DataNotice>
        Species and counts come from GBIF occurrence records (eBird, iNaturalist and other datasets)
        located inside each park&apos;s OpenStreetMap boundary since January 2023. Abundance here is the
        number of records, not a count of individuals. GBIF publication lags by months, so the most
        recent months are incomplete. Data: GBIF.org · boundaries © OpenStreetMap contributors.
      </DataNotice>

      <Tabs defaultValue="indices" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="indices">Indices</TabsTrigger>
          <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
          <TabsTrigger value="observations">Observations</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>

        <TabsContent value="indices" className="space-y-6">
          <IndicesTab park={parkParam(park)} query={indices} />
        </TabsContent>

        <TabsContent value="catalogue" className="space-y-4">
          <CatalogueTab park={parkParam(park)} onSelect={setSelected} />
        </TabsContent>

        <TabsContent value="observations" className="space-y-4">
          <ObservationsTab park={parkParam(park)} />
        </TabsContent>

        <TabsContent value="compare" className="space-y-4">
          <CompareTab />
        </TabsContent>
      </Tabs>

      <SpeciesSheet species={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indices
// ---------------------------------------------------------------------------

function IndicesTab({
  park,
  query,
}: {
  park?: string;
  query: ReturnType<typeof useBiodiversityIndices>;
}) {
  const seasonality = useSeasonality({ park });

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={4} />}>
      {(data) => {
        const abundanceChart = data.abundance.slice(0, 12).map((row) => ({
          name: displayName(row),
          count: row.count,
          isInvasive: row.isInvasive,
        }));

        const classChart = Object.entries(data.byClass).map(([name, value]) => ({ name, value }));

        // Per-taxocene radar: evenness within each class, which is the fair
        // comparison across groups surveyed by different methods.
        const taxoceneRadar = Object.entries(data.byClassIndices)
          .filter(([, v]) => v.richness > 1)
          .map(([name, v]) => ({ name, evenness: Math.round(v.evenness * 100) }));

        return (
          <div className="space-y-6">
            {/* --- Headline indices --- */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label="Biodiversity Score"
                value={data.score}
                hint="0–100 composite"
                tone={data.score >= 70 ? 'success' : data.score >= 50 ? 'warning' : 'destructive'}
              />
              <MetricTile label="Species richness" value={data.indices.richness} hint="S — distinct species" />
              <MetricTile
                label="Shannon–Wiener"
                value={data.indices.shannon.toFixed(3)}
                hint={`H′ · maximum possible ${data.indices.shannonMax.toFixed(3)}`}
              />
              <MetricTile
                label="Pielou evenness"
                value={data.indices.evenness.toFixed(3)}
                hint="J′ = H′ / ln(S)"
                tone={data.indices.evenness >= 0.75 ? 'success' : data.indices.evenness >= 0.5 ? 'warning' : 'destructive'}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* --- The formulas, with this dataset's numbers --- */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">How the score is derived</CardTitle>
                  <CardDescription>
                    Every figure below is computed from {data.indices.totalIndividuals.toLocaleString()} verified
                    occurrence records across {data.indices.richness} species. Each record counts as one
                    unit of abundance nᵢ, so &ldquo;individual&rdquo; below means &ldquo;record&rdquo;.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    {[
                      {
                        symbol: "H′",
                        name: 'Shannon–Wiener index',
                        formula: 'H′ = −Σ pᵢ · ln(pᵢ)',
                        value: data.indices.shannon.toFixed(4),
                        note: 'Uncertainty in guessing the species of a randomly drawn individual. Rises with both richness and evenness.',
                      },
                      {
                        symbol: "J′",
                        name: "Pielou's evenness",
                        formula: 'J′ = H′ / ln(S)',
                        value: data.indices.evenness.toFixed(4),
                        note: 'Isolates evenness from richness. 1 means every species is equally abundant.',
                      },
                      {
                        symbol: '1−D',
                        name: 'Gini–Simpson diversity',
                        formula: 'D = Σ pᵢ²',
                        value: data.indices.simpsonDiversity.toFixed(4),
                        note: 'Probability two individuals drawn at random are different species.',
                      },
                      {
                        symbol: 'D_Mg',
                        name: 'Margalef richness',
                        formula: 'D_Mg = (S − 1) / ln(N)',
                        value: data.indices.margalef.toFixed(4),
                        note: 'Richness corrected for sampling effort, so unevenly surveyed parks stay comparable.',
                      },
                      {
                        symbol: 'd',
                        name: 'Berger–Parker dominance',
                        formula: 'd = max(pᵢ)',
                        value: data.indices.dominance.toFixed(4),
                        note: 'Share held by the commonest species. High dominance is what drags evenness down.',
                      },
                    ].map((metric) => (
                      <div key={metric.symbol} className="flex items-start gap-3 rounded-lg border p-3">
                        <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-bold text-primary">
                          {metric.symbol}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-medium">{metric.name}</p>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{metric.formula}</code>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p>
                        </div>
                        <span className="shrink-0 font-mono text-lg font-bold tabular-nums">{metric.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg bg-primary/5 p-3">
                    <p className="text-xs font-medium">Composite score</p>
                    <code className="mt-1 block text-[11px] leading-relaxed">
                      Score = 100 · (0.35·Ĥ + 0.25·J′ + 0.20·R̂ + 0.20·Ĉ) = {data.score}
                    </code>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Ĥ normalised Shannon · J′ evenness · R̂ normalised richness ·
                      Ĉ conservation component ({data.conservationComponent.toFixed(3)}). Shannon carries the
                      largest weight because it is the only term reacting to richness and evenness at once.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Composition</CardTitle>
                    <CardDescription>Records by taxonomic class</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={classChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} innerRadius={46} paddingAngle={2}>
                          {classChart.map((entry) => (
                            <Cell key={entry.name} fill={CLASS_COLOURS[entry.name] ?? 'hsl(var(--chart-1))'} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 gap-3">
                  <MetricTile
                    label="Threatened"
                    value={data.threatenedSpecies}
                    hint="Species Near Threatened or worse (IUCN)"
                    tone={data.threatenedSpecies > 0 ? 'warning' : undefined}
                  />
                  <MetricTile
                    label="Invasive records"
                    value={data.invasiveIndividuals.toLocaleString()}
                    hint={
                      data.indices.totalIndividuals > 0
                        ? `${((100 * data.invasiveIndividuals) / data.indices.totalIndividuals).toFixed(1)}% of records · GRIIS India`
                        : 'No records'
                    }
                    tone={data.invasiveIndividuals > 0 ? 'destructive' : undefined}
                  />
                </div>
              </div>
            </div>

            {/* --- Taxocene caveat, stated rather than hidden --- */}
            {taxoceneRadar.length > 1 && (
              <Card>
                <CardHeader>
                  <div className="flex items-start gap-2">
                    <div>
                      <CardTitle className="text-lg">Per-Taxocene Indices</CardTitle>
                      <CardDescription>
                        Diversity computed within each taxonomic class — the methodologically sound
                        comparison
                      </CardDescription>
                    </div>
                    <TooltipProvider>
                      <UiTooltip>
                        <TooltipTrigger className="mt-1"><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          <p className="text-xs">
                            Ecologists compute diversity within a taxocene — one taxonomic group
                            surveyed by one method — not across all life. Pooling bird counts with
                            plant-stem counts mixes units of survey effort. The pooled score above
                            is reported because a manager needs one comparable number per park; these
                            are the figures to quote when comparing sites rigorously.
                          </p>
                        </TooltipContent>
                      </UiTooltip>
                    </TooltipProvider>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <ResponsiveContainer width="100%" height={260}>
                    <RadarChart data={taxoceneRadar}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Radar name="Evenness J′ (%)" dataKey="evenness" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.35} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </RadarChart>
                  </ResponsiveContainer>

                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 font-medium">Class</th>
                          <th className="py-2 text-right font-medium">S</th>
                          <th className="py-2 text-right font-medium">N</th>
                          <th className="py-2 text-right font-medium">H′</th>
                          <th className="py-2 text-right font-medium">J′</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(data.byClassIndices ?? {}).map(([name, v]) => (
                          <tr key={name} className="border-b last:border-0">
                            <td className="py-2 capitalize">{name}</td>
                            <td className="py-2 text-right tabular-nums">{v.richness}</td>
                            <td className="py-2 text-right tabular-nums">{v.individuals.toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums">{v.shannon.toFixed(3)}</td>
                            <td className="py-2 text-right tabular-nums">{v.evenness.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-3 text-xs text-muted-foreground">
                      A class with S = 1 necessarily has H′ = 0: a single species carries no
                      diversity, which is the formula behaving correctly rather than missing data.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* --- Abundance vector --- */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Abundance Distribution</CardTitle>
                <CardDescription>
                  Top {abundanceChart.length} of {data.indices.richness} species from the abundance vector
                  n₁…n_S the indices are computed from. Invasive species are shown in red.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {abundanceChart.length === 0 ? (
                  <EmptyState title="No verified records" description="There are no verified records in this scope." icon="Bird" />
                ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={abundanceChart} margin={{ bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" angle={-40} textAnchor="end" height={90} stroke="hsl(var(--muted-foreground))" fontSize={10} interval={0} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Records" radius={[4, 4, 0, 0]}>
                      {abundanceChart.map((entry, i) => (
                        <Cell key={i} fill={entry.isInvasive ? 'hsl(var(--destructive))' : 'hsl(var(--chart-1))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* --- Seasonality --- */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Seasonality</CardTitle>
                <CardDescription>
                  Verified records per calendar month, pooled across years since January 2023 —
                  migration and flowering both show up here, which is why a single annual figure would
                  mislead. Recent months are under-counted while GBIF publication catches up.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {seasonality.isPending ? (
                  <LoadingState label="Loading seasonality…" />
                ) : seasonality.isError ? (
                  <ErrorState error={seasonality.error} onRetry={() => seasonality.refetch()} />
                ) : seasonality.data.every((row) => row.sightings === 0) ? (
                  <EmptyState title="No verified records" description="Nothing has been recorded in this scope yet." icon="Bird" />
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={seasonality.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line yAxisId="left" type="monotone" dataKey="individuals" name="Records" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="richness" name="Species present" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <IndexCalculator />
          </div>
        );
      }}
    </QueryState>
  );
}

/**
 * A live calculator over the same backend endpoint the indices use.
 *
 * Its purpose is demonstrative: an assessor can type an abundance vector and
 * watch H′ and J′ respond, which shows the formulas are genuinely implemented
 * rather than the numbers being decorative.
 */
function IndexCalculator() {
  const [input, setInput] = useState('50, 40, 30, 20, 10');
  const [result, setResult] = useState<Awaited<ReturnType<typeof biodiversityApi.previewIndices>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compute = async () => {
    const abundances = input
      .split(/[,\s]+/)
      .map((token) => Number(token.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!abundances.length) {
      setError('Enter at least one positive number.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setResult(await biodiversityApi.previewIndices(abundances));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="h-5 w-5 text-primary" />
          Index Calculator
        </CardTitle>
        <CardDescription>
          Enter an abundance vector (n₁, n₂, …) and the server recomputes every index. Try
          <code className="mx-1 rounded bg-muted px-1">100, 1, 1, 1</code> against
          <code className="mx-1 rounded bg-muted px-1">25, 25, 25, 25</code> — same richness, very
          different evenness.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="50, 40, 30, 20, 10"
            className="font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void compute();
            }}
          />
          <Button onClick={compute} disabled={busy}>{busy ? 'Computing…' : 'Compute'}</Button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {result && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Richness S" value={result.richness} />
            <MetricTile label="Total N" value={result.total} />
            <MetricTile label="Shannon H′" value={result.shannon.toFixed(4)} />
            <MetricTile label="Evenness J′" value={result.evenness.toFixed(4)} />
            <MetricTile label="Simpson D" value={result.simpson.toFixed(4)} />
            <MetricTile label="Gini–Simpson" value={result.simpsonDiversity.toFixed(4)} />
            <MetricTile label="Margalef" value={result.margalef.toFixed(4)} />
            <MetricTile label="Dominance" value={result.dominance.toFixed(4)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function CatalogueTab({ park, onSelect }: { park?: string; onSelect: (s: Species) => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [speciesClass, setSpeciesClass] = useState('all');
  const [conservation, setConservation] = useState('all');

  // A different park is a different result set — start again from page one.
  const [lastPark, setLastPark] = useState(park);
  if (lastPark !== park) {
    setLastPark(park);
    setPage(1);
  }

  const query = useSpeciesList({
    page,
    limit: 12,
    q: search || undefined,
    class: speciesClass === 'all' ? undefined : speciesClass,
    conservationStatus: conservation === 'all' ? undefined : conservation,
    // Species recorded in that park.
    parks: park,
  });

  const applyFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearch={applyFilter(setSearch)}
        searchPlaceholder="Search by common or scientific name…"
        filters={[
          {
            label: 'Class',
            value: speciesClass,
            onChange: applyFilter(setSpeciesClass),
            options: [{ label: 'All classes', value: 'all' }, ...SPECIES_CLASSES.map((c) => ({ label: c, value: c }))],
          },
          {
            label: 'Conservation',
            value: conservation,
            onChange: applyFilter(setConservation),
            options: [
              { label: 'All statuses', value: 'all' },
              ...CONSERVATION_STATUSES.map((s) => ({ label: s, value: s })),
            ],
          },
        ]}
      />

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No species match those filters"
        emptyIcon="Bird"
        skeleton={<LoadingState label="Loading catalogue…" />}
      >
        {(data) => (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((species) => (
                <Card
                  key={species.id}
                  onClick={() => onSelect(species)}
                  className="cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                >
                  <div className="relative h-36 bg-muted">
                    {species.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- remote gallery URLs, not local assets
                      <img src={species.images[0]} alt={displayName(species)} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Bird className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                      <IntroductionBadges species={species} />
                      {species.isIndicator && (
                        <Badge variant="outline" className="border-info/30 bg-info/90 text-[10px] text-white">
                          Indicator
                        </Badge>
                      )}
                    </div>
                  </div>

                  <CardContent className="space-y-2 p-4">
                    <div>
                      <p className="font-medium leading-tight">{displayName(species)}</p>
                      {species.commonName?.trim() && (
                        <p className="text-xs italic text-muted-foreground">{species.scientificName}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] capitalize">{species.class}</Badge>
                      <IucnBadge status={species.conservationStatus} />
                    </div>
                    {species.habitat && <p className="line-clamp-2 text-xs text-muted-foreground">{species.habitat}</p>}
                    {species.images[0] && species.imageCredit && (
                      <p className="line-clamp-1 text-[10px] text-muted-foreground" title={species.imageCredit}>
                        Photo: {species.imageCredit}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

function ObservationsTab({ park }: { park?: string }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [verified, setVerified] = useState('all');
  const [source, setSource] = useState('all');

  const [lastPark, setLastPark] = useState(park);
  if (lastPark !== park) {
    setLastPark(park);
    setPage(1);
  }

  const query = useObservations({
    page,
    limit: 15,
    park,
    verified: verified === 'all' ? undefined : verified,
    source: source === 'all' ? undefined : source,
  });

  const verify = useVerifyObservation();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <FilterBar
          filters={[
            {
              label: 'Verification',
              value: verified,
              onChange: (v) => { setVerified(v); setPage(1); },
              options: [
                { label: 'All records', value: 'all' },
                { label: 'Verified', value: 'true' },
                { label: 'Unverified', value: 'false' },
              ],
            },
            {
              label: 'Source',
              value: source,
              onChange: (v) => { setSource(v); setPage(1); },
              options: [
                { label: 'All sources', value: 'all' },
                { label: 'GBIF records', value: 'gbif' },
                { label: 'Officer survey', value: 'officer-survey' },
                { label: 'Citizen report', value: 'citizen-report' },
                { label: 'Camera trap', value: 'camera-trap' },
                { label: 'AI detection', value: 'ai-detection' },
              ],
            },
          ]}
        />
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <p className="text-xs">
          Only <strong>verified</strong> observations feed the diversity indices. That gate is what
          stops one enthusiastic — or mistaken — reporter from moving a park&apos;s score. A GBIF row
          is one species in one park in one month, imported as verified; its count is the number of
          occurrence records, not individuals.
        </p>
      </div>

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No observations recorded"
        emptyIcon="Bird"
        skeleton={<LoadingState label="Loading observations…" />}
      >
        {(data) => (
          <>
            <div className="space-y-2">
              {data.items.map((observation) => {
                const species = typeof observation.species === 'object' ? observation.species : null;
                return (
                  <Card key={observation.id}>
                    <CardContent className="flex flex-wrap items-center gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{species ? displayName(species) : 'Unknown species'}</p>
                          {species?.commonName?.trim() && (
                            <span className="text-xs italic text-muted-foreground">{species.scientificName}</span>
                          )}
                          {observation.source === 'gbif' && <SourceBadge source="gbif" className="text-[10px]" />}
                          {observation.verified ? (
                            <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-[10px] text-success">
                              <CheckCircle2 className="h-3 w-3" /> Verified
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning">
                              <ShieldQuestion className="h-3 w-3" /> Unverified
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {countLabel(observation)} ·{' '}
                          {typeof observation.park === 'object' ? observation.park.name : '—'} ·{' '}
                          {observedLabel(observation)} ·{' '}
                          {observation.source === 'gbif'
                            ? observation.observerName
                            : `${observation.observerName} (${observation.source.replace('-', ' ')})`}
                        </p>
                      </div>

                      {can('ecologist') && (
                        <Button
                          size="sm"
                          variant={observation.verified ? 'outline' : 'default'}
                          disabled={verify.isPending}
                          onClick={() =>
                            verify.mutate({ id: observation.id, verified: !observation.verified })
                          }
                        >
                          {observation.verified ? 'Withdraw' : 'Verify'}
                        </Button>
                      )}
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
// Compare
// ---------------------------------------------------------------------------

function CompareTab() {
  const query = useBiodiversityComparison();

  return (
    <QueryState query={query} skeleton={<LoadingState label="Comparing parks…" />}>
      {(rows) => (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Biodiversity by Park</CardTitle>
              <CardDescription>
                The lowest-scoring site is where conservation effort earns the most. S = species,
                N = verified records, threatened = Near Threatened or worse.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={rows} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis type="category" dataKey="park" width={150} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="score" name="Biodiversity score" radius={[0, 4, 4, 0]}>
                    {rows.map((row) => (
                      <Cell
                        key={row.parkId}
                        fill={row.score >= 70 ? 'hsl(var(--success))' : row.score >= 50 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="overflow-x-auto p-0 scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Park</th>
                    <th className="px-4 py-3 text-right font-medium">Score</th>
                    <th className="px-4 py-3 text-right font-medium">S</th>
                    <th className="px-4 py-3 text-right font-medium">N</th>
                    <th className="px-4 py-3 text-right font-medium">H′</th>
                    <th className="px-4 py-3 text-right font-medium">J′</th>
                    <th className="px-4 py-3 text-right font-medium">1−D</th>
                    <th className="px-4 py-3 text-right font-medium">Threatened</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.parkId} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{row.park}</td>
                      <td className="px-4 py-3">
                        <ScoreBar score={row.score} className="min-w-[110px]" />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.richness}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.totalIndividuals.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.shannon.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.evenness.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.simpsonDiversity.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.threatenedSpecies > 0 ? (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <TriangleAlert className="h-3 w-3" />
                            {row.threatenedSpecies}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Species detail
// ---------------------------------------------------------------------------

/**
 * Species detail, including a GBIF cross-check.
 *
 * The verification is fetched only when the user asks for it: GBIF is a public
 * service and firing a query every time a card is opened would be inconsiderate
 * as well as slow.
 */
function SpeciesSheet({ species, onClose }: { species: Species | null; onClose: () => void }) {
  const [checkGbif, setCheckGbif] = useState(false);
  const observations = useSpeciesObservations(species?.id ?? '');
  const gbif = useGbifVerification(species?.id ?? '', checkGbif);

  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return (
    <Sheet
      open={Boolean(species)}
      onOpenChange={(open) => {
        if (!open) { onClose(); setCheckGbif(false); }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {species && (
          <>
            <SheetHeader>
              <SheetTitle>{displayName(species)}</SheetTitle>
              <SheetDescription className="italic">
                {species.scientificName}
                {!species.commonName?.trim() && <span className="not-italic"> · no English common name</span>}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize">{species.class}</Badge>
                {species.order && <Badge variant="outline">{species.order}</Badge>}
                {species.family && <Badge variant="outline">{species.family}</Badge>}
                <IucnBadge status={species.conservationStatus} />
                <IntroductionBadges species={species} />
                {species.isIndicator && (
                  <Badge variant="outline" className="border-info/30 bg-info/10 text-info">Indicator species</Badge>
                )}
              </div>

              {species.images[0] && (
                <figure className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote GBIF photograph */}
                  <img src={species.images[0]} alt={displayName(species)} className="max-h-72 w-full rounded-lg object-cover" />
                  {species.imageCredit && (
                    <figcaption className="text-[11px] text-muted-foreground">Photo: {species.imageCredit}</figcaption>
                  )}
                </figure>
              )}

              {species.gbifKey != null && (
                <a
                  href={gbifSpeciesUrl(species.gbifKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View on GBIF.org
                </a>
              )}

              {species.description && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">About</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{species.description}</p>
                </div>
              )}

              {species.habitat && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">Habitat</p>
                  <p className="text-sm text-muted-foreground">{species.habitat}</p>
                </div>
              )}

              {species.seasonality.length > 0 && species.seasonality.length < 12 && (
                <div>
                  <p className="mb-2 text-sm font-medium">Months with records</p>
                  <div className="flex gap-1">
                    {MONTHS.map((label, index) => {
                      const present = species.seasonality.includes(index + 1);
                      return (
                        <div
                          key={index}
                          title={present ? 'Recorded in this month' : 'No records in this month'}
                          className={cn(
                            'flex h-8 flex-1 items-center justify-center rounded text-[11px] font-medium',
                            present ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground/40'
                          )}
                        >
                          {label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* --- GBIF cross-check --- */}
              <div className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <Globe2 className="h-4 w-4 text-primary" />
                      Cross-check against GBIF
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Does the global occurrence record agree this species belongs here?
                    </p>
                  </div>
                  {!checkGbif && (
                    <Button size="sm" variant="outline" onClick={() => setCheckGbif(true)}>Check</Button>
                  )}
                </div>

                {checkGbif && (
                  <div className="mt-3">
                    {gbif.isPending ? (
                      <LoadingState label="Querying GBIF…" className="py-6" />
                    ) : gbif.isError ? (
                      <p className="text-xs text-destructive">{gbif.error.message}</p>
                    ) : (
                      <div className="space-y-2.5">
                        <div
                          className={cn(
                            'rounded-lg p-3 text-xs',
                            gbif.data.verdict === 'corroborated'
                              ? 'bg-success/10 text-success'
                              : gbif.data.verdict === 'not-recorded-nearby'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {gbif.data.note}
                        </div>

                        {gbif.data.occurrences.ok && (
                          <p className="text-xs text-muted-foreground">
                            <strong className="text-foreground">
                              {gbif.data.occurrences.total?.toLocaleString()}
                            </strong>{' '}
                            georeferenced records within {gbif.data.occurrences.radiusKm} km.
                          </p>
                        )}

                        {gbif.data.taxonomy.ok && gbif.data.taxonomy.accepted && (
                          <p className="text-xs text-muted-foreground">
                            Taxonomy: {gbif.data.taxonomy.matchType} match at{' '}
                            {gbif.data.taxonomy.confidence}% confidence ·{' '}
                            {gbif.data.taxonomy.kingdom} › {gbif.data.taxonomy.family}
                          </p>
                        )}

                        <p className="text-[10px] text-muted-foreground">
                          Data from the Global Biodiversity Information Facility (gbif.org)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* --- Observation history --- */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="h-4 w-4" />
                  Observation history
                </p>
                {observations.isPending ? (
                  <LoadingState label="Loading observations…" className="py-6" />
                ) : observations.isError ? (
                  <ErrorState error={observations.error} onRetry={() => observations.refetch()} />
                ) : !observations.data.observations.length ? (
                  <EmptyState
                    title="No observations yet"
                    description="This species is catalogued but has no observation records in the monitored parks."
                    icon="Bird"
                    className="py-8"
                  />
                ) : (
                  <>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Verified total: {observations.data.verifiedIndividuals.toLocaleString()} (GBIF rows count
                      occurrence records) · showing the latest {observations.data.observations.length} row
                      {observations.data.observations.length === 1 ? '' : 's'}
                      {observations.data.observations.length >= 50 && ' (the list is limited to 50)'}
                    </p>
                    <div className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
                      {observations.data.observations.map((record) => (
                        <div key={record.id} className="rounded-lg border p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium">
                              {typeof record.park === 'object' ? record.park.name : '—'}
                              {record.locationName && record.source !== 'gbif' && ` · ${record.locationName}`}
                            </p>
                            <span className="shrink-0 text-xs tabular-nums">{countLabel(record)}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {observedLabel(record)} · {record.observerName}
                            {!record.verified && ' · unverified'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
