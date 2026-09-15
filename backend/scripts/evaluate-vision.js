'use strict';

/**
 * Accuracy report for the AI module.
 *
 * Runs every labelled photograph in `src/seed/data/sample-images` through the
 * real inference pipeline and compares the prediction with the label a
 * correct classifier should give. Prints a per-image table and per-task
 * accuracy — the figures quoted in the README come from this script.
 *
 *   npm run eval:vision
 */

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

const fs = require('fs');
const path = require('path');
const { runInference } = require('../src/services/ai-inference.service');

const DIR = path.resolve(__dirname, '../src/seed/data/sample-images');

async function main() {
  const samples = JSON.parse(fs.readFileSync(path.join(DIR, 'attribution.json'), 'utf8'));
  const byTask = {};

  console.log('task          image                                  prediction                                        conf   ok');
  console.log('─'.repeat(118));

  for (const sample of samples) {
    const result = await runInference(sample.task, fs.readFileSync(path.join(DIR, sample.file)));
    const correct = sample.expected.includes(result.prediction);

    byTask[sample.task] ||= { correct: 0, total: 0 };
    byTask[sample.task].total += 1;
    if (correct) byTask[sample.task].correct += 1;

    console.log(
      `${sample.task.padEnd(13)} ${sample.file.padEnd(38)} ${result.prediction.padEnd(49)} ${String(result.confidence).padStart(5)}%  ${correct ? '✓' : '✗'}`
    );
  }

  console.log('─'.repeat(118));
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
