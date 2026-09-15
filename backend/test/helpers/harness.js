'use strict';

/**
 * Shared test harness.
 *
 * Every suite runs against its own ephemeral MongoDB (`mongodb-memory-server`)
 * so tests never touch a developer's real database and never depend on the
 * order they run in. The Express app is imported *after* the connection is
 * open and is bound to port 0, letting the OS pick a free port — several test
 * files can therefore run in parallel without colliding.
 */

process.env.NODE_ENV = 'test';
// Silence the request logger and the boot banner during tests.
process.env.LOG_LEVEL = 'silent';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let memoryServer = null;
let server = null;
let baseUrl = null;

/**
 * Boot an in-memory MongoDB, connect Mongoose, and start the API on a free
 * port. Returns the base URL, e.g. `http://127.0.0.1:51234/api`.
 */
async function startTestServer() {
  memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'greenpulse-test' } });

  mongoose.set('strictQuery', true);
  await mongoose.connect(memoryServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  // Required only once the connection exists, so model index builds succeed.
  const app = require('../../src/app');

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  // Media URLs (e.g. /api/ai/images/:id) are root-relative; tests resolve them here.
  process.env.TEST_API_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

/** Tear everything down so the test process can exit. */
async function stopTestServer() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.connection.close();
  if (memoryServer) await memoryServer.stop();
  server = null;
  memoryServer = null;
}

/**
 * Minimal HTTP client returning `{ status, body }`.
 *
 * @param {string} method
 * @param {string} path   Path below `/api`, e.g. `/parks`
 * @param {{token?: string, body?: unknown, raw?: string}} [options]
 */
async function request(method, path, options = {}) {
  const headers = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let payload;
  if (options.raw !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = options.raw;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  const res = await fetch(baseUrl + path, { method, headers, body: payload });
  const text = await res.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return { status: res.status, body, headers: res.headers };
}

const get = (path, token) => request('GET', path, { token });
const post = (path, body, token) => request('POST', path, { body, token });
const patch = (path, body, token) => request('PATCH', path, { body, token });
const del = (path, token) => request('DELETE', path, { token });

/** Sign in and return the JWT, failing loudly if the credentials are wrong. */
async function login(email, password = 'greenpulse123') {
  const res = await post('/auth/login', { email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token;
}

/**
 * A list endpoint may answer with a bare array or with a wrapper object.
 * Tests care about the records, not the envelope shape.
 */
function itemsOf(res) {
  const data = res.body && res.body.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

module.exports = {
  startTestServer,
  stopTestServer,
  request,
  get,
  post,
  patch,
  del,
  login,
  itemsOf,
};
