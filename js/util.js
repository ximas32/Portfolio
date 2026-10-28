/* Kleine Helfer, die überall gebraucht werden. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML-Escaping – IMMER benutzen, bevor Nutzertext in innerHTML landet. */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Für die Suche: klein, ohne Akzente, Umlaute ausgeschrieben. */
export function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** "1'234.50", "1 234,5", "12.5" -> Zahl (bzw. null) */
export function parseNum(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input ?? '').trim().replace(/['’\s]/g, '');
  if (!s) return null;
  // Komma als Dezimaltrenner nur, wenn kein Punkt vorkommt
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replaceAll(',', '');
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

/** ISIN: 2 Buchstaben, 9 Zeichen, 1 Prüfziffer – inkl. Prüfziffer-Kontrolle. */
export function isIsin(value) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
  const digits = s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let sum = 0;
  let double = true;
  for (let i = digits.length - 2; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

const CHF_FMT = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12345.6 -> "12’345.60" */
export function fmtMoney(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return CHF_FMT.format(n);
}

/** Betrag mit Währung: "CHF 12’345.60" */
export function fmtCur(n, currency = 'CHF') {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${currency} ${fmtMoney(n)}`;
}

/** Mit Vorzeichen: "+1’234.00" / "−56.10" */
export function fmtSigned(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const sign = n > 0.004 ? '+' : n < -0.004 ? '−' : '±';
  return sign + CHF_FMT.format(Math.abs(n));
}

export function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const v = n * 100;
  const sign = v > 0.004 ? '+' : v < -0.004 ? '−' : '±';
  return `${sign}${Math.abs(v).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Kurse/Stückzahlen ohne künstliche Rundung, aber lesbar. */
export function fmtNum(n, maxDigits = 4) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return n.toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: maxDigits });
}

/** Klasse für Gewinn/Verlust-Farbe */
export function gainClass(n) {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '';
  return n > 0 ? 'gain' : 'loss';
}

let toastTimer;
export function toast(message, ms = 2600) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), ms);
}

/** "2024-03-15" -> "15.03.2024" */
export function fmtDate(value) {
  if (!value) return '';
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  return today ? `heute ${time}` : `${fmtDate(d)} ${time}`;
}

/** Heutiges Datum als "YYYY-MM-DD" in Ortszeit */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function downloadFile(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Query-Parameter aus dem Hash: "#/erfassen?konto=abc" -> { konto: 'abc' } */
export function hashParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
