'use strict';

/**
 * Request schemas for every module.
 *
 * Grouped in one file so the shape of the whole API surface can be read at a
 * glance — the same reason the OpenAPI-style reference in `docs/api.md` is a
 * single document.
 */

const { z, objectId, geoPoint, geoLineString, dateish } = require('./common');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const auth = {
  register: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(120),
    email: z.string().email('Please provide a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
    park: objectId.optional(),
  }),

  login: z.object({
    email: z.string().email('Please provide a valid email address'),
    password: z.string().min(1, 'Password is required'),
  }),

  updateMe: z.object({
    name: z.string().min(2).max(120).optional(),
    phone: z.string().max(20).optional(),
    avatar: z.string().optional(),
    park: objectId.nullable().optional(),
  }),

  changePassword: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
  }),
};

// ---------------------------------------------------------------------------
// Parks
// ---------------------------------------------------------------------------
const parkBase = {
  name: z.string().min(2).max(160),
  slug: z.string().optional(),
  description: z.string().max(2000).optional(),
  location: geoPoint,
  boundary: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }).optional(),
  areaAcres: z.number().min(0).optional(),
  weeklyVisitors: z.number().int().min(0).optional(),
  establishedYear: z.number().int().min(1600).max(2100).optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  manager: z.string().optional(),
  facilities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  active: z.boolean().optional(),
};

const parks = {
  create: z.object(parkBase),
  update: z.object(parkBase).partial(),
};

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const assetBase = {
  assetCode: z.string().optional(),
  type: z.enum(['tree', 'plant', 'bench', 'lake', 'path', 'light', 'structure']),
  name: z.string().min(2).max(160),
  park: objectId,
  location: geoPoint,
  path: geoLineString.optional(),
  condition: z.number().min(0).max(100).optional(),
  installedAt: dateish.optional(),
  nextMaintenanceDue: dateish.optional(),
  attributes: z.record(z.string()).optional(),
  notes: z.string().max(2000).optional(),
  images: z.array(z.string()).optional(),
  active: z.boolean().optional(),
};

const assets = {
  create: z.object(assetBase),
  update: z.object(assetBase).partial(),
  addMaintenance: z.object({
    date: dateish.optional(),
    type: z.string().min(2),
    description: z.string().max(1000).optional(),
    cost: z.number().min(0).optional(),
    technician: z.string().optional(),
    conditionAfter: z.number().min(0).max(100).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Biodiversity
// ---------------------------------------------------------------------------
const SPECIES_CLASSES = ['bird', 'mammal', 'butterfly', 'reptile', 'amphibian', 'tree', 'plant', 'insect'];
const CONSERVATION = ['Least Concern', 'Near Threatened', 'Vulnerable', 'Endangered', 'Critically Endangered'];

const speciesBase = {
  commonName: z.string().min(2).max(160),
  scientificName: z.string().min(2),
  class: z.enum(SPECIES_CLASSES),
  family: z.string().optional(),
  conservationStatus: z.enum(CONSERVATION).optional(),
  habitat: z.string().optional(),
  description: z.string().max(3000).optional(),
  isInvasive: z.boolean().optional(),
  isIndicator: z.boolean().optional(),
  seasonality: z.array(z.number().int().min(1).max(12)).optional(),
  images: z.array(z.string()).optional(),
};

const observationBase = {
  species: objectId,
  park: objectId,
  observedAt: dateish.optional(),
  count: z.number().int().min(1).default(1),
  location: geoPoint,
  locationName: z.string().optional(),
  observerName: z.string().optional(),
  source: z.enum(['officer-survey', 'citizen-report', 'camera-trap', 'ai-detection']).optional(),
  notes: z.string().max(1000).optional(),
  images: z.array(z.string()).optional(),
};

const biodiversity = {
  createSpecies: z.object(speciesBase),
  updateSpecies: z.object(speciesBase).partial(),
  createObservation: z.object(observationBase),
  updateObservation: z.object(observationBase).partial(),
  verifyObservation: z.object({ verified: z.boolean().optional() }),
  previewIndices: z.object({
    abundances: z.array(z.number().positive()).min(1, 'Provide at least one abundance value'),
  }),
};

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------
const sensorBase = {
  sensorCode: z.string().min(2),
  name: z.string().min(2),
  type: z.enum(['aqi', 'temperature', 'humidity', 'noise', 'water', 'soil']),
  park: objectId,
  location: geoPoint,
  unit: z.string().optional(),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  warnAbove: z.number().nullable().optional(),
  warnBelow: z.number().nullable().optional(),
  status: z.enum(['online', 'offline', 'warning', 'maintenance']).optional(),
  batteryLevel: z.number().min(0).max(100).optional(),
  firmware: z.string().optional(),
  active: z.boolean().optional(),
};

const sensors = {
  create: z.object(sensorBase),
  update: z.object(sensorBase).partial(),
  ingest: z.object({
    value: z.number(),
    recordedAt: dateish.optional(),
  }),
};

// ---------------------------------------------------------------------------
// Citizen reports
// ---------------------------------------------------------------------------
const citizen = {
  create: z.object({
    category: z.enum(['issue', 'wildlife-sighting', 'feedback', 'suggestion']),
    title: z.string().min(4, 'Give the report a descriptive title').max(200),
    description: z.string().min(10, 'Please describe the issue in at least 10 characters').max(2000),
    park: objectId,
    location: geoPoint,
    images: z.array(z.string()).max(6).optional(),
    species: objectId.optional(),
    submittedByName: z.string().optional(),
  }),

  update: z.object({
    title: z.string().min(4).max(200).optional(),
    description: z.string().min(10).max(2000).optional(),
    images: z.array(z.string()).optional(),
    status: z.enum(['submitted', 'in-review', 'accepted', 'resolved', 'rejected']).optional(),
    officialResponse: z.string().max(2000).optional(),
  }),

  review: z.object({
    decision: z.enum(['accepted', 'rejected', 'in-review']),
    officialResponse: z.string().max(2000).optional(),
    incidentType: z.string().optional(),
    severity: z.number().int().min(1).max(5).optional(),
    affectedPeople: z.number().int().min(0).optional(),
    species: objectId.optional(),
    count: z.number().int().min(1).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
const INCIDENT_TYPES = [
  'tree-fall', 'illegal-dumping', 'fire', 'water-pollution',
  'dead-animal', 'vandalism', 'infrastructure-damage', 'air-pollution',
];

const incidents = {
  create: z.object({
    type: z.enum(INCIDENT_TYPES),
    title: z.string().min(4).max(200),
    description: z.string().max(2000).optional(),
    park: objectId,
    location: geoPoint,
    severity: z.number().int().min(1).max(5).optional(),
    affectedPeople: z.number().int().min(0).optional(),
    source: z.enum(['citizen-report', 'sensor-alert', 'ai-detection', 'officer-patrol']).optional(),
    images: z.array(z.string()).optional(),
    reportedAt: dateish.optional(),
  }),

  update: z.object({
    title: z.string().min(4).max(200).optional(),
    description: z.string().max(2000).optional(),
    type: z.enum(INCIDENT_TYPES).optional(),
    severity: z.number().int().min(1).max(5).optional(),
    affectedPeople: z.number().int().min(0).optional(),
    status: z.enum(['reported', 'assigned', 'in-progress', 'resolved', 'closed']).optional(),
    statusNote: z.string().max(500).optional(),
    resolutionNotes: z.string().max(2000).optional(),
    assignedTo: objectId.nullable().optional(),
  }),

  assign: z.object({ assignedTo: objectId }),
  resolve: z.object({ resolutionNotes: z.string().max(2000).optional() }),

  createWorkOrder: z.object({
    type: z.enum(['cleaning', 'tree-trimming', 'repair', 'lake-cleaning', 'inspection', 'planting', 'irrigation']).optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    scheduledDate: dateish.optional(),
    assignedTo: objectId.optional(),
    assignedTeam: z.string().optional(),
    estimatedCost: z.number().min(0).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------
const workOrderBase = {
  type: z.enum(['cleaning', 'tree-trimming', 'repair', 'lake-cleaning', 'inspection', 'planting', 'irrigation']),
  title: z.string().min(4).max(200),
  description: z.string().max(2000).optional(),
  park: objectId,
  asset: objectId.nullable().optional(),
  assetName: z.string().optional(),
  assignedTo: objectId.nullable().optional(),
  assignedTeam: z.string().optional(),
  scheduledDate: dateish,
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['scheduled', 'in-progress', 'completed', 'overdue', 'cancelled']).optional(),
  progress: z.number().min(0).max(100).optional(),
  estimatedCost: z.number().min(0).optional(),
  actualCost: z.number().min(0).optional(),
  estimatedHours: z.number().min(0).optional(),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  completionNotes: z.string().max(2000).optional(),
};

const maintenance = {
  create: z.object(workOrderBase),
  update: z.object(workOrderBase).partial(),
  progress: z.object({
    progress: z.number().min(0).max(100),
    completionNotes: z.string().max(2000).optional(),
    actualCost: z.number().min(0).optional(),
  }),
};

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------
const ai = {
  analyze: z.object({
    task: z.enum(['tree-disease', 'plant-id', 'wildlife', 'waste', 'fire']),
    imageUrl: z.string().min(4, '`imageUrl` is required'),
    imageName: z.string().optional(),
    park: objectId.optional(),
    location: geoPoint.optional(),
  }),

  review: z.object({
    verdict: z.enum(['confirmed', 'rejected']),
    correctedLabel: z.string().max(200).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------
const assistant = {
  ask: z.object({
    question: z.string().min(2, 'Ask a question').max(1000),
    sessionId: z.string().max(120).optional(),
  }),

  search: z.object({
    query: z.string().min(2).max(200),
    entities: z.array(z.string()).optional(),
    k: z.number().int().min(1).max(25).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Reports (Module 10)
// ---------------------------------------------------------------------------
const reportBase = {
  title: z.string().min(4).max(240),
  type: z.enum(['ecosystem', 'biodiversity', 'water', 'air', 'soil', 'maintenance', 'engagement']),
  summary: z.string().max(4000).optional(),
  park: objectId.nullable().optional(),
  periodStart: dateish.optional(),
  periodEnd: dateish.optional(),
  metrics: z.record(z.any()).optional(),
  findings: z.array(z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  authorName: z.string().optional(),
};

const reports = {
  create: z.object(reportBase),
  update: z.object(reportBase).partial(),
};

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------
const admin = {
  createUser: z.object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    role: z.enum(['citizen', 'ecologist', 'officer', 'admin']),
    park: objectId.nullable().optional(),
    phone: z.string().optional(),
    active: z.boolean().optional(),
  }),

  updateUser: z.object({
    name: z.string().min(2).max(120).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(['citizen', 'ecologist', 'officer', 'admin']).optional(),
    park: objectId.nullable().optional(),
    phone: z.string().optional(),
    active: z.boolean().optional(),
  }),

  updateSettings: z.object({
    organisationName: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    contactEmail: z.string().email().optional(),
    healthIndexWeights: z
      .object({
        air: z.number().min(0).max(1),
        water: z.number().min(0).max(1),
        soil: z.number().min(0).max(1),
        tree: z.number().min(0).max(1),
        biodiversity: z.number().min(0).max(1),
      })
      .partial()
      .optional(),
    anomalyZThreshold: z.number().min(1).max(6).optional(),
    aiAutoIncidentConfidence: z.number().min(0).max(100).optional(),
    enableSensorSimulation: z.boolean().optional(),
    enablePublicReporting: z.boolean().optional(),
    mapDefaultZoom: z.number().int().min(1).max(20).optional(),
  }),
};

module.exports = {
  auth, parks, assets, biodiversity, sensors,
  citizen, incidents, maintenance, ai, assistant, reports, admin,
};
