'use strict';

/**
 * Accuracy report for the AI module (wildlife recognition).
 *
 * Runs every labelled photograph in `src/seed/data/sample-images` through the
 * real inference pipeline and compares the prediction with the labels a
 * correct classifier may give. Prints a per-image table and per-task
 * accuracy — the figures quoted in the README and on the AI page come from
 * this script.
 *
 *   npm run eval:vision              the MobileNetV2 fallback engine
 *   npm run eval:vision -- --llm     AI vision with the configured provider
 *                                    (GEMINI_API_KEY etc.; one API call per
 *                                    photograph — `--claude` still works)
 */

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

const fs = require('fs');
const path = require('path');
const { runInference } = require('../src/services/ai-inference.service');
const llmVision = require('../src/services/llm-vision.service');

const DIR = path.resolve(__dirname, '../src/seed/data/sample-images');

async function main() {
  const useLlm = process.argv.includes('--llm') || process.argv.includes('--claude');
  if (useLlm && !llmVision.isEnabled()) {
    console.error('--llm needs a language-model key in backend/.env — GEMINI_API_KEY is free at https://aistudio.google.com/apikey.');
    process.exit(1);
  }

  const samples = JSON.parse(fs.readFileSync(path.join(DIR, 'attribution.json'), 'utf8'));
  const byTask = {};

  console.log(`engine: ${useLlm ? `llm-vision (${llmVision.providerInfo().label}, ${llmVision.modelId()})` : 'mobilenet-fallback'}\n`);
  console.log('task          image                                  prediction                                    conf   ok  species');
  console.log('─'.repeat(140));

  for (const sample of samples) {
    const result = await runInference(sample.task, fs.readFileSync(path.join(DIR, sample.file)), {
      engine: useLlm ? 'auto' : 'fallback',
    });
    const correct = sample.expected.includes(result.prediction);

    byTask[sample.task] ||= { correct: 0, total: 0 };
    byTask[sample.task].total += 1;
    if (correct) byTask[sample.task].correct += 1;

    const named = result.species
      ? `${result.species.common}${result.species.scientific ? ` (${result.species.scientific})` : ''}`
      : '';

    console.log(
      `${sample.task.padEnd(13)} ${sample.file.padEnd(38)} ${result.prediction.padEnd(45)} ${String(result.confidence).padStart(5)}%  ${correct ? '✓' : '✗'}   ${named}` +
        (useLlm && result.engine !== 'llm-vision' ? '  [fell back]' : '')
    );
  }

  console.log('─'.repeat(140));
  let correct = 0;
  let total = 0;
  for (const [task, t] of Object.entries(byTask)) {
    correct += t.correct;
    total += t.total;
    console.log(`${task.padEnd(13)} ${t.correct}/${t.total}`);
  }
  console.log(`${'overall'.padEnd(13)} ${correct}/${total} (${Math.round((correct / total) * 100)} %)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
