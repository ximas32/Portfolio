# Portfolio

Private Web-App (PWA) für das iPhone: alle Konten, Aktien und ETFs im
Überblick – **konsequent in Franken**.

- Pro Konto (Bank, Broker, Säule 3a …) Käufe und Verkäufe erfassen,
  dazu den Cash-Bestand.
- Wertpapiere per **ISIN**, Symbol oder Name suchen.
- Beim Kauf wird automatisch der **Wechselkurs vom Kauftag** geholt (EZB).
  Der Einstand in CHF steht damit fest und ändert sich nie mehr.
- Der aktuelle Wert wird mit dem **heutigen** Kurs und Wechselkurs in CHF
  gerechnet.
- Der Gewinn wird zerlegt in **Kurseffekt** (was das Wertpapier gemacht hat)
  und **Währungseffekt** (was der Franken dazu beigetragen hat).
- Verkäufe nach der Durchschnittskosten-Methode, realisierter Gewinn in CHF.
- Verteilung nach Konto, Währung und Art.
- Linien-Charts: Wert und Einstand in CHF über die Zeit (gesamt und pro
  Konto), Kursverlauf pro Wertpapier mit Kauf- und Verkaufspunkten. Pro
  Wertpapier genügt eine Anfrage für die ganze Historie; sie wird auf dem
  Gerät gespeichert und höchstens alle 12 Stunden erneuert.
- Offline lesbar, Synchronisation zwischen Geräten über Firebase.
- Backup als JSON, Transaktionen als CSV (für Excel).

Kein Build-Schritt, kein npm: Datei ändern, `git push`, fertig. Aufbau und
Erfahrungen stammen aus dem Rezeptbuch-Projekt, siehe
[PWA-MIT-FIREBASE.md](PWA-MIT-FIREBASE.md).

---

## Datenquellen

| Was | Quelle | Kosten / Schlüssel |
|---|---|---|
| Wechselkurse (heute + historisch) | EZB-Referenzkurse über [frankfurter.dev](https://frankfurter.dev) | gratis, kein Schlüssel |
| Suche (ISIN/Name) und Kurse | Yahoo Finance über den eigenen Kurs-Proxy | gratis, kein Schlüssel |

**Warum ein Proxy?** Yahoo findet Schweizer Titel und UCITS-ETFs zuverlässig
per ISIN (z. B. `CH0038863350` → Nestlé `NESN.SW`), erlaubt aber keine Abrufe
direkt aus dem Browser fremder Seiten (CORS). Der Proxy ist ein kleiner
Cloudflare-Worker (`worker/kurs-proxy.js`), der genau zwei Yahoo-Adressen
durchreicht. Er speichert nichts.

**Ohne Proxy** funktioniert die App trotzdem: Wertpapiere werden dann von Hand
erfasst und der aktuelle Kurs pro Wertpapier von Hand gesetzt. Die
Wechselkurse kommen immer automatisch.

**Hinweis zu ETFs:** Derselbe ETF wird an mehreren Börsen gehandelt, in
unterschiedlichen Währungen. Per ISIN liefert Yahoo oft nur einen
Börsenplatz. Beim Erfassen gibt es deshalb den Knopf *„Weitere Börsenplätze
suchen"* – dort den Platz wählen, an dem du tatsächlich gekauft hast
(Schweizer Bank → meist SIX, Symbol endet auf `.SW`, Kurs in CHF).

**Wechselkurs der Bank:** Die EZB-Kurse sind Referenzkurse. Banken rechnen
mit Aufschlag. Wer es exakt will, trägt beim Kauf den Kurs von der
Abrechnung ein – das Feld ist editierbar.

---

## Lokal ausprobieren

```bash
python dev-server.py
```

Dann <http://localhost:8000> öffnen. Solange in `js/config.js` noch
Platzhalter stehen, läuft die App im **Demo-Modus**: alles funktioniert, die
Daten bleiben aber nur in diesem Browser. Der Testserver spielt unter
`/yahoo/…` den Kurs-Proxy, Suche und Live-Kurse funktionieren also auch
lokal.

---

## Einrichtung (einmalig)

### 1. Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Projekt hinzufügen** (z. B. „portfolio"), Analytics abwählen.
2. **Sicherheit → Authentifizierung** → *Jetzt starten* → Reiter
   *Anmeldemethode* → **E-Mail/Passwort** aktivieren.
3. **Datenbanken und Speicher → Firestore** → *Datenbank erstellen* →
   Edition *Standard*, Standort **eur3 (europe-west)**, *Produktionsmodus*.
4. Firestore → Reiter **Regeln** → Inhalt von `firestore.rules` einfügen →
   **Veröffentlichen**. (Die erste Zeile `rules_version = '2';` gehört dazu.)
5. Zahnrad → **Projekteinstellungen** → *Meine Apps* → Web-App (`</>`)
   registrieren → die Werte in `js/config.js` bei `firebaseConfig` eintragen.
6. **Sicherheit → Authentifizierung → Einstellungen → Autorisierte Domains**:
   `ximas32.github.io` und `localhost` hinzufügen.
7. Die eigene E-Mail-Adresse steht in `js/config.js` (`ALLOWED_EMAILS`) **und**
   in `firestore.rules`. Beides anpassen, falls nötig.

Die Firebase-Werte sind keine Geheimnisse und dürfen im öffentlichen Repo
stehen – den Zugriff schützen die Regeln. Jede angemeldete Person sieht
ausschliesslich ihr eigenes Portfolio (`users/{uid}/…`).

### 2. Kurs-Proxy (Cloudflare Worker)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → kostenlos registrieren.
2. **Compute (Workers) → Workers & Pages → Erstellen** → *Hello World* →
   Name `kurs-proxy` → *Bereitstellen*.
3. **Code bearbeiten** → alles ersetzen durch `worker/kurs-proxy.js` →
   *Bereitstellen*.
4. Die Adresse (`https://kurs-proxy.<name>.workers.dev`) in `js/config.js` bei
   `QUOTE_PROXY` eintragen.
5. In der App: Einstellungen → *Suche testen*.

Falls die App unter einer anderen Adresse als `ximas32.github.io` läuft, im
Worker `ALLOWED_ORIGINS` ergänzen.

### 3. GitHub Pages

```bash
git push
```

Dann im Repo **Settings → Pages** → *Deploy from a branch* → `main` / `root`.
Nach ein, zwei Minuten läuft die App unter
`https://ximas32.github.io/Portfolio/`.

### 4. Auf dem iPhone

Safari → Adresse öffnen → **Teilen → Zum Home-Bildschirm**. Einmal anmelden,
danach bleibt man angemeldet.

---

## Aufbau

```
index.html, manifest.webmanifest, sw.js, .nojekyll
css/app.css
js/config.js        ← Einstellungen (Firebase, Proxy, E-Mail)
js/firebase.js      Initialisierung, Offline-Cache
js/auth.js          Anmeldung, Demo-Modus
js/store.js         Daten (Firestore bzw. Demo-Speicher)
js/market.js        Suche, Kurse, Wechselkurse
js/calc.js          Rechnung in CHF (Einstand, Wert, Effekte, Verkäufe)
js/ui.js            gemeinsame Bausteine
js/chart.js         Linien-Chart (SVG, ohne Bibliothek)
js/history-chart.js Verlaufs-Karten für Übersicht, Konto, Wertpapier
js/views/…          Übersicht, Positionen, Wertpapier, Konten, Erfassen, Einstellungen
worker/kurs-proxy.js  Cloudflare Worker
dev-server.py       lokaler Testserver inkl. Proxy
firestore.rules     Kopie der Sicherheitsregeln
```

**Datenmodell** (Firestore, pro Person unter `users/{uid}`):

- `accounts` – Name, Plattform, Cash-Bestand + Währung, Notiz
- `instruments` – ISIN, Symbol (Yahoo), Name, Währung, Art, optional Handkurs
- `trades` – Konto, Wertpapier, Kauf/Verkauf, Datum, Anzahl, Kurs,
  Gebühren (in Wertpapier-Währung oder CHF), **Wechselkurs am Stichtag**,
  Quelle des Wechselkurses (EZB/manuell)

## Bei jedem Update

1. In `sw.js` die `CACHE_VERSION` hochzählen.
2. In `js/config.js` die `APP_VERSION` hochzählen (wird in den Einstellungen
   angezeigt).
3. `git push`.

## Ideen für später

- Dividenden erfassen (in CHF zum Tageskurs, als Ertrag)
- Import der Transaktionen aus Bank-CSV (Swissquote, IBKR, PostFinance …)
- Steuerwert per 31.12. (Kurse der ESTV-Kursliste)
- Zielallokation und Rebalancing-Hinweise
