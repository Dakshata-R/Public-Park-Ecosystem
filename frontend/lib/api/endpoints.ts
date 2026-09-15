/**
 * Every API call the application makes, in one place.
 *
 * Components never build URLs. They call a function here, which keeps request
 * shapes typed, keeps query-key construction consistent in `lib/hooks`, and
 * means a change to a route is a one-line edit rather than a search across
 * a dozen pages.
 */

import { api, buildQuery, downloadFile, type Paginated, type QueryValue } from './client';
import type {
  Alert, AnalyzeResponse, AskResponse, Asset, AssetStats, AuditEntry, AuthResponse,
  BiodiversityAnalysis, ChatMessage, CitizenReport, DashboardOverview, ActivityEvent,
  AiDetection, AiTask, AiTaskInfo, EcoReport, EcoReportType, HeatPoint, Incident, LiveSensorsResponse, MapLayers,
  Observation, Park, RawIndices, SensorSeries, Sensor, Species, SystemSettings, SystemStats,
  TrendPoint, TriagedIncident, User, WorkOrder, SensorRefreshResult, StaffMember, PublicSettings,
  HealthSubIndices, HealthContribution, Grade, GeoPoint,
  WeatherResponse, AirQualityResponse, ParkConditions, GbifVerification,
  GbifOccurrences, EbirdResponse, GeocodeResponse, IntegrationStatus,
} from '@/lib/types';

type Query = Record<string, QueryValue>;

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const authApi = {
  register: (body: { name: string; email: string; password: string; park?: string }) =>
    api.post<AuthResponse>('/auth/register', body, { anonymous: true }),

  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', body, { anonymous: true }),

  me: () => api.get<User>('/auth/me'),

  updateMe: (body: Partial<Pick<User, 'name' | 'phone' | 'avatar'>> & { park?: string | null }) =>
    api.patch<User>('/auth/me', body),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<{ message: string }>('/auth/change-password', body),
};

// ---------------------------------------------------------------------------
// Module 1 — Dashboard
// ---------------------------------------------------------------------------

export const dashboardApi = {
  overview: (park?: string) => api.get<DashboardOverview>(`/dashboard/overview${buildQuery({ park })}`),
  trend: (params?: { days?: number; park?: string }) =>
    api.get<TrendPoint[]>(`/dashboard/trend${buildQuery(params as Query)}`),
  activity: (limit = 15, park?: string) => api.get<ActivityEvent[]>(`/dashboard/activity${buildQuery({ limit, park })}`),
};

// ---------------------------------------------------------------------------
// Module 2 — GIS
// ---------------------------------------------------------------------------

export const gisApi = {
  layers: (params?: { layers?: string; park?: string }) =>
    api.get<MapLayers>(`/gis/layers${buildQuery(params as Query)}`),

  heatmap: (params: { metric: 'pollution' | 'incidents' | 'wildlife'; park?: string }) =>
    api.get<HeatPoint[]>(`/gis/heatmap${buildQuery(params as Query)}`),

  within: (params: { lng: number; lat: number; radius?: number }) =>
    api.get<{
      centre: [number, number];
      radiusMetres: number;
      parks: { id: string; name: string; health: number | null }[];
      assets: { id: string; name: string; type: string; condition: number }[];
      wildlife: { id: string; species: string; count: number }[];
      incidents: { id: string; title: string; type: string; priority: string }[];
    }>(`/gis/within${buildQuery(params as Query)}`),
};

// ---------------------------------------------------------------------------
// Module 3 — Parks & assets
// ---------------------------------------------------------------------------

export const parkApi = {
  list: (params?: Query) => api.list<Park>(`/parks${buildQuery(params)}`),
  get: (id: string) => api.get<Park>(`/parks/${id}`),
  health: (id: string) =>
    api.get<{
      park: { id: string; name: string };
      /** null when no indicator has data. */
      ecosystemHealth: number | null;
      grade: Grade | null;
      subIndices: HealthSubIndices;
      weights: Record<string, number>;
      contributions: HealthContribution[];
      biodiversityDetail: Record<string, number>;
    }>(`/parks/${id}/health`),
  summary: (id: string) =>
    api.get<{
      park: Park;
      counts: Record<string, number>;
      biodiversity: { score: number; richness: number; shannon: number; evenness: number };
    }>(`/parks/${id}/summary`),
  trend: (id: string, days = 30) => api.get<TrendPoint[]>(`/parks/${id}/trend${buildQuery({ days })}`),
  create: (body: Partial<Park>) => api.post<Park>('/parks', body),
  update: (id: string, body: Partial<Park>) => api.patch<Park>(`/parks/${id}`, body),
  remove: (id: string) => api.delete<void>(`/parks/${id}`),
};

export const assetApi = {
  list: (params?: Query) => api.list<Asset>(`/assets${buildQuery(params)}`),
  get: (id: string) => api.get<Asset>(`/assets/${id}`),
  stats: (park?: string) => api.get<AssetStats>(`/assets/stats${buildQuery({ park })}`),
  history: (id: string) =>
    api.get<{ asset: Asset; maintenance: Asset['maintenance']; workOrders: WorkOrder[]; totalSpend: number }>(
      `/assets/${id}/history`
    ),
  create: (body: Partial<Asset>) => api.post<Asset>('/assets', body),
  update: (id: string, body: Partial<Asset>) => api.patch<Asset>(`/assets/${id}`, body),
  remove: (id: string) => api.delete<void>(`/assets/${id}`),
  addMaintenance: (
    id: string,
    body: { type: string; description?: string; cost?: number; technician?: string; conditionAfter?: number; date?: string }
  ) => api.post<Asset>(`/assets/${id}/maintenance`, body),
};

// ---------------------------------------------------------------------------
// Module 4 — Biodiversity
// ---------------------------------------------------------------------------

export const biodiversityApi = {
  indices: (params?: { park?: string; days?: number }) =>
    api.get<BiodiversityAnalysis>(`/biodiversity/indices${buildQuery(params as Query)}`),

  /** Recompute the indices for a hand-entered abundance vector. */
  previewIndices: (abundances: number[]) =>
    api.post<RawIndices>('/biodiversity/indices/preview', { abundances }),

  compare: () =>
    api.get<
      {
        park: string;
        parkId: string;
        score: number;
        richness: number;
        shannon: number;
        evenness: number;
        simpsonDiversity: number;
        threatenedSpecies: number;
        totalIndividuals: number;
      }[]
    >('/biodiversity/compare'),

  seasonality: (params?: { species?: string; park?: string }) =>
    api.get<{ month: string; individuals: number; sightings: number; richness: number }[]>(
      `/biodiversity/seasonality${buildQuery(params as Query)}`
    ),

  listSpecies: (params?: Query) => api.list<Species>(`/biodiversity/species${buildQuery(params)}`),
  getSpecies: (id: string) => api.get<Species>(`/biodiversity/species/${id}`),
  speciesObservations: (id: string, params?: Query) =>
    api.get<{ species: Species; observations: Observation[]; verifiedIndividuals: number }>(
      `/biodiversity/species/${id}/observations${buildQuery(params)}`
    ),
  createSpecies: (body: Partial<Species>) => api.post<Species>('/biodiversity/species', body),
  updateSpecies: (id: string, body: Partial<Species>) => api.patch<Species>(`/biodiversity/species/${id}`, body),
  removeSpecies: (id: string) => api.delete<void>(`/biodiversity/species/${id}`),

  listObservations: (params?: Query) => api.list<Observation>(`/biodiversity/observations${buildQuery(params)}`),
  createObservation: (body: Partial<Observation>) => api.post<Observation>('/biodiversity/observations', body),
  verifyObservation: (id: string, verified = true) =>
    api.post<Observation>(`/biodiversity/observations/${id}/verify`, { verified }),
  removeObservation: (id: string) => api.delete<void>(`/biodiversity/observations/${id}`),
};

// ---------------------------------------------------------------------------
// Module 5 — AI
// ---------------------------------------------------------------------------

export const aiApi = {
  tasks: () => api.get<AiTaskInfo[]>('/ai/tasks'),

  /** `imageUrl` is an http(s) URL or an uploaded image as a data URL. Requires sign-in. */
  analyze: (body: { task: AiTask; imageUrl: string; imageName?: string; park?: string; location?: GeoPoint }) =>
    api.post<AnalyzeResponse>('/ai/analyze', body, { timeoutMs: 60_000 }),

  list: (params?: Query) => api.list<AiDetection>(`/ai/detections${buildQuery(params)}`),
  get: (id: string) => api.get<AiDetection>(`/ai/detections/${id}`),
  gallery: (task?: AiTask) => api.get<AiDetection[]>(`/ai/gallery${buildQuery({ task })}`),
  review: (id: string, body: { verdict: 'confirmed' | 'rejected'; correctedLabel?: string }) =>
    api.post<AiDetection>(`/ai/${id}/review`, body),

  stats: () =>
    api.get<{
      byTask: { task: AiTask; count: number; avgConfidence: number }[];
      bySeverity: { severity: string; count: number }[];
      confidenceDistribution: { band: string; count: number }[];
      review: { pending: number; confirmed: number; rejected: number; precision: number | null };
      total: number;
    }>('/ai/stats'),
};

// ---------------------------------------------------------------------------
// Module 6 — Sensors
// ---------------------------------------------------------------------------

export const sensorApi = {
  list: (params?: Query) => api.list<Sensor>(`/sensors${buildQuery(params)}`),
  get: (id: string) => api.get<Sensor>(`/sensors/${id}`),
  live: (park?: string) => api.get<LiveSensorsResponse>(`/sensors/live${buildQuery({ park })}`),
  readings: (id: string, hours = 24) => api.get<SensorSeries>(`/sensors/${id}/readings${buildQuery({ hours })}`),
  anomalies: (id: string, limit = 200) =>
    api.get<{ sensor: Sensor; anomalies: { recordedAt: string; value: number; zScore: number; reason: string }[] }>(
      `/sensors/${id}/anomalies${buildQuery({ limit })}`
    ),
  ingest: (id: string, value: number) => api.post<unknown>(`/sensors/${id}/readings`, { value }),
  /** Pull newer Open-Meteo observations and, if enabled, one simulated reading per simulated sensor. */
  refresh: () => api.post<SensorRefreshResult>('/sensors/refresh', undefined, { timeoutMs: 90_000 }),
  create: (body: Partial<Sensor>) => api.post<Sensor>('/sensors', body),
  update: (id: string, body: Partial<Sensor>) => api.patch<Sensor>(`/sensors/${id}`, body),
  remove: (id: string) => api.delete<void>(`/sensors/${id}`),
};

// ---------------------------------------------------------------------------
// Module 7 — Citizen portal
// ---------------------------------------------------------------------------

export const citizenApi = {
  list: (params?: Query) => api.list<CitizenReport>(`/citizen/reports${buildQuery(params)}`),
  get: (id: string) => api.get<CitizenReport>(`/citizen/reports/${id}`),
  create: (body: Partial<CitizenReport>) => api.post<CitizenReport>('/citizen/reports', body),
  update: (id: string, body: Partial<CitizenReport>) => api.patch<CitizenReport>(`/citizen/reports/${id}`, body),
  remove: (id: string) => api.delete<void>(`/citizen/reports/${id}`),
  /** One upvote per account; repeating it is harmless. */
  upvote: (id: string) => api.post<{ id: string; upvotes: number; upvoted: boolean }>(`/citizen/reports/${id}/upvote`),
  removeUpvote: (id: string) =>
    api.delete<{ id: string; upvotes: number; upvoted: boolean }>(`/citizen/reports/${id}/upvote`),
  /** Ids of the reports the signed-in account has upvoted. */
  myUpvotes: () => api.get<string[]>('/citizen/my-upvotes'),

  review: (
    id: string,
    body: {
      decision: 'accepted' | 'rejected' | 'in-review';
      officialResponse?: string;
      incidentType?: string;
      severity?: number;
      affectedPeople?: number;
      species?: string;
      count?: number;
    }
  ) =>
    api.post<{ report: CitizenReport; createdIncident: Incident | null; createdObservation: Observation | null }>(
      `/citizen/reports/${id}/review`,
      body
    ),

  myReports: () =>
    api.get<{
      reports: CitizenReport[];
      summary: { total: number; byStatus: Record<string, number>; totalUpvotes: number; contributions: number };
    }>('/citizen/my-reports'),

  stats: () =>
    api.get<{
      byCategory: { category: string; count: number }[];
      byStatus: { status: string; count: number }[];
      byPark: { park: string; reports: number; upvotes: number }[];
      topContributors: { id: string; name: string; contributions: number }[];
      total: number;
      acceptanceRate: number;
    }>('/citizen/stats'),
};

// ---------------------------------------------------------------------------
// Module 8 — Incidents & alerts
// ---------------------------------------------------------------------------

export const incidentApi = {
  list: (params?: Query) => api.list<Incident>(`/incidents${buildQuery(params)}`),
  get: (id: string) => api.get<Incident>(`/incidents/${id}`),
  triage: (park?: string) => api.list<TriagedIncident>(`/incidents/triage${buildQuery({ park })}`),
  create: (body: Partial<Incident>) => api.post<Incident>('/incidents', body),
  update: (id: string, body: Partial<Incident> & { statusNote?: string }) =>
    api.patch<Incident>(`/incidents/${id}`, body),
  remove: (id: string) => api.delete<void>(`/incidents/${id}`),
  assign: (id: string, assignedTo: string) => api.post<Incident>(`/incidents/${id}/assign`, { assignedTo }),
  resolve: (id: string, resolutionNotes?: string) =>
    api.post<Incident>(`/incidents/${id}/resolve`, { resolutionNotes }),
  createWorkOrder: (id: string, body: Partial<WorkOrder>) =>
    api.post<WorkOrder>(`/incidents/${id}/work-order`, body),

  stats: (park?: string) =>
    api.get<{
      byType: { type: string; label: string; count: number }[];
      byStatus: { status: string; count: number }[];
      byPriority: { priority: string; count: number }[];
      meanResolution: { type: string; hours: number; targetHours: number | null; resolved: number }[];
      total: number;
      open: number;
      activeAlerts: number;
    }>(`/incidents/stats${buildQuery({ park })}`),
};

export const alertApi = {
  list: (params?: Query) => api.list<Alert>(`/alerts${buildQuery(params)}`),
  get: (id: string) => api.get<Alert>(`/alerts/${id}`),
  acknowledge: (id: string) => api.post<Alert>(`/alerts/${id}/acknowledge`),
  resolve: (id: string) => api.post<Alert>(`/alerts/${id}/resolve`),
  acknowledgeAll: (body?: { park?: string; severity?: string }) =>
    api.post<{ acknowledged: number }>('/alerts/acknowledge-all', body ?? {}),
};

// ---------------------------------------------------------------------------
// Module 9 — Maintenance
// ---------------------------------------------------------------------------

export const maintenanceApi = {
  list: (params?: Query) => api.list<WorkOrder>(`/maintenance${buildQuery(params)}`),
  get: (id: string) => api.get<WorkOrder>(`/maintenance/${id}`),
  calendar: (params?: { month?: string; park?: string }) =>
    api.get<{ month: string; days: Record<string, WorkOrder[]> }>(`/maintenance/calendar${buildQuery(params as Query)}`),
  create: (body: Partial<WorkOrder>) => api.post<WorkOrder>('/maintenance', body),
  update: (id: string, body: Partial<WorkOrder>) => api.patch<WorkOrder>(`/maintenance/${id}`, body),
  remove: (id: string) => api.delete<void>(`/maintenance/${id}`),
  updateProgress: (id: string, body: { progress: number; completionNotes?: string; actualCost?: number }) =>
    api.patch<WorkOrder>(`/maintenance/${id}/progress`, body),

  stats: (park?: string) =>
    api.get<{
      byStatus: { status: string; count: number }[];
      byType: { type: string; count: number; cost: number }[];
      workload: { name: string; role: string; open: number }[];
      totals: {
        total: number;
        completed: number;
        overdue: number;
        inProgress: number;
        completionRate: number;
        estimatedCost: number;
        actualCost: number;
      };
    }>(`/maintenance/stats${buildQuery({ park })}`),
};

// ---------------------------------------------------------------------------
// Module 10 — Analytics
// ---------------------------------------------------------------------------

export type ExportDataset = 'incidents' | 'assets' | 'observations' | 'citizen-reports' | 'work-orders';

export const analyticsApi = {
  summary: (params?: { park?: string; days?: number }) =>
    api.get<{
      window: { from: string; to: string };
      /** Current values — not limited to the selected window. */
      ecosystemHealth: number | null;
      healthGrade: Grade | null;
      subIndices: HealthSubIndices;
      biodiversity: { score: number; richness: number; shannon: number; evenness: number; threatenedSpecies: number };
      incidents: {
        total: number; resolved: number; resolutionRate: number;
        avgResolutionHours: number | null; avgPriorityScore: number;
      };
      citizenReports: number;
      maintenance: { total: number; completed: number; completionRate: number; cost: number };
      aiDetections: number;
      assets: { count: number; avgCondition: number };
    }>(`/analytics/summary${buildQuery(params as Query)}`),

  environmentalTrend: (params?: { park?: string; days?: number; interval?: 'day' | 'week' | 'month' }) =>
    api.get<Record<string, number | string>[]>(`/analytics/environmental-trend${buildQuery(params as Query)}`),

  biodiversityTrend: (params?: { park?: string; days?: number }) =>
    api.get<{ month: string; richness: number; individuals: number; shannon: number; evenness: number; simpsonDiversity: number }[]>(
      `/analytics/biodiversity-trend${buildQuery(params as Query)}`
    ),

  incidentTrend: (params?: { park?: string; days?: number }) =>
    api.get<{ month: string; reported: number; resolved: number; critical: number; backlog: number; avgResolutionHours: number | null }[]>(
      `/analytics/incident-trend${buildQuery(params as Query)}`
    ),

  engagement: (params?: { park?: string; days?: number }) =>
    api.get<Record<string, number | string>[]>(`/analytics/engagement${buildQuery(params as Query)}`),

  /** Sub-index columns are null for parks where they are not measured. */
  parkComparison: () => api.get<Record<string, number | string | null>[]>('/analytics/park-comparison'),

  /** JSON export, for building a PDF in the browser. */
  exportJson: (dataset: ExportDataset, park?: string) =>
    api.get<Record<string, unknown>[]>(`/analytics/export${buildQuery({ dataset, format: 'json', park })}`),

  /** CSV download. The export needs an officer's token, so it is fetched, not linked. */
  exportCsv: (dataset: ExportDataset, park?: string) =>
    downloadFile('/analytics/export', { dataset, format: 'csv', park }, `greenpulse-${dataset}.csv`),

  listReports: (params?: Query) => api.list<EcoReport>(`/analytics/reports${buildQuery(params)}`),
  getReport: (id: string) => api.get<EcoReport>(`/analytics/reports/${id}`),
  createReport: (body: Partial<EcoReport>) => api.post<EcoReport>('/analytics/reports', body),
  /** A draft whose metrics, findings and recommendations are computed from the data. */
  generateReport: (body: { type: EcoReportType; park?: string | null; days?: number }) =>
    api.post<EcoReport>('/analytics/reports/generate', body, { timeoutMs: 60_000 }),
  updateReport: (id: string, body: Partial<EcoReport>) => api.patch<EcoReport>(`/analytics/reports/${id}`, body),
  removeReport: (id: string) => api.delete<void>(`/analytics/reports/${id}`),
};

// ---------------------------------------------------------------------------
// Module 11 — Assistant
// ---------------------------------------------------------------------------

export const assistantApi = {
  ask: (question: string, sessionId?: string) => api.post<AskResponse>('/assistant/ask', { question, sessionId }),
  history: (sessionId: string) => api.get<ChatMessage[]>(`/assistant/history/${sessionId}`),
  suggestions: () => api.get<{ suggestions: string[]; capabilities: string[] }>('/assistant/suggestions'),
  search: (query: string, k = 8) =>
    api.post<{ entity: string; id: string; label: string; score: number }[]>('/assistant/search', { query, k }),
};

// ---------------------------------------------------------------------------
// External integrations — weather, live air quality, GBIF, geocoding
// ---------------------------------------------------------------------------

export const integrationApi = {
  weather: (park?: string) =>
    api.get<WeatherResponse>(`/integrations/weather${buildQuery({ park })}`),

  airQuality: (park?: string) =>
    api.get<AirQualityResponse>(`/integrations/air-quality${buildQuery({ park })}`),

  /** Weather and air quality together — one round trip for the conditions panel. */
  parkConditions: (park?: string) =>
    api.get<ParkConditions>(`/integrations/park-conditions${buildQuery({ park })}`),

  /** Cross-check a catalogued species against GBIF's global occurrence record. */
  verifySpecies: (speciesId: string, park?: string) =>
    api.get<GbifVerification>(`/integrations/gbif/${speciesId}${buildQuery({ park })}`),

  searchGbif: (name: string, park?: string) =>
    api.get<GbifOccurrences>(`/integrations/gbif/search${buildQuery({ name, park })}`),

  ebird: (park?: string) =>
    api.get<EbirdResponse>(`/integrations/ebird${buildQuery({ park })}`),

  geocode: (lat: number, lng: number) =>
    api.get<GeocodeResponse>(`/integrations/geocode${buildQuery({ lat, lng })}`),

  status: () => api.get<IntegrationStatus>('/integrations/status'),

  clearCache: () => api.post<{ cleared: number }>('/integrations/clear-cache'),
};

// ---------------------------------------------------------------------------
// Module 12 — Administration
// ---------------------------------------------------------------------------

export const adminApi = {
  listUsers: (params?: Query) => api.list<User>(`/admin/users${buildQuery(params)}`),
  getUser: (id: string) => api.get<User>(`/admin/users/${id}`),
  createUser: (body: { name: string; email: string; password: string; role: string; park?: string | null }) =>
    api.post<User>('/admin/users', body),
  updateUser: (id: string, body: Partial<User> & { password?: string }) => api.patch<User>(`/admin/users/${id}`, body),
  removeUser: (id: string) => api.delete<void>(`/admin/users/${id}`),

  settings: () => api.get<SystemSettings>('/admin/settings'),
  updateSettings: (body: Partial<SystemSettings>) => api.patch<SystemSettings>('/admin/settings', body),

  auditLog: (params?: Query) => api.list<AuditEntry>(`/admin/audit-log${buildQuery(params)}`),
  stats: () => api.get<SystemStats>('/admin/stats'),

  recomputeScores: () =>
    api.post<{ parks: number; results: { park: string; ecosystemHealth: number }[] }>('/admin/recompute-scores'),
  reindexAssistant: () => api.post<{ documents: number; vocabulary: number }>('/admin/reindex-assistant'),
  reseed: () => api.post<Record<string, unknown>>('/admin/reseed'),
};

// ---------------------------------------------------------------------------
// Staff directory and public settings
// ---------------------------------------------------------------------------

export const userApi = {
  /** Active officers, ecologists and administrators — for assignee pickers (officer+). */
  staff: () => api.get<StaffMember[]>('/users/staff'),
};

export const settingsApi = {
  public: () => api.get<PublicSettings>('/settings/public'),
};

export type { Paginated };
