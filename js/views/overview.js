/* Übersicht: Gesamtvermögen in CHF, Konten, Verteilung. */
import { state, onChange } from '../store.js';
import { totalSummary, breakdown } from '../calc.js';
import { gainHtml, kv, bars, marketStatus, kindOf, emptyState } from '../ui.js';
import { mountValueChart } from '../history-chart.js';
import { $, esc, fmtCur, fmtMoney } from '../util.js';

export function render(root) {
  let chartOff = () => {};

  function draw() {
    chartOff();
    chartOff = () => {};
    if (state.error) {
      root.innerHTML = `<div class="card error">${esc(state.error)}</div>`;
      return;
    }
    if (!state.loaded) {
      root.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
      return;
    }
    if (!state.accounts.length) {
      root.innerHTML = emptyState('🏦',
        'Noch keine Konten. Lege zuerst ein Konto an – z. B. deine Bank oder deinen Broker – und erfasse dann deine Käufe.',
        '<a class="btn btn-primary" href="#/konto-neu">Erstes Konto anlegen</a>');
      return;
    }

    const s = totalSummary();
    const byCurrency = breakdown(s.positions, (p) => p.quote?.currency || p.currency);
    const byKind = breakdown(s.positions, (p) => p.instrument?.kind || 'other', (k) => kindOf(k).label);
    const byAccount = s.accounts
      .filter((a) => a.totalChf > 0)
      .map((a) => ({ key: a.account.id, label: a.account.name, value: a.totalChf, share: s.totalChf ? a.totalChf / s.totalChf : 0 }));

    root.innerHTML = `
      <section class="hero card">
        <div class="hero-label">Gesamtvermögen</div>
        <div class="hero-value">CHF ${fmtMoney(s.totalChf)}</div>
        <div class="hero-gain">${gainHtml(s.gainChf, s.gainPct)} <span class="muted">seit Kauf</span></div>
        ${s.dayChangeChf !== null ? `<div class="hero-day">${gainHtml(s.dayChangeChf)} <span class="muted">heute</span></div>` : ''}
        ${s.missing ? `<p class="warn">${s.missing} Position(en) ohne Kurs oder Wechselkurs – nicht im Total enthalten.</p>` : ''}
      </section>

      <div class="card">
        ${kv('Wertschriften', fmtCur(s.valueChf))}
        ${kv('Cash', fmtCur(s.cashChf))}
        ${kv('Einstand (bezahlt in CHF)', fmtCur(s.costChf))}
        ${kv('Kurseffekt', gainHtml(s.priceEffectChf), 'kv-sub')}
        ${kv('Währungseffekt', gainHtml(s.fxEffectChf), 'kv-sub')}
        ${s.realizedChf ? kv('Realisiert (Verkäufe)', gainHtml(s.realizedChf)) : ''}
        ${marketStatus()}
      </div>

      <div id="value-chart"></div>

      <h2 class="section-title">Konten</h2>
      <div class="list">
        ${s.accounts.map((a) => `
          <a class="pos-row" href="#/konto/${encodeURIComponent(a.account.id)}">
            <div class="pos-icon">🏦</div>
            <div class="pos-main">
              <div class="pos-name">${esc(a.account.name)}</div>
              <div class="pos-sub">${a.positions.length} Position(en)${a.cashChf ? ` · Cash ${fmtMoney(a.cashChf)}` : ''}</div>
            </div>
            <div class="pos-figs">
              <div class="pos-value">${fmtMoney(a.totalChf)}</div>
              <div class="pos-gain">${gainHtml(a.gainChf, a.gainPct)}</div>
            </div>
          </a>`).join('')}
      </div>

      ${s.positions.length ? `
        <h2 class="section-title">Verteilung</h2>
        <div class="card">
          <h3>Nach Konto</h3>
          ${bars(byAccount)}
        </div>
        <div class="card">
          <h3>Nach Währung</h3>
          <p class="muted">Wertschriften nach Handelswährung – zeigt, wie stark du vom Franken-Kurs abhängst.</p>
          ${bars(byCurrency)}
        </div>
        <div class="card">
          <h3>Nach Art</h3>
          ${bars(byKind)}
        </div>` : `
        <div class="card center">
          <p class="muted">Noch keine Käufe erfasst.</p>
          <a class="btn btn-primary" href="#/erfassen">Ersten Kauf erfassen</a>
        </div>`}
    `;
    chartOff = mountValueChart($('#value-chart', root));
  }

  draw();
  const off = onChange(draw);
  return () => { off(); chartOff(); };
}
