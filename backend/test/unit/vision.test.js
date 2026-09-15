'use strict';

/**
 * The AI module's deterministic parts: evidence pooling, the task mappings,
 * image decoding and the internal-address guard. These run without the
 * network; the end-to-end inference over real photographs is exercised in
 * the integration suite and by `npm run eval:vision`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';

const { interpret, massOf, GROUPS, TASKS } = require('../../src/services/ai-inference.service');
const vision = require('../../src/services/vision.service');

/** A 1000-way distribution with the given index → probability entries. */
function distribution(entries) {
  const probs = new Float64Array(1000);
  let assigned = 0;
  for (const [index, p] of Object.entries(entries)) {
    probs[Number(index)] = p;
    assigned += p;
  }
  // Spread the remainder thinly over classes 500–548, which no task group
  // uses, so no single filler class looks like a confident prediction.
  for (let i = 500; i <= 548; i += 1) probs[i] += (1 - assigned) / 49;
  return probs;
}

const NEUTRAL_STATS = {
  healthyGreenFraction: 0, chloroticFraction: 0, necroticFraction: 0,
  flameFraction: 0, strictFlameFraction: 0, smokeFraction: 0, greenLeafIndex: 0,
};

const describe = (entries, stats = {}) => {
  const probabilities = distribution(entries);
  return {
    probabilities,
    stats: { ...NEUTRAL_STATS, ...stats },
    imagenet: vision.topClasses(probabilities, 5),
  };
};

test('ImageNet groups do not overlap and stay inside the 1000 classes', () => {
  const seen = new Map();
  const animalGroups = ['bird', 'amphibian', 'reptile', 'insect', 'butterfly', 'invertebrate', 'wildMammal', 'domesticAnimal', 'fish'];
  for (const group of animalGroups) {
    for (const index of GROUPS[group]) {
      assert.ok(index >= 0 && index < 1000, `${group} has index ${index}`);
      assert.ok(!seen.has(index), `index ${index} is in both ${seen.get(index)} and ${group}`);
      seen.set(index, group);
    }
  }
});

test('group evidence is the sum of member probabilities', () => {
  const probs = distribution({ 92: 0.6, 133: 0.2 }); // bee eater, bittern
  assert.ok(Math.abs(massOf(probs, 'bird') - 0.8) < 1e-12);
  assert.equal(massOf(probs, 'fire'), 0);
});

test('every task returns a probability vector that sums to one, argmax first', () => {
  const cases = {
    fire: describe({ 980: 0.7 }),
    wildlife: describe({ 92: 0.77 }),
    waste: describe({ 898: 0.5 }),
    'plant-id': describe({ 985: 0.4 }, { healthyGreenFraction: 0.5 }),
    'tree-disease': describe({}, { healthyGreenFraction: 0.3, chloroticFraction: 0.05 }),
  };
  for (const [task, description] of Object.entries(cases)) {
    const r = interpret(task, description);
    const total = r.probabilities.reduce((s, p) => s + p.probability, 0);
    assert.ok(Math.abs(total - 1) < 0.001, `${task} sums to ${total}`);
    assert.equal(r.prediction, r.probabilities[0].label);
    assert.equal(r.probabilities.length, TASKS[task].classes.length);
    for (let i = 1; i < r.probabilities.length; i += 1) {
      assert.ok(r.probabilities[i - 1].probability >= r.probabilities[i].probability);
    }
  }
});

test('fire: strong volcano evidence is flames; orange colour alone is not', () => {
  assert.equal(interpret('fire', describe({ 980: 0.7 })).prediction, 'Flames visible');

  // Autumn leaves: most pixels pass the flame-colour rule, the network sees no fire.
  const leaves = interpret('fire', describe({ 989: 0.8 }, { strictFlameFraction: 0.63 }));
  assert.equal(leaves.prediction, 'No fire or smoke detected');
  assert.ok(leaves.confidence > 90);

  // Plume classes plus grey pixels read as smoke.
  assert.equal(interpret('fire', describe({ 974: 0.08, 820: 0.08 }, { smokeFraction: 0.45 })).prediction, 'Smoke visible');
});

test('fire findings name an incident type; nothing else auto-escalates', () => {
  for (const [task, def] of Object.entries(TASKS)) {
    for (const c of def.classes) {
      if (task === 'fire' && c.label !== 'No fire or smoke detected') assert.equal(c.incidentType, 'fire');
      else assert.ok(!c.incidentType, `${task} / ${c.label} would open incidents without review`);
    }
  }
});

test('wildlife: the winning group names its closest ImageNet class', () => {
  const r = interpret('wildlife', describe({ 92: 0.77, 95: 0.01 }));
  assert.equal(r.prediction, 'Bird');
  assert.match(r.detail, /bee eater/);
  assert.equal(interpret('wildlife', describe({ 323: 0.53 })).prediction, 'Butterfly or moth');
  assert.equal(interpret('wildlife', describe({})).prediction, 'No animal detected');
});

test('tree health follows foliage colour shares', () => {
  assert.equal(interpret('tree-disease', describe({}, { healthyGreenFraction: 0.25, chloroticFraction: 0.03, necroticFraction: 0.02 })).prediction, 'Healthy green foliage');
  assert.equal(interpret('tree-disease', describe({}, { healthyGreenFraction: 0.01, chloroticFraction: 0.41, necroticFraction: 0.04 })).prediction, 'Yellowing foliage (chlorosis)');
  assert.equal(interpret('tree-disease', describe({}, { healthyGreenFraction: 0.03, chloroticFraction: 0.08, necroticFraction: 0.2 })).prediction, 'Browning foliage (necrosis or dieback)');
  assert.equal(interpret('tree-disease', describe({}, { healthyGreenFraction: 0.01 })).prediction, 'No foliage in frame');

  // A green-backgrounded bird photograph is not a foliage photograph.
  const bird = interpret('tree-disease', describe({ 92: 0.88 }, { healthyGreenFraction: 0.25, chloroticFraction: 0.27 }));
  assert.equal(bird.prediction, 'No foliage in frame');
});

test('an unsure network is called out in the notes', () => {
  const r = interpret('waste', describe({ 833: 0.11 }));
  assert.ok(r.notes.some((n) => n.includes('unsure')), JSON.stringify(r.notes));
});

test('internal and reserved addresses are recognised', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(vision.isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '151.101.1.69', '2606:4700::6810:84e5']) {
    assert.equal(vision.isPrivateAddress(address), false, address);
  }
});

test('uploads must be base64 image data URLs', () => {
  assert.throws(() => vision.decodeDataUrl('data:text/plain;base64,aGVsbG8='), /valid base64/);
  assert.throws(() => vision.decodeDataUrl('data:image/png;base64,'), /valid base64|empty/);
  assert.equal(vision.decodeDataUrl('data:image/png;base64,aGVsbG8=').toString(), 'hello');
});

test('only JPEG and PNG bytes decode', () => {
  assert.throws(() => vision.decodeImage(Buffer.from('<html>not an image</html>')), /JPEG and PNG/);
});

test('resize keeps aspect ratio and a round trip stays a valid JPEG', () => {
  const width = 800;
  const height = 400;
  const data = new Uint8Array(width * height * 3).fill(120);
  const small = vision.resizeRgb({ data, width, height }, 200);
  assert.deepEqual([small.width, small.height], [200, 100]);

  const encoded = vision.encodeJpeg(small);
  const decoded = vision.decodeImage(encoded);
  assert.deepEqual([decoded.width, decoded.height, decoded.format], [200, 100, 'jpeg']);
});
