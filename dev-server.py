"""Lokaler Testserver fuer die Portfolio-App.

    python dev-server.py          -> http://localhost:8000

Liefert die App-Dateien aus und spielt unter /yahoo/... denselben Kurs-Proxy
wie der Cloudflare-Worker. So funktionieren Suche und Live-Kurse auch lokal,
ohne dass der Worker schon eingerichtet ist.
"""
import http.server
import socketserver
import urllib.request
import urllib.error
import re

PORT = 8000
UPSTREAM = "https://query1.finance.yahoo.com"
ALLOWED = [re.compile(r"^/v1/finance/search$"), re.compile(r"^/v8/finance/chart/[A-Za-z0-9.\-_=^%]+$")]


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Wie GitHub Pages ohne Zwischenspeicher – beim Entwickeln will man frischen Code
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/yahoo/"):
            return self.proxy(self.path[len("/yahoo"):])
        return super().do_GET()

    def proxy(self, rest):
        path = rest.split("?", 1)[0]
        if not any(r.match(path) for r in ALLOWED):
            self.send_error(404, "Pfad nicht erlaubt")
            return
        req = urllib.request.Request(UPSTREAM + rest, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                body, status = res.read(), res.status
        except urllib.error.HTTPError as err:
            body, status = err.read(), err.code
        except Exception as err:  # Netz weg o. ae.
            self.send_error(502, str(err))
            return
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print(f"Portfolio laeuft auf http://localhost:{PORT}  (Ctrl+C beendet)")
        httpd.serve_forever()
