'use strict';

/**
 * The incident → work order → resolution workflow.
 *
 *   citizen report ──(officer/admin approves)──▶ incident
 *   incident ──(admin assigns a park officer)──▶ work order for that officer
 *   work order progress ──▶ incident in progress
 *   work order completed ──▶ incident resolved
 *
 * Both controllers call into this module, so the incident and its work
 * orders can never disagree about who is doing the work or whether it is
 * finished.
 */

const { Incident, WorkOrder } = require('../models');
const alertService = require('./alert.service');
const { nextCode, year } = require('../utils/sequence');

const OPEN_ORDER_STATUSES = ['scheduled', 'in-progress', 'overdue'];

/** The kind of maintenance job that fixes each kind of incident. */
const WORK_TYPE_FOR_INCIDENT = {
  'tree-fall': 'tree-trimming',
  'illegal-dumping': 'cleaning',
  fire: 'inspection',
  'water-pollution': 'lake-cleaning',
  'dead-animal': 'cleaning',
  vandalism: 'repair',
  'infrastructure-damage': 'repair',
  'air-pollution': 'inspection',
};

const generateOrderCode = () =>
  nextCode({ model: WorkOrder, field: 'orderCode', prefix: `WO-${year()}` });

/** The open work order for an incident, if one exists. */
const findOpenOrder = (incidentId) =>
  WorkOrder.findOne({ sourceIncident: incidentId, status: { $in: OPEN_ORDER_STATUSES } });

/**
 * Raise the work order that will fix an incident, assigned to the incident's
 * officer. The caller checks that no open order exists.
 */
async function raiseWorkOrder(incident, fields = {}) {
  return WorkOrder.create({
    orderCode: await generateOrderCode(),
    type: fields.type || WORK_TYPE_FOR_INCIDENT[incident.type] || 'repair',
    title: fields.title || `Resolve: ${incident.title}`,
    description: fields.description || incident.description,
    park: incident.park,
    scheduledDate: fields.scheduledDate || new Date(Date.now() + 86_400_000),
    priority: incident.priority,
    assignedTo: fields.assignedTo || incident.assignedTo || null,
    assignedTeam: fields.assignedTeam || '',
    estimatedCost: fields.estimatedCost || 0,
    ...(fields.estimatedHours !== undefined ? { estimatedHours: fields.estimatedHours } : {}),
    sourceIncident: incident._id,
  });
}

/**
 * Make every open work order of an incident follow the incident's assignee.
 * @returns {Promise<number>} orders updated
 */
async function syncAssignee(incident) {
  if (!incident.assignedTo) return 0;
  const result = await WorkOrder.updateMany(
    { sourceIncident: incident._id, status: { $in: OPEN_ORDER_STATUSES }, assignedTo: { $ne: incident.assignedTo } },
    { $set: { assignedTo: incident.assignedTo } }
  );
  return result.modifiedCount || 0;
}

/**
 * Carry a work order's state back to the incident it was raised from: work
 * started puts the incident in progress, and completing the last open order
 * resolves it.
 *
 * @param {import('mongoose').Document} order  the saved work order
 * @param {{_id: any, name: string}} [actor]
 */
async function onWorkOrderChanged(order, actor) {
  if (!order.sourceIncident) return;
  const incident = await Incident.findById(order.sourceIncident);
  if (!incident || ['resolved', 'closed'].includes(incident.status)) return;

  const by = actor?._id || null;
  const byName = actor?.name || 'System';

  if (order.status === 'completed') {
    const stillOpen = await WorkOrder.exists({
      sourceIncident: incident._id,
      _id: { $ne: order._id },
      status: { $in: OPEN_ORDER_STATUSES },
    });
    if (stillOpen) return;

    incident.status = 'resolved';
    incident.resolutionNotes = order.completionNotes || `Work order ${order.orderCode} completed.`;
    incident.timeline.push({ status: 'resolved', note: `Work order ${order.orderCode} completed`, by, byName });
    await incident.save(); // pre-save hook stamps resolvedAt / resolutionMinutes
    await alertService.autoResolve(`incident:${incident._id}`);
    return;
  }

  if (order.status === 'in-progress' && ['reported', 'assigned'].includes(incident.status)) {
    incident.status = 'in-progress';
    incident.timeline.push({ status: 'in-progress', note: `Work started on ${order.orderCode} (${order.progress}%)`, by, byName });
    await incident.save();
  }
}

module.exports = {
  OPEN_ORDER_STATUSES,
  WORK_TYPE_FOR_INCIDENT,
  generateOrderCode,
  findOpenOrder,
  raiseWorkOrder,
  syncAssignee,
  onWorkOrderChanged,
};
