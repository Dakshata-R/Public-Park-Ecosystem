'use client';

/**
 * TanStack Query hooks over `lib/api/endpoints`.
 *
 * Query keys are built from one `qk` factory rather than written inline, so
 * invalidation after a mutation cannot miss a cache entry because a key was
 * spelled differently in two files.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';
import {
  adminApi, aiApi, alertApi, analyticsApi, assetApi, assistantApi,
  biodiversityApi, citizenApi, dashboardApi, gisApi, incidentApi,
  integrationApi, maintenanceApi, parkApi, sensorApi, settingsApi, userApi,
  type ExportDataset,
} from '@/lib/api/endpoints';
import type {
  AiTask, Asset, CitizenReport, EcoReport, EcoReportType, Incident, Observation,
  Park, Sensor, Species, SystemSettings, User, WorkOrder,
} from '@/lib/types';

type Filters = Record<string, string | number | boolean | undefined>;

/**
 * Query-key factory. Every key starts with its module name, so
 * `invalidateQueries({ queryKey: qk.incidents.all })` clears every incident
 * query — list, detail, triage and stats — in one call.
 */
export const qk = {
  dashboard: {
    all: ['dashboard'] as const,
    overview: (park?: string) => ['dashboard', 'overview', park ?? 'city'] as const,
    trend: (days: number, park?: string) => ['dashboard', 'trend', days, park ?? 'city'] as const,
    activity: (limit: number, park?: string) => ['dashboard', 'activity', limit, park ?? 'city'] as const,
  },
  gis: {
    all: ['gis'] as const,
    layers: (layers?: string, park?: string) => ['gis', 'layers', layers ?? 'all', park ?? 'city'] as const,
    heatmap: (metric: string, park?: string) => ['gis', 'heatmap', metric, park ?? 'city'] as const,
  },
  parks: {
    all: ['parks'] as const,
    list: (filters?: Filters) => ['parks', 'list', filters ?? {}] as const,
    detail: (id: string) => ['parks', 'detail', id] as const,
    health: (id: string) => ['parks', 'health', id] as const,
    summary: (id: string) => ['parks', 'summary', id] as const,
  },
  assets: {
    all: ['assets'] as const,
    list: (filters?: Filters) => ['assets', 'list', filters ?? {}] as const,
    detail: (id: string) => ['assets', 'detail', id] as const,
    history: (id: string) => ['assets', 'history', id] as const,
    stats: (park?: string) => ['assets', 'stats', park ?? 'city'] as const,
  },
  biodiversity: {
    all: ['biodiversity'] as const,
    indices: (park?: string, days?: number) => ['biodiversity', 'indices', park ?? 'city', days ?? 0] as const,
    compare: ['biodiversity', 'compare'] as const,
    seasonality: (filters?: Filters) => ['biodiversity', 'seasonality', filters ?? {}] as const,
    species: (filters?: Filters) => ['biodiversity', 'species', filters ?? {}] as const,
    speciesDetail: (id: string) => ['biodiversity', 'species', 'detail', id] as const,
    speciesObservations: (id: string) => ['biodiversity', 'species', 'observations', id] as const,
    observations: (filters?: Filters) => ['biodiversity', 'observations', filters ?? {}] as const,
  },
  ai: {
    all: ['ai'] as const,
    tasks: ['ai', 'tasks'] as const,
    list: (filters?: Filters) => ['ai', 'list', filters ?? {}] as const,
    gallery: (task?: AiTask) => ['ai', 'gallery', task ?? 'all'] as const,
    stats: ['ai', 'stats'] as const,
  },
  sensors: {
    all: ['sensors'] as const,
    list: (filters?: Filters) => ['sensors', 'list', filters ?? {}] as const,
    live: (park?: string) => ['sensors', 'live', park ?? 'city'] as const,
    readings: (id: string, hours: number) => ['sensors', 'readings', id, hours] as const,
    anomalies: (id: string) => ['sensors', 'anomalies', id] as const,
  },
  citizen: {
    all: ['citizen'] as const,
    list: (filters?: Filters) => ['citizen', 'list', filters ?? {}] as const,
    detail: (id: string) => ['citizen', 'detail', id] as const,
    mine: ['citizen', 'mine'] as const,
    myUpvotes: ['citizen', 'my-upvotes'] as const,
    stats: ['citizen', 'stats'] as const,
  },
  incidents: {
    all: ['incidents'] as const,
    list: (filters?: Filters) => ['incidents', 'list', filters ?? {}] as const,
    detail: (id: string) => ['incidents', 'detail', id] as const,
    triage: (park?: string) => ['incidents', 'triage', park ?? 'city'] as const,
    stats: (park?: string) => ['incidents', 'stats', park ?? 'city'] as const,
  },
  alerts: {
    all: ['alerts'] as const,
    list: (filters?: Filters) => ['alerts', 'list', filters ?? {}] as const,
  },
  maintenance: {
    all: ['maintenance'] as const,
    list: (filters?: Filters) => ['maintenance', 'list', filters ?? {}] as const,
    detail: (id: string) => ['maintenance', 'detail', id] as const,
    calendar: (month?: string, park?: string) => ['maintenance', 'calendar', month ?? 'now', park ?? 'city'] as const,
    stats: (park?: string) => ['maintenance', 'stats', park ?? 'city'] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    summary: (filters?: Filters) => ['analytics', 'summary', filters ?? {}] as const,
    environmental: (filters?: Filters) => ['analytics', 'environmental', filters ?? {}] as const,
    biodiversity: (filters?: Filters) => ['analytics', 'biodiversity', filters ?? {}] as const,
    incidents: (filters?: Filters) => ['analytics', 'incidents', filters ?? {}] as const,
    engagement: (filters?: Filters) => ['analytics', 'engagement', filters ?? {}] as const,
    comparison: ['analytics', 'comparison'] as const,
    reports: (filters?: Filters) => ['analytics', 'reports', filters ?? {}] as const,
  },
  assistant: {
    all: ['assistant'] as const,
    suggestions: ['assistant', 'suggestions'] as const,
    history: (sessionId: string) => ['assistant', 'history', sessionId] as const,
  },
  integrations: {
    all: ['integrations'] as const,
    status: ['integrations', 'status'] as const,
    weather: (park?: string) => ['integrations', 'weather', park ?? 'city'] as const,
    airQuality: (park?: string) => ['integrations', 'air-quality', park ?? 'city'] as const,
    conditions: (park?: string) => ['integrations', 'conditions', park ?? 'city'] as const,
    gbif: (speciesId: string) => ['integrations', 'gbif', speciesId] as const,
  },
  users: {
    all: ['users'] as const,
    staff: ['users', 'staff'] as const,
  },
  settings: {
    public: ['settings', 'public'] as const,
  },
  admin: {
    all: ['admin'] as const,
    users: (filters?: Filters) => ['admin', 'users', filters ?? {}] as const,
    settings: ['admin', 'settings'] as const,
    audit: (filters?: Filters) => ['admin', 'audit', filters ?? {}] as const,
    stats: ['admin', 'stats'] as const,
  },
};

/** Shared options type, minus the parts each hook supplies itself. */
type Opts<T> = Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>;

// ---------------------------------------------------------------------------
// Module 1 — Dashboard
// ---------------------------------------------------------------------------

export const useDashboard = (park?: string) =>
  useQuery({ queryKey: qk.dashboard.overview(park), queryFn: () => dashboardApi.overview(park) });

export const useHealthTrend = (days = 30, park?: string) =>
  useQuery({ queryKey: qk.dashboard.trend(days, park), queryFn: () => dashboardApi.trend({ days, park }) });

export const useActivityFeed = (limit = 15, park?: string) =>
  useQuery({ queryKey: qk.dashboard.activity(limit, park), queryFn: () => dashboardApi.activity(limit, park) });

// ---------------------------------------------------------------------------
// Module 2 — GIS
// ---------------------------------------------------------------------------

export const useMapLayers = (layers?: string, park?: string) =>
  useQuery({ queryKey: qk.gis.layers(layers, park), queryFn: () => gisApi.layers({ layers, park }) });

export const useHeatmap = (metric: 'pollution' | 'incidents' | 'wildlife', park?: string, enabled = true) =>
  useQuery({ queryKey: qk.gis.heatmap(metric, park), queryFn: () => gisApi.heatmap({ metric, park }), enabled });

// ---------------------------------------------------------------------------
// Module 3 — Parks & assets
// ---------------------------------------------------------------------------

export const useParks = (filters?: Filters) =>
  useQuery({
    queryKey: qk.parks.list(filters),
    queryFn: () => parkApi.list({ limit: 100, ...filters }),
    // The park list changes rarely and is referenced by nearly every filter
    // dropdown in the application, so it is worth a long stale window.
    staleTime: 10 * 60 * 1000,
  });

export const usePark = (id: string, options?: Opts<Park>) =>
  useQuery({ queryKey: qk.parks.detail(id), queryFn: () => parkApi.get(id), enabled: Boolean(id), ...options });

export const useParkHealth = (id: string) =>
  useQuery({ queryKey: qk.parks.health(id), queryFn: () => parkApi.health(id), enabled: Boolean(id) });

export const useParkSummary = (id: string) =>
  useQuery({ queryKey: qk.parks.summary(id), queryFn: () => parkApi.summary(id), enabled: Boolean(id) });

export const useAssets = (filters?: Filters) =>
  useQuery({ queryKey: qk.assets.list(filters), queryFn: () => assetApi.list(filters) });

export const useAsset = (id: string) =>
  useQuery({ queryKey: qk.assets.detail(id), queryFn: () => assetApi.get(id), enabled: Boolean(id) });

export const useAssetHistory = (id: string) =>
  useQuery({ queryKey: qk.assets.history(id), queryFn: () => assetApi.history(id), enabled: Boolean(id) });

export const useAssetStats = (park?: string) =>
  useQuery({ queryKey: qk.assets.stats(park), queryFn: () => assetApi.stats(park) });

// ---------------------------------------------------------------------------
// Module 4 — Biodiversity
// ---------------------------------------------------------------------------

export const useBiodiversityIndices = (park?: string, days?: number) =>
  useQuery({ queryKey: qk.biodiversity.indices(park, days), queryFn: () => biodiversityApi.indices({ park, days }) });

export const useBiodiversityComparison = () =>
  useQuery({ queryKey: qk.biodiversity.compare, queryFn: () => biodiversityApi.compare() });

export const useSeasonality = (filters?: { species?: string; park?: string }) =>
  useQuery({ queryKey: qk.biodiversity.seasonality(filters), queryFn: () => biodiversityApi.seasonality(filters) });

export const useSpeciesList = (filters?: Filters) =>
  useQuery({ queryKey: qk.biodiversity.species(filters), queryFn: () => biodiversityApi.listSpecies(filters) });

export const useSpecies = (id: string) =>
  useQuery({ queryKey: qk.biodiversity.speciesDetail(id), queryFn: () => biodiversityApi.getSpecies(id), enabled: Boolean(id) });

export const useSpeciesObservations = (id: string) =>
  useQuery({
    queryKey: qk.biodiversity.speciesObservations(id),
    queryFn: () => biodiversityApi.speciesObservations(id, { limit: 50 }),
    enabled: Boolean(id),
  });

export const useObservations = (filters?: Filters) =>
  useQuery({ queryKey: qk.biodiversity.observations(filters), queryFn: () => biodiversityApi.listObservations(filters) });

// ---------------------------------------------------------------------------
// Module 5 — AI
// ---------------------------------------------------------------------------

export const useAiTasks = () =>
  useQuery({ queryKey: qk.ai.tasks, queryFn: () => aiApi.tasks(), staleTime: Infinity });

export const useAiDetections = (filters?: Filters) =>
  useQuery({ queryKey: qk.ai.list(filters), queryFn: () => aiApi.list(filters) });

export const useAiGallery = (task?: AiTask) =>
  useQuery({ queryKey: qk.ai.gallery(task), queryFn: () => aiApi.gallery(task) });

export const useAiStats = () => useQuery({ queryKey: qk.ai.stats, queryFn: () => aiApi.stats() });

// ---------------------------------------------------------------------------
// Module 6 — Sensors
// ---------------------------------------------------------------------------

export const useSensors = (filters?: Filters) =>
  useQuery({ queryKey: qk.sensors.list(filters), queryFn: () => sensorApi.list({ limit: 100, ...filters }) });

export const useLiveSensors = (park?: string) =>
  useQuery({
    queryKey: qk.sensors.live(park),
    queryFn: () => sensorApi.live(park),
    // Sensors refresh once a minute on the server (Open-Meteo publishes a new
    // observation every 15 minutes), so polling faster re-reads identical data.
    refetchInterval: 60_000,
  });

export const useSensorReadings = (id: string, hours = 24) =>
  useQuery({ queryKey: qk.sensors.readings(id, hours), queryFn: () => sensorApi.readings(id, hours), enabled: Boolean(id) });

export const useSensorAnomalies = (id: string) =>
  useQuery({ queryKey: qk.sensors.anomalies(id), queryFn: () => sensorApi.anomalies(id), enabled: Boolean(id) });

// ---------------------------------------------------------------------------
// Module 7 — Citizen portal
// ---------------------------------------------------------------------------

export const useCitizenReports = (filters?: Filters) =>
  useQuery({ queryKey: qk.citizen.list(filters), queryFn: () => citizenApi.list(filters) });

export const useCitizenReport = (id: string) =>
  useQuery({ queryKey: qk.citizen.detail(id), queryFn: () => citizenApi.get(id), enabled: Boolean(id) });

export const useMyReports = (enabled = true) =>
  useQuery({ queryKey: qk.citizen.mine, queryFn: () => citizenApi.myReports(), enabled });

/** Ids of reports the signed-in account has upvoted, for the toggle state. */
export const useMyUpvotes = (enabled = true) =>
  useQuery({ queryKey: qk.citizen.myUpvotes, queryFn: () => citizenApi.myUpvotes(), enabled });

export const useCitizenStats = () =>
  useQuery({ queryKey: qk.citizen.stats, queryFn: () => citizenApi.stats() });

// ---------------------------------------------------------------------------
// Module 8 — Incidents & alerts
// ---------------------------------------------------------------------------

export const useIncidents = (filters?: Filters) =>
  useQuery({ queryKey: qk.incidents.list(filters), queryFn: () => incidentApi.list(filters) });

export const useIncident = (id: string) =>
  useQuery({ queryKey: qk.incidents.detail(id), queryFn: () => incidentApi.get(id), enabled: Boolean(id) });

export const useTriageQueue = (park?: string) =>
  useQuery({ queryKey: qk.incidents.triage(park), queryFn: () => incidentApi.triage(park) });

export const useIncidentStats = (park?: string) =>
  useQuery({ queryKey: qk.incidents.stats(park), queryFn: () => incidentApi.stats(park) });

export const useAlerts = (filters?: Filters) =>
  useQuery({ queryKey: qk.alerts.list(filters), queryFn: () => alertApi.list(filters) });

// ---------------------------------------------------------------------------
// Module 9 — Maintenance
// ---------------------------------------------------------------------------

export const useWorkOrders = (filters?: Filters) =>
  useQuery({ queryKey: qk.maintenance.list(filters), queryFn: () => maintenanceApi.list(filters) });

export const useWorkOrder = (id: string) =>
  useQuery({ queryKey: qk.maintenance.detail(id), queryFn: () => maintenanceApi.get(id), enabled: Boolean(id) });

export const useMaintenanceCalendar = (month?: string, park?: string) =>
  useQuery({ queryKey: qk.maintenance.calendar(month, park), queryFn: () => maintenanceApi.calendar({ month, park }) });

export const useMaintenanceStats = (park?: string) =>
  useQuery({ queryKey: qk.maintenance.stats(park), queryFn: () => maintenanceApi.stats(park) });

// ---------------------------------------------------------------------------
// Module 10 — Analytics
// ---------------------------------------------------------------------------

export const useAnalyticsSummary = (filters?: { park?: string; days?: number }) =>
  useQuery({ queryKey: qk.analytics.summary(filters), queryFn: () => analyticsApi.summary(filters) });

export const useEnvironmentalTrend = (filters?: { park?: string; days?: number; interval?: 'day' | 'week' | 'month' }) =>
  useQuery({ queryKey: qk.analytics.environmental(filters), queryFn: () => analyticsApi.environmentalTrend(filters) });

export const useBiodiversityTrend = (filters?: { park?: string; days?: number }) =>
  useQuery({ queryKey: qk.analytics.biodiversity(filters), queryFn: () => analyticsApi.biodiversityTrend(filters) });

export const useIncidentTrend = (filters?: { park?: string; days?: number }) =>
  useQuery({ queryKey: qk.analytics.incidents(filters), queryFn: () => analyticsApi.incidentTrend(filters) });

export const useEngagementTrend = (filters?: { park?: string; days?: number }) =>
  useQuery({ queryKey: qk.analytics.engagement(filters), queryFn: () => analyticsApi.engagement(filters) });

export const useParkComparison = () =>
  useQuery({ queryKey: qk.analytics.comparison, queryFn: () => analyticsApi.parkComparison() });

export const useEcoReports = (filters?: Filters) =>
  useQuery({ queryKey: qk.analytics.reports(filters), queryFn: () => analyticsApi.listReports(filters) });

// ---------------------------------------------------------------------------
// Module 11 — Assistant
// ---------------------------------------------------------------------------

export const useAssistantSuggestions = () =>
  useQuery({ queryKey: qk.assistant.suggestions, queryFn: () => assistantApi.suggestions(), staleTime: Infinity });

/** A stored conversation, so a reload does not lose it. */
export const useAssistantHistory = (sessionId?: string | null) =>
  useQuery({
    queryKey: qk.assistant.history(sessionId ?? ''),
    queryFn: () => assistantApi.history(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: Infinity,
  });

// ---------------------------------------------------------------------------
// External integrations
// ---------------------------------------------------------------------------

export const useParkConditions = (park?: string) =>
  useQuery({
    queryKey: qk.integrations.conditions(park),
    queryFn: () => integrationApi.parkConditions(park),
    // Upstream refreshes hourly and the server caches for 10–15 minutes, so
    // anything faster than this just re-reads the same cache entry.
    staleTime: 10 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    // A failed upstream should not retry aggressively — the panel degrades
    // gracefully and the next scheduled refetch will try again.
    retry: 1,
  });

export const useLiveWeather = (park?: string) =>
  useQuery({
    queryKey: qk.integrations.weather(park),
    queryFn: () => integrationApi.weather(park),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

export const useLiveAirQuality = (park?: string) =>
  useQuery({
    queryKey: qk.integrations.airQuality(park),
    queryFn: () => integrationApi.airQuality(park),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

export const useIntegrationStatus = () =>
  useQuery({ queryKey: qk.integrations.status, queryFn: () => integrationApi.status(), retry: 1 });

export const useGbifVerification = (speciesId: string, enabled = false) =>
  useQuery({
    queryKey: qk.integrations.gbif(speciesId),
    queryFn: () => integrationApi.verifySpecies(speciesId),
    enabled: enabled && Boolean(speciesId),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

// ---------------------------------------------------------------------------
// Module 12 — Administration
// ---------------------------------------------------------------------------

/** Administrators only — for everyone else's assignee pickers use `useStaff`. */
export const useUsers = (filters?: Filters, enabled = true) =>
  useQuery({ queryKey: qk.admin.users(filters), queryFn: () => adminApi.listUsers(filters), enabled });

/** Assignable staff (officer+). Pass `enabled` false for roles that cannot assign. */
export const useStaff = (enabled = true) =>
  useQuery({ queryKey: qk.users.staff, queryFn: () => userApi.staff(), enabled, staleTime: 5 * 60 * 1000 });

/** Organisation name, contact and feature switches every visitor's interface needs. */
export const usePublicSettings = () =>
  useQuery({ queryKey: qk.settings.public, queryFn: () => settingsApi.public(), staleTime: 5 * 60 * 1000 });

export const useSettings = (enabled = true) =>
  useQuery({ queryKey: qk.admin.settings, queryFn: () => adminApi.settings(), enabled });

export const useAuditLog = (filters?: Filters) =>
  useQuery({ queryKey: qk.admin.audit(filters), queryFn: () => adminApi.auditLog(filters) });

export const useSystemStats = (enabled = true) =>
  useQuery({ queryKey: qk.admin.stats, queryFn: () => adminApi.stats(), enabled });

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Wrap a mutation with a success toast, an error toast, and cache
 * invalidation. Every mutation below goes through this so the three are never
 * accidentally omitted.
 */
function useApiMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options: {
    successMessage?: string | ((data: TData) => string);
    /**
     * Query keys to invalidate. Readonly at both levels because the `qk`
     * factory returns `as const` tuples — accepting mutable arrays would
     * reject every key it produces.
     */
    invalidate?: readonly (readonly unknown[])[];
    onSuccess?: (data: TData, vars: TVars) => void;
  } = {}
) {
  const queryClient = useQueryClient();

  return useMutation<TData, ApiError, TVars>({
    mutationFn,
    onSuccess: (data, vars) => {
      for (const key of options.invalidate ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (options.successMessage) {
        const message =
          typeof options.successMessage === 'function'
            ? options.successMessage(data)
            : options.successMessage;
        toast.success(message);
      }
      options.onSuccess?.(data, vars);
    },
    onError: (error) => {
      // An expired session is announced once by AuthProvider, not per mutation.
      if (error instanceof ApiError && error.isAuthError) return;
      // Field-level detail is far more useful than "Validation failed".
      const detail = error.details ? Object.values(error.details).join('. ') : '';
      toast.error(error.message, detail ? { description: detail } : undefined);
    },
  });
}

// --- Assets ---
export const useCreateAsset = () =>
  useApiMutation((body: Partial<Asset>) => assetApi.create(body), {
    successMessage: 'Asset added to the inventory',
    invalidate: [qk.assets.all, qk.gis.all, qk.dashboard.all],
  });

export const useUpdateAsset = () =>
  useApiMutation(({ id, body }: { id: string; body: Partial<Asset> }) => assetApi.update(id, body), {
    successMessage: 'Asset updated',
    invalidate: [qk.assets.all, qk.gis.all, qk.dashboard.all],
  });

export const useDeleteAsset = () =>
  useApiMutation((id: string) => assetApi.remove(id), {
    successMessage: 'Asset retired',
    invalidate: [qk.assets.all, qk.gis.all],
  });

export const useAddMaintenance = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: Parameters<typeof assetApi.addMaintenance>[1] }) =>
      assetApi.addMaintenance(id, body),
    { successMessage: 'Maintenance recorded', invalidate: [qk.assets.all] }
  );

// --- Biodiversity ---
export const useCreateSpecies = () =>
  useApiMutation((body: Partial<Species>) => biodiversityApi.createSpecies(body), {
    successMessage: 'Species added to the catalogue',
    invalidate: [qk.biodiversity.all],
  });

export const useUpdateSpecies = () =>
  useApiMutation(({ id, body }: { id: string; body: Partial<Species> }) => biodiversityApi.updateSpecies(id, body), {
    successMessage: 'Species updated',
    invalidate: [qk.biodiversity.all],
  });

export const useDeleteSpecies = () =>
  useApiMutation((id: string) => biodiversityApi.removeSpecies(id), {
    successMessage: 'Species removed',
    invalidate: [qk.biodiversity.all],
  });

export const useCreateObservation = () =>
  useApiMutation((body: Partial<Observation>) => biodiversityApi.createObservation(body), {
    successMessage: 'Observation recorded',
    invalidate: [qk.biodiversity.all, qk.gis.all, qk.dashboard.all],
  });

export const useVerifyObservation = () =>
  useApiMutation(
    ({ id, verified }: { id: string; verified: boolean }) => biodiversityApi.verifyObservation(id, verified),
    {
      // Verification is what admits a record into the indices, so the
      // biodiversity scores everywhere must be recomputed.
      successMessage: (o) => (o.verified ? 'Observation verified and counted' : 'Verification withdrawn'),
      invalidate: [qk.biodiversity.all, qk.dashboard.all, qk.analytics.all],
    }
  );

// --- AI ---
export const useAnalyzeImage = () =>
  useApiMutation(
    (body: { task: AiTask; imageUrl: string; imageName?: string; park?: string }) => aiApi.analyze(body),
    {
      successMessage: (r) =>
        r.escalated
          ? `${r.inference.prediction} — incident ${r.escalated.referenceCode} opened automatically`
          : `${r.inference.prediction} (${r.inference.confidence}% confidence)`,
      invalidate: [qk.ai.all, qk.incidents.all, qk.dashboard.all],
    }
  );

export const useReviewDetection = () =>
  useApiMutation(
    ({ id, verdict, correctedLabel }: { id: string; verdict: 'confirmed' | 'rejected'; correctedLabel?: string }) =>
      aiApi.review(id, { verdict, correctedLabel }),
    { successMessage: 'Review recorded', invalidate: [qk.ai.all] }
  );

// --- Sensors ---
export const useRefreshSensors = () =>
  useApiMutation((_: void) => sensorApi.refresh(), {
    successMessage: (r) => {
      const parts = [
        `${r.live} new Open-Meteo observation${r.live === 1 ? '' : 's'}`,
        r.simulationEnabled ? `${r.simulated} simulated reading${r.simulated === 1 ? '' : 's'}` : 'simulation is switched off',
      ];
      if (r.anomalies) parts.push(`${r.anomalies} flagged as anomalous`);
      return parts.join(' · ');
    },
    onSuccess: (r) => {
      // A partial upstream failure is not an error, but it must not be silent.
      if (r.errors.length) {
        toast.warning('Some live data could not be fetched', { description: r.errors.slice(0, 3).join(' · ') });
      }
    },
    invalidate: [qk.sensors.all, qk.dashboard.all, qk.alerts.all, qk.parks.all],
  });

export const useCreateSensor = () =>
  useApiMutation((body: Partial<Sensor>) => sensorApi.create(body), {
    successMessage: 'Sensor registered',
    invalidate: [qk.sensors.all, qk.gis.all],
  });

export const useUpdateSensor = () =>
  useApiMutation(({ id, body }: { id: string; body: Partial<Sensor> }) => sensorApi.update(id, body), {
    successMessage: 'Sensor updated',
    invalidate: [qk.sensors.all, qk.gis.all],
  });

export const useDeleteSensor = () =>
  useApiMutation((id: string) => sensorApi.remove(id), {
    successMessage: 'Sensor decommissioned',
    invalidate: [qk.sensors.all, qk.gis.all],
  });

// --- Citizen ---
export const useCreateReport = () =>
  useApiMutation((body: Partial<CitizenReport>) => citizenApi.create(body), {
    successMessage: (r) => `Report ${r.referenceCode} submitted — thank you`,
    invalidate: [qk.citizen.all, qk.gis.all, qk.dashboard.all],
  });

/** Toggle the signed-in account's upvote on a report. */
export const useUpvoteReport = () =>
  useApiMutation(
    ({ id, upvoted }: { id: string; upvoted: boolean }) => (upvoted ? citizenApi.removeUpvote(id) : citizenApi.upvote(id)),
    // Upvotes feed the priority of a linked incident.
    { invalidate: [qk.citizen.all, qk.incidents.all] }
  );

export const useReviewReport = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: Parameters<typeof citizenApi.review>[1] }) => citizenApi.review(id, body),
    {
      successMessage: (r) =>
        r.createdIncident
          ? `Accepted — incident ${r.createdIncident.referenceCode} opened`
          : r.createdObservation
          ? 'Accepted — sighting added to the biodiversity record'
          : 'Report reviewed',
      invalidate: [qk.citizen.all, qk.incidents.all, qk.biodiversity.all, qk.dashboard.all],
    }
  );

// --- Incidents ---
export const useCreateIncident = () =>
  useApiMutation((body: Partial<Incident>) => incidentApi.create(body), {
    successMessage: (i) => `Incident ${i.referenceCode} opened at ${i.priority} priority`,
    invalidate: [qk.incidents.all, qk.alerts.all, qk.gis.all, qk.dashboard.all],
  });

export const useUpdateIncident = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: Partial<Incident> & { statusNote?: string } }) => incidentApi.update(id, body),
    { successMessage: 'Incident updated', invalidate: [qk.incidents.all, qk.alerts.all, qk.dashboard.all] }
  );

export const useAssignIncident = () =>
  useApiMutation(({ id, assignedTo }: { id: string; assignedTo: string }) => incidentApi.assign(id, assignedTo), {
    successMessage: 'Officer assigned',
    invalidate: [qk.incidents.all, qk.dashboard.all],
  });

export const useResolveIncident = () =>
  useApiMutation(
    ({ id, resolutionNotes }: { id: string; resolutionNotes?: string }) => incidentApi.resolve(id, resolutionNotes),
    {
      successMessage: 'Incident resolved',
      invalidate: [qk.incidents.all, qk.alerts.all, qk.gis.all, qk.dashboard.all],
    }
  );

export const useCreateWorkOrderFromIncident = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: Partial<WorkOrder> }) => incidentApi.createWorkOrder(id, body),
    {
      successMessage: (w) => `Work order ${w.orderCode} raised`,
      invalidate: [qk.maintenance.all, qk.incidents.all],
    }
  );

export const useDeleteIncident = () =>
  useApiMutation((id: string) => incidentApi.remove(id), {
    successMessage: 'Incident deleted',
    invalidate: [qk.incidents.all, qk.dashboard.all],
  });

// --- Alerts ---
export const useAcknowledgeAlert = () =>
  useApiMutation((id: string) => alertApi.acknowledge(id), {
    successMessage: 'Alert acknowledged',
    invalidate: [qk.alerts.all, qk.dashboard.all],
  });

export const useResolveAlert = () =>
  useApiMutation((id: string) => alertApi.resolve(id), {
    successMessage: 'Alert resolved',
    invalidate: [qk.alerts.all, qk.dashboard.all],
  });

export const useAcknowledgeAllAlerts = () =>
  useApiMutation((body: { park?: string; severity?: string } | undefined) => alertApi.acknowledgeAll(body), {
    successMessage: (r) => `${r.acknowledged} alerts acknowledged`,
    invalidate: [qk.alerts.all, qk.dashboard.all],
  });

// --- Maintenance ---
export const useCreateWorkOrder = () =>
  useApiMutation((body: Partial<WorkOrder>) => maintenanceApi.create(body), {
    successMessage: (w) => `Work order ${w.orderCode} scheduled`,
    invalidate: [qk.maintenance.all, qk.dashboard.all],
  });

export const useUpdateWorkOrder = () =>
  useApiMutation(({ id, body }: { id: string; body: Partial<WorkOrder> }) => maintenanceApi.update(id, body), {
    successMessage: 'Work order updated',
    invalidate: [qk.maintenance.all, qk.assets.all, qk.dashboard.all],
  });

export const useUpdateProgress = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: { progress: number; completionNotes?: string; actualCost?: number } }) =>
      maintenanceApi.updateProgress(id, body),
    {
      successMessage: (w) => (w.status === 'completed' ? 'Work order completed' : `Progress set to ${w.progress}%`),
      invalidate: [qk.maintenance.all, qk.assets.all, qk.dashboard.all],
    }
  );

export const useDeleteWorkOrder = () =>
  useApiMutation((id: string) => maintenanceApi.remove(id), {
    successMessage: 'Work order removed',
    invalidate: [qk.maintenance.all],
  });

// --- Reports ---
export const useGenerateReport = () =>
  useApiMutation(
    (body: { type: EcoReportType; park?: string | null; days?: number }) => analyticsApi.generateReport(body),
    { successMessage: (r) => `Draft created: ${r.title}`, invalidate: [qk.analytics.all] }
  );

export const useCreateEcoReport = () =>
  useApiMutation((body: Partial<EcoReport>) => analyticsApi.createReport(body), {
    successMessage: 'Report created',
    invalidate: [qk.analytics.all, qk.dashboard.all],
  });

export const useUpdateEcoReport = () =>
  useApiMutation(({ id, body }: { id: string; body: Partial<EcoReport> }) => analyticsApi.updateReport(id, body), {
    successMessage: 'Report updated',
    invalidate: [qk.analytics.all, qk.dashboard.all],
  });

export const useDeleteEcoReport = () =>
  useApiMutation((id: string) => analyticsApi.removeReport(id), {
    successMessage: 'Report deleted',
    invalidate: [qk.analytics.all],
  });

// --- Parks ---
export const useCreatePark = () =>
  useApiMutation((body: Partial<Park>) => parkApi.create(body), {
    successMessage: 'Park added',
    invalidate: [qk.parks.all, qk.gis.all, qk.dashboard.all],
  });

export const useUpdatePark = () =>
  useApiMutation(({ id, body }: { id: string; body: Partial<Park> }) => parkApi.update(id, body), {
    successMessage: 'Park updated',
    invalidate: [qk.parks.all, qk.gis.all, qk.dashboard.all],
  });

export const useDeletePark = () =>
  useApiMutation((id: string) => parkApi.remove(id), {
    successMessage: 'Park deactivated',
    invalidate: [qk.parks.all, qk.gis.all],
  });

// --- Administration ---
export const useCreateUser = () =>
  useApiMutation((body: Parameters<typeof adminApi.createUser>[0]) => adminApi.createUser(body), {
    successMessage: 'User account created',
    invalidate: [qk.admin.all],
  });

export const useUpdateUser = () =>
  useApiMutation(
    ({ id, body }: { id: string; body: Partial<User> & { password?: string } }) => adminApi.updateUser(id, body),
    { successMessage: 'User updated', invalidate: [qk.admin.all] }
  );

export const useDeleteUser = () =>
  useApiMutation((id: string) => adminApi.removeUser(id), {
    successMessage: 'User deactivated',
    invalidate: [qk.admin.all],
  });

export const useUpdateSettings = () =>
  useApiMutation((body: Partial<SystemSettings>) => adminApi.updateSettings(body), {
    // Changing the index weights re-scores every park, so the dashboard and
    // analytics caches are no longer valid.
    successMessage: 'Settings saved',
    invalidate: [qk.admin.all, qk.dashboard.all, qk.parks.all, qk.analytics.all],
  });

export const useRecomputeScores = () =>
  useApiMutation((_: void) => adminApi.recomputeScores(), {
    successMessage: (r) => `Recomputed scores for ${r.parks} parks`,
    invalidate: [qk.dashboard.all, qk.parks.all, qk.analytics.all],
  });

export const useReindexAssistant = () =>
  useApiMutation((_: void) => adminApi.reindexAssistant(), {
    successMessage: (r) => `Assistant reindexed: ${r.documents} documents, ${r.vocabulary} terms`,
  });

export const useClearIntegrationCache = () =>
  useApiMutation((_: void) => integrationApi.clearCache(), {
    successMessage: (r) => `Cleared ${r.cleared} cached upstream responses`,
    invalidate: [qk.integrations.all],
  });

export const useReseed = () =>
  useApiMutation((_: void) => adminApi.reseed(), {
    successMessage: 'Database reseeded from the reference snapshot',
    invalidate: [['dashboard'], ['parks'], ['assets'], ['biodiversity'], ['sensors'], ['citizen'], ['incidents'], ['maintenance'], ['analytics'], ['ai'], ['alerts'], ['gis'], ['admin']],
  });

export const useAskAssistant = () =>
  useApiMutation(({ question, sessionId }: { question: string; sessionId?: string }) =>
    assistantApi.ask(question, sessionId)
  );

export { type ExportDataset };
