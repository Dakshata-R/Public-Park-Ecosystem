'use strict';

/**
 * Module 12 — Administration: platform user accounts.
 *
 * Passwords are stored as bcrypt hashes and never serialised (the `private`
 * flag is honoured by the toJSON plugin).
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const toJSONPlugin = require('./plugins/toJSON');

const ROLES = ['citizen', 'ecologist', 'officer', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      private: true, // stripped by the toJSON plugin
    },
    role: { type: String, enum: ROLES, default: 'citizen', index: true },

    /** Home park — the park an officer/ecologist is primarily responsible for. */
    park: { type: mongoose.Schema.Types.ObjectId, ref: 'Park', default: null },

    phone: { type: String, trim: true, default: '' },
    avatar: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },

    /** Number of accepted citizen contributions (reports + sightings). */
    contributions: { type: Number, default: 0, min: 0 },

    lastLoginAt: { type: Date, default: null },

    /** True for the seeded demonstration accounts. */
    demo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.plugin(toJSONPlugin);

userSchema.index({ name: 'text', email: 'text' });

/** Hash the password whenever it is set or changed. */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

/**
 * Compare a plaintext candidate against the stored hash.
 * @param {string} candidate
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = function verifyPassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
