/* Liste der Konten / Plattformen. */
import { state, onChange } from '../store.js';
import { totalSummary } from '../calc.js';
import { gainHtml, emptyState } from '../ui.js';
import { esc, fmtCur, fmtMoney } from '../util.js';

export function render(root) {
  function draw() {
    if (!state.loaded) { root.innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return; }
    if (!state.accounts.length) {
      root.innerHTML = emptyState('🏦',
        'Lege für jede Bank, jeden Broker oder jede Säule-3a-Lösung ein Konto an.',
        '<a class="btn btn-primary" href="#/konto-neu">Konto anlegen</a>');
      return;
    }
    const s = totalSummary();
    root.innerHTML = `
      <div class="list">
        ${s.accounts.map((a) => `
          <a class="pos-row" href="#/konto/${encodeURIComponent(a.account.id)}">
            <div class="pos-icon">🏦</div>
            <div class="pos-main">
              <div class="pos-name">${esc(a.account.name)}</div>
              <div class="pos-sub">${esc(a.account.platform || '')}${a.account.platform ? ' · ' : ''}${a.positions.length} Position(en)</div>
            </div>
            <div class="pos-figs">
              <div class="pos-value">${fmtMoney(a.totalChf)}</div>
              <div class="pos-gain">${gainHtml(a.gainChf, a.gainPct)}</div>
            </div>
          </a>`).join('')}
      </div>
      <div class="sum-line"><span>Total</span><b>${fmtCur(s.totalChf)}</b></div>
      <a class="btn btn-block" href="#/konto-neu">➕ Konto anlegen</a>`;
  }

  draw();
  return onChange(draw);
}
