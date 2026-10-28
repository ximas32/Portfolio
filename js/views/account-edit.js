/* Konto anlegen / bearbeiten. */
import { CURRENCIES } from '../config.js';
import { state, getAccount, saveAccount, deleteAccount } from '../store.js';
import { $, esc, uid, parseNum, toast } from '../util.js';

export function render(root, { id } = {}) {
  const existing = id ? getAccount(id) : null;
  if (id && !existing) {
    root.innerHTML = '<p class="muted">Konto nicht gefunden.</p>';
    return null;
  }
  const a = existing || { name: '', platform: '', cash: 0, cashCurrency: 'CHF', note: '' };
  const tradeCount = existing ? state.trades.filter((t) => t.accountId === id).length : 0;

  root.innerHTML = `
    <form id="acc-form" class="card" autocomplete="off">
      <label class="field">Name
        <input type="text" name="name" required maxlength="60" value="${esc(a.name)}" placeholder="z. B. Swissquote, PostFinance, Säule 3a">
      </label>
      <label class="field">Plattform / Bank (optional)
        <input type="text" name="platform" maxlength="60" value="${esc(a.platform || '')}" placeholder="z. B. Interactive Brokers">
      </label>
      <div class="row">
        <label class="field">Cash-Bestand
          <input type="text" name="cash" inputmode="decimal" value="${a.cash ? esc(a.cash) : ''}" placeholder="0.00">
        </label>
        <label class="field" style="flex:0 0 110px">Währung
          <select name="cashCurrency">
            ${CURRENCIES.map((c) => `<option ${c === (a.cashCurrency || 'CHF') ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="field">Notiz (optional)
        <textarea name="note" maxlength="500" rows="2">${esc(a.note || '')}</textarea>
      </label>
      <button class="btn btn-primary btn-block" type="submit">Speichern</button>
      ${existing ? `<button class="btn btn-danger btn-block" type="button" id="acc-del">Konto löschen${tradeCount ? ` (inkl. ${tradeCount} Transaktionen)` : ''}</button>` : ''}
    </form>`;

  const form = $('#acc-form', root);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const name = String(f.get('name')).trim();
    if (!name) return toast('Bitte einen Namen eingeben.');
    const account = {
      ...a,
      id: existing?.id || uid(),
      name,
      platform: String(f.get('platform')).trim(),
      cash: parseNum(f.get('cash')) || 0,
      cashCurrency: String(f.get('cashCurrency')),
      note: String(f.get('note')).trim(),
      createdAt: a.createdAt || new Date().toISOString()
    };
    saveAccount(account);
    toast('Konto gespeichert.');
    location.replace(`#/konto/${encodeURIComponent(account.id)}`);
  });

  $('#acc-del', root)?.addEventListener('click', () => {
    const msg = tradeCount
      ? `„${a.name}" und alle ${tradeCount} Transaktionen darin endgültig löschen?`
      : `„${a.name}" löschen?`;
    if (!confirm(msg)) return;
    deleteAccount(id);
    toast('Konto gelöscht.');
    location.replace('#/konten');
  });

  return null;
}
