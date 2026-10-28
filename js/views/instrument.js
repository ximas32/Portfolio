/* Ein Wertpapier über alle Konten: Kennzahlen, Transaktionen, Stammdaten. */
import { KINDS } from '../config.js';
import { state, onChange, getInstrument, saveInstrument, deleteInstrument } from '../store.js';
import { mergedPosition, tradeChf } from '../calc.js';
import { hasProxy, refreshQuote } from '../market.js';
import { gainHtml, kv, fxText, kindOf, marketStatus, emptyState } from '../ui.js';
import { $, esc, fmtCur, fmtNum, fmtDate, fmtTime, parseNum, today, toast } from '../util.js';

export function render(root, { id }) {
  let editOpen = false;

  function draw() {
    if (!state.loaded) { root.innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return; }
    const inst = getInstrument(id);
    const p = mergedPosition(id, { includeClosed: true });
    if (!inst && !p) {
      root.innerHTML = emptyState('🤷', 'Dieses Wertpapier gibt es nicht (mehr).', '<a class="btn" href="#/positionen">Zu den Positionen</a>');
      return;
    }
    const i = inst || p.instrument || {};
    const enc = encodeURIComponent(id);
    const accName = (aid) => state.accounts.find((a) => a.id === aid)?.name || '?';
    const q = p?.quote;
    const single = p && p.parts.length === 1 ? `&konto=${encodeURIComponent(p.parts[0].accountId)}` : '';

    const sourceText = !q ? 'kein Kurs'
      : q.source === 'live' ? `live · ${fmtTime(q.time)}`
      : q.source === 'manual' ? `von Hand${q.time ? ` · ${fmtDate(q.time)}` : ''}`
      : 'letzter Transaktionskurs';

    root.innerHTML = `
      <section class="card">
        <div class="inst-head">
          <span class="pos-icon">${kindOf(i.kind).emoji}</span>
          <div>
            <h2 style="margin:0">${esc(i.name || id)}</h2>
            <div class="muted">${[kindOf(i.kind).label, i.isin, i.symbol, i.currency].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
        </div>
        ${kv('Aktueller Kurs', q ? `<b>${fmtCur(q.price, q.currency)}</b>` : '–')}
        ${kv('Quelle', `<span class="muted">${sourceText}</span>`, 'kv-sub')}
        ${q && q.currency !== 'CHF' ? kv('Wechselkurs heute', `<span class="muted">${fxText(q.currency, p.fxNow)}</span>`, 'kv-sub') : ''}
      </section>

      ${p ? `
      <div class="card">
        ${kv('Stück', `<b>${fmtNum(p.qty)}</b>`)}
        ${kv('Wert', `<b>${fmtCur(p.valueChf)}</b>`)}
        ${kv('Einstand (bezahlt in CHF)', fmtCur(p.costChf))}
        ${kv('Gewinn / Verlust', gainHtml(p.gainChf, p.gainPct))}
        ${p.currency !== 'CHF' ? `
          ${kv('Kurseffekt', gainHtml(p.priceEffectChf), 'kv-sub')}
          ${kv('Währungseffekt', gainHtml(p.fxEffectChf), 'kv-sub')}` : ''}
        ${p.dayChangeChf !== null ? kv('Heute', gainHtml(p.dayChangeChf)) : ''}
        ${p.avgPriceLocal ? kv('Ø Kaufkurs inkl. Gebühren', fmtCur(p.avgPriceLocal, p.currency)) : ''}
        ${p.currency !== 'CHF' && p.avgFx ? kv('Ø Wechselkurs beim Kauf', fxText(p.currency, p.avgFx)) : ''}
        ${p.realizedChf ? kv('Realisiert (Verkäufe)', gainHtml(p.realizedChf)) : ''}
      </div>

      ${p.parts.length > 1 ? `
        <h2 class="section-title">Nach Konto</h2>
        <div class="card">
          ${p.parts.map((x) => kv(
            `<a href="#/konto/${encodeURIComponent(x.accountId)}">${esc(accName(x.accountId))}</a> · ${fmtNum(x.qty)} Stk`,
            `${fmtCur(x.valueChf)} ${gainHtml(x.gainChf, x.gainPct)}`)).join('')}
        </div>` : ''}` : ''}

      <div class="actions-row">
        <a class="btn btn-primary" href="#/erfassen?wp=${enc}${single}">➕ Kauf</a>
        ${p && p.qty > 0 ? `<a class="btn" href="#/erfassen?wp=${enc}${single}&typ=sell">➖ Verkauf</a>` : ''}
      </div>

      <h2 class="section-title">Transaktionen</h2>
      <div class="card card-tight">
        ${p && p.trades.length ? p.trades.slice().reverse().map((t) => `
          <a class="trade-row" href="#/transaktion/${encodeURIComponent(t.id)}">
            <div>
              <div><span class="tag ${t.type === 'sell' ? 'tag-sell' : 'tag-buy'}">${t.type === 'sell' ? 'Verkauf' : 'Kauf'}</span> ${fmtDate(t.date)}</div>
              <div class="muted small">${esc(accName(t.accountId))} · ${fmtNum(t.quantity)} × ${fmtCur(Number(t.price), t.currency)}${t.currency !== 'CHF' ? ` · ${fxText(t.currency, Number(t.fxRate))}` : ''}</div>
            </div>
            <div class="trade-chf">${fmtCur(tradeChf(t))}</div>
          </a>`).join('') : '<p class="muted">Keine Transaktionen.</p>'}
      </div>

      <details class="acc" id="inst-edit" ${editOpen ? 'open' : ''}>
        <summary>Wertpapier bearbeiten / Kurs von Hand setzen</summary>
        <form id="inst-form" autocomplete="off" style="margin-top:.7rem">
          <label class="field">Name <input type="text" name="name" required maxlength="120" value="${esc(i.name || '')}"></label>
          <div class="row">
            <label class="field">Symbol (Yahoo)
              <input type="text" name="symbol" maxlength="30" value="${esc(i.symbol || '')}" placeholder="z. B. NESN.SW">
            </label>
            <label class="field">Art
              <select name="kind">${KINDS.map((k) => `<option value="${k.id}" ${k.id === i.kind ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
            </label>
          </div>
          <div class="row">
            <label class="field">Kurs von Hand (${esc(i.currency || 'CHF')})
              <input type="text" name="manualPrice" inputmode="decimal" value="${Number.isFinite(i.manualPrice) ? esc(i.manualPrice) : ''}" placeholder="leer = automatisch">
            </label>
            <label class="field">Stand
              <input type="date" name="manualPriceDate" value="${esc(i.manualPriceDate || today())}">
            </label>
          </div>
          <p class="sub">Der Handkurs wird nur verwendet, wenn kein Live-Kurs verfügbar ist${hasProxy ? '' : ' (Live-Kurse sind noch nicht eingerichtet)'}.
            Die Währung lässt sich nicht ändern, weil alle Transaktionen darauf beruhen.</p>
          <button class="btn btn-primary btn-block" type="submit">Speichern</button>
          ${!p || !p.trades.length ? '<button class="btn btn-danger btn-block" type="button" id="inst-del">Wertpapier löschen</button>' : ''}
        </form>
      </details>
      ${marketStatus()}`;

    $('#inst-edit', root).addEventListener('toggle', (e) => { editOpen = e.target.open; });

    $('#inst-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const manual = parseNum(f.get('manualPrice'));
      const symbol = String(f.get('symbol')).trim().toUpperCase();
      const updated = {
        ...i,
        id,
        name: String(f.get('name')).trim() || i.name,
        symbol,
        kind: String(f.get('kind')),
        manualPrice: manual === null ? null : manual,
        manualPriceDate: manual === null ? null : String(f.get('manualPriceDate'))
      };
      saveInstrument(updated);
      editOpen = false;
      toast('Gespeichert.');
      if (symbol && symbol !== i.symbol) refreshQuote(symbol);
    });

    $('#inst-del', root)?.addEventListener('click', () => {
      if (!confirm(`„${i.name}" löschen?`)) return;
      deleteInstrument(id);
      location.replace('#/positionen');
    });
  }

  draw();
  // Waehrend das Formular offen ist nicht neu zeichnen, sonst ist die Eingabe weg
  return onChange(() => { if (!editOpen) draw(); });
}
