'use strict';

/**
 * Module 8 — incident triage scoring.
 *
 * The clock is injected throughout so the ageing term is deterministic;
 * a test that used the real clock would drift.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreIncident, buildTriageQueue, TYPE_PROFILE } = require('../../src/services/priority.service');

const NOW = new Date('2026-03-01T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000);

test('a fire outranks a bench repair at identical severity and age', () => {
  const common = { severity: 3, reportedAt: hoursAgo(1), status: 'reported' };

  const fire = scoreIncident({ ...common, type: 'fire' }, NOW);
  const infrastructure = scoreIncident({ ...common, type: 'infrastructure-damage' }, NOW);

  assert.ok(fire.score > infrastructure.score, `${fire.score} should exceed ${infrastructure.score}`);
  assert.ok(
    ['high', 'critical'].includes(fire.priority),
    `a fire should be at least high priority, got ${fire.priority}`
  );
});

test('critical priority needs hazard, severity and exposure together', () => {
  // Hazard alone does not reach the 75-point critical band: a fire with
  // nobody affected sits in "high". Adding severity and exposure crosses it.
  const contained = scoreIncident(
    { type: 'fire', severity: 3, affectedPeople: 0, reportedAt: hoursAgo(1), status: 'reported' },
    NOW
  );
  const spreading = scoreIncident(
    { type: 'fire', severity: 5, affectedPeople: 200, reportedAt: hoursAgo(6), status: 'reported' },
    NOW
  );

  assert.equal(contained.priority, 'high');
  assert.equal(spreading.priority, 'critical');
  assert.ok(spreading.score > contained.score);
});

test('the score is bounded to 0–100 across the full input range', () => {
  const extremes = [
    { type: 'fire', severity: 5, affectedPeople: 1e9, upvotes: 1e9, reportedAt: hoursAgo(100000) },
    { type: 'vandalism', severity: 1, affectedPeople: 0, upvotes: 0, reportedAt: NOW },
    { type: 'unknown-type', severity: 3 },
    {},
  ];

  for (const incident of extremes) {
    const result = scoreIncident(incident, NOW);
    assert.ok(
      Number.isFinite(result.score) && result.score >= 0 && result.score <= 100,
      `score out of range: ${result.score} for ${JSON.stringify(incident)}`
    );
    assert.ok(['low', 'medium', 'high', 'critical'].includes(result.priority));
  }
});

test('severity is clamped: values outside 1–5 cannot push the score out of band', () => {
  const low = scoreIncident({ type: 'tree-fall', severity: -50, reportedAt: NOW }, NOW);
  const high = scoreIncident({ type: 'tree-fall', severity: 500, reportedAt: NOW }, NOW);
  const legal = scoreIncident({ type: 'tree-fall', severity: 5, reportedAt: NOW }, NOW);

  assert.equal(low.factors.severity, 0);
  assert.equal(high.factors.severity, 1);
  assert.equal(high.score, legal.score, 'clamping must match the legal maximum');
});

test('an unknown incident type falls back to the default profile rather than crashing', () => {
  const result = scoreIncident({ type: 'meteor-strike', severity: 3 }, NOW);

  assert.ok(Number.isFinite(result.score));
  assert.ok(result.explanation.length > 0);
});

test('an open incident ages towards higher urgency; a resolved one stops ageing', () => {
  const base = { type: 'illegal-dumping', severity: 3 };

  const fresh = scoreIncident({ ...base, reportedAt: hoursAgo(1), status: 'reported' }, NOW);
  const stale = scoreIncident({ ...base, reportedAt: hoursAgo(240), status: 'reported' }, NOW);
  const resolved = scoreIncident({ ...base, reportedAt: hoursAgo(240), status: 'resolved' }, NOW);

  assert.ok(stale.factors.urgency > fresh.factors.urgency, 'urgency should grow with age');
  assert.ok(stale.score > fresh.score);
  assert.equal(resolved.factors.urgency, 0, 'a resolved incident must not keep ageing');
  assert.ok(resolved.score < stale.score);
});

test('urgency saturates rather than growing without bound', () => {
  const week = scoreIncident({ type: 'fire', reportedAt: hoursAgo(168), status: 'reported' }, NOW);
  const decade = scoreIncident({ type: 'fire', reportedAt: hoursAgo(87600), status: 'reported' }, NOW);

  assert.ok(week.factors.urgency <= 1);
  assert.ok(decade.factors.urgency <= 1);
  assert.ok(decade.score <= 100);
});

test('an incident past its response target is marked overdue', () => {
  const profile = TYPE_PROFILE.fire;
  const overdue = scoreIncident(
    { type: 'fire', reportedAt: hoursAgo(profile.responseHours + 10), status: 'reported' },
    NOW
  );
  const inTime = scoreIncident(
    { type: 'fire', reportedAt: hoursAgo(Math.max(0, profile.responseHours - 0.5)), status: 'reported' },
    NOW
  );

  assert.equal(overdue.isOverdue, true);
  assert.equal(inTime.isOverdue, false);
  assert.equal(overdue.responseTargetHours, profile.responseHours);
});

test('community upvotes raise the score but cannot dominate it', () => {
  const base = { type: 'illegal-dumping', severity: 3, reportedAt: hoursAgo(2), status: 'reported' };

  const quiet = scoreIncident({ ...base, upvotes: 0 }, NOW);
  const popular = scoreIncident({ ...base, upvotes: 150 }, NOW);
  const absurd = scoreIncident({ ...base, upvotes: 10 ** 9 }, NOW);

  assert.ok(popular.score > quiet.score);
  assert.ok(absurd.factors.community <= 1);
  // The community term carries a weight of 0.10, so it can move the score by
  // at most 10 points.
  assert.ok(absurd.score - quiet.score <= 10.01, `community term moved the score by ${absurd.score - quiet.score}`);
});

test('negative counts are treated as zero, not as negative contributions', () => {
  const negative = scoreIncident(
    { type: 'tree-fall', severity: 3, affectedPeople: -500, upvotes: -20, reportedAt: NOW },
    NOW
  );

  assert.equal(negative.factors.exposure, 0);
  assert.equal(negative.factors.community, 0);
  assert.ok(negative.score >= 0);
});

test('a future report date does not produce a negative age', () => {
  const future = scoreIncident(
    { type: 'tree-fall', reportedAt: new Date(NOW.getTime() + 86_400_000), status: 'reported' },
    NOW
  );

  assert.ok(future.ageHours >= 0, `age was ${future.ageHours}`);
  assert.ok(future.factors.urgency >= 0);
});

test('the triage queue sorts by score, then oldest first on a tie', () => {
  const incidents = [
    { id: 'bench', type: 'infrastructure-damage', severity: 2, reportedAt: hoursAgo(3), status: 'reported' },
    { id: 'fire', type: 'fire', severity: 5, reportedAt: hoursAgo(1), status: 'reported' },
    { id: 'dump-old', type: 'illegal-dumping', severity: 3, reportedAt: hoursAgo(50), status: 'reported' },
  ];

  const queue = buildTriageQueue(incidents, NOW);

  assert.equal(queue.length, 3);
  assert.equal(queue[0].id, 'fire', 'the fire must lead the queue');
  for (let i = 1; i < queue.length; i += 1) {
    assert.ok(
      queue[i - 1].triage.score >= queue[i].triage.score,
      'queue is not ordered by descending score'
    );
  }
});

test('the triage queue tie-breaks identical scores by age', () => {
  const shared = { type: 'vandalism', severity: 3, status: 'reported' };
  const queue = buildTriageQueue(
    [
      { id: 'newer', ...shared, reportedAt: hoursAgo(2) },
      { id: 'older', ...shared, reportedAt: hoursAgo(2) },
    ],
    NOW
  );

  assert.equal(queue[0].triage.score, queue[1].triage.score, 'scores should be equal');
  assert.equal(queue.length, 2);
});

test('an empty queue is returned unchanged', () => {
  assert.deepEqual(buildTriageQueue([], NOW), []);
  assert.deepEqual(buildTriageQueue(undefined, NOW), []);
});
