// Tiny SVG helpers shared by both diagram generators.
const FONT = "'Segoe UI', Inter, 'Helvetica Neue', Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(cx, cy, lines, o = {}) {
  const size = o.size || 16;
  const lh = o.lh || Math.round(size * 1.3);
  const weight = o.weight || 500;
  const color = o.color || '#0f172a';
  const anchor = o.anchor || 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  const startY = cy - ((arr.length - 1) * lh) / 2;
  return arr
    .map((l, i) => {
      // allow per-line styling with {t, w, c, s}
      const line = typeof l === 'string' ? { t: l } : l;
      return `<text x="${cx}" y="${startY + i * lh}" font-family="${FONT}" font-size="${line.s || size}" font-weight="${line.w || weight}" fill="${line.c || color}" text-anchor="${anchor}" dominant-baseline="central">${esc(line.t)}</text>`;
    })
    .join('\n');
}

function svgDoc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#475569"/>
  </marker>
  <marker id="arrowG" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#15803d"/>
  </marker>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.08"/>
  </filter>
</defs>
<rect width="${w}" height="${h}" fill="#ffffff"/>
${body}
</svg>
`;
}

// polyline with rounded corners
function path(points, o = {}) {
  const r = o.r ?? 10;
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    if (i < points.length - 1 && r > 0) {
      const [px, py] = points[i - 1];
      const [nx, ny] = points[i + 1];
      const l1 = Math.hypot(x - px, y - py);
      const l2 = Math.hypot(nx - x, ny - y);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = x - ((x - px) / l1) * rr;
      const ay = y - ((y - py) / l1) * rr;
      const bx = x + ((nx - x) / l2) * rr;
      const by = y + ((ny - y) / l2) * rr;
      d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
    } else d += ` L${x},${y}`;
  }
  const color = o.color || '#475569';
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${o.width || 2.2}"${dash} marker-end="url(#${o.marker || 'arrow'})"/>`;
}

function pill(cx, cy, label, o = {}) {
  const size = o.size || 14;
  const w = o.w || Math.round(label.length * size * 0.56 + 22);
  const h = size + 12;
  return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="${o.fill || '#ffffff'}" stroke="${o.stroke || '#cbd5e1'}" stroke-width="1.2"/>
${text(cx, cy, label, { size, weight: o.weight || 600, color: o.color || '#334155' })}`;
}

module.exports = { FONT, esc, text, svgDoc, path, pill };
