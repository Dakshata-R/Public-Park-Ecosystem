/**
 * Domain types mirroring the API's response shapes.
 *
 * These are hand-written rather than generated: the project has one backend
 * and one frontend maintained together, and a generator would add a build step
 * for little benefit at this size. They correspond one-to-one with the
 * Mongoose schemas in `server/src/models`.
 *
 * Coordinate convention: everything crossing the wire is GeoJSON, so
 * `[longitude, latitude]`. Leaflet wants `[latitude, longitude]` — convert at
 * the boundary with the helpers in `lib/api/geo.ts`, never inline.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** GeoJSON order: [longitude, latitude]. */
export type Position = [number, number];

/** Leaflet order: [latitude, longitude]. */
export type LatLng = [number, number];

export interface GeoPoint {
  type: 'Point';
  coordinates: Position;
}

export interface GeoLineString {
  type: 'LineString';
  coordinates: Position[];
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: Position[][];
}

export type Geometry = GeoPoint | GeoLineString | GeoPolygon;

export interface Feature<P = Record<string, unknown>> {
  type: 'Feature';
  geometry: Geometry;
  properties: P;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}

// ---------------------------------------------------------------------------
// Shared vocabularies
// ---------------------------------------------------------------------------

export type Grade = 'excellent' | 'good' | 'moderate' | 'poor' | 'critical';
export type ConditionStatus = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type UserRole = 'citizen' | 'ecologist' | 'officer' | 'admin';

/** Every document carries these. */
interface Timestamped {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** A populated reference collapses to the fields the API selected. */
export interface ParkRef {
  id: string;
  name: string;
  slug?: string;
}

export interface UserRef {
  id: string;
  name: string;
  email?: string;
  role?: UserRole;
}

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export interface User extends Timestamped {
  name: string;
  email: string;
  role: UserRole;
  park: ParkRef | string | null;
  phone: string;
  avatar: string;
  active: boolean;
  contributions: number;
  lastLoginAt: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ---------------------------------------------------------------------------
// Module 3 — Parks & assets
// ---------------------------------------------------------------------------

export interface ParkScores {
  ecosystemHealth: number;
  biodiversity: number;
  airQuality: number;
  waterQuality: number;
  soilHealth: number;
  treeHealth: number;
  computedAt: string | null;
}

export interface Park extends Timestamped {
  name: string;
  slug: string;
  description: string;
  location: GeoPoint;
  boundary?: GeoPolygon;
  areaAcres: number;
  weeklyVisitors: number;
  establishedYear?: number;
  address: string;
  city: string;
  manager: string;
  scores: ParkScores;
  facilities: string[];
  images: string[];
  active: boolean;
}

export type AssetType = 'tree' | 'plant' | 'bench' | 'lake' | 'path' | 'light' | 'structure';

export interface MaintenanceRecord {
  id?: string;
  date: string;
  type: string;
  description: string;
  cost: number;
  technician: string;
}

export interface Asset extends Timestamped {
  assetCode: string;
  type: AssetType;
  name: string;
  park: ParkRef | string;
  location: GeoPoint;
  path?: GeoLineString;
  condition: number;
  status: ConditionStatus;
  installedAt?: string;
  lastMaintenanceAt: string | null;
  nextMaintenanceDue: string | null;
  attributes: Record<string, string>;
  maintenance: MaintenanceRecord[];
  notes: string;
  images: string[];
  active: boolean;
}

export interface AssetStats {
  byType: { type: AssetType; count: number; avgCondition: number }[];
  byStatus: { status: ConditionStatus; count: number }[];
  total: number;
  avgCondition: number;
  maintenanceSpend: number;
  needsAttention: number;
}

// ---------------------------------------------------------------------------
// Module 4 — Biodiversity
// ---------------------------------------------------------------------------

export type SpeciesClass =
  | 'bird' | 'mammal' | 'butterfly' | 'reptile'
  | 'amphibian' | 'tree' | 'plant' | 'insect';

export type ConservationStatus =
  | 'Least Concern' | 'Near Threatened' | 'Vulnerable'
  | 'Endangered' | 'Critically Endangered';

export interface Species extends Timestamped {
  commonName: string;
  scientificName: string;
  class: SpeciesClass;
  family: string;
  conservationStatus: ConservationStatus;
  habitat: string;
  description: string;
  isInvasive: boolean;
  isIndicator: boolean;
  seasonality: number[];
  parks: (ParkRef | string)[];
  images: string[];
}

export type ObservationSource = 'officer-survey' | 'citizen-report' | 'camera-trap' | 'ai-detection';

export interface Observation extends Timestamped {
  species: Species | string;
  park: ParkRef | string;
  observedAt: string;
  count: number;
  location: GeoPoint;
  locationName: string;
  observer: UserRef | string | null;
  observerName: string;
  source: ObservationSource;
  verified: boolean;
  notes: string;
  images: string[];
}

/**
 * Raw output of `computeIndices()` — the shape returned by the preview
 * endpoint, which computes over an arbitrary abundance vector rather than
 * over the database.
 */
export interface RawIndices {
  richness: number;
  /** Σ nᵢ. Named `total` here; the analysis endpoint renames it for clarity. */
  total: number;
  shannon: number;
  shannonMax: number;
  evenness: number;
  simpson: number;
  simpsonDiversity: number;
  margalef: number;
  dominance: number;
}

/** The ecological indices as the analysis endpoint reports them. */
export interface BiodiversityIndices extends Omit<RawIndices, 'total'> {
  totalIndividuals: number;
}

/** Indices computed within one taxonomic class. */
export interface TaxoceneIndices extends RawIndices {
  individuals: number;
}

export interface SpeciesAbundance {
  speciesId: string;
  commonName: string;
  scientificName: string;
  class: SpeciesClass;
  conservationStatus: ConservationStatus;
  count: number;
  sightings: number;
  isInvasive: boolean;
}

export interface BiodiversityAnalysis {
  scope: 'park' | 'citywide';
  park: string | null;
  windowDays: number | null;
  indices: BiodiversityIndices;
  score: number;
  conservationComponent: number;
  threatenedSpecies: number;
  invasiveIndividuals: number;
  byClass: Record<string, number>;
  /**
   * The same mathematics applied within each taxonomic class. Pooling counts
   * across birds and plant stems mixes units of survey effort, so this is the
   * defensible view when comparing sites — see the note in the service.
   */
  byClassIndices: Record<string, TaxoceneIndices>;
  byConservation: Record<string, number>;
  abundance: SpeciesAbundance[];
}

// ---------------------------------------------------------------------------
// Module 5 — AI
// ---------------------------------------------------------------------------

export type AiTask = 'tree-disease' | 'plant-id' | 'wildlife' | 'waste' | 'fire';

export interface ClassProbability {
  label: string;
  probability: number;
}

export interface ModelCard {
  name: string;
  backbone: string;
  version: string;
  inputSize: number;
}

export interface AiDetection extends Timestamped {
  task: AiTask;
  imageUrl: string;
  imageName: string;
  park: ParkRef | string | null;
  prediction: string;
  confidence: number;
  probabilities: ClassProbability[];
  severity: Severity;
  recommendedAction: string;
  modelName: string;
  modelVersion: string;
  inferenceMs: number;
  reviewStatus: 'pending' | 'confirmed' | 'rejected';
  correctedLabel: string;
  linkedIncident: { id: string; referenceCode: string; priority: string } | string | null;
}

export interface InferenceResult {
  prediction: string;
  confidence: number;
  probabilities: ClassProbability[];
  severity: Severity;
  recommendedAction: string;
  model: ModelCard;
  inferenceMs: number;
  simulated: boolean;
}

export interface AnalyzeResponse {
  detection: AiDetection;
  inference: InferenceResult;
  escalated: { id: string; referenceCode: string; priority: string } | null;
  escalationRule: {
    dangerous: boolean;
    confident: boolean;
    confidenceFloor: number;
    applied: boolean;
    reason: string;
  };
}

// ---------------------------------------------------------------------------
// Module 6 — Sensors
// ---------------------------------------------------------------------------

export type SensorType = 'aqi' | 'temperature' | 'humidity' | 'noise' | 'water' | 'soil';
export type SensorStatus = 'online' | 'offline' | 'warning' | 'maintenance';

export interface Sensor extends Timestamped {
  sensorCode: string;
  name: string;
  type: SensorType;
  park: ParkRef | string;
  location: GeoPoint;
  unit: string;
  minValue: number;
  maxValue: number;
  warnAbove: number | null;
  warnBelow: number | null;
  currentValue: number;
  lastReadingAt: string | null;
  status: SensorStatus;
  batteryLevel: number;
  firmware: string;
  active: boolean;
}

/** A sensor enriched by `GET /sensors/live`. */
export interface LiveSensor extends Sensor {
  score: number;
  breached: boolean;
  stale: boolean;
}

export interface SensorReadingPoint {
  time: string;
  value: number;
  score: number;
  isAnomaly: boolean;
  zScore: number;
}

export interface SensorSeries {
  sensor: Sensor;
  readings: SensorReadingPoint[];
  stats: {
    min: number;
    max: number;
    mean: number;
    stdDev: number;
    median: number;
    anomalies: number;
  } | null;
}

export interface LiveSensorsResponse {
  sensors: LiveSensor[];
  summary: {
    total: number;
    online: number;
    warning: number;
    offline: number;
    averageScoreByType: Record<string, number>;
  };
}

// ---------------------------------------------------------------------------
// Module 7 — Citizen reports
// ---------------------------------------------------------------------------

export type ReportCategory = 'issue' | 'wildlife-sighting' | 'feedback' | 'suggestion';
export type ReportStatus = 'submitted' | 'in-review' | 'accepted' | 'resolved' | 'rejected';

export interface CitizenReport extends Timestamped {
  referenceCode: string;
  category: ReportCategory;
  title: string;
  description: string;
  park: ParkRef | string;
  location: GeoPoint;
  submittedBy: UserRef | string | null;
  submittedByName: string;
  status: ReportStatus;
  upvotes: number;
  images: string[];
  species: Species | string | null;
  linkedIncident: { id: string; referenceCode: string; status: string } | string | null;
  officialResponse: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Module 8 — Incidents & alerts
// ---------------------------------------------------------------------------

export type IncidentType =
  | 'tree-fall' | 'illegal-dumping' | 'fire' | 'water-pollution'
  | 'dead-animal' | 'vandalism' | 'infrastructure-damage' | 'air-pollution';

export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'reported' | 'assigned' | 'in-progress' | 'resolved' | 'closed';
export type IncidentSource = 'citizen-report' | 'sensor-alert' | 'ai-detection' | 'officer-patrol';

export interface TimelineEntry {
  id?: string;
  status: IncidentStatus;
  note: string;
  byName: string;
  at: string;
}

export interface Incident extends Timestamped {
  referenceCode: string;
  type: IncidentType;
  title: string;
  description: string;
  park: ParkRef | string;
  location: GeoPoint;
  priorityScore: number;
  priority: IncidentPriority;
  status: IncidentStatus;
  source: IncidentSource;
  affectedPeople: number;
  severity: number;
  assignedTo: UserRef | string | null;
  assignedAt: string | null;
  reportedAt: string;
  resolvedAt: string | null;
  resolutionMinutes: number | null;
  resolutionNotes: string;
  images: string[];
  timeline: TimelineEntry[];
}

/** The factor breakdown returned by `priority.service.js`. */
export interface TriageVerdict {
  score: number;
  priority: IncidentPriority;
  ageHours: number;
  responseTargetHours: number;
  isOverdue: boolean;
  factors: {
    hazard: number;
    severity: number;
    exposure: number;
    urgency: number;
    community: number;
  };
  explanation: string;
}

export type TriagedIncident = Incident & { triage: TriageVerdict };

export interface Alert extends Timestamped {
  title: string;
  message: string;
  module: string;
  source: 'sensor' | 'ai' | 'incident' | 'system' | 'anomaly';
  severity: Severity;
  status: 'active' | 'acknowledged' | 'resolved';
  park: ParkRef | string | null;
  relatedModel: string;
  relatedId: string | null;
  occurrences: number;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Module 9 — Maintenance
// ---------------------------------------------------------------------------

export type WorkOrderType =
  | 'cleaning' | 'tree-trimming' | 'repair' | 'lake-cleaning'
  | 'inspection' | 'planting' | 'irrigation';

export type WorkOrderStatus = 'scheduled' | 'in-progress' | 'completed' | 'overdue' | 'cancelled';

export interface WorkOrder extends Timestamped {
  orderCode: string;
  type: WorkOrderType;
  title: string;
  description: string;
  park: ParkRef | string;
  asset: { id: string; name: string; assetCode: string } | string | null;
  assetName: string;
  assignedTo: UserRef | string | null;
  assignedTeam: string;
  scheduledDate: string;
  startedAt: string | null;
  completedAt: string | null;
  priority: IncidentPriority;
  status: WorkOrderStatus;
  progress: number;
  estimatedCost: number;
  actualCost: number;
  estimatedHours: number;
  sourceIncident: { id: string; referenceCode: string } | string | null;
  recurrence: 'none' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  completionNotes: string;
}

// ---------------------------------------------------------------------------
// Module 10 — Reports
// ---------------------------------------------------------------------------

export type EcoReportType =
  | 'ecosystem' | 'biodiversity' | 'water' | 'air' | 'soil' | 'maintenance' | 'engagement';

export interface EcoReport extends Timestamped {
  title: string;
  type: EcoReportType;
  summary: string;
  park: ParkRef | string | null;
  authorName: string;
  periodStart: string | null;
  periodEnd: string | null;
  metrics: Record<string, number | string>;
  findings: string[];
  recommendations: string[];
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Module 1 — Dashboard
// ---------------------------------------------------------------------------

export interface HealthSubIndices {
  airQuality: number;
  waterQuality: number;
  soilHealth: number;
  treeHealth: number;
  biodiversity: number;
}

export interface HealthContribution {
  key: string;
  score: number;
  weight: number;
  contribution: number;
}

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  score: number | null;
  icon: string;
}

export interface DashboardOverview {
  scope: 'park' | 'citywide';
  health: {
    score: number;
    grade: Grade;
    subIndices: HealthSubIndices;
    weights: Record<string, number>;
    contributions: HealthContribution[];
    computedAt: string;
  };
  airQuality: { aqi: number; score: number; label: string; advice: string };
  biodiversity: {
    score: number;
    richness: number;
    shannon: number;
    evenness: number;
    simpsonDiversity: number;
    threatenedSpecies: number;
    byClass: Record<string, number>;
  };
  kpis: Kpi[];
  counts: {
    activeAlerts: number;
    openIncidents: number;
    pendingReports: number;
    dueWorkOrders: number;
    assets: number;
    species: number;
    sensorsOnline: number;
    sensorsWarning: number;
    sensorsOffline: number;
  };
  recentAlerts: Alert[];
  priorityIncidents: Incident[];
  recentReports: EcoReport[];
  parkRanking: {
    id: string;
    name: string;
    slug: string;
    score: number;
    grade: Grade;
    biodiversity: number;
    areaAcres: number;
    weeklyVisitors: number;
  }[];
}

export interface TrendPoint {
  date: string;
  air: number;
  water: number;
  soil: number;
  noise: number;
  temperature: number;
  humidity: number;
}

export interface ActivityEvent {
  type: 'incident' | 'citizen-report' | 'work-order' | 'ai-detection' | 'observation';
  id: string;
  title: string;
  subtitle: string;
  park?: string;
  at: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Module 2 — GIS
// ---------------------------------------------------------------------------

export type MapLayerKey =
  | 'parks' | 'trees' | 'water' | 'wildlife'
  | 'pollution' | 'trails' | 'sensors' | 'reports';

export interface MapFeatureProperties {
  id: string;
  layer: MapLayerKey;
  name: string;
  [key: string]: unknown;
}

export type MapLayers = Record<MapLayerKey, FeatureCollection<MapFeatureProperties>>;

/** Leaflet heat-layer tuple: [lat, lng, intensity]. */
export type HeatPoint = [number, number, number];

// ---------------------------------------------------------------------------
// Module 11 — Assistant
// ---------------------------------------------------------------------------

export interface Citation {
  label: string;
  entity: string;
  entityId: string;
  score: number;
}

export interface ChatMessage extends Timestamped {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  intent: string;
  citations: Citation[];
  latencyMs: number;
}

export interface AskResponse {
  sessionId: string;
  message: ChatMessage;
  intent: string;
  intentConfidence: number;
  citations: Citation[];
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// External integrations
// ---------------------------------------------------------------------------

/**
 * Upstream responses are never guaranteed. Every integration result carries
 * `ok`, and the UI must render something sensible when it is false — the
 * network may be down, the service rate-limited, or the demo offline.
 */
interface IntegrationResult {
  ok: boolean;
  reason?: string;
  source?: string;
  attribution?: string;
  cached?: boolean;
}

export interface ResolvedLocation {
  lat: number;
  lng: number;
  label: string;
  park: string | null;
}

export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  precipitation: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  cloudCover: number;
  isDay: boolean;
  code: number;
  condition: string;
  /** Key for the frontend's icon map, not a URL. */
  icon: string;
  observedAt: string;
  uvIndexMax: number | null;
  sunrise: string | null;
  sunset: string | null;
}

export interface ForecastDay {
  date: string;
  code: number;
  condition: string;
  icon: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  uvIndexMax: number;
}

export interface WeatherResponse extends IntegrationResult {
  location: ResolvedLocation;
  current?: CurrentWeather;
  forecast?: ForecastDay[];
}

/** Live pollutant concentrations, scored through the project's CPCB implementation. */
export interface LiveAirQuality extends IntegrationResult {
  observedAt?: string;
  concentrations?: {
    pm25: number;
    pm10: number;
    no2: number;
    so2: number;
    o3: number;
    coMgM3: number;
    dust: number;
    uvIndex: number;
  };
  /** Per-pollutant CPCB sub-indices computed by this project. */
  subIndices?: Record<string, number>;
  dominantPollutant?: string | null;
  aqi?: number;
  score?: number;
  label?: string;
  advice?: string;
  pm25Series?: { time: string; pm25: number; pm10: number }[];
}

export interface AirQualityResponse {
  location: ResolvedLocation;
  live: LiveAirQuality;
  localSensor: {
    name: string;
    value: number;
    unit: string;
    status: SensorStatus;
    lastReadingAt: string | null;
  } | null;
  /** Local sensor reading minus the modelled AQI; null when either is missing. */
  divergence: number | null;
}

export interface ParkConditions {
  location: ResolvedLocation;
  weather: WeatherResponse;
  airQuality: LiveAirQuality;
  advisory: string;
}

export interface GbifOccurrence {
  key: number;
  scientificName: string;
  country: string;
  locality: string;
  year: number;
  month: number;
  basisOfRecord: string;
  recordedBy: string;
  lat: number;
  lng: number;
  datasetName: string;
}

export interface GbifOccurrences extends IntegrationResult {
  scientificName?: string;
  total?: number;
  recordedNearby?: boolean;
  radiusKm?: number;
  occurrences?: GbifOccurrence[];
}

export interface GbifTaxonomy extends IntegrationResult {
  matchType?: string;
  confidence?: number;
  accepted?: boolean;
  scientificName?: string;
  canonicalName?: string;
  rank?: string;
  kingdom?: string;
  family?: string;
  genus?: string;
}

export interface GbifVerification {
  species: { id: string; commonName: string; scientificName: string; class: SpeciesClass };
  taxonomy: GbifTaxonomy;
  occurrences: GbifOccurrences;
  verdict: 'corroborated' | 'not-recorded-nearby' | 'unknown';
  note: string;
}

export interface EbirdResponse extends IntegrationResult {
  location?: { lat: number; lng: number; label: string };
  observations?: {
    speciesCode: string;
    commonName: string;
    scientificName: string;
    count: number;
    observedAt: string;
    locationName: string;
    lat: number;
    lng: number;
  }[];
}

export interface GeocodeResponse extends IntegrationResult {
  displayName?: string;
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

export interface IntegrationStatus {
  reachable: boolean;
  probeReason: string | null;
  cacheEntries: number;
  integrations: {
    id: string;
    name: string;
    purpose: string;
    requiresKey: boolean;
    configured: boolean;
    live: boolean | null;
  }[];
}

// ---------------------------------------------------------------------------
// Module 12 — Administration
// ---------------------------------------------------------------------------

export interface SystemSettings extends Timestamped {
  key: string;
  organisationName: string;
  city: string;
  contactEmail: string;
  healthIndexWeights: {
    air: number;
    water: number;
    soil: number;
    tree: number;
    biodiversity: number;
  };
  anomalyZThreshold: number;
  aiAutoIncidentConfidence: number;
  enableSensorSimulation: boolean;
  enablePublicReporting: boolean;
  mapDefaultZoom: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  entityLabel: string;
  actorName: string;
  actorRole: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  ip: string;
  createdAt: string;
}

export interface SystemStats {
  counts: Record<string, number>;
  usersByRole: Record<string, number>;
  database: { name: string; state: string; collections: number };
  runtime: { node: string; uptimeSeconds: number; memoryMb: number; environment: string };
}
