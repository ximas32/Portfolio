/* Einstellungen, Datenquellen, Backup und Infos. */
import { APP_VERSION, ALLOWED_EMAILS, QUOTE_PROXY, firebaseConfig } from '../config.js';
import { state, onChange, exportData, importData } from '../store.js';
import { hasProxy, proxyUrl, searchInstruments, refreshMarket } from '../market.js';
import { tradeChf } from '../calc.js';
import { logout, currentUser, isDemo } from '../auth.js';
import { $, esc, toast, downloadFile, fmtTime, fmtDate } from '../util.js';
import { getTheme, setTheme } from '../theme.js';

export function render(root) {
  function draw() {
    const user = currentUser();

    root.innerHTML = `
      <div class="card">
        <h3>Anmeldung</h3>
        <div class="kv"><span>Angemeldet als</span><b>${esc(user?.email || '–')}</b></div>
        ${isDemo
          ? '<p class="warn">Demo-Modus: Die Daten liegen nur in diesem Browser. Für die Synchronisation mit dem iPhone Firebase in js/config.js eintragen (siehe README).</p>'
          : `<div class="kv"><span>Freigegebene Adressen</span><span class="muted">${esc(ALLOWED_EMAILS.join(', '))}</span></div>
             <button class="btn btn-block" id="logout" style="margin-top:.6rem">Abmelden</button>`}
      </div>

      <div class="card">
        <h3>Darstellung</h3>
        <div class="chips" id="theme-chips" style="margin-bottom:0">
          ${[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']]
            .map(([id, label]) => `<button class="chip ${getTheme() === id ? 'active' : ''}" data-theme="${id}">${label}</button>`).join('')}
        </div>
      </div>

      <div class="card">
        <h3>Datenquellen</h3>
        <div class="kv"><span>Wechselkurse</span><span>EZB via frankfurter.dev ${state.fx?.date ? `· ${fmtDate(state.fx.date)}` : ''}</span></div>
        <div class="kv"><span>Kurse &amp; Suche</span><span>${hasProxy ? 'Yahoo Finance über Kurs-Proxy' : '<span class="warn">nicht eingerichtet</span>'}</span></div>
        ${hasProxy ? `<div class="kv kv-sub"><span>Proxy</span><span class="muted small">${esc(proxyUrl)}${QUOTE_PROXY ? '' : ' (lokaler Testserver)'}</span></div>` : ''}
        <div class="kv"><span>Letzte Aktualisierung</span><span>${esc(fmtTime(state.quotesAt) || '–')}</span></div>
        ${state.marketError ? `<p class="warn small">${esc(state.marketError)}</p>` : ''}
        <div class="actions-row" style="margin-top:.6rem">
          <button class="btn btn-sm" id="refresh">🔄 Jetzt aktualisieren</button>
          ${hasProxy ? '<button class="btn btn-sm" id="test-proxy">🧪 Suche testen</button>' : ''}
        </div>
        ${hasProxy ? '' : '<p class="sub">Ohne Proxy kannst du Kurse pro Wertpapier von Hand setzen. Einrichtung: README → „Kurs-Proxy".</p>'}
      </div>

      <div class="card">
        <h3>Dein Portfolio</h3>
        <div class="kv"><span>Konten</span><b>${state.accounts.length}</b></div>
        <div class="kv"><span>Wertpapiere</span><b>${state.instruments.length}</b></div>
        <div class="kv"><span>Transaktionen</span><b>${state.trades.length}</b></div>
      </div>

      <div class="card">
        <h3>Backup</h3>
        <p class="muted">Sichere regelmässig alle Daten als Datei – bei Gratis-Diensten kein Luxus.</p>
        <div class="actions-row" style="margin-top:0">
          <button class="btn btn-sm" id="export-json">⬇️ Backup (JSON)</button>
          <button class="btn btn-sm" id="export-csv">⬇️ Transaktionen (CSV)</button>
          <button class="btn btn-sm" id="import-json">⬆️ Backup einspielen</button>
          <input type="file" id="backup-file" accept=".json,application/json" style="display:none">
        </div>
      </div>

      <div class="card">
        <h3>App</h3>
        <div class="kv"><span>Version</span><span>${esc(APP_VERSION)}</span></div>
        <div class="kv"><span>Firebase-Projekt</span><span>${esc(isDemo ? '– (Demo)' : firebaseConfig.projectId)}</span></div>
        <div class="kv"><span>Verbindung</span><span>${navigator.onLine ? '🟢 online' : '🔴 offline'}</span></div>
        <button class="btn btn-sm btn-block" id="reload" style="margin-top:.6rem">🔄 Nach Update suchen</button>
        <p class="sub">iPhone: in Safari öffnen → Teilen → „Zum Home-Bildschirm". Dann startet das Portfolio wie eine normale App.</p>
      </div>
    `;
    bind();
  }

  function bind() {
    $('#logout', root)?.addEventListener('click', async () => {
      await logout();
      location.hash = '#/uebersicht';
    });

    $('#theme-chips', root).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme]');
      if (!btn) return;
      setTheme(btn.dataset.theme);
      draw();
    });

    $('#refresh', root).addEventListener('click', () => refreshMarket({ force: true }));

    $('#test-proxy', root)?.addEventListener('click', async () => {
      try {
        const res = await searchInstruments('CH0038863350');
        toast(res.length ? `Proxy funktioniert: ${res[0].name} (${res[0].symbol})` : 'Proxy antwortet, aber ohne Treffer.', 4000);
      } catch (err) {
        toast(`Proxy-Fehler: ${err.message}`, 5000);
      }
    });

    $('#export-json', root).addEventListener('click', () => {
      const data = {
        exportedAt: new Date().toISOString(),
        app: 'Portfolio',
        version: APP_VERSION,
        ...exportData()
      };
      downloadFile(`portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
    });

    $('#export-csv', root).addEventListener('click', () => {
      const acc = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
      const inst = Object.fromEntries(state.instruments.map((i) => [i.id, i]));
      const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
      const rows = [['Datum', 'Konto', 'Typ', 'Wertpapier', 'ISIN', 'Symbol', 'Anzahl', 'Kurs', 'Währung',
        'Gebühren', 'Gebühren-Währung', 'Wechselkurs CHF', 'Total CHF', 'Notiz']];
      state.trades.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
        const i = inst[t.instrumentId] || {};
        rows.push([t.date, acc[t.accountId] || '', t.type === 'sell' ? 'Verkauf' : 'Kauf', i.name, i.isin, i.symbol,
          t.quantity, t.price, t.currency, t.fees, t.feesCurrency, t.fxRate, tradeChf(t).toFixed(2), t.note]);
      });
      // BOM, damit Excel die Umlaute richtig liest; Semikolon fuer CH-Excel
      const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
      downloadFile(`portfolio-transaktionen-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    });

    $('#import-json', root).addEventListener('click', () => $('#backup-file', root).click());
    $('#backup-file', root).addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const n = (data.accounts?.length || 0) + (data.instruments?.length || 0) + (data.trades?.length || 0);
        if (!n) return toast('Keine Daten in der Datei gefunden.');
        if (!confirm(`${data.accounts?.length || 0} Konten, ${data.instruments?.length || 0} Wertpapiere und ${data.trades?.length || 0} Transaktionen einspielen? Gleiche IDs werden überschrieben.`)) return;
        await importData(data);
        toast('Backup eingespielt.');
      } catch (err) {
        toast(`Import fehlgeschlagen: ${err.message}`);
      }
    });

    $('#reload', root).addEventListener('click', async () => {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
      location.reload();
    });
  }

  draw();
  return onChange(draw);
}
