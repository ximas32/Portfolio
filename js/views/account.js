/* Ein Konto: Summen, Cash, Positionen. */
import { state, onChange, getAccount } from '../store.js';
import { accountSummary } from '../calc.js';
import { positionRow, gainHtml, kv, marketStatus, emptyState } from '../ui.js';
import { esc, fmtCur, fmtMoney } from '../util.js';

export function render(root, { id }) {
  function draw() {
    if (!state.loaded) { root.innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return; }
    const account = getAccount(id);
    if (!account) {
      root.innerHTML = emptyState('🤷', 'Dieses Konto gibt es nicht (mehr).', '<a class="btn" href="#/konten">Zu den Konten</a>');
      return;
    }
    const s = accountSummary(account);
    const enc = encodeURIComponent(id);
    const cashLine = account.cash
      ? `${fmtCur(Number(account.cash), account.cashCurrency || 'CHF')}${account.cashCurrency && account.cashCurrency !== 'CHF' ? ` ≈ ${fmtCur(s.cashChf)}` : ''}`
      : fmtCur(0);

    root.innerHTML = `
      <section class="hero card">
        <div class="hero-label">${esc(account.platform || 'Konto')}</div>
        <div class="hero-value">CHF ${fmtMoney(s.totalChf)}</div>
        <div class="hero-gain">${gainHtml(s.gainChf, s.gainPct)} <span class="muted">seit Kauf</span></div>
        ${s.dayChangeChf !== null ? `<div class="hero-day">${gainHtml(s.dayChangeChf)} <span class="muted">heute</span></div>` : ''}
      </section>

      <div class="card">
        ${kv('Wertschriften', fmtCur(s.valueChf))}
        ${kv('Cash', cashLine)}
        ${kv('Einstand (bezahlt in CHF)', fmtCur(s.costChf))}
        ${kv('Kurseffekt', gainHtml(s.priceEffectChf), 'kv-sub')}
        ${kv('Währungseffekt', gainHtml(s.fxEffectChf), 'kv-sub')}
        ${s.realizedChf ? kv('Realisiert (Verkäufe)', gainHtml(s.realizedChf)) : ''}
        ${account.note ? `<p class="muted" style="margin-top:.6rem">${esc(account.note)}</p>` : ''}
      </div>

      <div class="actions-row">
        <a class="btn btn-primary" href="#/erfassen?konto=${enc}">➕ Kauf erfassen</a>
        <a class="btn" href="#/konto-bearbeiten/${enc}">✏️ Konto bearbeiten</a>
      </div>

      <h2 class="section-title">Positionen</h2>
      ${s.positions.length
        ? `<div class="list">${s.positions.map((p) => positionRow(p, `#/wertpapier/${encodeURIComponent(p.instrumentId)}`)).join('')}</div>`
        : '<p class="muted">Noch keine Positionen in diesem Konto.</p>'}
      ${marketStatus()}`;
  }

  draw();
  return onChange(draw);
}
