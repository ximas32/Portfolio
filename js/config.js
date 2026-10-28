/* ============================================================
   HIER MUSST DU ETWAS EINTRAGEN  (einmalig, ca. 15 Minuten)
   ------------------------------------------------------------
   Schritt fuer Schritt in der README.md. Kurzfassung:

   1. Firebase-Projekt anlegen, Web-App registrieren und die Werte
      aus "firebaseConfig" unten eintragen.
   2. Sicherheit -> Authentifizierung -> "E-Mail/Passwort" aktivieren.
   3. Firestore-Datenbank erstellen und firestore.rules einfuegen.
   4. Kurs-Proxy (worker/kurs-proxy.js) bei Cloudflare anlegen und die
      Adresse unten bei QUOTE_PROXY eintragen.

   Solange hier Platzhalter stehen, laeuft die App im Demo-Modus:
   alles funktioniert, die Daten bleiben aber nur in diesem Browser.

   Die Werte hier sind KEINE Geheimnisse – sie duerfen oeffentlich im
   GitHub-Repo stehen. Den Zugriff schuetzen die Firestore-Regeln.
   ============================================================ */

export const firebaseConfig = {
  apiKey: 'AIzaSyBcAKBQCoYgszTgSiwg0OBrYpau9iT287Q',
  authDomain: 'portfolio-612b7.firebaseapp.com',
  projectId: 'portfolio-612b7',
  storageBucket: 'portfolio-612b7.firebasestorage.app',
  messagingSenderId: '326635214752',
  appId: '1:326635214752:web:237e36272b7f31a9a676c5'
};

/* Wer darf rein? Dieselben Adressen auch in firestore.rules eintragen –
   dort wird es wirklich durchgesetzt, hier dient es nur der Fehlermeldung.
   Jede Person sieht ausschliesslich ihr eigenes Portfolio. */
export const ALLOWED_EMAILS = [
  'akumalic@proton.me',
  'parathazhammaria@gmail.com'
];

/* Adresse des Kurs-Proxys (Cloudflare Worker), ohne Schraegstrich am Ende,
   z. B. 'https://kurs-proxy.deinname.workers.dev'.
   Leer = keine automatische Suche und keine Live-Kurse; Kurse lassen sich
   dann pro Wertpapier von Hand eintragen. Wechselkurse funktionieren
   immer, die kommen direkt von der EZB (frankfurter.dev). */
export const QUOTE_PROXY = '';

/* Kurse gelten so lange als frisch (Millisekunden). */
export const QUOTE_MAX_AGE = 10 * 60 * 1000;

export const KINDS = [
  { id: 'etf', label: 'ETF', emoji: '🧺' },
  { id: 'stock', label: 'Aktie', emoji: '📈' },
  { id: 'fund', label: 'Fonds', emoji: '🏛️' },
  { id: 'crypto', label: 'Krypto', emoji: '🪙' },
  { id: 'other', label: 'Sonstiges', emoji: '📦' }
];

/* Waehrungen fuer die Auswahlliste – alle werden von der EZB gefuehrt. */
export const CURRENCIES = ['CHF', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'HKD'];

export const APP_VERSION = '0.2.0';
