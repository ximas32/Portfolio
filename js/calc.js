/* Portfolio-Rechnung – alles in CHF.

   Einstandswert: Jeder Kauf wird mit dem Wechselkurs seines Kauftags in
   CHF umgerechnet und so festgehalten. Was du damals in Franken bezahlt
   hast, aendert sich also nie mehr.
   Aktueller Wert: Stueckzahl × aktueller Kurs × aktueller Wechselkurs.

   Verkaeufe nach der Durchschnittskosten-Methode: der verkaufte Anteil
   nimmt anteilig Einstandswert mit, der Rest bleibt zum alten Schnitt.

   Gewinn wird zerlegt in
     Kurseffekt     – was das Wertpapier in seiner Waehrung gemacht hat
     Waehrungseffekt – was die Franken-Veraenderung dazu beigetragen hat
   Summe der beiden = Gewinn in CHF. */
import { state } from './store.js';
import { chfPer } from './market.js';

const EPS = 1e-9;

/** Was ein Trade in CHF gekostet bzw. eingebracht hat (inkl. Gebuehren). */
export function tradeChf(t) {
  const fx = Number(t.fxRate) || (t.currency === 'CHF' ? 1 : 0);
  const gross = (Number(t.quantity) || 0) * (Number(t.price) || 0) * fx;
  const fees = Number(t.fees) || 0;
  const feesChf = t.feesCurrency === 'CHF' ? fees : fees * fx;
  return t.type === 'sell' ? gross - feesChf : gross + feesChf;
}

/** Gebuehren in der Waehrung des Wertpapiers */
function feesLocal(t) {
  const fees = Number(t.fees) || 0;
  const fx = Number(t.fxRate) || 1;
  return t.feesCurrency === 'CHF' && t.currency !== 'CHF' ? fees / fx : fees;
}

function sortTrades(list) {
  return list.slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') ||
    (a.type === 'buy' ? -1 : 1) - (b.type === 'buy' ? -1 : 1) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

/** Aktueller Kurs eines Wertpapiers: Live-Kurs, sonst Handkurs, sonst letzter Trade. */
export function currentPrice(instrument, trades = []) {
  const q = instrument?.symbol ? state.quotes[instrument.symbol] : null;
  if (q && Number.isFinite(q.price)) {
    return { price: q.price, currency: q.currency, prevClose: q.prevClose, time: q.time, source: 'live' };
  }
  if (instrument && Number.isFinite(instrument.manualPrice)) {
    return {
      price: instrument.manualPrice,
      currency: instrument.currency,
      time: instrument.manualPriceDate ? Date.parse(instrument.manualPriceDate) : 0,
      source: 'manual'
    };
  }
  const last = sortTrades(trades).pop();
  if (last) {
    return { price: Number(last.price), currency: last.currency, time: Date.parse(last.date), source: 'trade' };
  }
  return null;
}

/** Eine Position = ein Wertpapier in einem Konto. */
export function computePosition(instrumentId, accountId) {
  const instrument = state.instruments.find((i) => i.id === instrumentId) || null;
  const trades = sortTrades(state.trades.filter((t) =>
    t.instrumentId === instrumentId && t.accountId === accountId));

  let qty = 0;
  let costChf = 0;
  let costLocal = 0;
  let realizedChf = 0;
  let investedChf = 0;

  for (const t of trades) {
    const q = Number(t.quantity) || 0;
    const p = Number(t.price) || 0;
    if (t.type === 'sell') {
      if (qty <= EPS) continue;
      const share = Math.min(q, qty) / qty;
      const outChf = costChf * share;
      realizedChf += tradeChf(t) - outChf;
      costChf -= outChf;
      costLocal -= costLocal * share;
      qty -= Math.min(q, qty);
      if (qty < EPS) { qty = 0; costChf = 0; costLocal = 0; }
    } else {
      qty += q;
      costChf += tradeChf(t);
      costLocal += q * p + feesLocal(t);
      investedChf += tradeChf(t);
    }
  }

  const currency = instrument?.currency || trades[0]?.currency || 'CHF';
  const quote = currentPrice(instrument, trades);
  const fxNow = quote ? chfPer(quote.currency) : null;

  let valueChf = null;
  let gainChf = null;
  let gainPct = null;
  let fxEffectChf = null;
  let priceEffectChf = null;
  let dayChangeChf = null;

  if (quote && fxNow !== null) {
    const valueLocal = qty * quote.price;
    valueChf = valueLocal * fxNow;
    gainChf = valueChf - costChf;
    gainPct = costChf > EPS ? gainChf / costChf : null;
    if (quote.currency === currency && currency === 'CHF') {
      // Franken-Titel: der ganze Gewinn ist Kurseffekt
      priceEffectChf = gainChf;
      fxEffectChf = 0;
    } else if (quote.currency === currency && qty > EPS) {
      priceEffectChf = (valueLocal - costLocal) * fxNow;
      fxEffectChf = costLocal * fxNow - costChf;
    }
    if (quote.source === 'live' && Number.isFinite(quote.prevClose)) {
      dayChangeChf = qty * (quote.price - quote.prevClose) * fxNow;
    }
  }

  return {
    instrumentId,
    accountId,
    instrument,
    trades,
    currency,
    qty,
    costChf,
    costLocal,
    avgPriceLocal: qty > EPS ? costLocal / qty : null,
    avgFx: costLocal > EPS ? costChf / costLocal : null,
    investedChf,
    realizedChf,
    quote,
    fxNow,
    valueChf,
    gainChf,
    gainPct,
    priceEffectChf,
    fxEffectChf,
    dayChangeChf
  };
}

/** Alle offenen Positionen eines Kontos, nach Wert sortiert. */
export function positions({ accountId, includeClosed = false }) {
  const ids = new Set(state.trades
    .filter((t) => t.accountId === accountId)
    .map((t) => t.instrumentId));
  return [...ids]
    .map((id) => computePosition(id, accountId))
    .filter((p) => includeClosed || p.qty > EPS)
    .sort((a, b) => (b.valueChf ?? b.costChf) - (a.valueChf ?? a.costChf));
}

/** Cash eines Kontos in CHF (null, wenn der Wechselkurs fehlt). */
export function cashChf(account) {
  const amount = Number(account?.cash) || 0;
  if (!amount) return 0;
  const fx = chfPer(account.cashCurrency || 'CHF');
  return fx === null ? null : amount * fx;
}

/** Summen ueber eine Liste von Positionen (+ optional Cash). */
export function summarize(list, cash = 0) {
  const sum = (key) => list.reduce((s, p) => s + (Number.isFinite(p[key]) ? p[key] : 0), 0);
  const missing = list.filter((p) => p.valueChf === null).length;
  const costChf = sum('costChf');
  const valueChf = sum('valueChf');
  // Gewinn nur ueber Positionen mit bekanntem Wert, sonst waere er verfaelscht
  const valued = list.filter((p) => p.valueChf !== null);
  const valuedCost = valued.reduce((s, p) => s + p.costChf, 0);
  const gainChf = valueChf - valuedCost;
  return {
    count: list.length,
    missing,
    costChf,
    valueChf,
    cashChf: cash || 0,
    totalChf: valueChf + (cash || 0),
    gainChf,
    gainPct: valuedCost > EPS ? gainChf / valuedCost : null,
    fxEffectChf: sum('fxEffectChf'),
    priceEffectChf: sum('priceEffectChf'),
    dayChangeChf: list.some((p) => Number.isFinite(p.dayChangeChf)) ? sum('dayChangeChf') : null,
    realizedChf: sum('realizedChf')
  };
}

/** Uebersicht pro Konto */
export function accountSummary(account) {
  const list = positions({ accountId: account.id });
  const closed = positions({ accountId: account.id, includeClosed: true });
  const s = summarize(list, cashChf(account) ?? 0);
  s.realizedChf = closed.reduce((x, p) => x + p.realizedChf, 0);
  return { account, positions: list, ...s };
}

/** Gesamtvermoegen ueber alle Konten. Gerechnet wird pro Konto und dann
    summiert – jedes Konto hat seinen eigenen Einstands-Schnitt. */
export function totalSummary() {
  const accounts = state.accounts
    .map(accountSummary)
    .sort((a, b) => b.totalChf - a.totalChf);
  const list = accounts.flatMap((a) => a.positions);
  const cash = accounts.reduce((s, a) => s + a.cashChf, 0);
  const s = summarize(list, cash);
  s.realizedChf = accounts.reduce((x, a) => x + a.realizedChf, 0);
  return { accounts, positions: list, ...s };
}

const SUM_KEYS = ['qty', 'costChf', 'costLocal', 'investedChf', 'realizedChf', 'valueChf',
  'gainChf', 'priceEffectChf', 'fxEffectChf', 'dayChangeChf'];

/**
 * Dasselbe Wertpapier ueber alle Konten zusammengezaehlt (z. B. derselbe
 * ETF bei zwei Banken). parts enthaelt die einzelnen Konto-Positionen.
 */
export function mergedPosition(instrumentId, { includeClosed = false } = {}) {
  const parts = state.accounts
    .map((a) => computePosition(instrumentId, a.id))
    .filter((p) => p.trades.length && (includeClosed || p.qty > EPS));
  if (!parts.length) return null;
  const m = { ...parts[0], accountId: null, parts, trades: parts.flatMap((p) => p.trades) };
  for (const k of SUM_KEYS) {
    const vals = parts.map((p) => p[k]).filter(Number.isFinite);
    m[k] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  if (parts.some((p) => p.valueChf === null)) { m.valueChf = null; m.gainChf = null; }
  m.gainPct = m.gainChf !== null && m.costChf > EPS ? m.gainChf / m.costChf : null;
  m.avgPriceLocal = m.qty > EPS ? m.costLocal / m.qty : null;
  m.avgFx = m.costLocal > EPS ? m.costChf / m.costLocal : null;
  return m;
}

export function mergedPositions() {
  const ids = [...new Set(state.trades.map((t) => t.instrumentId))];
  return ids
    .map((id) => mergedPosition(id))
    .filter(Boolean)
    .sort((a, b) => (b.valueChf ?? b.costChf) - (a.valueChf ?? a.costChf));
}

/** Verteilung nach einem Merkmal (Waehrung, Art, Konto) in CHF */
export function breakdown(list, keyFn, labelFn = (k) => k) {
  const map = new Map();
  for (const p of list) {
    const v = p.valueChf ?? p.costChf;
    if (!v) continue;
    const k = keyFn(p);
    map.set(k, (map.get(k) || 0) + v);
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  return [...map.entries()]
    .map(([key, value]) => ({ key, label: labelFn(key), value, share: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}
