const fs = require('fs');
const { text, svgDoc, path, pill } = require('./lib');

const OUT = process.argv[2];
const W = 1800, H = 1290;

const ROLE = {
  citizen: { fill: '#e0f2fe', stroke: '#0284c7', ink: '#0c4a6e', label: 'Citizen' },
  officer: { fill: '#fef3c7', stroke: '#d97706', ink: '#78350f', label: 'Park Officer' },
  admin: { fill: '#ede9fe', stroke: '#7c3aed', ink: '#4c1d95', label: 'Admin' },
  both: { fill: 'url(#offadm)', stroke: '#a855f7', ink: '#4c1d95', label: 'Park Officer or Admin' },
  system: { fill: '#dcfce7', stroke: '#16a34a', ink: '#14532d', label: 'System (automatic)' },
};

const nodes = {};
const parts = [];

function lines(arr, ink) {
  // first line bold, remaining lines regular & slightly smaller
  return arr.map((t, i) => (i === 0 ? { t, w: 700, s: 17, c: ink } : { t, w: 500, s: 15, c: ink }));
}

function node(id, kind, role, cx, cy, w, h, label) {
  const r = ROLE[role];
  nodes[id] = { cx, cy, w, h, l: [cx - w / 2, cy], r: [cx + w / 2, cy], t: [cx, cy - h / 2], b: [cx, cy + h / 2] };
  let shape;
  if (kind === 'diamond') {
    shape = `<polygon points="${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}" fill="${r.fill}" stroke="${r.stroke}" stroke-width="2.2" stroke-linejoin="round" filter="url(#shadow)"/>`;
  } else {
    const rx = kind === 'oval' ? h / 2 : 12;
    const sw = kind === 'oval' ? 3 : 2;
    shape = `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${rx}" fill="${r.fill}" stroke="${r.stroke}" stroke-width="${sw}" filter="url(#shadow)"/>`;
  }
  parts.push(shape, text(cx, cy, lines(label, r.ink), { lh: 21 }));
}

const A = 260, B = 700, C = 1140;

// --- AI side panel (drawn first so it sits behind) ---
parts.push(`<rect x="1420" y="420" width="340" height="450" rx="18" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="7 6"/>`);
parts.push(text(1590, 452, [{ t: 'AI Monitoring · wildlife', w: 700, s: 17, c: '#334155' }]));

// --- main flow ---
node('start', 'oval', 'citizen', B, 170, 260, 60, ['Citizen signs in']);
node('submit', 'rect', 'citizen', B, 285, 360, 84, ['Submit a report', 'Issue · Wildlife sighting (photo) · Feedback']);
node('review', 'diamond', 'both', B, 450, 300, 150, ['Review', 'Park Officer / Admin', 'Accept?']);
node('rejected', 'oval', 'system', A, 450, 300, 76, ['Rejected', 'citizen is notified']);
node('type', 'diamond', 'system', B, 640, 250, 130, ['Report type?']);
node('obs', 'rect', 'system', A, 640, 300, 84, ['Verified Observation', 'created from the sighting']);
node('bio', 'oval', 'system', A, 790, 380, 84, ['Biodiversity tab · Citizen sightings', 'counted in diversity indices']);
node('feedback', 'oval', 'system', B, 790, 280, 76, ['Feedback logged', 'and acknowledged']);
node('incident', 'rect', 'system', C, 640, 340, 84, ['Incident created', 'auto priority / triage score']);
node('assign', 'rect', 'admin', C, 770, 340, 70, ['Admin assigns a Park Officer']);
node('wo', 'rect', 'system', C, 900, 360, 84, ['Work order created', "on the officer's list · Maintenance tab"]);
node('update', 'rect', 'officer', C, 1030, 360, 84, ['Officer updates progress', 'Admin monitors and can also update']);
node('done', 'diamond', 'system', C, 1170, 250, 120, ['Progress', '= 100% ?']);
node('complete', 'rect', 'system', B, 1170, 320, 84, ['Work order completed', 'Incident resolved']);
node('end', 'oval', 'citizen', A, 1170, 340, 84, ['Alert cleared', 'Citizen sees the status']);

// --- AI side nodes ---
node('ai1', 'rect', 'citizen', 1590, 525, 290, 84, ['Upload a photo — wildlife', 'any signed-in user']);
node('ai2', 'rect', 'system', 1590, 660, 290, 104, ['Species identification', 'animal named, group labelled', 'MobileNetV2 · LLM*']);
node('ai3', 'rect', 'both', 1590, 798, 290, 84, ['Human review queue', 'Officer / Admin confirms']);
parts.push(text(1590, 892, [{ t: '* optional AI vision (Gemini, Groq, Ollama, Claude)', s: 13, w: 500, c: '#64748b' }]));

// --- edges ---
const n = nodes;
const E = [];
E.push(path([n.start.b, n.submit.t]));
E.push(path([n.submit.b, n.review.t]));
E.push(path([n.review.l, n.rejected.r]));
E.push(path([n.review.b, n.type.t]));
E.push(path([n.type.l, n.obs.r]));
E.push(path([n.obs.b, n.bio.t]));
E.push(path([n.type.b, n.feedback.t]));
E.push(path([n.type.r, n.incident.l]));
E.push(path([n.incident.b, n.assign.t]));
E.push(path([n.assign.b, n.wo.t]));
E.push(path([n.wo.b, n.update.t]));
E.push(path([n.update.b, n.done.t]));
E.push(path([n.done.r, [1340, 1170], [1340, 1030], n.update.r]));
E.push(path([n.done.l, n.complete.r]));
E.push(path([n.complete.l, n.end.r]));
E.push(path([n.ai1.b, n.ai2.t]));
E.push(path([n.ai2.b, n.ai3.t]));

// edge labels
const L = [];
L.push(pill(480, 450, 'Rejected', { color: '#b91c1c', stroke: '#fecaca' }));
L.push(pill(770, 545, 'Accepted', { color: '#15803d', stroke: '#bbf7d0' }));
L.push(pill(490, 640, 'Sighting'));
L.push(pill(905, 640, 'Issue'));
L.push(pill(768, 727, 'Feedback'));
L.push(pill(940, 1170, 'Yes', { color: '#15803d', stroke: '#bbf7d0' }));
L.push(pill(1340, 1100, 'No', { color: '#b45309', stroke: '#fde68a' }));

// --- header + legend ---
const head = [];
head.push(text(60, 52, [{ t: 'Park Ecosystem Portal — Main Workflow', s: 30, w: 700, c: '#14532d' }], { anchor: 'start' }));
head.push(text(60, 88, [{ t: 'Citizen report → review → observation or incident → work order → resolution', s: 16, w: 500, c: '#475569' }], { anchor: 'start' }));
head.push(text(60, 114, [{ t: 'Oval = start / end   ·   Rectangle = process   ·   Diamond = decision', s: 14, w: 500, c: '#64748b' }], { anchor: 'start' }));

const legend = ['citizen', 'officer', 'admin', 'both', 'system'];
const widths = [125, 160, 112, 222, 180];
let lx = W - 60 - widths.reduce((a, b) => a + b, 0);
for (let i = 0; i < legend.length; i++) {
  const r = ROLE[legend[i]];
  head.push(`<rect x="${lx}" y="50" width="22" height="22" rx="6" fill="${r.fill}" stroke="${r.stroke}" stroke-width="2"/>`);
  head.push(text(lx + 32, 61, [{ t: r.label, s: 15, w: 600, c: '#334155' }], { anchor: 'start' }));
  lx += widths[i];
}

const grad = `<defs><linearGradient id="offadm" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#fef3c7"/><stop offset="1" stop-color="#ede9fe"/></linearGradient></defs>`;

fs.writeFileSync(OUT, svgDoc(W, H, [grad, ...head, ...E, ...parts, ...L].join('\n')));
console.log('wrote', OUT);
