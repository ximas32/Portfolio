# Gratis-Web-App mit Firebase und GitHub Pages

Bauanleitung und Erfahrungsbericht: eine installierbare Web-App (PWA) für einen
kleinen, privaten Nutzerkreis, mit gemeinsamer Datenbank, ohne Server, ohne
Kosten, ohne Build-Schritt.

Geschrieben am 28.10.2026 nach dem Aufbau eines gemeinsamen Rezeptbuchs. Die
Rezept-Inhalte sind hier bewusst weggelassen – es geht nur um das Gerüst, das
für jedes ähnliche Projekt gleich funktioniert (Haushaltsbuch, Trainingstagebuch,
Packliste, Sammlung …).

---

## 1. Überblick

| Baustein | Dienst | Kosten |
|---|---|---|
| Auslieferung der Dateien | GitHub Pages | gratis (öffentliches Repo) |
| Datenbank | Firebase Firestore | gratis (Spark-Plan) |
| Anmeldung | Firebase Authentication | gratis |
| Dateien/Bilder | **bewusst nicht** Firebase Storage | – |

**Wie es zusammenspielt:** GitHub Pages liefert nur statische Dateien aus
(HTML, CSS, JavaScript). Die Verbindung zur Datenbank baut der **Browser des
Nutzers** direkt zu Firebase auf. Es gibt also keine Verknüpfung zwischen GitHub
und Firebase, die man irgendwo einrichten müsste – nur sechs Konfigurationswerte
im JavaScript.

```
Browser  ──lädt Dateien──▶  GitHub Pages (statisch)
   │
   └──────Daten────────▶  Firebase (Firestore + Auth)
```

**Kein Build-Schritt.** Das Firebase-SDK lässt sich direkt als ES-Modul vom
Google-CDN laden. Kein npm, kein Vite, kein Deploy-Workflow: Datei ändern,
`git push`, fertig. Für ein Projekt dieser Grösse spart das mehr Ärger, als es
kostet.

---

## 2. Firebase-Projekt anlegen

> **Achtung, die Konsole wurde 2025 umgebaut.** Ältere Anleitungen im Netz
> sprechen von *Build → Authentication* und *Build → Firestore Database*.
> Heute heissen die Bereiche anders (siehe unten). Gemeint ist dasselbe.

1. [console.firebase.google.com](https://console.firebase.google.com) öffnen,
   mit Google-Konto anmelden.
2. **Projekt hinzufügen** → Name vergeben → Google Analytics kann man abwählen.
3. **Sicherheit → Authentifizierung** → *Jetzt starten* → Reiter
   **Anmeldemethode** → Anbieter **E-Mail/Passwort** aktivieren → speichern.
4. **Datenbanken und Speicher → Firestore** → *Datenbank erstellen* →
   Edition **Standard**, Standort **eur3 (europe-west)**,
   Start im **Produktionsmodus**.

### Häufige Verwechslung

*Projekteinstellungen → Nutzer und Berechtigungen* ist **nicht** die Anmeldung
der App. Dort steht, welche Google-Konten das Firebase-Projekt **verwalten**
dürfen. Die Konten der App-Nutzer leben unter
*Sicherheit → Authentifizierung → Nutzer*.

### Konfigurationswerte holen

Zahnrad → **Projekteinstellungen** → *Meine Apps* → Symbol **`</>`** (Web) →
App registrieren. Firebase zeigt dann:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "projekt-1234.firebaseapp.com",
  projectId: "projekt-1234",
  storageBucket: "projekt-1234.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123"
};
```

`measurementId` erscheint nur, wenn Analytics aktiv ist – wird sonst nicht
gebraucht.

### Domain freigeben (wird gern vergessen)

**Sicherheit → Authentifizierung → Einstellungen → Autorisierte Domains →
Domain hinzufügen**: die GitHub-Pages-Adresse eintragen,
z. B. `benutzername.github.io`.

Fürs lokale Testen zusätzlich `localhost` – **bei Projekten, die nach dem
28.04.2025 erstellt wurden, ist localhost nicht mehr automatisch freigegeben.**
Fehlt der Eintrag, bricht die Anmeldung mit `auth/unauthorized-domain` ab.

---

## 3. Zugriff schützen

Das ist der Teil, bei dem man nicht sparen sollte. Die Regeln sind das
Einzige, was zwischen den Daten und dem offenen Internet steht.

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function erlaubt() {
      return request.auth != null
        && request.auth.token.email != null
        && request.auth.token.email.lower() in [
             'person-a@example.com',
             'person-b@example.com'
           ];
    }

    function groesseOk() {
      return request.resource.data.size() < 60
        && (!('image' in request.resource.data)
            || request.resource.data.image.size() < 800000);
    }

    match /eintraege/{id} {
      allow read: if erlaubt();
      allow create, update: if erlaubt() && groesseOk()
        && request.resource.data.title is string
        && request.resource.data.title.size() > 0;
      allow delete: if erlaubt();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Einfügen in der Konsole unter *Datenbanken und Speicher → Firestore → Reiter
Regeln* → **Veröffentlichen**. Firebase liest die Regeln **nicht** aus dem
Git-Repository; die Datei dort ist nur eine Kopie zum Nachschlagen.

**Die erste Zeile `rules_version = '2';` gehört zwingend dazu.** Fehlt sie,
gilt die alte Regelversion 1 mit anderer Semantik bei Platzhaltern. Beim
Kopieren aus einer Datei schneidet man sie leicht ab.

### Warum überhaupt eine Anmeldung?

Das Argument „da sind keine sensiblen Daten drin" greift zu kurz. Offene Regeln
(`allow read, write: if true`) heissen nicht nur „jeder darf schauen", sondern
auch **„jeder darf löschen"**. Es gibt Bots, die das Netz nach offenen
Firestore-Datenbanken absuchen. Das Risiko ist nicht Geheimnisverrat, sondern
Datenverlust oder eine als Gratisspeicher missbrauchte Datenbank.

Der Komfortverlust ist dabei fast null: Mit `browserLocalPersistence` meldet man
sich **einmal pro Gerät** an und bleibt angemeldet, bis jemand aktiv abmeldet.

Mittelweg, falls man Inhalte teilen will: `allow read: if true;` und
`allow write: if erlaubt();` – Fremde dürfen lesen, ändern nur die eigenen Leute.

### Ist der öffentliche API-Key ein Problem?

**Nein.** Google dazu wörtlich: *„API-Schlüssel für Firebase-Dienste
identifizieren nur Ihr Firebase-Projekt … Sie können sie bedenkenlos in Ihren
Code oder Ihre Konfigurationsdateien einfügen."*
([Doku](https://firebase.google.com/docs/projects/api-keys?hl=de))

Der Schlüssel ist eine Absenderadresse, kein Passwort. Autorisiert wird über
die Security Rules. Kommt von Google die Mail *„Öffentlich zugänglicher
Google-API-Schlüssel"*, prüft man laut Google unter
*Google Cloud Console → APIs & Dienste → Anmeldedaten*:

1. Es ist der `Browser key (auto created by Firebase)` und wird nur für Firebase
   verwendet.
2. In der API-Zulassungsliste stehen nur Firebase-APIs – **nicht** die
   *Generative Language API*.
3. Security Rules sind aktiv.

**Den Schlüssel nicht löschen oder neu erzeugen.** Die App wäre sofort tot, und
der neue Schlüssel wäre genauso öffentlich.

Optionale Härtung: Schlüssel in der Cloud Console unter
*Anwendungseinschränkungen → Websites* auf die eigene Domain beschränken
(vorher testen, falsch gesetzt bricht die Anmeldung), und die Registrierung
abschalten, sobald alle Konten existieren.

---

## 4. Die App anbinden

### SDK vom CDN, Version fest verdrahten

```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import { getAuth, setPersistence, browserLocalPersistence }
  from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
  from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';
```

Immer eine **konkrete Version** angeben, nie „latest". Ob eine Version wirklich
existiert, prüft man in einer Sekunde:

```bash
curl -s -o /dev/null -w "%{size_download}\n" \
  https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js
```

Eine erfundene Version liefert eine ~1,6 KB grosse Fehlerseite statt ~100 KB
Code – der HTTP-Status ist in beiden Fällen 200, die Dateigrösse verrät es.

### Initialisierung mit Offline-Cache

```js
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
```

`persistentLocalCache` ist der Grund, warum die App offline funktioniert: Lesen
geht aus dem lokalen Cache, Schreibvorgänge werden gepuffert und synchronisiert,
sobald wieder Netz da ist. Das muss man nicht selbst bauen.

### Daten lesen: einmal abonnieren statt dauernd abfragen

Bei kleinen Datenmengen (ein paar hundert Dokumente) ist der einfachste Weg auch
der beste: die ganze Sammlung einmal mit `onSnapshot` abonnieren, im Speicher
halten und lokal filtern. Das gibt Live-Synchronisation zwischen den Geräten
geschenkt, kostet kaum Lesezugriffe und macht jede Suche sofort möglich – auch
Volltextsuche, die Firestore selbst gar nicht kann.

Trick für die Suche: beim Speichern ein Feld `searchTerms` mitschreiben, das
alle durchsuchbaren Wörter normalisiert enthält (klein, ohne Umlaute und
Akzente). Dann ist die Suche ein simpler `includes`-Vergleich.

### Bilder ohne Firebase Storage

Firebase Storage verlangt inzwischen ein hinterlegtes Zahlungsmittel. Für kleine
Bilder braucht man es nicht: im Browser per Canvas verkleinern und als Data-URL
direkt ins Dokument schreiben.

```js
const canvas = document.createElement('canvas');
// … Bild auf max. 1200 px skalieren …
let url = canvas.toDataURL('image/jpeg', 0.82);
```

**Grenze:** Ein Firestore-Dokument darf maximal **1 MB** gross sein. Also auf
ca. 300 KB herunterrechnen (Qualität schrittweise senken, notfalls zusätzlich
die Kantenlänge) und in den Regeln eine Obergrenze erzwingen.

---

## 5. GitHub-Repository und Pages

### Aufbau

```
index.html
manifest.webmanifest
sw.js
.nojekyll          ← verhindert Jekyll-Verarbeitung
css/app.css
js/…               ← ES-Module
assets/icon-192.png, icon-512.png, icon-maskable-512.png
```

### Veröffentlichen

```bash
git add . && git commit -m "…" && git push
```

Dann im Repo: **Settings → Pages** → *Source*: `Deploy from a branch`,
Branch `main`, Ordner `/ (root)`. Nach ein bis zwei Minuten läuft die Seite
unter `https://benutzername.github.io/reponame/`.

### Drei Dinge, die man dabei falsch machen kann

1. **Absolute Pfade.** Die Seite liegt in einem Unterordner
   (`/reponame/`), nicht im Wurzelverzeichnis. Alle Pfade relativ halten
   (`./js/app.js`, nicht `/js/app.js`), sonst findet der Browser nichts.
2. **Routing mit History-API.** GitHub Pages kann keine Server-Rewrites.
   Ein Aufruf von `/reponame/detail/42` endet im 404. Lösung:
   **Hash-Routing** (`#/detail/42`) – unschön, aber es funktioniert überall
   und braucht keine Konfiguration.
3. **Fehlende `.nojekyll`.** Ohne diese leere Datei ignoriert GitHub Pages
   Ordner und Dateien, die mit `_` beginnen.

### Lokal testen

```bash
python -m http.server 8000
```

Ein Doppelklick auf `index.html` genügt **nicht**: ES-Module und Service Worker
brauchen `http://`, unter `file://` verweigern sie den Dienst.

---

## 6. PWA: installierbar machen

### manifest.webmanifest

```json
{
  "name": "Lange Bezeichnung",
  "short_name": "Kurz",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#b4502b",
  "icons": [
    { "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`start_url` und `scope` relativ (`./`), sonst startet die installierte App im
falschen Verzeichnis.

Das **maskable**-Icon ist ein eigenes Bild, bei dem das Motiv nur die inneren
~70 % füllt – Android schneidet je nach Gerät rund oder eckig zu.

### Installieren

- Android/Chrome: Menü ⋮ → *App installieren*
- iPhone/Safari: Teilen → *Zum Home-Bildschirm*

Nützliche Kleinigkeiten für den Handy-Einsatz: `viewport-fit=cover` plus
`env(safe-area-inset-*)` in CSS, und für Bildschirme, die nicht ausgehen sollen,
die Wake-Lock-API:

```js
const lock = await navigator.wakeLock.request('screen');
```

---

## 7. Updates zuverlässig ausliefern

**Das war der grösste Zeitfresser des ganzen Projekts.** Ein Fehler wurde
behoben, gepusht, live geprüft – und auf dem Handy lief trotzdem noch der alte
Code. Zwei unabhängige Caches liegen übereinander, und beide muss man kennen.

### Problem 1: der Service Worker

Die übliche Strategie „Cache zuerst, im Hintergrund aktualisieren" ist für
Bilder richtig und für Programmcode falsch. Sie liefert beim Start **immer** die
alte Version und holt die neue erst danach – man braucht also mindestens zwei
Starts, bis eine Änderung greift. Bei einer installierten PWA, die man nie
wirklich neu lädt, kann das beliebig lange dauern.

Besser: **Netz zuerst für Seiten, JavaScript und CSS, Cache nur als Rückfall.**

```js
function holenUndCachen(req, revalidieren = false) {
  const anfrage = revalidieren
    ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : req;
  return fetch(anfrage).then((res) => {
    if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // CDN & API durchreichen

  if (/\.(png|jpg|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    event.respondWith(caches.match(req).then((c) => c || holenUndCachen(req)));
    return;
  }

  event.respondWith(
    holenUndCachen(req, true).catch(() =>
      caches.match(req).then((c) => c || (req.mode === 'navigate'
        ? caches.match('./index.html')
        : Response.error()))
    )
  );
});
```

Firebase-Requests (`*.googleapis.com` usw.) gehören **nie** in den
Service-Worker-Cache – Firestore bringt seinen eigenen Offline-Mechanismus mit.

### Problem 2: der Browser-Cache darunter

Auch mit „Netz zuerst" bekommt man alten Code, denn **GitHub Pages sendet
`Cache-Control: max-age=600`**. Der Browser behält die Dateien also bis zu zehn
Minuten in seinem eigenen Cache, da kommt der Service Worker gar nicht hin.
Nachgemessen:

```bash
curl -sI https://benutzername.github.io/repo/js/app.js | grep -i cache-control
# Cache-Control: max-age=600
```

Deshalb oben `cache: 'no-cache'`: Der Browser fragt beim Server kurz nach, ob
sich etwas geändert hat. Hat es das nicht, kommt ein `304 Not Modified` zurück –
ein paar hundert Byte, kaum messbar. Und beim Installieren des Service Workers
die Shell mit `cache: 'reload'` holen, damit nicht sofort wieder Veraltetes
eingelagert wird:

```js
fetch(new Request(url, { cache: 'reload' })).then((res) => cache.put(url, res));
```

### Übernahme einer neuen Version

```js
const hatteController = Boolean(navigator.serviceWorker.controller);
let laedtNeu = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!hatteController || laedtNeu) return;   // beim Erststart nicht neu laden
  laedtNeu = true;
  if (formularIstOffen()) {                   // sonst ist die Eingabe weg
    hinweisZeigen('Neue Version beim nächsten Start aktiv.');
    return;
  }
  location.reload();
});

// Installierte PWAs werden selten neu geladen -> beim Zurückholen nachsehen
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') registration.update();
});
```

Im Service Worker dazu `self.skipWaiting()` beim `install` und
`self.clients.claim()` beim `activate`, sowie alte Caches beim Aktivieren
löschen.

### Beim Umstellen: ein Start Verzug ist unvermeidbar

Wer schon die alte Fassung installiert hat, bekommt die neue Logik erst beim
**zweiten** Start – der erste läuft ja noch mit dem alten Code, der die
Auto-Aktualisierung gar nicht kennt. Das ist einmalig und danach vorbei. Ein
Knopf „Nach Update suchen" in den Einstellungen hilft über diesen Moment hinweg:

```js
const regs = await navigator.serviceWorker.getRegistrations();
await Promise.all(regs.map((r) => r.update()));
location.reload();
```

### Merksätze

- Bei jedem Deploy die `CACHE_VERSION` im Service Worker hochzählen.
- Eine sichtbare Versionsnummer in der App einbauen. Ohne sie rätselt man, ob
  ein Fehler noch existiert oder nur der alte Code läuft. Das hat hier mehr
  Zeit gekostet als jeder echte Bug.
- Beim Debuggen immer zuerst prüfen, **welche Version tatsächlich läuft**, bevor
  man den Code verdächtigt.

---

## 8. Daten von aussen einlesen

Wenn Nutzer Inhalte per KI erzeugen lassen und als JSON einfügen sollen:

- **Alles durch eine Normalisierungsfunktion schicken.** Nie darauf verlassen,
  dass die Feldnamen, Typen oder Wertebereiche stimmen. Synonyme abfangen
  (`"Hauptgericht"` → `hauptspeise`), Zahlen aus Text parsen (`"1/2"` → `0.5`),
  fehlende Felder mit Vorgaben füllen.
- **Verunstaltete Eingaben reparieren.** Wer eine Antwort aus einer
  Chat-Oberfläche markiert statt über den Kopier-Knopf nimmt, bekommt
  Markdown mitgeliefert: Backslashes am Zeilenende und `&#x20;` statt
  Leerzeichen. Beides macht JSON ungültig.

```js
text
  .replace(/&#x20;/gi, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\\(?![\\"/bfnrtu])/g, '')   // Backslash ohne gültiges JSON-Escape
  .replace(/,(\s*[}\]])/g, '$1');       // hängende Kommas
```

  Der Backslash-Ausdruck ist sicher: In gültigem JSON kann ein Backslash nur vor
  `" \ / b f n r t u` stehen, alles andere ist ohnehin kaputt. Echte Escapes wie
  `\"` und `\n` bleiben unangetastet.
- Auch Codeblöcke (```` ```json ````) und Fliesstext drumherum wegschneiden,
  und eine Vorschau vor dem Speichern zeigen.

---

## 9. Grenzen des Gratis-Plans

Firebase Spark, Stand Oktober 2026:

| | Limit |
|---|---|
| Gespeicherte Daten | 1 GiB |
| Lesevorgänge | 50 000 / Tag |
| Schreibvorgänge | 20 000 / Tag |
| Löschvorgänge | 20 000 / Tag |
| Ausgehende Daten | 10 GiB / Monat |
| Grösse eines Dokuments | 1 MiB (1 048 576 Byte) |

Die Tageskontingente werden um Mitternacht (UTC −7/−8) zurückgesetzt, und pro
Projekt ist genau **eine** kostenlose Datenbank möglich.
([Quelle](https://firebase.google.com/docs/firestore/quotas?hl=de))

Für eine Handvoll Nutzer ist das weit weg. Relevant wird es erst, wenn die
ganze Sammlung bei jedem Start geladen wird **und** sie auf mehrere tausend
Dokumente wächst – dann lohnt sich Paginierung.

GitHub Pages ist für öffentliche Repositories gratis (für private braucht es
ein kostenpflichtiges Konto). Soft-Limit rund 100 GB Datenverkehr im Monat.

---

## 10. Checkliste für das nächste Projekt

**Einrichtung**
- [ ] Firebase-Projekt, Authentifizierung (E-Mail/Passwort), Firestore Standard
- [ ] Eigene Domain unter *Autorisierte Domains* eintragen, `localhost` dazu
- [ ] Security Rules mit `rules_version = '2'` **veröffentlicht** (nicht nur im Repo)
- [ ] Konfigurationswerte im Code, Zugriff über die Regeln geschützt

**Repository**
- [ ] Nur relative Pfade, Hash-Routing, `.nojekyll`
- [ ] Pages auf `main` / `root` gestellt
- [ ] `.gitignore` für lokale Einstellungsdateien

**PWA**
- [ ] Manifest mit relativen `start_url`/`scope`, Icons inkl. maskable
- [ ] Service Worker: Netz zuerst für Code, `cache: 'no-cache'`, Cache als Rückfall
- [ ] Automatischer Neustart bei neuer Version, Formulare ausgenommen
- [ ] Sichtbare Versionsnummer in der App

**Vor dem Übergeben**
- [ ] Auf echtem Handy installiert und offline ausprobiert
- [ ] Backup-/Exportfunktion vorhanden (bei Gratis-Diensten kein Luxus)
- [ ] Ein Update deployt und geprüft, dass es wirklich ankommt
