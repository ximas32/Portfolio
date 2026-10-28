/* Schlanker Linien-Chart als SVG – ohne Bibliothek.
   Fadenkreuz mit Wertanzeige per Finger oder Maus, Pfeiltasten am Desktop,
   Legende ab zwei Reihen, Datentabelle zum Aufklappen. Farben kommen aus
   CSS-Variablen (--chart-1, --chart-2), damit Hell/Dunkel stimmt. */
import { fmtDate } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const H = 210;
const PAD = { top: 12, right: 10, bottom: 24, left: 46 };

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

/** Runde Achsenschritte: 1, 2, 2.5, 5 × 10^n */
function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

/** Kurz fuer Achsen: 950 / 1.2K / 12K / 1.5M */
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}K`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  if (a >= 10) return String(Math.round(v));
  return String(+v.toFixed(2));
}

function shortDate(d) {
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y.slice(2)}`;
}

/**
 * @param {HTMLElement} host
 * @param {object} cfg
 * @param {string[]} cfg.dates                 X-Werte (YYYY-MM-DD), gleichmaessig verteilt
 * @param {Array<{label, color, values:number[], area?:boolean}>} cfg.series   color = 1 | 2
 * @param {Array<{index:number, kind:'buy'|'sell', text:string}>} [cfg.markers]
 * @param {(v:number)=>string} cfg.format      Wertformat fuer Tooltip/Tabelle
 * @param {(i:number)=>string} [cfg.note]      Zusatzzeile im Tooltip (z. B. Kauf)
 * @returns {() => void} Aufraeumen
 */
export function lineChart(host, cfg) {
  host.classList.add('chart');
  host.innerHTML = '';

  const n = cfg.dates.length;
  if (n < 2) {
    host.innerHTML = '<p class="muted center small">Zu wenig Daten für einen Verlauf.</p>';
    return () => {};
  }

  if (cfg.series.length > 1) {
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    for (const s of cfg.series) {
      const item = document.createElement('span');
      const key = document.createElement('i');
      key.className = `key c${s.color}`;
      item.append(key, document.createTextNode(s.label));
      legend.appendChild(item);
    }
    host.appendChild(legend);
  }

  const plot = document.createElement('div');
  plot.className = 'chart-plot';
  host.appendChild(plot);
  const tip = document.createElement('div');
  tip.className = 'chart-tip hidden';
  plot.appendChild(tip);

  let svg = null;
  let current = -1;
  let geom = null;

  function draw() {
    const W = Math.max(240, plot.clientWidth || 320);
    if (svg) svg.remove();
    svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', tabindex: '0',
      'aria-label': `Verlauf vom ${fmtDate(cfg.dates[0])} bis ${fmtDate(cfg.dates[n - 1])}` });
    plot.insertBefore(svg, tip);

    const all = cfg.series.flatMap((s) => s.values).filter(Number.isFinite);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi - lo < 1e-9) { hi += Math.abs(hi) * 0.05 || 1; lo -= Math.abs(lo) * 0.05 || 1; }
    const step = niceStep((hi - lo) / 3);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const x0 = PAD.left;
    const x1 = W - PAD.right;
    const y0 = H - PAD.bottom;
    const y1 = PAD.top;
    const sx = (i) => x0 + (i / (n - 1)) * (x1 - x0);
    const sy = (v) => y0 - ((v - lo) / (hi - lo)) * (y0 - y1);
    geom = { sx, sy, x0, x1, y0, y1, W };

    // Gitter + Y-Achse
    for (let v = lo; v <= hi + step / 2; v += step) {
      el('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v), class: 'grid' }, svg);
      el('text', { x: x0 - 6, y: sy(v) + 4, class: 'axis', 'text-anchor': 'end' }, svg).textContent = compact(v);
    }
    // X-Achse: Anfang, Mitte, Ende
    [[0, 'start'], [Math.floor((n - 1) / 2), 'middle'], [n - 1, 'end']].forEach(([i, anchor]) => {
      el('text', { x: sx(i), y: H - 6, class: 'axis', 'text-anchor': anchor }, svg).textContent = shortDate(cfg.dates[i]);
    });

    // Reihen (die erste zuletzt, damit sie oben liegt)
    for (const s of cfg.series.slice().reverse()) {
      let d = '';
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        d += `${d ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
      });
      if (s.area && d) {
        const firstI = s.values.findIndex(Number.isFinite);
        el('path', { d: `${d}L${sx(n - 1).toFixed(1)},${y0}L${sx(firstI).toFixed(1)},${y0}Z`, class: `area c${s.color}` }, svg);
      }
      el('path', { d, class: `line c${s.color}` }, svg);
    }

    // Kauf-/Verkaufspunkte auf der ersten Reihe
    for (const m of cfg.markers || []) {
      const v = cfg.series[0].values[m.index];
      if (!Number.isFinite(v)) continue;
      el('circle', { cx: sx(m.index), cy: sy(v), r: 4.5, class: `marker ${m.kind}` }, svg);
    }

    // Fadenkreuz-Ebene
    const cross = el('g', { class: 'cross hidden' }, svg);
    el('line', { y1: y1, y2: y0, class: 'cross-line' }, cross);
    cfg.series.forEach((s) => el('circle', { r: 4.5, class: `cross-dot c${s.color}` }, cross));
    geom.cross = cross;

    const hit = el('rect', { x: x0, y: 0, width: x1 - x0, height: H, class: 'hit' }, svg);
    hit.addEventListener('pointerdown', onPointer);
    hit.addEventListener('pointermove', onPointer);
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('keydown', onKey);
    svg.addEventListener('blur', hide);
    if (current >= 0) show(current);
  }

  function onPointer(e) {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * geom.W;
    const i = Math.round(((x - geom.x0) / (geom.x1 - geom.x0)) * (n - 1));
    show(Math.max(0, Math.min(n - 1, i)));
  }

  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const start = current < 0 ? n - 1 : current;
    show(Math.max(0, Math.min(n - 1, start + (e.key === 'ArrowRight' ? 1 : -1))));
  }

  function show(i) {
    current = i;
    const { sx, sy, cross } = geom;
    cross.classList.remove('hidden');
    const x = sx(i);
    cross.querySelector('.cross-line').setAttribute('x1', x);
    cross.querySelector('.cross-line').setAttribute('x2', x);
    cross.querySelectorAll('.cross-dot').forEach((dot, k) => {
      const v = cfg.series[k].values[i];
      dot.style.display = Number.isFinite(v) ? '' : 'none';
      if (Number.isFinite(v)) { dot.setAttribute('cx', x); dot.setAttribute('cy', sy(v)); }
    });

    // Tooltip: Werte zuerst und kraeftig, Bezeichnung dahinter
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-date';
    head.textContent = fmtDate(cfg.dates[i]);
    tip.appendChild(head);
    cfg.series.forEach((s) => {
      const v = s.values[i];
      if (!Number.isFinite(v)) return;
      const row = document.createElement('div');
      row.className = 'tip-row';
      const key = document.createElement('i');
      key.className = `key c${s.color}`;
      const b = document.createElement('b');
      b.textContent = cfg.format(v);
      row.append(key, b);
      // Eine einzige Reihe braucht keinen Namen – der Titel sagt, was es ist
      if (cfg.series.length > 1) row.appendChild(document.createTextNode(s.label));
      tip.appendChild(row);
    });
    const note = cfg.note?.(i);
    if (note) {
      const p = document.createElement('div');
      p.className = 'tip-note';
      p.textContent = note;
      tip.appendChild(p);
    }
    tip.classList.remove('hidden');
    const scale = plot.clientWidth / geom.W;
    const left = x * scale;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(plot.clientWidth - w, left - w / 2))}px`;
  }

  function hide() {
    current = -1;
    geom?.cross?.classList.add('hidden');
    tip.classList.add('hidden');
  }

  // Tabelle als Alternative zum Antippen (max. ~24 Zeilen, gleichmaessig verteilt)
  const table = document.createElement('details');
  table.className = 'chart-table';
  const sum = document.createElement('summary');
  sum.textContent = 'Als Tabelle';
  table.appendChild(sum);
  table.addEventListener('toggle', () => {
    if (!table.open || table.querySelector('table')) return;
    const t = document.createElement('table');
    const hr = t.insertRow();
    ['Datum', ...cfg.series.map((s) => s.label)].forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    const every = Math.max(1, Math.ceil(n / 24));
    for (let i = n - 1; i >= 0; i -= every) {
      const r = t.insertRow();
      r.insertCell().textContent = fmtDate(cfg.dates[i]);
      cfg.series.forEach((s) => { r.insertCell().textContent = Number.isFinite(s.values[i]) ? cfg.format(s.values[i]) : '–'; });
    }
    table.appendChild(t);
  });
  host.appendChild(table);

  draw();
  const ro = new ResizeObserver(() => { if (svg && Math.abs(plot.clientWidth - geom.W) > 2) draw(); });
  ro.observe(plot);
  return () => ro.disconnect();
}

/** Zeitraum-Auswahl: schneidet eine Datumsreihe zu. */
export const RANGES = [
  { id: '1m', label: '1M', days: 31 },
  { id: '3m', label: '3M', days: 92 },
  { id: '1y', label: '1J', days: 366 },
  { id: '3y', label: '3J', days: 1096 },
  { id: 'max', label: 'Max', days: 0 }
];

export function rangeStart(id) {
  const r = RANGES.find((x) => x.id === id) || RANGES[RANGES.length - 1];
  if (!r.days) return '';
  return new Date(Date.now() - r.days * 86400000).toISOString().slice(0, 10);
}

const RANGE_KEY = 'portfolio.chartRange';
export function getRange() {
  try { return localStorage.getItem(RANGE_KEY) || 'max'; } catch { return 'max'; }
}
export function setRange(id) {
  try { localStorage.setItem(RANGE_KEY, id); } catch { /* egal */ }
}

export function rangeChips(active) {
  return `<div class="chips chart-ranges">${RANGES.map((r) =>
    `<button type="button" class="chip ${r.id === active ? 'active' : ''}" data-range="${r.id}">${r.label}</button>`).join('')}</div>`;
}
