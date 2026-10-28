/* Einstiegspunkt: Router, Grundgerüst, Service Worker. */
import { initAuth, isDemo } from './auth.js';
import { startSync, stopSync, state, onChange, getAccount, getInstrument } from './store.js';
import { loadMarketCache, refreshMarket } from './market.js';
import { applyTheme } from './theme.js';
import { $, $$, toast } from './util.js';

import * as overviewView from './views/overview.js';
import * as positionsView from './views/positions.js';
import * as instrumentView from './views/instrument.js';
import * as accountsView from './views/accounts.js';
import * as accountView from './views/account.js';
import * as accountEditView from './views/account-edit.js';
import * as tradeEditView from './views/trade-edit.js';
import * as settingsView from './views/settings.js';

const ROUTES = [
  { re: /^\/?$|^\/uebersicht$/, view: overviewView, title: 'Übersicht', tab: 'uebersicht' },
  { re: /^\/positionen$/, view: positionsView, title: 'Positionen', tab: 'positionen' },
  { re: /^\/wertpapier\/(.+)$/, view: instrumentView, title: 'Wertpapier', tab: 'positionen', back: true, param: 'id' },
  { re: /^\/konten$/, view: accountsView, title: 'Konten', tab: 'konten' },
  { re: /^\/konto\/(.+)$/, view: accountView, title: 'Konto', tab: 'konten', back: true, param: 'id' },
  { re: /^\/konto-neu$/, view: accountEditView, title: 'Konto anlegen', tab: 'konten', back: true },
  { re: /^\/konto-bearbeiten\/(.+)$/, view: accountEditView, title: 'Konto bearbeiten', tab: 'konten', back: true, param: 'id' },
  { re: /^\/erfassen$/, view: tradeEditView, title: 'Kauf / Verkauf erfassen', tab: 'erfassen' },
  { re: /^\/transaktion\/(.+)$/, view: tradeEditView, title: 'Transaktion bearbeiten', tab: '', back: true, param: 'id' },
  { re: /^\/einstellungen$/, view: settingsView, title: 'Einstellungen', tab: '', back: true }
];

const FORM_ROUTE = /^#\/(erfassen|transaktion|konto-neu|konto-bearbeiten)/;

let cleanup = null;
let signedIn = false;

function currentPath() {
  return decodeURI(location.hash.replace(/^#/, '').split('?')[0]) || '/';
}

function route() {
  if (!signedIn) return;
  const path = currentPath();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  const { r, m } = match || { r: ROUTES[0], m: [] };

  const params = {};
  if (r.param && m[1]) params[r.param] = decodeURIComponent(m[1]);

  if (cleanup) { try { cleanup(); } catch (err) { console.error(err); } }
  const root = $('#view');
  root.innerHTML = '';
  window.scrollTo(0, 0);

  $('#topbar-title').textContent = r.title;
  $('#btn-back').hidden = !r.back;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === r.tab));

  cleanup = r.view.render(root, params) || null;

  // Kopfzeile mit dem Namen von Konto bzw. Wertpapier
  if (r.view === accountView) {
    const a = getAccount(params.id);
    if (a) $('#topbar-title').textContent = a.name;
  }
  if (r.view === instrumentView) {
    const i = getInstrument(params.id);
    if (i) $('#topbar-title').textContent = i.name;
  }
}

function initShell() {
  $('#btn-back').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/uebersicht';
  });

  $('#btn-settings').addEventListener('click', () => { location.hash = '#/einstellungen'; });

  $('#btn-refresh').addEventListener('click', () => {
    refreshMarket({ force: true }).then(() => {
      toast(state.marketError ? 'Teilweise aktualisiert – Details in der Übersicht.' : 'Kurse aktualisiert.');
    });
  });

  // Formulare lesen ihre Daten nur beim Aufbau – kommen die Daten erst
  // danach an (Direktaufruf, langsames Netz), einmal neu aufbauen.
  let wasLoaded = false;
  onChange(() => {
    $('#btn-refresh').classList.toggle('spinning', state.marketBusy);
    if (state.loaded && !wasLoaded && FORM_ROUTE.test(location.hash)) route();
    wasLoaded = state.loaded;
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    toast('Wieder online – wird synchronisiert.');
    refreshMarket();
  });
  window.addEventListener('offline', () => toast('Offline – Änderungen werden später gespeichert.'));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // Beim Zurueckholen der App Kurse auffrischen, falls sie veraltet sind
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && signedIn) refreshMarket();
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  const hatteController = Boolean(navigator.serviceWorker.controller);
  let laedtNeu = false;

  // Uebernimmt eine neue Version, laedt die Seite einmal neu – ausser ein
  // Formular ist offen, dann waere die Eingabe weg.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteController || laedtNeu) return;
    laedtNeu = true;
    if (FORM_ROUTE.test(location.hash)) {
      toast('Neue Version geladen – sie wird beim nächsten Start aktiv.');
      return;
    }
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // Beim Zurueckholen der App nach Updates sehen – eine installierte PWA
      // wird sonst selten neu geladen.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch((err) => console.warn('SW:', err));
  });
}

applyTheme();
loadMarketCache();
initShell();
registerServiceWorker();

// Kurse erst laden, wenn die Wertpapiere da sind (die Symbole werden gebraucht)
let marketStarted = false;
onChange(() => {
  if (!signedIn || !state.loaded || marketStarted) return;
  marketStarted = true;
  refreshMarket();
});

initAuth((user) => {
  signedIn = Boolean(user);
  if (user) {
    startSync(user, { demo: isDemo });
    if (!location.hash) location.hash = '#/uebersicht';
    route();
  } else {
    stopSync();
    marketStarted = false;
    if (cleanup) { cleanup(); cleanup = null; }
    $('#view').innerHTML = '';
  }
});
