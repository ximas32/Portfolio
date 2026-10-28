/* Wiederverwendbare Bausteine fuer die Ansichten. */
import { KINDS } from './config.js';
import { state } from './store.js';
import { hasProxy } from './market.js';
import { esc, fmtCur, fmtSigned, fmtPct, fmtNum, fmtMoney, fmtDate, fmtTime, gainClass } from './util.js';

export function kindOf(id) {
  return KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];
}

/** "+1’234.00 CHF (+5.2%)" farbig */
export function gainHtml(chf, pct) {
  if (!Number.isFinite(chf)) return '<span class="muted">–</span>';
  const p = Number.isFinite(pct) ? ` <small>(${fmtPct(pct)})</small>` : '';
  return `<span class="${gainClass(chf)}">${fmtSigned(chf)}${p}</span>`;
}

/** Eine Zeile in einer Positionsliste */
export function positionRow(p, href) {
  const inst = p.instrument || {};
  const kind = kindOf(inst.kind);
  const sub = [inst.symbol, inst.isin].filter(Boolean).join(' · ');
  const value = p.valueChf !== null ? fmtMoney(p.valueChf) : '–';
  const stale = p.quote && p.quote.source !== 'live'
    ? `<span class="tag" title="${p.quote.source === 'manual' ? 'Kurs von Hand gesetzt' : 'Kein aktueller Kurs – letzter Kaufkurs'}">${p.quote.source === 'manual' ? 'Handkurs' : 'Kaufkurs'}</span>`
    : '';
  return `
    <a class="pos-row" href="${href}">
      <div class="pos-icon">${kind.emoji}</div>
      <div class="pos-main">
        <div class="pos-name">${esc(inst.name || p.instrumentId)}</div>
        <div class="pos-sub">${fmtNum(p.qty)} Stk · ${esc(sub || p.currency)} ${stale}</div>
      </div>
      <div class="pos-figs">
        <div class="pos-value">${value}</div>
        <div class="pos-gain">${gainHtml(p.gainChf, p.gainPct)}</div>
      </div>
    </a>`;
}

/** Kennzahl-Zeile key/value */
export function kv(label, value, extra = '') {
  return `<div class="kv ${extra}"><span>${label}</span><span>${value}</span></div>`;
}

/** Horizontale Balken fuer die Verteilung */
export function bars(items) {
  if (!items.length) return '<p class="muted">Noch keine Daten.</p>';
  return `<div class="bars">${items.map((x) => `
    <div class="bar-row">
      <div class="bar-label"><span>${esc(x.label)}</span><span>${fmtPct(x.share).replace(/^[+±]/, '')}</span></div>
      <div class="bar"><div style="width:${Math.max(1, x.share * 100).toFixed(1)}%"></div></div>
      <div class="bar-value">${fmtCur(x.value)}</div>
    </div>`).join('')}</div>`;
}

/** Hinweis, woher die Kurse kommen und wie alt sie sind. */
export function marketStatus() {
  const parts = [];
  if (state.marketBusy) parts.push('<span class="spinner"></span> Kurse werden geladen …');
  else if (state.quotesAt) parts.push(`Aktualisiert ${fmtTime(state.quotesAt)}`);
  if (state.fx?.date) parts.push(`EZB-Wechselkurse vom ${fmtDate(state.fx.date)}`);
  if (!hasProxy) parts.push('Live-Kurse nicht eingerichtet (siehe Einstellungen)');
  const err = state.marketError
    ? `<details class="market-err"><summary>Nicht alle Kurse geladen</summary>${esc(state.marketError)}</details>`
    : '';
  return `<div class="market-status">${parts.join(' · ')}${err}</div>`;
}

/** Wechselkurs lesbar: "1 USD = 0.8826 CHF" */
export function fxText(currency, rate) {
  if (!currency || currency === 'CHF') return '';
  if (!Number.isFinite(rate)) return `${currency}/CHF unbekannt`;
  return `1 ${currency} = ${fmtNum(rate, 4)} CHF`;
}

export function emptyState(emoji, text, button = '') {
  return `<div class="empty"><span class="big">${emoji}</span>${text}${button ? `<div style="margin-top:1rem">${button}</div>` : ''}</div>`;
}
