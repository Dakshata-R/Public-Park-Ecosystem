'use strict';

/**
 * Wire-shape normalisation for `.lean()` query results.
 *
 * These are regression tests for a bug that reached the client: a bare,
 * un-populated ObjectId is a non-array object with no `_id`, so the original
 * recursion walked straight past it and `JSON.stringify` then serialised the
 * driver's internal byte buffer as `{ buffer: { data: [...] } }`. The frontend
 * received that instead of an id string.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { normaliseId } = require('../../src/controllers/crud.factory');

const oid = () => new mongoose.Types.ObjectId();

/** True when the value survived JSON serialisation as a 24-char hex string. */
const isHexId = (value) => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);

test('a top-level _id becomes a string id', () => {
  const id = oid();
  const result = normaliseId({ _id: id, name: 'Cubbon Park' });

  assert.equal(result.id, id.toString());
  assert.ok(!('_id' in result));
  assert.equal(result.name, 'Cubbon Park');
});

test('an un-populated ObjectId reference becomes a hex string, not a buffer', () => {
  const result = normaliseId({ _id: oid(), submittedBy: oid(), park: oid() });

  assert.ok(isHexId(result.submittedBy), `submittedBy was ${JSON.stringify(result.submittedBy)}`);
  assert.ok(isHexId(result.park), `park was ${JSON.stringify(result.park)}`);
});

test('the serialised payload never contains a raw buffer', () => {
  const serialised = JSON.stringify(
    normaliseId({
      _id: oid(),
      submittedBy: oid(),
      reviewedBy: null,
      linkedIncident: oid(),
      nested: { owner: oid() },
      many: [oid(), oid()],
    })
  );

  assert.ok(!serialised.includes('"buffer"'), 'a driver buffer leaked into the payload');
  assert.ok(!serialised.includes('"_bsontype"'));
});

test('an array of bare ObjectIds is stringified element-wise', () => {
  const ids = [oid(), oid(), oid()];
  const result = normaliseId({ _id: oid(), watchers: ids });

  assert.equal(result.watchers.length, 3);
  result.watchers.forEach((value, index) => {
    assert.equal(value, ids[index].toString());
  });
});

test('a populated reference is recursed into and gets its own id', () => {
  const parkId = oid();
  const result = normaliseId({
    _id: oid(),
    park: { _id: parkId, name: 'Banyan Forest Park' },
  });

  assert.equal(result.park.id, parkId.toString());
  assert.ok(!('_id' in result.park));
  assert.equal(result.park.name, 'Banyan Forest Park');
});

test('embedded sub-documents in an array are normalised', () => {
  const entryId = oid();
  const result = normaliseId({
    _id: oid(),
    timeline: [{ _id: entryId, status: 'reported', by: oid() }],
  });

  assert.equal(result.timeline[0].id, entryId.toString());
  assert.ok(!('_id' in result.timeline[0]));
  assert.ok(isHexId(result.timeline[0].by));
});

test('Dates survive normalisation as Dates, not as empty objects', () => {
  const when = new Date('2026-03-01T12:00:00.000Z');
  const result = normaliseId({ _id: oid(), reportedAt: when, nested: { at: when } });

  assert.ok(result.reportedAt instanceof Date, 'top-level Date was mangled');
  assert.equal(result.reportedAt.toISOString(), when.toISOString());
  assert.ok(result.nested.at instanceof Date, 'nested Date was mangled');
});

test('internal fields are stripped', () => {
  const result = normaliseId({
    _id: oid(),
    __v: 7,
    password: '$2a$10$abcdefghijklmnopqrstuv',
    email: 'officer@greenpulse.gov',
  });

  assert.ok(!('__v' in result));
  assert.ok(!('password' in result));
  assert.equal(result.email, 'officer@greenpulse.gov');
});

test('GeoJSON coordinate arrays are preserved exactly', () => {
  const location = { type: 'Point', coordinates: [77.5946, 12.9716] };
  const result = normaliseId({ _id: oid(), location });

  assert.deepEqual(result.location, location);
});

test('null, undefined and primitives pass through untouched', () => {
  assert.equal(normaliseId(null), null);
  assert.equal(normaliseId(undefined), undefined);
  assert.equal(normaliseId('a string'), 'a string');
  assert.equal(normaliseId(42), 42);
  assert.equal(normaliseId(false), false);
});

test('an array of documents is normalised element-wise', () => {
  const a = oid();
  const b = oid();
  const result = normaliseId([{ _id: a }, { _id: b }]);

  assert.deepEqual(result.map((r) => r.id), [a.toString(), b.toString()]);
});

test('a document with no _id is returned with its other fields intact', () => {
  const result = normaliseId({ name: 'aggregate row', count: 3 });

  assert.deepEqual(result, { name: 'aggregate row', count: 3 });
});
