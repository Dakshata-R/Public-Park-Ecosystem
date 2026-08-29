'use strict';

/**
 * Single import point for every Mongoose model.
 *
 *   const { Park, Incident } = require('../models');
 *
 * Requiring this module also guarantees all schemas are registered before any
 * `populate()` runs, which avoids "Schema hasn't been registered" errors when
 * a controller is loaded in isolation (e.g. by the seed script or tests).
 */

module.exports = {
  User: require('./User'),
  Park: require('./Park'),
  Asset: require('./Asset'),
  Species: require('./Species'),
  Observation: require('./Observation'),
  Sensor: require('./Sensor'),
  SensorReading: require('./SensorReading'),
  CitizenReport: require('./CitizenReport'),
  Incident: require('./Incident'),
  WorkOrder: require('./WorkOrder'),
  AiDetection: require('./AiDetection'),
  Alert: require('./Alert'),
  EcoReport: require('./EcoReport'),
  AuditLog: require('./AuditLog'),
  Setting: require('./Setting'),
  ChatMessage: require('./ChatMessage'),
};
