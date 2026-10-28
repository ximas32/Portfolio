/* Login / Registrierung mit E-Mail + Passwort.
   Ohne Firebase-Zugangsdaten startet die App direkt im Demo-Modus. */
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import { auth, configIsPlaceholder } from './firebase.js';
import { ALLOWED_EMAILS } from './config.js';
import { $, toast } from './util.js';

const FEHLER = {
  'auth/invalid-email': 'Diese E-Mail-Adresse sieht nicht gültig aus.',
  'auth/invalid-credential': 'E-Mail oder Passwort stimmt nicht.',
  'auth/wrong-password': 'Das Passwort stimmt nicht.',
  'auth/user-not-found': 'Zu dieser E-Mail gibt es noch kein Konto – zuerst registrieren.',
  'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto – bitte anmelden.',
  'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte ein paar Minuten warten.',
  'auth/network-request-failed': 'Keine Verbindung zum Server.',
  'auth/operation-not-allowed': 'E-Mail/Passwort ist in der Firebase-Console noch nicht aktiviert.',
  'auth/unauthorized-domain': 'Diese Adresse ist in Firebase nicht freigegeben (Autorisierte Domains).'
};

const DEMO_USER = { uid: 'demo', email: 'Demo-Modus (nur dieses Gerät)' };

let modeRegister = false;

export const isDemo = configIsPlaceholder;

export function initAuth(onUser) {
  const loginBox = $('#login');
  const form = $('#login-form');
  const errorBox = $('#login-error');
  const submit = $('#login-submit');
  const toggle = $('#login-toggle');
  const resetBtn = $('#login-reset');
  const sub = $('#login-sub');

  if (configIsPlaceholder) {
    $('#boot').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#demo-banner').classList.remove('hidden');
    onUser(DEMO_USER);
    return;
  }

  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.classList.toggle('hidden', !msg);
  };

  toggle.addEventListener('click', () => {
    modeRegister = !modeRegister;
    submit.textContent = modeRegister ? 'Konto erstellen' : 'Anmelden';
    toggle.textContent = modeRegister ? 'Ich habe schon ein Konto' : 'Noch kein Konto? Registrieren';
    sub.textContent = modeRegister
      ? 'Einmal registrieren – danach bleibst du auf diesem Gerät angemeldet.'
      : 'Melde dich an, um dein Portfolio zu sehen.';
    $('#login-password').setAttribute('autocomplete', modeRegister ? 'new-password' : 'current-password');
    showError('');
  });

  resetBtn.addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!email) return showError('Bitte zuerst die E-Mail-Adresse eintragen.');
    try {
      await sendPasswordResetEmail(auth, email);
      showError('');
      toast('E-Mail zum Zurücksetzen verschickt.');
    } catch (err) {
      showError(FEHLER[err.code] || err.message);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    submit.disabled = true;
    showError('');
    try {
      if (modeRegister) {
        const allow = ALLOWED_EMAILS.map((e) => e.toLowerCase());
        if (allow.length && !allow.includes(email.toLowerCase())) {
          throw new Error(
            'Diese Adresse ist nicht freigegeben. Trage sie in js/config.js ' +
            'und in den Firestore-Regeln ein.'
          );
        }
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      showError(FEHLER[err.code] || err.message || 'Anmeldung fehlgeschlagen.');
    } finally {
      submit.disabled = false;
    }
  });

  onAuthStateChanged(auth, (user) => {
    $('#boot').classList.add('hidden');
    if (user) {
      loginBox.classList.add('hidden');
      $('#app').classList.remove('hidden');
    } else {
      $('#app').classList.add('hidden');
      loginBox.classList.remove('hidden');
      $('#login-password').value = '';
    }
    onUser(user);
  });
}

export function logout() {
  return isDemo ? Promise.resolve() : signOut(auth);
}

export function currentUser() {
  if (isDemo) return DEMO_USER;
  return auth ? auth.currentUser : null;
}
