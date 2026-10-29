'use strict';

/**
 * Boot-time migrations against an in-memory MongoDB: detections from the
 * retired AI tasks are deleted, wildlife detections are kept (without the
 * retired plant-health `diagnosis` field), and a second run changes nothing.
 */

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { AiDetection } = require('../../src/models');
const { runMigrations } = require('../../src/seed/migrate');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await memory.stop();
});

test('retired AI tasks are removed on boot; wildlife detections stay', async () => {
  const base = { imageUrl: '/x.jpg', confidence: 80, reviewStatus: 'pending' };
  // Raw inserts: the retired tasks are no longer in the schema's enum.
  await AiDetection.collection.insertMany([
    { ...base, task: 'tree-disease', prediction: 'Healthy foliage', diagnosis: { condition: 'healthy', disease: '', symptoms: [] } },
    { ...base, task: 'plant-id', prediction: 'Flowering plant' },
    { ...base, task: 'fire', prediction: 'Fire' },
    { ...base, task: 'waste', prediction: 'Litter' },
    { ...base, task: 'wildlife', prediction: 'Bird', diagnosis: { condition: 'not applicable', disease: '', symptoms: [] } },
  ]);

  await runMigrations();

  const left = await AiDetection.collection.find({}).toArray();
  assert.deepEqual(left.map((d) => d.task), ['wildlife']);
  assert.equal(left[0].prediction, 'Bird');
  assert.equal('diagnosis' in left[0], false, 'the plant-health diagnosis field is dropped');

  // Idempotent: a second boot finds nothing to do.
  await runMigrations();
  assert.equal(await AiDetection.countDocuments(), 1);
});

test('only wildlife is a valid task for new detections', async () => {
  assert.deepEqual(AiDetection.AI_TASKS, ['wildlife']);
  const doc = new AiDetection({ task: 'tree-disease', imageUrl: '/x.jpg', prediction: 'x', confidence: 1 });
  assert.ok(doc.validateSync()?.errors?.task, 'tree-disease is rejected by the schema');
});
