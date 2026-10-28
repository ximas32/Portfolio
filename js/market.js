/* Marktdaten: Wertpapiersuche, Kurse, Wechselkurse.

   Kurse/Suche:  Yahoo Finance, ueber den eigenen Cloudflare-Worker
                 (worker/kurs-proxy.js), weil Yahoo keine Browser-Zugriffe
                 von fremden Seiten erlaubt (CORS).
   Wechselkurse: Referenzkurse der EZB via frankfurter.dev – gratis, ohne
                 Schluessel, direkt aus dem Browser abrufbar. Historische
                 Kurse fuer den Kauftag kommen von dort.

   Alle Werte in der App werden in CHF umgerechnet. Ein Wechselkurs wird
   hier immer als "CHF pro 1 Einheit Fremdwaehrung" gefuehrt. */
import { QUOTE_PROXY, QUOTE_MAX_AGE } from './config.js';
import { state, notify } from './store.js';
import { norm } from './util.js';

const FX_API = 'https://api.frankfurter.dev/v1';
const CACHE_KEY = 'portfolio.market';

/* Lokal (python dev-server.py) spielt der Testserver unter /yahoo den Proxy. */
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const PROXY = QUOTE_PROXY || (IS_LOCAL ? `${location.origin}/yahoo` : '');

export const hasProxy = Boolean(PROXY);
export const proxyUrl = PROXY;

/* ---------------- Waehrungs-Helfer ---------------- */

/** Yahoo notiert Londoner Titel in Pence ("GBp"), Johannesburg in Cents usw. */
const MINOR_UNITS = { GBp: ['GBP', 100], GBX: ['GBP', 100], ZAc: ['ZAR', 100], ILA: ['ILS', 100] };

export function normalizePrice(price, currency) {
  const minor = MINOR_UNITS[currency];
  if (minor) return { price: price / minor[1], currency: minor[0] };
  return { price, currency: (currency || '').toUpperCase() };
}

/** CHF pro 1 Einheit der Waehrung – null, wenn (noch) unbekannt. */
export function chfPer(currency) {
  if (!currency || currency === 'CHF') return 1;
  const rate = state.fx?.rates?.[currency];
  return Number.isFinite(rate) ? rate : null;
}

/* ---------------- Wechselkurse (EZB) ---------------- */

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Aktuelle Referenzkurse fuer alle Waehrungen gegen CHF. */
async function fetchLatestFx() {
  const data = await getJson(`${FX_API}/latest?base=CHF`);
  const rates = {};
  for (const [cur, perChf] of Object.entries(data.rates || {})) {
    if (perChf) rates[cur] = 1 / perChf;
  }
  return { date: data.date, rates };
}

/**
 * Wechselkurs am Stichtag. Faellt der Tag auf ein Wochenende oder einen
 * Feiertag, liefert die EZB den letzten Kurs davor – das tatsaechlich
 * verwendete Datum kommt mit zurueck.
 * @returns {Promise<{rate:number, date:string}>}
 */
export async function fetchHistoricalFx(currency, date) {
  if (currency === 'CHF') return { rate: 1, date };
  const key = `portfolio.fx.${currency}.${date}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (hit) return hit;
  } catch { /* egal */ }
  const data = await getJson(`${FX_API}/${date}?base=${encodeURIComponent(currency)}&symbols=CHF`);
  const rate = data.rates?.CHF;
  if (!rate) throw new Error(`Kein Kurs für ${currency}`);
  const result = { rate, date: data.date };
  // Vergangene Kurse aendern sich nicht mehr -> dauerhaft merken
  if (date < new Date().toISOString().slice(0, 10)) {
    try { localStorage.setItem(key, JSON.stringify(result)); } catch { /* voll */ }
  }
  return result;
}

/* ---------------- Yahoo ueber den Proxy ---------------- */

async function yahoo(path) {
  if (!hasProxy) throw new Error('Kein Kurs-Proxy eingerichtet (config.js → QUOTE_PROXY).');
  const res = await fetch(PROXY.replace(/\/$/, '') + path);
  if (!res.ok) throw new Error(`Kursdienst antwortet mit HTTP ${res.status}`);
  return res.json();
}

const TYPE_MAP = { ETF: 'etf', EQUITY: 'stock', MUTUALFUND: 'fund', CRYPTOCURRENCY: 'crypto' };

/**
 * Suche nach ISIN, Symbol oder Name.
 * @returns {Promise<Array<{symbol, name, exchange, kind}>>}
 */
export async function searchInstruments(query) {
  const q = encodeURIComponent(query.trim());
  const data = await yahoo(`/v1/finance/search?q=${q}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false`);
  return sortSwissFirst((data.quotes || [])
    .filter((x) => x.symbol && TYPE_MAP[x.quoteType])
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      kind: TYPE_MAP[x.quoteType]
    })));
}

/** Schweizer Boersenplaetze (SIX, Handel in CHF) zuerst – stabil sortiert. */
function sortSwissFirst(list) {
  return list
    .map((x, i) => ({ x, i, swiss: x.exchange === 'Swiss' || x.symbol.endsWith('.SW') ? 0 : 1 }))
    .sort((a, b) => a.swiss - b.swiss || a.i - b.i)
    .map((e) => e.x);
}

/**
 * Yahoo findet per ISIN oft nur einen Boersenplatz (z. B. London in USD).
 * Hier werden weitere Handelsplaetze desselben Wertpapiers gesucht: ueber
 * den Namen und die Symbol-Wurzel (VWRL.L -> VWRL -> VWRL.SW). Behalten wird
 * nur, was exakt gleich heisst – sonst landet man leicht bei einer anderen
 * Anteilsklasse (thesaurierend statt ausschuettend, andere ISIN).
 */
export async function findListings(hits) {
  const names = new Set(hits.map((h) => norm(h.name)));
  const kinds = new Set(hits.map((h) => h.kind));
  const found = new Map(hits.map((h) => [h.symbol, h]));
  const run = async (query) => {
    try {
      for (const r of await searchInstruments(query)) {
        if (names.has(norm(r.name)) && kinds.has(r.kind) && !found.has(r.symbol)) found.set(r.symbol, r);
      }
    } catch { /* einzelne Suche darf scheitern */ }
  };
  await Promise.all([...new Set(hits.map((h) => h.name))].map(run));
  const roots = new Set([...found.keys()].map((s) => s.split('.')[0]));
  await Promise.all([...roots].map(run));
  return sortSwissFirst([...found.values()]);
}

/** Aktueller Kurs eines Symbols (bereits auf Hauptwaehrung normalisiert). */
export async function fetchQuote(symbol) {
  const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) throw new Error(`Kein Kurs für ${symbol}`);
  const now = normalizePrice(meta.regularMarketPrice, meta.currency);
  const prev = Number.isFinite(meta.chartPreviousClose)
    ? normalizePrice(meta.chartPreviousClose, meta.currency).price
    : null;
  return {
    price: now.price,
    currency: now.currency,
    prevClose: prev,
    time: (meta.regularMarketTime || 0) * 1000,
    name: meta.longName || meta.shortName || ''
  };
}

/** Schlusskurs am (oder zuletzt vor dem) Stichtag – als Vorschlag beim Erfassen. */
export async function fetchHistoricalClose(symbol, date) {
  const day = Date.parse(`${date}T00:00:00Z`) / 1000;
  const p1 = day - 8 * 86400;
  const p2 = day + 86400;
  const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`);
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  for (let i = ts.length - 1; i >= 0; i--) {
    if (Number.isFinite(closes[i]) && ts[i] < p2) {
      const n = normalizePrice(closes[i], r.meta.currency);
      return { price: n.price, currency: n.currency, date: new Date(ts[i] * 1000).toISOString().slice(0, 10) };
    }
  }
  throw new Error('Für dieses Datum gibt es keinen Kurs.');
}

/* ---------------- Aktualisieren & Zwischenspeichern ---------------- */

export function loadMarketCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c) {
      state.quotes = c.quotes || {};
      state.fx = c.fx || null;
      state.quotesAt = c.quotesAt || 0;
    }
  } catch { /* egal */ }
}

function saveMarketCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      quotes: state.quotes, fx: state.fx, quotesAt: state.quotesAt
    }));
  } catch { /* voll */ }
}

/** Kleine Parallelitaets-Bremse, damit der Proxy nicht 50 Anfragen auf einmal bekommt. */
async function mapLimited(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

let running = null;

/**
 * Wechselkurse und Kurse aller Wertpapiere mit Symbol neu laden.
 * @param {{force?: boolean}} opts  force = auch wenn die Daten noch frisch sind
 */
export function refreshMarket({ force = false } = {}) {
  if (running) return running;
  if (!force && state.quotesAt && Date.now() - state.quotesAt < QUOTE_MAX_AGE) return Promise.resolve();
  if (!navigator.onLine) return Promise.resolve();

  running = (async () => {
    state.marketBusy = true;
    state.marketError = '';
    notify();
    const problems = [];

    try {
      state.fx = await fetchLatestFx();
    } catch (err) {
      problems.push(`Wechselkurse: ${err.message}`);
    }

    if (hasProxy) {
      const symbols = [...new Set(state.instruments.map((i) => i.symbol).filter(Boolean))];
      await mapLimited(symbols, 4, async (sym) => {
        try {
          state.quotes[sym] = await fetchQuote(sym);
        } catch (err) {
          problems.push(`${sym}: ${err.message}`);
        }
      });
    }

    state.quotesAt = Date.now();
    state.marketError = problems.join(' · ');
    state.marketBusy = false;
    saveMarketCache();
    notify();
  })().finally(() => { running = null; });

  return running;
}

/* ---------------- Historie fuer die Linien-Charts ----------------
   Pro Wertpapier eine einzige Anfrage fuer alle Tageskurse seit dem ersten
   Kauf, dazu eine fuer alle Wechselkurse. Beides wird im localStorage
   kompakt als [Datum, Kurs] gespeichert und hoechstens alle 12 Stunden
   erneuert – Yahoo und der Proxy merken davon praktisch nichts. */

const HIST_MAX_AGE = 12 * 60 * 60 * 1000;
const HIST_RETRY = 5 * 60 * 1000;
const PRICE_HIST_KEY = 'portfolio.hist.';
const FX_HIST_KEY = 'portfolio.fxhist';

/** Im Speicher: { prices: {symbol: {currency, points:[[d,c]]}}, fx: {cur: [[d,rate]]} } */
const history = { prices: {}, fx: {}, error: '', failedAt: 0 };
let historyLoading = null;

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* voll – dann eben nur im Speicher */ }
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function minusDays(date, days) {
  return isoDate(Date.parse(`${date}T00:00:00Z`) - days * 86400000);
}

/** Tageskurse eines Symbols ab Datum (bereits auf Hauptwaehrung normalisiert). */
async function fetchPriceHistory(symbol, from) {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const data = await yahoo(`/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`);
  const r = data.chart?.result?.[0];
  if (!r) throw new Error(`Keine Historie für ${symbol}`);
  const offset = (r.meta?.gmtoffset || 0) * 1000;
  const closes = r.indicators?.quote?.[0]?.close || [];
  const unit = normalizePrice(1, r.meta?.currency);
  const points = [];
  (r.timestamp || []).forEach((ts, i) => {
    if (Number.isFinite(closes[i])) points.push([isoDate(ts * 1000 + offset), closes[i] * unit.price]);
  });
  return { currency: unit.currency, points };
}

/** Taegliche EZB-Kurse ab Datum, als CHF pro Einheit. */
async function fetchFxHistory(currencies, from) {
  const data = await getJson(`${FX_API}/${from}..?base=CHF&symbols=${currencies.join(',')}`);
  const out = Object.fromEntries(currencies.map((c) => [c, []]));
  for (const date of Object.keys(data.rates || {}).sort()) {
    for (const [cur, perChf] of Object.entries(data.rates[date])) {
      if (perChf && out[cur]) out[cur].push([date, 1 / perChf]);
    }
  }
  return out;
}

/** Was die Charts brauchen: Symbole bzw. Waehrungen mit fruehestem Datum. */
function historyNeeds() {
  const firstByInst = {};
  for (const t of state.trades) {
    if (!firstByInst[t.instrumentId] || t.date < firstByInst[t.instrumentId]) firstByInst[t.instrumentId] = t.date;
  }
  const symbols = {};
  const currencies = {};
  for (const [id, first] of Object.entries(firstByInst)) {
    const inst = state.instruments.find((i) => i.id === id);
    // 30 Tage Vorlauf, damit der Kurs-Chart vor dem ersten Kauf beginnt
    const from = minusDays(first, 30);
    if (inst?.symbol && (!symbols[inst.symbol] || from < symbols[inst.symbol])) symbols[inst.symbol] = from;
    const cur = inst?.currency;
    if (cur && cur !== 'CHF' && (!currencies[cur] || from < currencies[cur])) currencies[cur] = from;
  }
  return { symbols, currencies };
}

function priceCacheOk(entry, from) {
  return entry && entry.from <= from && Date.now() - entry.at < HIST_MAX_AGE;
}

async function loadHistories() {
  const { symbols, currencies } = historyNeeds();
  const problems = [];

  if (hasProxy) {
    await mapLimited(Object.entries(symbols), 4, async ([sym, from]) => {
      let entry = history.prices[sym] || readJson(PRICE_HIST_KEY + sym);
      if (!priceCacheOk(entry, from)) {
        try {
          const h = await fetchPriceHistory(sym, from);
          entry = { from, at: Date.now(), ...h };
          writeJson(PRICE_HIST_KEY + sym, entry);
        } catch (err) {
          problems.push(`${sym}: ${err.message}`);
        }
      }
      if (entry) history.prices[sym] = entry;
    });
  }

  const curList = Object.keys(currencies).sort();
  if (curList.length) {
    const from = Object.values(currencies).sort()[0];
    let entry = history.fxEntry || readJson(FX_HIST_KEY);
    const covers = entry && entry.from <= from && curList.every((c) => entry.rates[c]);
    if (!covers || Date.now() - entry.at >= HIST_MAX_AGE) {
      try {
        entry = { from, at: Date.now(), rates: await fetchFxHistory(curList, from) };
        writeJson(FX_HIST_KEY, entry);
      } catch (err) {
        problems.push(`Wechselkurse: ${err.message}`);
      }
    }
    if (entry) { history.fxEntry = entry; history.fx = entry.rates; }
  }

  history.error = problems.join(' · ');
  history.failedAt = problems.length ? Date.now() : 0;
}

/** Sind alle benoetigten Reihen vorhanden und frisch genug? */
function historyComplete() {
  const { symbols, currencies } = historyNeeds();
  const pricesOk = !hasProxy || Object.entries(symbols).every(([s, from]) => priceCacheOk(history.prices[s], from));
  const fxOk = Object.entries(currencies).every(([c, from]) =>
    history.fxEntry && history.fxEntry.from <= from && history.fx[c] && Date.now() - history.fxEntry.at < HIST_MAX_AGE);
  return pricesOk && fxOk;
}

/**
 * Historie fuer die Charts. Liefert sofort, was da ist, und stoesst im
 * Hintergrund das Nachladen an – danach meldet notify() die neuen Daten.
 * @returns {{prices, fx, loading:boolean, error:string}}
 */
export function getHistory() {
  const retryOk = !history.failedAt || Date.now() - history.failedAt > HIST_RETRY;
  if (!historyLoading && retryOk && navigator.onLine && !historyComplete()) {
    historyLoading = loadHistories()
      .catch((err) => { history.error = err.message; history.failedAt = Date.now(); })
      .finally(() => { historyLoading = null; notify(); });
  }
  // Beim ersten Aufruf auch ohne Netz den Geraete-Cache nutzen
  if (!Object.keys(history.prices).length) {
    for (const sym of Object.keys(historyNeeds().symbols)) {
      const e = readJson(PRICE_HIST_KEY + sym);
      if (e) history.prices[sym] = e;
    }
  }
  if (!history.fxEntry) {
    const e = readJson(FX_HIST_KEY);
    if (e) { history.fxEntry = e; history.fx = e.rates; }
  }
  return { prices: history.prices, fx: history.fx, loading: Boolean(historyLoading), error: history.error };
}

/** Nach dem Erfassen eines neuen Wertpapiers sofort dessen Kurs holen. */
export async function refreshQuote(symbol) {
  if (!hasProxy || !symbol) return;
  try {
    state.quotes[symbol] = await fetchQuote(symbol);
    saveMarketCache();
    notify();
  } catch { /* beim naechsten Gesamt-Update erneut */ }
}
