'use strict';

/**
 * Idempotent data migrations, run on every boot after the database connects.
 * Each step only touches documents still in the old shape, so a migrated
 * database pays for a few indexed `updateMany` no-ops and nothing else.
 */

const { User, WorkOrder, Incident, AiDetection, Setting } = require('../models');
const logger = require('../utils/logger');

/** The ecologist role was folded into the park officer role. */
async function retireEcologistRole() {
  // The raw collection: `ecologist` is no longer in the schema's enum.
  const users = User.collection;

  const renamed = await users.findOne({ email: 'ecologist@greenpulse.gov' });
  if (renamed && !(await users.findOne({ email: 'karthik.gowda@greenpulse.gov' }))) {
    await users.updateOne({ _id: renamed._id }, { $set: { email: 'karthik.gowda@greenpulse.gov' } });
  }

  const { modifiedCount } = await users.updateMany({ role: 'ecologist' }, { $set: { role: 'officer' } });
  return modifiedCount;
}

/**
 * Open work orders raised from an incident follow the incident's assignee.
 * Older data assigned the incident without updating its work order, which
 * left the maintenance board showing "Unassigned".
 */
async function syncWorkOrderAssignees() {
  const orders = await WorkOrder.find({
    sourceIncident: { $ne: null },
    assignedTo: null,
    status: { $in: ['scheduled', 'in-progress', 'overdue'] },
  }).select('sourceIncident').lean();

  let fixed = 0;
  for (const order of orders) {
    const incident = await Incident.findById(order.sourceIncident).select('assignedTo').lean();
    if (incident?.assignedTo) {
      await WorkOrder.updateOne({ _id: order._id }, { $set: { assignedTo: incident.assignedTo } });
      fixed += 1;
    }
  }
  return fixed;
}

/**
 * AI Monitoring is wildlife recognition only: fire and litter detection, tree
 * and foliage health, and plant and fungus recognition were retired. Their
 * detections are deleted, and the plant-health `diagnosis` field is dropped
 * from any remaining detection.
 */
const RETIRED_AI_TASKS = ['fire', 'waste', 'tree-disease', 'plant-id'];

async function removeRetiredAiTasks() {
  const detections = AiDetection.collection;
  const { deletedCount } = await detections.deleteMany({ task: { $in: RETIRED_AI_TASKS } });
  await detections.updateMany({ diagnosis: { $exists: true } }, { $unset: { diagnosis: '' } });
  return deletedCount;
}

/** The portal's former product name, left in the stored organisation setting. */
async function renameOrganisation() {
  const { modifiedCount } = await Setting.collection.updateMany(
    { organisationName: 'GreenPulse Park Monitoring' },
    { $set: { organisationName: 'Park Ecosystem Portal' } }
  );
  return modifiedCount;
}

async function runMigrations() {
  const roles = await retireEcologistRole();
  const orders = await syncWorkOrderAssignees();
  const detections = await removeRetiredAiTasks();
  await renameOrganisation();
  if (roles) logger.info(`Migration: ${roles} ecologist account(s) are now park officers.`);
  if (orders) logger.info(`Migration: ${orders} work order(s) now carry their incident's assignee.`);
  if (detections) logger.info(`Migration: removed ${detections} detection(s) from retired AI tasks (fire, litter, tree health, plant recognition).`);
}

module.exports = { runMigrations };
