'use client';

/**
 * Module 4 — Biodiversity Management.
 *
 * Species catalogue, observation records and a park-by-park comparison.
 */

import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Bird, CheckCircle2, Sparkles, TriangleAlert, Globe2, Info, ShieldQuestion, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { ConservationBadge } from '@/components/shared/status-badges';
import { ScoreBar } from '@/components/shared/score-badge';
import { SourceBadge } from '@/components/shared/data-source';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, LoadingState, EmptyState, ErrorState } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useBiodiversityComparison,
  useSpeciesList, useSpeciesObservations, useGbifVerification, useVerifyObservation,
  useObservations,
} from '@/lib/hooks/use-api';
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

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

export default function BiodiversityPage() {
  const [park, setPark] = useState(ALL_PARKS);
  const [selected, setSelected] = useState<Species | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Biodiversity Management"
        description="Species recorded across Bengaluru's parks, with verified observation records from GBIF."
        icon="Bird"
        action={<ParkFilter value={park} onChange={setPark} allLabel="All parks (citywide)" />}
      />

      <Tabs defaultValue="catalogue" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="catalogue">Catalogue</TabsTrigger>
          <TabsTrigger value="observations">Observations</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>

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
