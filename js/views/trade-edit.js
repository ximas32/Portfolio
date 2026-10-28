/* Kauf / Verkauf erfassen oder bearbeiten.
   Kern der App: der Wechselkurs vom Kauftag wird automatisch geholt (EZB),
   damit der Einstand in CHF fest steht. Er bleibt aber editierbar, weil
   Banken oft einen leicht anderen Kurs verrechnen. */
import { KINDS, CURRENCIES } from '../config.js';
import {
  state, getTrade, getInstrument, saveTrade, deleteTrade, saveInstrument, instrumentIdFor
} from '../store.js';
import { computePosition, tradeChf } from '../calc.js';
import {
  hasProxy, searchInstruments, findListings, fetchQuote, fetchHistoricalFx, fetchHistoricalClose, refreshQuote
} from '../market.js';
import { kindOf, fxText } from '../ui.js';
import {
  $, esc, norm, uid, parseNum, isIsin, debounce, toast, today, hashParams,
  fmtCur, fmtNum, fmtDate
} from '../util.js';

export function render(root, { id } = {}) {
  const existing = id ? getTrade(id) : null;
  if (id && !existing) {
    root.innerHTML = state.loaded ? '<p class="muted">Transaktion nicht gefunden.</p>' : '<div class="empty"><span class="spinner"></span></div>';
    return null;
  }
  if (!state.loaded) {
    root.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
    return null;
  }
  if (!state.accounts.length) {
    root.innerHTML = `<div class="empty"><span class="big">🏦</span>Lege zuerst ein Konto an, damit du Käufe zuordnen kannst.
      <div style="margin-top:1rem"><a class="btn btn-primary" href="#/konto-neu">Konto anlegen</a></div></div>`;
    return null;
  }

  const qp = hashParams();
  const t = existing ? { ...existing } : {
    type: qp.typ === 'sell' ? 'sell' : 'buy',
    accountId: qp.konto || (state.accounts.length === 1 ? state.accounts[0].id : ''),
    instrumentId: qp.wp || '',
    date: today(),
    quantity: '',
    price: '',
    fees: '',
    feesCurrency: '',
    fxRate: '',
    fxDate: '',
    note: ''
  };

  /** Gewaehltes Wertpapier: bestehend ({existing:true}) oder neu */
  let sel = t.instrumentId ? instFromState(t.instrumentId) : null;
  let fxManual = Boolean(existing);   // beim Bearbeiten den gespeicherten Kurs behalten
  let fxSeq = 0;

  function instFromState(instId) {
    const i = getInstrument(instId);
    return i ? { ...i, existing: true } : null;
  }

  const accounts = state.accounts.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));

  root.innerHTML = `
    <form id="trade-form" autocomplete="off">
      <div class="card">
        <div class="seg" id="type-seg">
          <button type="button" data-type="buy" class="${t.type === 'buy' ? 'active' : ''}">Kauf</button>
          <button type="button" data-type="sell" class="${t.type === 'sell' ? 'active' : ''}">Verkauf</button>
        </div>
        <label class="field">Konto
          <select name="accountId" required>
            <option value="">– wählen –</option>
            ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === t.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="card">
        <h3>Wertpapier</h3>
        <div id="inst-box"></div>
      </div>

      <div class="card" id="detail-card">
        <div class="row">
          <label class="field">Datum
            <input type="date" name="date" required max="${today()}" value="${esc(t.date)}">
          </label>
          <label class="field">Anzahl
            <input type="text" name="quantity" inputmode="decimal" required value="${esc(t.quantity)}" placeholder="z. B. 10">
          </label>
        </div>
        <label class="field">Kurs pro Stück <span class="cur-label"></span>
          <input type="text" name="price" inputmode="decimal" required value="${esc(t.price)}" placeholder="z. B. 102.50">
        </label>
        <div id="close-hint" class="sub"></div>
        <div class="row">
          <label class="field">Gebühren
            <input type="text" name="fees" inputmode="decimal" value="${esc(t.fees)}" placeholder="0.00">
          </label>
          <label class="field" style="flex:0 0 120px">in
            <select name="feesCurrency" id="fees-cur"></select>
          </label>
        </div>
        <div id="fx-box" class="fx-box hidden">
          <label class="field">Wechselkurs am Kauftag: 1 <span class="cur-label-plain"></span> =
            <div class="fx-input">
              <input type="text" name="fxRate" inputmode="decimal" value="${esc(t.fxRate)}">
              <span>CHF</span>
              <button type="button" class="btn btn-sm" id="fx-reload" title="EZB-Kurs vom Datum holen">↻ EZB</button>
            </div>
          </label>
          <div id="fx-info" class="sub"></div>
        </div>
        <div id="total-box" class="total-box"></div>
        <label class="field">Notiz (optional)
          <input type="text" name="note" maxlength="200" value="${esc(t.note || '')}">
        </label>
      </div>

      <div class="sticky-save">
        ${existing ? '<button class="btn btn-danger" type="button" id="trade-del">Löschen</button>' : ''}
        <button class="btn btn-primary" type="submit">Speichern</button>
      </div>
    </form>`;

  const form = $('#trade-form', root);
  const field = (name) => form.elements[name];

  /* ---------- Kauf / Verkauf ---------- */
  $('#type-seg', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    t.type = b.dataset.type;
    $('#type-seg', root).querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    updateTotals();
  });

  /* ---------- Wertpapier-Auswahl ---------- */
  function drawInst() {
    const box = $('#inst-box', root);
    if (sel) {
      const locked = sel.existing;
      box.innerHTML = `
        <div class="sel-inst">
          <div class="pos-icon">${kindOf(sel.kind).emoji}</div>
          <div class="pos-main">
            <div class="pos-name">${esc(sel.name || '–')}</div>
            <div class="pos-sub">${[sel.isin, sel.symbol, sel.exchange].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          ${existing ? '' : '<button type="button" class="btn btn-sm" id="inst-change">Ändern</button>'}
        </div>
        ${locked ? `<p class="sub">Währung: <b>${esc(sel.currency)}</b></p>` : `
          <div class="new-inst">
            <label class="field">Name <input type="text" id="ni-name" maxlength="120" value="${esc(sel.name || '')}"></label>
            <div class="row">
              <label class="field">ISIN <input type="text" id="ni-isin" maxlength="12" value="${esc(sel.isin || '')}" placeholder="optional" style="text-transform:uppercase"></label>
              <label class="field">Symbol <input type="text" id="ni-symbol" maxlength="30" value="${esc(sel.symbol || '')}" placeholder="z. B. NESN.SW" style="text-transform:uppercase"></label>
            </div>
            <div class="row">
              <label class="field">Handelswährung
                <select id="ni-currency">${[...new Set([...CURRENCIES, sel.currency])].map((c) => `<option ${c === sel.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
              </label>
              <label class="field">Art
                <select id="ni-kind">${KINDS.map((k) => `<option value="${k.id}" ${k.id === sel.kind ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
              </label>
            </div>
            ${sel.loading ? '<p class="sub"><span class="spinner"></span> Kurs und Währung werden geholt …</p>' : ''}
            ${sel.quoteError ? `<p class="sub warn">${esc(sel.quoteError)}</p>` : ''}
            <p class="sub">Die Währung ist die, in der du den Kurs eingibst – meist die Börse, an der gekauft wurde (Nestlé an der SIX = CHF, Apple an der Nasdaq = USD).</p>
          </div>`}`;
      $('#inst-change', root)?.addEventListener('click', () => { sel = null; drawInst(); onInstChanged(); });
      if (!locked) {
        $('#ni-name', root).addEventListener('input', (e) => { sel.name = e.target.value; });
        $('#ni-isin', root).addEventListener('input', (e) => { sel.isin = e.target.value.trim().toUpperCase(); });
        $('#ni-symbol', root).addEventListener('input', (e) => { sel.symbol = e.target.value.trim().toUpperCase(); });
        $('#ni-kind', root).addEventListener('change', (e) => { sel.kind = e.target.value; });
        $('#ni-currency', root).addEventListener('change', (e) => { sel.currency = e.target.value; onInstChanged(); });
      }
      return;
    }

    box.innerHTML = `
      <div class="searchbar">
        <input type="search" id="inst-q" placeholder="ISIN, Symbol oder Name, z. B. CH0038863350" autocomplete="off" autocapitalize="characters">
      </div>
      <div id="inst-results"></div>
      <button type="button" class="btn btn-link" id="inst-manual">Ohne Suche von Hand erfassen</button>
      ${hasProxy ? '' : '<p class="sub">Die Online-Suche ist noch nicht eingerichtet (Kurs-Proxy in config.js) – bereits erfasste Wertpapiere werden trotzdem gefunden.</p>'}`;

    const q = $('#inst-q', root);
    q.addEventListener('input', () => { drawLocalResults(q.value); remoteSearch(q.value); });
    $('#inst-manual', root).addEventListener('click', () => {
      const v = q.value.trim().toUpperCase();
      sel = { name: '', isin: isIsin(v) ? v : '', symbol: '', currency: 'CHF', kind: 'etf' };
      drawInst();
      onInstChanged();
    });
    $('#inst-results', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      pick(JSON.parse(b.dataset.pick), q.value);
    });
    drawLocalResults('');
    // Mit erfassten Wertpapieren keinen Fokus setzen – sonst verdeckt die
    // iPhone-Tastatur die Liste zum Nachkaufen.
    if (!existing && !state.instruments.length) setTimeout(() => q.focus(), 50);
  }

  let remoteResults = [];
  let remoteState = '';

  /** Letzte Transaktion pro Wertpapier – im gewaehlten Konto und insgesamt. */
  function usage() {
    const accountId = field('accountId').value;
    const map = new Map();
    for (const tr of state.trades) {
      const u = map.get(tr.instrumentId) || { last: '', inAccount: false };
      if ((tr.date || '') > u.last) u.last = tr.date || '';
      if (tr.accountId === accountId) u.inAccount = true;
      map.set(tr.instrumentId, u);
    }
    return map;
  }

  function resultRow(item, local, use) {
    const payload = esc(JSON.stringify(local ? { id: item.id } : item));
    const info = local
      ? [item.symbol, item.isin, item.currency].filter(Boolean).map(esc).join(' · ') +
        (use?.last ? ` · zuletzt ${fmtDate(use.last)}` : '')
      : esc([item.symbol, item.exchange].filter(Boolean).join(' · '));
    return `<button type="button" class="result-row" data-pick="${payload}">
      <span class="pos-icon">${kindOf(item.kind).emoji}</span>
      <span class="pos-main">
        <span class="pos-name">${esc(item.name)}</span>
        <span class="pos-sub">${info}</span>
      </span>
    </button>`;
  }

  function drawLocalResults(text) {
    const box = $('#inst-results', root);
    if (!box) return;
    const words = norm(text).split(' ').filter(Boolean);
    const use = usage();
    // Bereits erfasste Wertpapiere: ohne Suchtext alle, sonst die passenden.
    // Zuerst die aus dem gewaehlten Konto, dann nach letztem Kauf.
    const local = state.instruments
      .filter((i) => {
        const hay = norm(`${i.name} ${i.symbol} ${i.isin}`);
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => {
        const ua = use.get(a.id) || {};
        const ub = use.get(b.id) || {};
        return (ub.inAccount ? 1 : 0) - (ua.inAccount ? 1 : 0) ||
          (ub.last || '').localeCompare(ua.last || '') ||
          (a.name || '').localeCompare(b.name || '', 'de');
      })
      .slice(0, words.length ? 6 : 50);
    const localSymbols = new Set(local.map((i) => i.symbol));
    const remote = remoteResults.filter((r) => !localSymbols.has(r.symbol));
    const canExpand = hasProxy && isIsin(text.trim()) && remoteResults.length && !remoteExpanded && !remoteState;
    box.innerHTML = `
      ${local.length ? `<div class="result-head">${words.length ? 'Bereits erfasst' : 'Bereits erfasst – antippen zum Nachkaufen'}</div>` : ''}
      ${local.map((i) => resultRow(i, true, use.get(i.id))).join('')}
      ${remote.length ? '<div class="result-head">Online gefunden</div>' : ''}
      ${remote.map((r) => resultRow(r, false, null)).join('')}
      ${remoteState ? `<p class="sub">${remoteState}</p>` : ''}
      ${canExpand ? `<button type="button" class="btn btn-sm btn-block" id="expand">Weitere Börsenplätze suchen (z. B. SIX in CHF)</button>
        <p class="sub">Wähle den Börsenplatz, an dem du gekauft hast – davon hängt die Währung ab.</p>` : ''}`;
    $('#expand', box)?.addEventListener('click', async () => {
      remoteState = '<span class="spinner"></span> suche weitere Börsenplätze …';
      drawLocalResults(text);
      const more = await findListings(remoteResults);
      remoteExpanded = true;
      remoteResults = more;
      remoteState = more.length > 1 ? '' : 'Keine weiteren Börsenplätze gefunden – ggf. nach dem Symbol suchen (z. B. VWRL).';
      drawLocalResults(text);
    });
  }

  let remoteExpanded = false;

  let searchSeq = 0;
  const remoteSearch = debounce(async (text) => {
    const query = text.trim();
    const seq = ++searchSeq;
    remoteExpanded = false;
    if (!hasProxy || query.length < 2) {
      remoteResults = [];
      remoteState = '';
      drawLocalResults(text);
      return;
    }
    remoteState = '<span class="spinner"></span> suche …';
    drawLocalResults(text);
    try {
      const res = await searchInstruments(query);
      if (seq !== searchSeq) return;
      remoteResults = res;
      remoteState = res.length ? '' : 'Online nichts gefunden – ggf. von Hand erfassen.';
    } catch (err) {
      if (seq !== searchSeq) return;
      remoteResults = [];
      remoteState = `Suche fehlgeschlagen: ${esc(err.message)}`;
    }
    drawLocalResults(text);
  }, 400);

  async function pick(item, query) {
    if (item.id) {
      sel = instFromState(item.id);
      drawInst();
      onInstChanged();
      return;
    }
    const q = query.trim().toUpperCase();
    // Gibt es das Wertpapier schon (gleiches Symbol oder gleiche ISIN)?
    const known = state.instruments.find((i) => i.symbol === item.symbol || (isIsin(q) && i.isin === q));
    if (known) {
      sel = { ...known, existing: true };
      drawInst();
      onInstChanged();
      return;
    }
    sel = {
      name: item.name, symbol: item.symbol, exchange: item.exchange, kind: item.kind,
      isin: isIsin(q) ? q : '', currency: 'CHF', loading: true
    };
    drawInst();
    try {
      const quote = await fetchQuote(item.symbol);
      if (!sel || sel.symbol !== item.symbol) return;
      sel.currency = quote.currency || sel.currency;
      sel.lastPrice = quote.price;
    } catch (err) {
      if (sel) sel.quoteError = `Kurs nicht abrufbar (${err.message}) – Währung bitte prüfen.`;
    }
    if (!sel) return;
    sel.loading = false;
    drawInst();
    onInstChanged();
  }

  /* ---------- Waehrung, Wechselkurs, Total ---------- */
  function currency() {
    return sel?.currency || t.currency || 'CHF';
  }

  function onInstChanged() {
    const cur = currency();
    root.querySelectorAll('.cur-label').forEach((el) => { el.textContent = `(${cur})`; });
    root.querySelectorAll('.cur-label-plain').forEach((el) => { el.textContent = cur; });
    const feeSel = $('#fees-cur', root);
    const wantFee = t.feesCurrency || (cur === 'CHF' ? 'CHF' : cur);
    feeSel.innerHTML = [...new Set([cur, 'CHF'])].map((c) => `<option ${c === wantFee ? 'selected' : ''}>${c}</option>`).join('');
    $('#fx-box', root).classList.toggle('hidden', cur === 'CHF');
    if (cur === 'CHF') field('fxRate').value = '1';
    else if (!fxManual || !parseNum(field('fxRate').value)) loadFx();
    drawCloseHint();
    updateTotals();
  }

  async function loadFx() {
    const cur = currency();
    const date = field('date').value;
    if (cur === 'CHF' || !date) return;
    const seq = ++fxSeq;
    $('#fx-info', root).innerHTML = '<span class="spinner"></span> EZB-Kurs wird geholt …';
    try {
      const r = await fetchHistoricalFx(cur, date);
      if (seq !== fxSeq) return;
      field('fxRate').value = String(Math.round(r.rate * 1e6) / 1e6);
      t.fxDate = r.date;
      fxManual = false;
      $('#fx-info', root).textContent = r.date === date
        ? `EZB-Referenzkurs vom ${fmtDate(r.date)}. Hat deine Bank anders gerechnet, trag ihren Kurs ein.`
        : `EZB-Referenzkurs vom ${fmtDate(r.date)} (letzter Handelstag vor dem ${fmtDate(date)}).`;
    } catch (err) {
      if (seq !== fxSeq) return;
      $('#fx-info', root).textContent = navigator.onLine
        ? `Wechselkurs nicht abrufbar (${err.message}) – bitte von Hand eintragen.`
        : 'Offline – Wechselkurs bitte von Hand eintragen.';
    }
    updateTotals();
  }

  function drawCloseHint() {
    const box = $('#close-hint', root);
    if (!hasProxy || !sel?.symbol) { box.innerHTML = ''; return; }
    box.innerHTML = '<button type="button" class="btn btn-link" id="close-btn">Schlusskurs vom Datum übernehmen</button>';
    $('#close-btn', root).addEventListener('click', async () => {
      box.innerHTML = '<span class="spinner"></span>';
      try {
        const c = await fetchHistoricalClose(sel.symbol, field('date').value);
        if (c.currency !== currency()) throw new Error(`Kurs ist in ${c.currency}, nicht in ${currency()}`);
        field('price').value = String(Math.round(c.price * 10000) / 10000);
        updateTotals();
        drawCloseHint();
        $('#close-hint', root).insertAdjacentHTML('afterbegin', `Schlusskurs vom ${fmtDate(c.date)} eingesetzt – der echte Ausführungskurs steht auf deiner Abrechnung. `);
      } catch (err) {
        drawCloseHint();
        $('#close-hint', root).insertAdjacentHTML('afterbegin', `${esc(err.message)} `);
      }
    });
  }

  function readTrade() {
    return {
      type: t.type,
      currency: currency(),
      quantity: parseNum(field('quantity').value),
      price: parseNum(field('price').value),
      fees: parseNum(field('fees').value) || 0,
      feesCurrency: field('feesCurrency').value || currency(),
      fxRate: currency() === 'CHF' ? 1 : parseNum(field('fxRate').value)
    };
  }

  function updateTotals() {
    const r = readTrade();
    const box = $('#total-box', root);
    if (!r.quantity || r.price === null) { box.innerHTML = ''; return; }
    const local = r.quantity * r.price;
    const chf = r.fxRate ? tradeChf(r) : null;
    const word = r.type === 'sell' ? 'Erlös' : 'Bezahlt';
    box.innerHTML = `
      ${r.currency !== 'CHF' ? `<div class="kv"><span>Kurswert</span><span>${fmtCur(local, r.currency)}</span></div>` : ''}
      <div class="kv"><span>${word} in CHF${r.fees ? ' inkl. Gebühren' : ''}</span><b>${chf !== null ? fmtCur(chf) : '–'}</b></div>
      ${r.currency !== 'CHF' && r.fxRate ? `<div class="sub">${fxText(r.currency, r.fxRate)}</div>` : ''}`;
  }

  /* ---------- Ereignisse ---------- */
  field('date').addEventListener('change', () => { fxManual = false; loadFx(); });
  field('accountId').addEventListener('change', () => {
    const q = $('#inst-q', root);
    if (q) drawLocalResults(q.value);
  });
  field('fxRate').addEventListener('input', () => { fxManual = true; $('#fx-info', root).textContent = 'Eigener Kurs (z. B. von der Bankabrechnung).'; updateTotals(); });
  $('#fx-reload', root).addEventListener('click', () => { fxManual = false; loadFx(); });
  ['quantity', 'price', 'fees'].forEach((n) => field(n).addEventListener('input', updateTotals));
  field('feesCurrency').addEventListener('change', updateTotals);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const accountId = field('accountId').value;
    const r = readTrade();
    if (!accountId) return toast('Bitte ein Konto wählen.');
    if (!sel) return toast('Bitte ein Wertpapier wählen.');
    if (!sel.existing && !String(sel.name || '').trim()) return toast('Bitte einen Namen für das Wertpapier eingeben.');
    if (sel.isin && !isIsin(sel.isin)) return toast('Die ISIN sieht nicht gültig aus (12 Zeichen, Prüfziffer).');
    if (!r.quantity || r.quantity <= 0) return toast('Bitte eine Anzahl grösser 0 eingeben.');
    if (r.price === null || r.price < 0) return toast('Bitte den Kurs pro Stück eingeben.');
    if (!r.fxRate || r.fxRate <= 0) return toast('Bitte den Wechselkurs eintragen.');

    // Wertpapier anlegen bzw. das bestehende wiederverwenden
    let instrumentId = sel.id;
    if (!sel.existing) {
      instrumentId = instrumentIdFor(sel) || uid();
      const known = getInstrument(instrumentId);
      if (known && known.currency !== sel.currency) {
        return toast(`Dieses Wertpapier ist schon in ${known.currency} erfasst.`);
      }
      if (!known) {
        saveInstrument({
          id: instrumentId,
          name: sel.name.trim(),
          isin: sel.isin || '',
          symbol: sel.symbol || '',
          currency: sel.currency,
          kind: sel.kind || 'other',
          createdAt: new Date().toISOString()
        });
      }
    }

    if (r.type === 'sell') {
      const pos = computePosition(instrumentId, accountId);
      const held = pos.qty + (existing && existing.type === 'sell' && existing.accountId === accountId ? Number(existing.quantity) : 0);
      if (r.quantity > held + 1e-9) {
        return toast(`In diesem Konto sind nur ${fmtNum(held)} Stück vorhanden.`);
      }
    }

    const trade = {
      id: existing?.id || uid(),
      accountId,
      instrumentId,
      type: r.type,
      date: field('date').value,
      quantity: r.quantity,
      price: r.price,
      currency: r.currency,
      fees: r.fees,
      feesCurrency: r.feesCurrency,
      fxRate: r.fxRate,
      fxDate: r.currency === 'CHF' ? '' : (fxManual ? '' : t.fxDate || ''),
      fxSource: r.currency === 'CHF' ? '' : (fxManual ? 'manuell' : 'EZB'),
      note: field('note').value.trim(),
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    saveTrade(trade);
    if (!sel.existing && sel.symbol) refreshQuote(sel.symbol);
    toast(r.type === 'sell' ? 'Verkauf gespeichert.' : 'Kauf gespeichert.');
    location.replace(`#/wertpapier/${encodeURIComponent(instrumentId)}`);
  });

  $('#trade-del', root)?.addEventListener('click', () => {
    if (!confirm('Diese Transaktion löschen?')) return;
    deleteTrade(existing.id);
    toast('Transaktion gelöscht.');
    history.back();
  });

  drawInst();
  onInstChanged();
  if (existing && existing.currency !== 'CHF') {
    $('#fx-info', root).textContent = existing.fxSource === 'EZB' && existing.fxDate
      ? `EZB-Referenzkurs vom ${fmtDate(existing.fxDate)}.`
      : 'Eigener Kurs (z. B. von der Bankabrechnung).';
  }
  return null;
}
