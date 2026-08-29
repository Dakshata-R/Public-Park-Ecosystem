'use strict';

/**
 * Authentication and role-based access control.
 *
 * Roles form a strict hierarchy, agreed with the project supervisor in
 * Week 6:
 *
 *   citizen (1)  — report issues, upload sightings, read public data
 *   ecologist(2) — everything a citizen can do + curate biodiversity records
 *   officer  (3) — operational duties: incidents, work orders, assets, sensors
 *   admin    (4) — full control including user management and settings
 *
 * `requireRole('officer')` therefore also admits admins, which avoids
 * listing every superior role at each route.
 */

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const asyncHandler = require('./asyncHandler');

const ROLE_RANK = { citizen: 1, ecologist: 2, officer: 3, admin: 4 };

/** Sign an access token for a user document. */
function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, name: user.name },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

/** Pull a bearer token out of the Authorization header. */
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Require a valid token. Populates `req.user` with the User document.
 */
const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('No authentication token provided');

  const payload = jwt.verify(token, env.jwtSecret); // throws → handled centrally
  const user = await User.findById(payload.sub);

  if (!user) throw ApiError.unauthorized('The account for this token no longer exists');
  if (!user.active) throw ApiError.forbidden('This account has been deactivated');

  req.user = user;
  next();
});

/**
 * Attach `req.user` when a token is present, but never reject.
 * Used by public endpoints that personalise their response when signed in.
 */
const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub);
    if (user && user.active) req.user = user;
  } catch {
    // An invalid token on an optional route is simply ignored.
  }
  next();
});

/**
 * Require at least the given role. Must run after `requireAuth`.
 * @param {'citizen'|'ecologist'|'officer'|'admin'} minimumRole
 */
function requireRole(minimumRole) {
  const required = ROLE_RANK[minimumRole];
  if (!required) throw new Error(`Unknown role '${minimumRole}'`);

  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if ((ROLE_RANK[req.user.role] || 0) < required) {
      return next(
        ApiError.forbidden(`This action requires the '${minimumRole}' role or higher`)
      );
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireRole, signToken, ROLE_RANK };
