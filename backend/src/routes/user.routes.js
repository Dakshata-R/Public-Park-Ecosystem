'use strict';

/**
 * Directory lookups that operational staff need but that are not user
 * administration — e.g. the assignee picker on incidents and work orders.
 * Full user management stays under /api/admin/users (administrators only).
 */

const express = require('express');
const { User } = require('../models');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ok } = require('../utils/response');

const router = express.Router();

/** GET /api/users/staff — active staff who can be assigned work. */
router.get(
  '/staff',
  requireAuth,
  requireRole('officer'),
  asyncHandler(async (_req, res) => {
    const staff = await User.find({ role: { $in: ['officer', 'ecologist', 'admin'] }, active: true })
      .sort({ role: 1, name: 1 })
      .select('name role park')
      .populate('park', 'name')
      .lean();

    return ok(
      res,
      staff.map((u) => ({ id: String(u._id), name: u.name, role: u.role, park: u.park ? { id: String(u.park._id), name: u.park.name } : null }))
    );
  })
);

module.exports = router;
