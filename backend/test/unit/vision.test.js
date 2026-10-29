'use strict';

/**
 * The AI module's deterministic parts: evidence pooling, the wildlife task
 * mapping, the AI vision engine's request and parsing (against a mocked
 * fetch / SDK client — no API key is needed), image decoding and the
 * internal-address guard. End-to-end inference over real photographs runs in
 * the integration suite and in `npm run eval:vision`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test'; // never use a real key from backend/.env
process.env.LOG_LEVEL = 'silent';

const { interpret, decide, describeTasks, massOf, GROUPS, TASKS } = require('../../src/services/ai-inference.service');
const llmVision = require('../../src/services/llm-vision.service');
const llmProvider = require('../../src/services/llm-provider.service');
const { fakeFetch, chatReply, fakeAnthropic } = require('../helpers/fake-llm');
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

const describe = (entries) => {
  const probabilities = distribution(entries);
  return {
    probabilities,
    imagenet: vision.topClasses(probabilities, 5),
    stored: { buffer: Buffer.from('jpeg bytes'), width: 10, height: 10 },
  };
};

/** A heron photograph as MobileNetV2 sees it (class 132: American egret). */
const HERON = () => describe({ 132: 0.7 });

const llmAnswer = (overrides = {}) => ({
  label_probabilities: [
    { label: 'Bird', probability: 0.9 },
    { label: 'Other insect or invertebrate', probability: 0.05 },
    { label: 'No animal detected', probability: 0.05 },
  ],
  species: { common_name: 'Indian pond heron', scientific_name: 'Ardeola grayii', confidence: 0.86 },
  severity: 'low',
  recommended_action: 'Log the sighting at the lake edge.',
  caveat: '',
  ...overrides,
});

/** Select a provider for this test, with a mocked transport and no backoff. */
const useProvider = (env, { fetch, anthropicClient } = {}) =>
  llmProvider._configure({ env, fetch, anthropicClient, timing: { retryDelayMs: 1, maxRetryDelayMs: 5 } });
const GEMINI = { llmProvider: 'gemini', geminiApiKey: 'test-gemini-key' };
const GROQ = { llmProvider: 'groq', groqApiKey: 'test-groq-key' };
const WILDLIFE_LABELS = () => TASKS.wildlife.classes.map((c) => c.label);

test.afterEach(() => llmProvider._configure(null));

// ---------------------------------------------------------------------------
// Evidence pooling and the task vocabulary
// ---------------------------------------------------------------------------

test('ImageNet groups do not overlap and stay inside the 1000 classes', () => {
  const seen = new Map();
  for (const [group, indices] of Object.entries(GROUPS)) {
    for (const index of indices) {
      assert.ok(index >= 0 && index < 1000, `${group} has index ${index}`);
      assert.ok(!seen.has(index), `index ${index} is in both ${seen.get(index)} and ${group}`);
      seen.set(index, group);
    }
  }
});

test('group evidence is the sum of member probabilities', () => {
  const probs = distribution({ 92: 0.6, 133: 0.2 }); // bee eater, bittern
  assert.ok(Math.abs(massOf(probs, 'bird') - 0.8) < 1e-12);
  assert.equal(massOf(probs, 'reptile'), 0);
});

test('wildlife recognition is the only task, and it opens no incidents', () => {
  assert.deepEqual(Object.keys(TASKS), ['wildlife']);
  for (const c of TASKS.wildlife.classes) assert.ok(!('incidentType' in c), `${c.label} names an incident type`);
});

test('the wildlife probability vector sums to one, argmax first', () => {
  for (const description of [describe({ 92: 0.77 }), describe({ 292: 0.4, 323: 0.3 }), describe({})]) {
    const r = interpret('wildlife', description);
    const total = r.probabilities.reduce((s, p) => s + p.probability, 0);
    assert.ok(Math.abs(total - 1) < 0.001, `sums to ${total}`);
    assert.equal(r.prediction, r.probabilities[0].label);
    assert.equal(r.probabilities.length, TASKS.wildlife.classes.length);
    assert.equal(r.engine, 'mobilenet-fallback');
    for (let i = 1; i < r.probabilities.length; i += 1) {
      assert.ok(r.probabilities[i - 1].probability >= r.probabilities[i].probability);
    }
  }
});

test('wildlife fallback: the animal name is the closest ImageNet class, the group is the label', () => {
  const tiger = interpret('wildlife', describe({ 292: 0.895 })); // tiger, Panthera tigris
  assert.equal(tiger.prediction, 'Wild mammal');
  assert.equal(tiger.species.common, 'Tiger');
  assert.equal(tiger.species.confidence, 89.5);
  assert.ok(!('diagnosis' in tiger), 'wildlife results carry no plant diagnosis');
  assert.ok(tiger.notes.some((n) => n.includes('ImageNet')));

  const bird = interpret('wildlife', describe({ 92: 0.77, 95: 0.01 }));
  assert.equal(bird.prediction, 'Bird');
  assert.equal(bird.species.common, 'Bee eater');
  assert.equal(interpret('wildlife', describe({ 323: 0.53 })).prediction, 'Butterfly or moth');

  const none = interpret('wildlife', describe({}));
  assert.equal(none.prediction, 'No animal detected');
  assert.equal(none.species, null);
});

test('the retired plant tasks are unknown to the inference service', () => {
  for (const task of ['tree-disease', 'plant-id']) {
    assert.throws(() => interpret(task, describe({})), /Unknown inference task/);
  }
});

// ---------------------------------------------------------------------------
// The AI vision engine (mocked transport — no API key or network needed)
// ---------------------------------------------------------------------------

test('without a key the fallback answers and says how to get a free one', async () => {
  assert.equal(llmVision.isEnabled(), false);
  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'mobilenet-fallback');
  assert.ok(r.notes.some((n) => n.includes('GEMINI_API_KEY') && n.includes('aistudio.google.com/apikey')), JSON.stringify(r.notes));
});

test('AI vision (Gemini): the species comes back in the wildlife vocabulary', async () => {
  const fetch = fakeFetch([chatReply(JSON.stringify(llmAnswer()), { model: 'gemini-3.5-flash-lite' })]);
  useProvider(GEMINI, { fetch });

  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'llm-vision');
  assert.equal(r.provider, 'gemini');
  assert.equal(r.providerLabel, 'Gemini');
  assert.deepEqual(r.engineModel, { name: 'Gemini vision', version: 'gemini-3.5-flash-lite' });
  assert.equal(r.prediction, 'Bird');
  assert.equal(r.confidence, 90);
  assert.deepEqual(r.species, { common: 'Indian pond heron', scientific: 'Ardeola grayii', confidence: 86 });
  assert.equal(r.severity, 'low');
  assert.ok(!('diagnosis' in r), 'no plant diagnosis is returned');
  assert.equal(r.recommendedAction, 'Log the sighting at the lake edge.');
  assert.equal(r.detail, 'Indian pond heron (Ardeola grayii)');
  assert.ok(r.notes.some((n) => n.includes('Gemini vision')));
  // Every task label is present, so the review queue still works.
  assert.equal(r.probabilities.length, TASKS.wildlife.classes.length);
  assert.ok(Math.abs(r.probabilities.reduce((s, p) => s + p.probability, 0) - 1) < 0.001);
  // The local evidence is kept.
  assert.ok('animalEvidence' in r.evidence);

  // The request: OpenAI-compatible endpoint, bearer key, image as a data URL, strict schema.
  assert.equal(fetch.calls.length, 1);
  const [{ url, headers, body }] = fetch.calls;
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(headers.authorization, 'Bearer test-gemini-key');
  assert.equal(body.model, 'gemini-3.5-flash-lite');
  assert.equal(body.messages[0].role, 'system');
  assert.doesNotMatch(body.messages[0].content, /plant|disease|foliage/i);
  const [image, text] = body.messages[1].content;
  assert.equal(image.type, 'image_url');
  assert.equal(image.image_url.url, `data:image/jpeg;base64,${Buffer.from('jpeg bytes').toString('base64')}`);
  assert.equal(text.type, 'text');
  assert.match(text.text, /Labels \(give a probability for every one\)/);
  assert.match(text.text, /MobileNetV2 \(ImageNet\) top classes/);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  const schema = body.response_format.json_schema.schema;
  assert.deepEqual(schema.properties.label_probabilities.items.properties.label.enum, WILDLIFE_LABELS());
  assert.deepEqual(schema.required, ['label_probabilities', 'species', 'severity', 'recommended_action', 'caveat']);
  for (const field of ['health', 'disease', 'symptoms']) assert.ok(!(field in schema.properties), `${field} is not asked for`);
  assert.ok(!JSON.stringify(schema).includes('additionalProperties'), 'Gemini gets the schema without additionalProperties');
  assert.equal(body.reasoning_effort, 'low');
});

test('AI vision: an injured animal keeps the severity the model gives', async () => {
  useProvider(GEMINI, {
    fetch: fakeFetch([chatReply(JSON.stringify(llmAnswer({
      label_probabilities: [{ label: 'Wild mammal', probability: 0.97 }, { label: 'Domestic or stray animal', probability: 0.03 }],
      species: { common_name: 'Bonnet macaque', scientific_name: 'Macaca radiata', confidence: 0.9 },
      severity: 'high',
      recommended_action: 'The macaque is limping; call the wildlife rescue helpline.',
    })))]),
  });
  const r = await decide('wildlife', describe({ 373: 0.9 }));
  assert.equal(r.prediction, 'Wild mammal');
  assert.equal(r.species.common, 'Bonnet macaque');
  assert.equal(r.species.scientific, 'Macaca radiata');
  assert.equal(r.severity, 'high');
  assert.match(r.recommendedAction, /rescue helpline/);
});

test('AI vision: unknown labels are dropped and probabilities renormalised', () => {
  const labels = WILDLIFE_LABELS();
  const parsed = llmVision.parseOutput(labels, llmAnswer({
    label_probabilities: [{ label: 'Bird', probability: 0.6 }, { label: 'Unicorn', probability: 0.9 }, { label: 'No animal detected', probability: 0.2 }],
    species: { common_name: '', scientific_name: '', confidence: 0 },
  }), 'm');
  assert.equal(parsed.probabilities[0].label, 'Bird');
  assert.equal(parsed.probabilities[0].probability, 0.75);
  assert.equal(parsed.probabilities.length, labels.length);
  assert.equal(parsed.species, null);
  assert.equal(parsed.severity, 'low');
  assert.equal(parsed.model, 'm');
});

test('AI vision: JSON wrapped in prose or code fences is still read', async () => {
  useProvider(GEMINI, { fetch: fakeFetch([chatReply(`Here you go:\n\`\`\`json\n${JSON.stringify(llmAnswer())}\n\`\`\``)]) });
  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'llm-vision');
});

test('AI vision: malformed JSON gets one repair round, then succeeds', async () => {
  const fetch = fakeFetch([chatReply('{"label_probabilities": [ oops'), chatReply(JSON.stringify(llmAnswer()))]);
  useProvider(GEMINI, { fetch });
  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'llm-vision');
  assert.equal(fetch.calls.length, 2);
  const repair = fetch.calls[1].body.messages;
  assert.equal(repair.at(-2).role, 'assistant');
  assert.equal(repair.at(-2).content, '{"label_probabilities": [ oops');
  assert.match(repair.at(-1).content, /not valid JSON/);
});

test('AI vision: output that ignores the schema is caught by our own validation', async () => {
  // e.g. a provider that silently ignores json_schema and returns its own shape.
  const fetch = fakeFetch([chatReply(JSON.stringify({ answer: 'a heron' })), chatReply(JSON.stringify({ answer: 'still wrong' }))]);
  useProvider(GROQ, { fetch });
  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'mobilenet-fallback');
  assert.equal(fetch.calls.length, 2, 'one repair attempt, then give up');
  assert.match(fetch.calls[1].body.messages.at(-1).content, /label_probabilities/);
  assert.ok(r.notes.some((n) => n.startsWith('Groq vision was unavailable') && n.includes('does not match the schema')), JSON.stringify(r.notes));
});

test('AI vision: a server that rejects json_schema is retried in JSON mode with the schema in the prompt', async () => {
  const fetch = fakeFetch([
    { status: 400, body: { error: { message: 'response_format json_schema is not supported for this model' } } },
    chatReply(JSON.stringify(llmAnswer())),
  ]);
  useProvider(GROQ, { fetch });
  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'llm-vision');
  assert.equal(r.provider, 'groq');
  assert.equal(fetch.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(fetch.calls[0].body.model, 'qwen/qwen3.8-27b');
  assert.equal(fetch.calls[0].body.response_format.type, 'json_schema');
  assert.ok(JSON.stringify(fetch.calls[0].body.response_format).includes('additionalProperties'), 'other providers keep the strict schema');
  assert.equal(fetch.calls[1].body.response_format.type, 'json_object');
  assert.match(fetch.calls[1].body.messages[1].content.at(-1).text, /JSON Schema/);
});

test('AI vision: malformed output, refusals and API errors fall back to MobileNetV2', async () => {
  const cases = [
    ['not json', () => [chatReply('not json'), chatReply('still not json')]],
    ['refusal', () => [chatReply(null, { finishReason: 'content_filter', extra: { refusal: 'no' } })]],
    ['schema', () => [chatReply(JSON.stringify({ label_probabilities: [{ label: 'Bird', probability: 0 }] })), chatReply('{}')]],
    ['network', () => [new TypeError('fetch failed'), new TypeError('fetch failed')]],
    ['auth', () => [{ status: 401, body: { error: { message: 'API key not valid' } } }]],
  ];
  for (const [name, replies] of cases) {
    useProvider(GEMINI, { fetch: fakeFetch(replies()) });
    const r = await decide('wildlife', HERON());
    assert.equal(r.engine, 'mobilenet-fallback', name);
    assert.ok(r.notes.some((n) => n.startsWith('Gemini vision was unavailable')), `${name}: ${JSON.stringify(r.notes)}`);
  }
});

test('AI vision with Claude: the Anthropic path still sends the image and schema natively', async () => {
  const client = fakeAnthropic([{
    model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(llmAnswer()) }],
  }]);
  useProvider({ llmProvider: 'anthropic', anthropicApiKey: 'test-key' }, { anthropicClient: client });
  const r = await decide('wildlife', HERON());
  assert.equal(r.engine, 'llm-vision');
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.engineModel.name, 'Claude vision');

  const [params] = client.requests;
  const [image, text] = params.messages[0].content;
  assert.equal(image.type, 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(image.source.data, Buffer.from('jpeg bytes').toString('base64'));
  assert.equal(text.type, 'text');
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.deepEqual(params.output_config.format.schema.properties.label_probabilities.items.properties.label.enum, WILDLIFE_LABELS());
  assert.equal(params.model, 'claude-opus-5-5');

  useProvider({ llmProvider: 'anthropic', anthropicApiKey: 'test-key' }, {
    anthropicClient: fakeAnthropic([{ model: 'claude-opus-5-5', stop_reason: 'refusal', content: [] }]),
  });
  const refused = await decide('wildlife', HERON());
  assert.equal(refused.engine, 'mobilenet-fallback');
  assert.ok(refused.notes.some((n) => n.startsWith('Claude vision was unavailable')));
});

test('AI vision is skipped when the caller asks for the fallback (seeding)', async () => {
  const fetch = fakeFetch([chatReply(JSON.stringify(llmAnswer()))]);
  useProvider(GEMINI, { fetch });
  const r = await decide('wildlife', HERON(), { engine: 'fallback' });
  assert.equal(r.engine, 'mobilenet-fallback');
  assert.equal(fetch.calls.length, 0);
});

test('the task legend names the active provider and model', () => {
  assert.equal(describeTasks()[0].engine, 'mobilenet-fallback');
  assert.equal(describeTasks()[0].visionProviderLabel, null);
  useProvider(GEMINI, { fetch: fakeFetch([]) });
  const [first] = describeTasks();
  assert.equal(first.engine, 'llm-vision');
  assert.equal(first.visionProvider, 'gemini');
  assert.equal(first.visionProviderLabel, 'Gemini');
  assert.equal(first.visionModel, 'gemini-3.5-flash-lite');
});
// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

test('an unsure network is called out in the notes', () => {
  const r = interpret('wildlife', describe({ 833: 0.11 }));
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
