/* Datenzugriff. Jede Person hat ihr eigenes Portfolio unter users/{uid}/…
   mit drei Sammlungen:
     accounts     Konten/Plattformen (inkl. Cash-Bestand)
     instruments  Wertpapiere (ISIN, Symbol, Name, Waehrung, Handkurs)
     trades       Kaeufe und Verkaeufe (inkl. Wechselkurs am Stichtag)
   Alles wird einmal abonniert und im Speicher gehalten – fuer ein privates
   Depot ist das schnell und spart Lesezugriffe.

   Solange config.js Platzhalter enthaelt, speichert ein Demo-Speicher im
   localStorage dieses Browsers – mit derselben Schnittstelle. */
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';
import { db } from './firebase.js';
import { toast } from './util.js';

export const COLLECTIONS = ['accounts', 'instruments', 'trades'];

export const state = {
  user: null,
  demo: false,
  loaded: false,
  error: '',
  accounts: [],
  instruments: [],
  trades: [],
  // Marktdaten (siehe market.js) – nur auf dem Geraet zwischengespeichert
  quotes: {},
  fx: null,
  quotesAt: 0,
  marketBusy: false,
  marketError: ''
};

const listeners = new Set();
let backend = null;
let unsubs = [];

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  listeners.forEach((fn) => {
    try { fn(state); } catch (err) { console.error(err); }
  });
}

/* ---------------- Speicher-Backends ---------------- */

function firestoreBackend(uid) {
  const col = (name) => collection(db, 'users', uid, name);
  return {
    subscribe(name, cb, onError) {
      return onSnapshot(col(name), (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), onError);
    },
    put(name, id, data) {
      return setDoc(doc(col(name), id), { ...data, updatedAt: serverTimestamp() });
    },
    remove(name, id) {
      return deleteDoc(doc(col(name), id));
    },
    async putMany(items) {
      // Firestore erlaubt max. 500 Schreibvorgaenge pro Batch
      for (let i = 0; i < items.length; i += 400) {
        const batch = writeBatch(db);
        for (const { name, id, data } of items.slice(i, i + 400)) {
          batch.set(doc(col(name), id), { ...data, updatedAt: serverTimestamp() });
        }
        await batch.commit();
      }
    }
  };
}

function localBackend() {
  const subs = {};
  const key = (name) => `portfolio.demo.${name}`;
  const read = (name) => {
    try { return JSON.parse(localStorage.getItem(key(name)) || '{}'); } catch { return {}; }
  };
  const write = (name, map) => {
    try { localStorage.setItem(key(name), JSON.stringify(map)); } catch { /* voll / Privatmodus */ }
    const list = Object.entries(map).map(([id, d]) => ({ ...d, id }));
    (subs[name] || []).forEach((cb) => cb(list));
  };
  return {
    subscribe(name, cb) {
      (subs[name] ||= []).push(cb);
      cb(Object.entries(read(name)).map(([id, d]) => ({ ...d, id })));
      return () => { subs[name] = subs[name].filter((x) => x !== cb); };
    },
    async put(name, id, data) {
      const map = read(name);
      map[id] = { ...data, updatedAt: new Date().toISOString() };
      write(name, map);
    },
    async remove(name, id) {
      const map = read(name);
      delete map[id];
      write(name, map);
    },
    async putMany(items) {
      const byName = {};
      for (const { name, id, data } of items) {
        (byName[name] ||= read(name))[id] = { ...data, updatedAt: new Date().toISOString() };
      }
      Object.entries(byName).forEach(([name, map]) => write(name, map));
    }
  };
}

/* ---------------- Sync ---------------- */

export function startSync(user, { demo = false } = {}) {
  stopSync();
  state.user = user;
  state.demo = demo;
  if (!user) return;
  backend = demo ? localBackend() : firestoreBackend(user.uid);

  const seen = new Set();
  for (const name of COLLECTIONS) {
    unsubs.push(backend.subscribe(
      name,
      (list) => {
        state[name] = list;
        seen.add(name);
        state.loaded = seen.size === COLLECTIONS.length;
        notify();
      },
      (err) => {
        console.error('Firestore-Fehler:', err);
        state.loaded = true;
        state.error = err.code === 'permission-denied'
          ? 'Keine Berechtigung. Steht deine E-Mail in den Firestore-Regeln, und sind die Regeln veröffentlicht?'
          : err.message;
        notify();
      }
    ));
  }
}

export function stopSync() {
  unsubs.forEach((u) => { try { u(); } catch { /* egal */ } });
  unsubs = [];
  backend = null;
  for (const name of COLLECTIONS) state[name] = [];
  state.loaded = false;
  state.error = '';
}

/**
 * Schreibvorgaenge nicht abwarten: Firestore bestaetigt erst, wenn der Server
 * geantwortet hat – offline also nie. Die lokale Ansicht aktualisiert sich
 * trotzdem sofort ueber den Snapshot. Fehler werden als Hinweis gezeigt.
 */
function fire(promise) {
  promise.catch((err) => {
    console.error(err);
    toast(err.code === 'permission-denied'
      ? 'Speichern abgelehnt – Firestore-Regeln prüfen.'
      : `Speichern fehlgeschlagen: ${err.message}`, 5000);
  });
}

function clean(obj) {
  const out = { ...obj };
  delete out.id;
  delete out.updatedAt;
  Object.keys(out).forEach((k) => { if (out[k] === undefined) delete out[k]; });
  return out;
}

/* ---------------- Konten ---------------- */

export function getAccount(id) {
  return state.accounts.find((a) => a.id === id) || null;
}

export function saveAccount(account) {
  fire(backend.put('accounts', account.id, clean(account)));
}

/** Konto samt aller zugehoerigen Transaktionen loeschen. */
export function deleteAccount(id) {
  fire(backend.remove('accounts', id));
  state.trades.filter((t) => t.accountId === id).forEach((t) => fire(backend.remove('trades', t.id)));
}

/* ---------------- Wertpapiere ---------------- */

export function getInstrument(id) {
  return state.instruments.find((i) => i.id === id) || null;
}

export function saveInstrument(instrument) {
  fire(backend.put('instruments', instrument.id, clean(instrument)));
}

export function deleteInstrument(id) {
  fire(backend.remove('instruments', id));
}

/** Stabiler Schluessel: ISIN, sonst Symbol – so landet derselbe ETF
    aus verschiedenen Kaeufen immer beim selben Wertpapier. */
export function instrumentIdFor({ isin, symbol }) {
  const base = (isin || symbol || '').toUpperCase().replace(/[^A-Z0-9.\-_^=]/g, '');
  return base || null;
}

/* ---------------- Transaktionen ---------------- */

export function getTrade(id) {
  return state.trades.find((t) => t.id === id) || null;
}

export function saveTrade(trade) {
  fire(backend.put('trades', trade.id, clean(trade)));
}

export function deleteTrade(id) {
  fire(backend.remove('trades', id));
}

/* ---------------- Backup ---------------- */

export function exportData() {
  const strip = (list) => list.map((x) => { const o = { ...x }; delete o.updatedAt; return o; });
  return {
    accounts: strip(state.accounts),
    instruments: strip(state.instruments),
    trades: strip(state.trades)
  };
}

export async function importData(data) {
  const items = [];
  for (const name of COLLECTIONS) {
    for (const entry of data[name] || []) {
      if (!entry || !entry.id) continue;
      items.push({ name, id: String(entry.id), data: clean(entry) });
    }
  }
  await backend.putMany(items);
  return items.length;
}
