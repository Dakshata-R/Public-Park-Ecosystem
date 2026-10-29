const fs = require('fs');
const { text, svgDoc, path, pill, esc, FONT } = require('./lib');

const OUT = process.argv[2];
const W = 1800, H = 1310;
const P = [];

const L = {
  client: { c: '#0284c7', bg: '#f0f9ff', bd: '#bae6fd', chip: '#7dd3fc' },
  api: { c: '#16a34a', bg: '#f0fdf4', bd: '#bbf7d0', chip: '#86efac' },
  svc: { c: '#0d9488', bg: '#f0fdfa', bd: '#99f6e4', chip: '#5eead4' },
  data: { c: '#4f46e5', bg: '#eef2ff', bd: '#c7d2fe', chip: '#a5b4fc' },
  ext: { c: '#d97706', bg: '#fffbeb', bd: '#fde68a', chip: '#fcd34d' },
  dep: { c: '#475569', bg: '#f8fafc', bd: '#cbd5e1', chip: '#cbd5e1' },
};

const tw = (s, size) => s.length * size * 0.54; // rough text width estimate

function band(x, y, w, h, k, tag, title, sub, o = {}) {
  const s = L[k];
  P.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${s.bg}" stroke="${s.bd}" stroke-width="2"${o.dash ? ' stroke-dasharray="8 6"' : ''}/>`);
  const tagW = Math.round(tw(tag, 13) + 30);
  P.push(`<rect x="${x + 22}" y="${y + 20}" width="${tagW}" height="26" rx="13" fill="${s.c}"/>`);
  P.push(text(x + 22 + tagW / 2, y + 33, [{ t: tag, s: 13, w: 700, c: '#ffffff' }]));
  P.push(text(x + 22 + tagW + 14, y + 33, [{ t: title, s: 20, w: 700, c: '#0f172a' }], { anchor: 'start' }));
  if (sub) {
    const tx = x + 22 + tagW + 14 + tw(title, 20) * 1.14 + 18;
    P.push(text(tx, y + 34, [{ t: sub, s: 15, w: 500, c: '#64748b' }], { anchor: 'start' }));
  }
}

function chip(x, y, w, h, k, lines, o = {}) {
  const s = L[k];
  P.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${o.fill || '#ffffff'}" stroke="${o.stroke || s.chip}" stroke-width="1.6"${o.dash ? ' stroke-dasharray="6 4"' : ''}/>`);
  const arr = (Array.isArray(lines) ? lines : [lines]).map((t, i) =>
    i === 0 ? { t, s: o.size || 16, w: 650, c: o.ink || '#0f172a' } : { t, s: 14, w: 500, c: '#475569' });
  P.push(text(o.left ? x + 16 : x + w / 2, y + h / 2, arr, { lh: 20, anchor: o.left ? 'start' : 'middle' }));
}

function grid(x, y, w, cols, cw_h, gap, k, items, o = {}) {
  const cw = (w - gap * (cols - 1)) / cols;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    chip(x + c * (cw + gap), y + r * (cw_h + gap), cw, cw_h, k, it, o);
  });
}

function connector(x, y1, y2, label) {
  P.push(path([[x, y1], [x, y2]], { color: '#475569', width: 2.4 }));
  if (label) P.push(pill(x + 14 + tw(label, 14) / 2 + 12, (y1 + y2) / 2, label));
}

// ---------- header ----------
P.push(text(60, 52, [{ t: 'Park Ecosystem Portal — Software Architecture', s: 30, w: 700, c: '#14532d' }], { anchor: 'start' }));
P.push(text(60, 88, [{ t: 'Layered web system: Next.js client · Express REST API · domain services · MongoDB · open-data APIs', s: 16, w: 500, c: '#475569' }], { anchor: 'start' }));

const X = 60, BW = 1680, IX = 92, IW = 1616;

// ---------- client ----------
let y = 120;
band(X, y, BW, 150, 'client', 'CLIENT', 'Next.js 13 web app', 'React · TypeScript');
const tech = ['React', 'TypeScript', 'Tailwind CSS', 'shadcn/ui', 'TanStack Query', 'Leaflet maps', 'Recharts'];
grid(IX, y + 70, 1060, 7, 50, 10, 'client', tech, { size: 15 });
// role-based UI panel
P.push(text(1200, y + 95, [{ t: 'Role-based UI', s: 15, w: 700, c: '#0c4a6e' }], { anchor: 'start' }));
const roles = [
  ['Citizen', '#e0f2fe', '#0284c7', '#0c4a6e'],
  ['Park Officer', '#fef3c7', '#d97706', '#78350f'],
  ['Admin', '#ede9fe', '#7c3aed', '#4c1d95'],
];
let rx = 1200;
[120, 150, 100].forEach((w, i) => {
  const [t, f, s, ink] = roles[i];
  chip(rx, y + 112, w, 34, 'client', t, { fill: f, stroke: s, ink, size: 15 });
  rx += w + 10;
});

connector(900, y + 150, y + 200, 'REST / JSON over HTTPS · Bearer JWT');

// ---------- API ----------
y = 320;
band(X, y, BW, 250, 'api', 'API', 'Node.js + Express REST API', '/api/*');
// request pipeline
P.push(text(IX, y + 88, [{ t: 'Request pipeline', s: 14, w: 700, c: '#166534' }], { anchor: 'start' }));
const pipe = ['Rate limiting', 'JWT auth', 'Role-based access', 'Zod validation', 'Module controller', 'Audit log'];
const pw = [180, 150, 200, 180, 200, 140];
let px = IX + 150;
pipe.forEach((t, i) => {
  chip(px, y + 70, pw[i], 36, 'api', t, { size: 15, fill: i < 4 ? '#dcfce7' : '#ffffff' });
  if (i < pipe.length - 1) P.push(path([[px + pw[i] + 4, y + 88], [px + pw[i] + 34, y + 88]], { r: 0, width: 2 }));
  px += pw[i] + 38;
});
P.push(text(IX, y + 137, [{ t: 'Modules', s: 14, w: 700, c: '#166534' }], { anchor: 'start' }));
const mods = ['Parks / GIS', 'Biodiversity', 'Sensors', 'Citizen reports', 'Incidents & triage',
  'Maintenance / work orders', 'AI monitoring', 'Eco Assistant', 'Analytics / reports', 'Admin'];
grid(IX, y + 152, IW, 5, 38, 10, 'api', mods, { size: 15 });
connector(900, y + 250, y + 300, 'calls');

// ---------- services ----------
y = 620;
band(X, y, BW, 230, 'svc', 'SERVICES', 'Domain services', 'one implementation, many callers');
const svcs = [
  ['Priority / triage', 'hazard × exposure × age → 0–100'],
  ['Ecosystem health score', 'weighted park index, graded'],
  ['Biodiversity indices', 'Shannon · Simpson · Pielou · richness'],
  ['Workflow', 'incident → work order → resolved'],
  ['AQI', 'CPCB sub-indices from pollutants'],
  ['Anomaly detection', 'z-score · robust z · IQR vote'],
  ['Wildlife vision', 'MobileNetV2 (TF.js) · LLM*'],
  ['Eco Assistant', 'LLM tool use · keyword fallback'],
];
grid(IX, y + 66, IW, 4, 68, 12, 'svc', svcs);

// ---------- data + external ----------
y = 900;
const DW = 1000;
band(X, y, DW, 270, 'data', 'DATA', 'MongoDB (Mongoose)', 'GeoJSON · 2dsphere');
const cols = ['users', 'parks', 'species', 'observations', 'sensors / readings',
  'incidents', 'work orders', 'citizen reports', 'AI detections / images', 'audit log'];
grid(IX, y + 72, DW - 64, 5, 44, 10, 'data', cols, { size: 15 });
P.push(text(IX, y + 200, [{ t: 'Seeded from a committed open-data snapshot (OSM parks, GBIF records).', s: 15, w: 500, c: '#475569' }], { anchor: 'start' }));
P.push(text(IX, y + 228, [{ t: 'Abundance is derived from observations on read — never stored as a count.', s: 15, w: 500, c: '#475569' }], { anchor: 'start' }));

const EX = X + DW + 40, EW = BW - DW - 40;
band(EX, y, EW, 270, 'ext', 'EXTERNAL', 'Open data & APIs', null);
const ext = [
  ['Open-Meteo', 'weather + air quality'],
  ['GBIF', 'species & occurrences'],
  ['OpenStreetMap / Nominatim', 'parks, assets, geocoding'],
  ['TensorFlow Hub', 'MobileNetV2 weights'],
  ['Gemini / Groq / Ollama / Claude', 'optional'],
];
ext.forEach(([n, d], i) => {
  const cy = y + 62 + i * 40;
  const opt = i === 4;
  P.push(`<rect x="${EX + 30}" y="${cy}" width="${EW - 60}" height="34" rx="9" fill="#ffffff" stroke="${L.ext.chip}" stroke-width="1.6"${opt ? ' stroke-dasharray="6 4"' : ''}/>`);
  P.push(text(EX + 46, cy + 17, [{ t: n, s: 15, w: 650, c: '#0f172a' }], { anchor: 'start' }));
  P.push(text(EX + EW - 46, cy + 17, [{ t: d, s: 14, w: 500, c: '#78350f' }], { anchor: 'end' }));
});

// services -> data / external
P.push(path([[560, 850], [560, 900]], { width: 2.4 }));
P.push(pill(560 + 82, 875, 'Mongoose ODM'));
P.push(path([[EX + EW / 2, 850], [EX + EW / 2, 900]], { width: 2.4 }));
P.push(pill(EX + EW / 2 + 100, 875, 'HTTPS · cached'));

// ---------- deployment ----------
y = 1200;
band(X, y, BW, 70, 'dep', 'DEPLOYMENT', '', null, { dash: true });
const dep = [
  ['Frontend', 'Vercel / Netlify'],
  ['API', 'Render'],
  ['Database', 'MongoDB Atlas  (local MongoDB in development)'],
];
let dx = 230;
dep.forEach(([k, v]) => {
  P.push(text(dx, y + 34, [{ t: k + ':', s: 16, w: 700, c: '#334155' }], { anchor: 'start' }));
  const kx = dx + tw(k + ':', 16) + 14;
  P.push(text(kx, y + 34, [{ t: v, s: 16, w: 500, c: '#334155' }], { anchor: 'start' }));
  dx = kx + tw(v, 16) + 70;
});
P.push(text(W - 60, 1290, [{ t: '* optional AI vision (Gemini free tier, Groq, Ollama or Claude) for wildlife species identification  ·  dashed border = optional', s: 13, w: 500, c: '#64748b' }], { anchor: 'end' }));

fs.writeFileSync(OUT, svgDoc(W, H, P.join('\n')));
console.log('wrote', OUT);
