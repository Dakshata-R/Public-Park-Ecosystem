'use strict';

/**
 * Authentication — registration, login, profile.
 *
 * Public self-registration always creates a `citizen`. Elevated roles are
 * granted only by an administrator through the admin module, so a caller
 * cannot promote themselves by adding `role: 'admin'` to the signup body.
 */

const { User, Park } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../middleware/asyncHandler');
const { ok, created } = require('../utils/response');
const { signToken } = require('../middleware/auth');
const audit = require('../services/audit.service');

/** POST /api/auth/register */
const register = asyncHandler(async (req, res) => {
  const { name, email, password, park } = req.body;

  if (await User.exists({ email: email.toLowerCase() })) {
    throw ApiError.conflict('An account with that email address already exists');
  }

  if (park && !(await Park.exists({ _id: park }))) {
    throw ApiError.badRequest('The selected park does not exist');
  }

  const user = await User.create({
    name,
    email,
    password,
    park: park || null,
    role: 'citizen', // never taken from the request body
  });

  await audit.record({ action: 'create', entity: 'User', entityId: user._id, entityLabel: user.email, req });

  return created(res, { token: signToken(user), user });
});

/** POST /api/auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });
  // The same message for "no such user" and "wrong password" so the endpoint
  // cannot be used to enumerate registered addresses.
  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('Incorrect email address or password');
  }
  if (!user.active) throw ApiError.forbidden('This account has been deactivated');

  user.lastLoginAt = new Date();
  await user.save();

  await audit.record({ action: 'login', entity: 'User', entityId: user._id, entityLabel: user.email, req });

  return ok(res, { token: signToken(user), user });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('park', 'name slug');
  return ok(res, user);
});

/** PATCH /api/auth/me — a user may edit their own profile, but not their role. */
const updateMe = asyncHandler(async (req, res) => {
  const allowed = ['name', 'phone', 'avatar', 'park'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => allowed.includes(key))
  );

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
  return ok(res, user);
});

/** POST /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id);
  if (!(await user.verifyPassword(currentPassword))) {
    throw ApiError.badRequest('The current password is incorrect');
  }

  user.password = newPassword; // re-hashed by the pre-save hook
  await user.save();

  return ok(res, { message: 'Password updated successfully' });
});

module.exports = { register, login, me, updateMe, changePassword };
