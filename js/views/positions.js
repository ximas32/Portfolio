/* Alle Positionen über alle Konten, mit Suche. */
import { state, onChange } from '../store.js';
import { mergedPositions, summarize } from '../calc.js';
import { positionRow, marketStatus, gainHtml, emptyState } from '../ui.js';
import { $, esc, norm, fmtMoney } from '../util.js';

export function render(root) {
  let text = '';

  root.innerHTML = `
    <div class="searchbar">
      <input type="search" id="pos-search" placeholder="Name, Symbol oder ISIN filtern" autocomplete="off">
    </div>
    <div id="pos-list"></div>`;

  const input = $('#pos-search', root);
  input.addEventListener('input', () => { text = input.value; draw(); });

  function draw() {
    const box = $('#pos-list', root);
    if (!state.loaded) { box.innerHTML = '<div class="empty"><span class="spinner"></span></div>'; return; }
    const all = mergedPositions();
    if (!all.length) {
      box.innerHTML = emptyState('📋', 'Noch keine Positionen.',
        '<a class="btn btn-primary" href="#/erfassen">Kauf erfassen</a>');
      return;
    }
    const words = norm(text).split(' ').filter(Boolean);
    const list = all.filter((p) => {
      const i = p.instrument || {};
      const hay = norm(`${i.name} ${i.symbol} ${i.isin} ${p.instrumentId}`);
      return words.every((w) => hay.includes(w));
    });
    const s = summarize(list);
    box.innerHTML = `
      <div class="sum-line">
        <span>${list.length} Position(en)</span>
        <span><b>CHF ${fmtMoney(s.valueChf)}</b> · ${gainHtml(s.gainChf, s.gainPct)}</span>
      </div>
      <div class="list">${list.map((p) => positionRow(p, `#/wertpapier/${encodeURIComponent(p.instrumentId)}`)).join('')
        || `<p class="muted center">Nichts gefunden für „${esc(text)}".</p>`}</div>
      ${marketStatus()}`;
  }

  draw();
  return onChange(draw);
}
