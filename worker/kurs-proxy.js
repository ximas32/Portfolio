/* Kurs-Proxy fuer die Portfolio-App – Cloudflare Worker (Gratis-Plan).

   Warum? Yahoo Finance liefert Kurse und eine ISIN-Suche, erlaubt aber
   keine Abrufe direkt aus dem Browser einer fremden Seite (CORS). Dieser
   Worker reicht genau zwei Yahoo-Endpunkte durch und haengt die noetigen
   CORS-Header an. Er speichert nichts und braucht keine Schluessel.

   Einrichten (einmalig, ca. 5 Minuten):
   1. dash.cloudflare.com -> kostenlos registrieren
   2. Compute (Workers) -> Workers & Pages -> Erstellen -> "Hello World"-Worker
      -> Name z. B. "kurs-proxy" -> Bereitstellen
   3. "Code bearbeiten" -> alles ersetzen durch diese Datei -> Bereitstellen
   4. Die Adresse (https://kurs-proxy.<dein-name>.workers.dev) in
      js/config.js bei QUOTE_PROXY eintragen.

   Gratis-Kontingent: 100 000 Anfragen pro Tag – fuer ein privates
   Portfolio unerreichbar. */

// Nur diese Seiten duerfen den Proxy aus dem Browser nutzen.
const ALLOWED_ORIGINS = [
  'https://ximas32.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
];

// Nur diese Yahoo-Pfade werden durchgereicht – kein offener Proxy.
const ALLOWED_PATHS = [
  /^\/v1\/finance\/search$/,
  /^\/v8\/finance\/chart\/[A-Za-z0-9.\-_=^%]+$/
];

const UPSTREAM = 'https://query1.finance.yahoo.com';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = allowed ? corsHeaders(origin) : {};

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }
    if (request.method !== 'GET') {
      return new Response('Nur GET', { status: 405, headers: cors });
    }
    if (!allowed) {
      return new Response('Herkunft nicht erlaubt', { status: 403 });
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
      return new Response('Pfad nicht erlaubt', { status: 404, headers: cors });
    }

    // Kurze Zwischenspeicherung am Cloudflare-Rand: 60 s fuer Kurse,
    // 1 h fuer die Suche. Schont Yahoo und macht wiederholte Abrufe schnell.
    const ttl = url.pathname.startsWith('/v1/finance/search') ? 3600 : 60;
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; portfolio-app)',
        'Accept': 'application/json'
      },
      cf: { cacheTtl: ttl, cacheEverything: true }
    });

    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
