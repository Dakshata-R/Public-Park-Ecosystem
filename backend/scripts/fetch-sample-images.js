'use strict';

/**
 * Download the labelled photographs used by the AI module.
 *
 * Every image is a freely licensed file on Wikimedia Commons. Each is stored
 * as a ≤640 px JPEG, and its author, licence and source page are recorded in
 * `attribution.json`, which the API serves alongside the image.
 *
 * `expected` is the label a correct classifier should give for `task`. The
 * same set drives the seeded detections (`use: 'seed'`) and the accuracy
 * report in `scripts/evaluate-vision.js`. Look-alike negatives (sunsets,
 * autumn leaves) are `use: 'evaluation'` only.
 *
 * The images are committed, so this only needs re-running to change the set:
 *
 *   npm run data:images
 */

const fs = require('fs/promises');
const path = require('path');
const { decodeImage, resizeRgb, encodeJpeg } = require('../src/services/vision.service');

const OUT_DIR = path.resolve(__dirname, '../src/seed/data/sample-images');
const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'GreenPulse/1.0 (academic park-ecology project; https://github.com/Dakshata-R/Public-Park-Ecosystem)';
const MAX_SIDE = 640;

const FLAMES = 'Flames visible';
const SMOKE = 'Smoke visible';
const NO_FIRE = 'No fire or smoke detected';

const SAMPLES = [
  // fire
  { file: 'fire-grassland-burn.jpg', use: 'seed', task: 'fire', expected: [FLAMES, SMOKE], title: 'File:Kazi fire.jpg' },
  { file: 'fire-smoke-plume.jpg', use: 'seed', task: 'fire', expected: [SMOKE], title: 'File:Huge white and gray smoke rising from forest fire.jpg' },
  { file: 'eval-fire-bonfire.jpg', use: 'evaluation', task: 'fire', expected: [FLAMES], title: 'File:Closeup of raging flames in a large bonfire. - Flickr - shixart1985.jpg' },
  { file: 'eval-fire-grass-wales.jpg', use: 'evaluation', task: 'fire', expected: [FLAMES, SMOKE], title: 'File:Grass fire near Dyffryn Castell - geograph.org.uk - 1746708.jpg' },
  { file: 'eval-fire-marsh-burn.jpg', use: 'evaluation', task: 'fire', expected: [FLAMES], title: 'File:Prescribed burn of marsh grasses showing heavy plant growth with flames and smoke.jpg' },
  { file: 'eval-fire-woolsey.jpg', use: 'evaluation', task: 'fire', expected: [FLAMES], title: 'File:Woolsey Flames (54811019352).jpg' },
  { file: 'eval-fire-bababudan-hills.jpg', use: 'evaluation', task: 'fire', expected: [FLAMES, SMOKE], title: 'File:Fire in montane rainforest Bababhudan hills v1.jpg' },
  { file: 'eval-nofire-sunset-paddy.jpg', use: 'evaluation', task: 'fire', expected: [NO_FIRE], title: 'File:Colorful sky with orange clouds reflecting in the water of a paddy field, at sunset, Vang Vieng, Laos.jpg' },
  { file: 'eval-nofire-sunset-falls.jpg', use: 'evaluation', task: 'fire', expected: [NO_FIRE], title: 'File:Li Phi falls at sunset with orange sky and a fishing boat in Don Khon Si Phan Don Laos.jpg' },
  { file: 'eval-nofire-orange-leaves.jpg', use: 'evaluation', task: 'fire', expected: [NO_FIRE], title: 'File:Orange autumn leaves (51958670387).jpg' },
  { file: 'eval-nofire-leaves-tamil-nadu.jpg', use: 'evaluation', task: 'fire', expected: [NO_FIRE], title: 'File:Autumn leaves Tamilnadu India.jpg' },

  // tree & foliage health
  { file: 'tree-canopy-cubbon-park.jpg', use: 'seed', task: 'tree-disease', expected: ['Healthy green foliage'], title: 'File:Tree canopy at Cubbon park, Bengaluru (2026) 01.jpg' },
  { file: 'tree-chlorosis-ficus.jpg', use: 'seed', task: 'tree-disease', expected: ['Yellowing foliage (chlorosis)'], title: 'File:Ficus benjamina with chlorosis (1 of 2).jpg' },
  { file: 'tree-dry-dead.jpg', use: 'seed', task: 'tree-disease', expected: ['Browning foliage (necrosis or dieback)'], title: 'File:A dry aging tree in Nairobi National Park.jpg' },

  // wildlife
  { file: 'wildlife-indian-pond-heron.jpg', use: 'seed', task: 'wildlife', expected: ['Bird'], title: 'File:Indian pond heron (Ardeola grayii) India.jpg' },
  { file: 'wildlife-green-bee-eater.jpg', use: 'seed', task: 'wildlife', expected: ['Bird'], title: 'File:007 Asian green bee-eater in Jim Corbett National Park Photo by Giles Laurent.jpg' },
  { file: 'wildlife-plain-tiger.jpg', use: 'seed', task: 'wildlife', expected: ['Butterfly or moth'], title: 'File:Danaus chrysippus Female by kadavoor.jpg' },

  // plants
  { file: 'plant-flowering-tree-cubbon.jpg', use: 'seed', task: 'plant-id', expected: ['Flowering plant', 'Foliage (species outside the model vocabulary)'], title: 'File:Flowering tree at Cubbon Park.jpg' },
  { file: 'plant-lantana-camara.jpg', use: 'seed', task: 'plant-id', expected: ['Flowering plant', 'Foliage (species outside the model vocabulary)'], title: 'File:LantanaFlowerLeaves.jpg' },

  // litter
  { file: 'waste-garbage-dump.jpg', use: 'seed', task: 'waste', expected: ['Litter recognised (bottles, bags, packaging)'], title: 'File:Garbage dump Ooty.jpg' },
  { file: 'waste-plastic-bottle.jpg', use: 'seed', task: 'waste', expected: ['Litter recognised (bottles, bags, packaging)'], title: 'File:Littered plastic bottle.jpg' },
  { file: 'waste-overflowing-bin.jpg', use: 'seed', task: 'waste', expected: ['Waste bin recognised', 'Litter recognised (bottles, bags, packaging)'], title: 'File:Overflowing paper bin.jpg' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strip the HTML Commons embeds in `Artist` so the credit reads as plain text. */
const plain = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function fetchWithRetry(url, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res;
    if (res.status !== 429 || attempt === attempts) throw new Error(`${url} responded ${res.status}`);
    await sleep(5000 * attempt);
  }
  throw new Error('unreachable');
}

async function describe(title) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '960',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  });
  const res = await fetchWithRetry(`${API}?${params}`);
  const page = Object.values((await res.json()).query.pages)[0];
  if (!page.imageinfo) throw new Error(`${title} was not found on Commons`);
  const info = page.imageinfo[0];
  return {
    thumbUrl: info.thumburl,
    sourcePage: info.descriptionurl,
    author: plain(info.extmetadata.Artist?.value) || 'Unknown',
    license: info.extmetadata.LicenseShortName?.value || 'Unknown',
    licenseUrl: info.extmetadata.LicenseUrl?.value || '',
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const attribution = [];

  for (const sample of SAMPLES) {
    const meta = await describe(sample.title);
    const original = Buffer.from(await (await fetchWithRetry(meta.thumbUrl)).arrayBuffer());
    const bytes = encodeJpeg(resizeRgb(decodeImage(original), MAX_SIDE), 85);
    await fs.writeFile(path.join(OUT_DIR, sample.file), bytes);

    attribution.push({
      file: sample.file,
      use: sample.use,
      task: sample.task,
      expected: sample.expected,
      title: sample.title.replace(/^File:/, ''),
      author: meta.author,
      license: meta.license,
      licenseUrl: meta.licenseUrl,
      source: meta.sourcePage,
    });
    console.log(`✓ ${sample.file}  (${Math.round(bytes.length / 1024)} KB, ${meta.license})`);
    await sleep(2000); // stay well inside Wikimedia's request-rate policy
  }

  await fs.writeFile(path.join(OUT_DIR, 'attribution.json'), `${JSON.stringify(attribution, null, 2)}\n`);
  console.log(`\n${attribution.length} images written to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(`Sample image download failed: ${err.message}`);
  process.exit(1);
});
