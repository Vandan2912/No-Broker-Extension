#!/usr/bin/env python3
"""Static file server with one extra route: GET /api/property/<id> proxies
to NoBroker's public property-detail API server-side, so the browser page
(served from this same origin) can fetch it without hitting NoBroker's
*.nobroker.in-only CORS policy."""

import http.server
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

PROPERTY_ID_RE = re.compile(r"^[0-9a-f]{32}$", re.IGNORECASE)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/property/"):
            self.handle_property_proxy()
        else:
            super().do_GET()

    def handle_property_proxy(self):
        property_id = self.path[len("/api/property/"):].split("?")[0]
        if not PROPERTY_ID_RE.match(property_id):
            self.send_json_error(400, "Invalid property id")
            return

        url = f"https://www.nobroker.in/api/v3/property/{property_id}?nbFr=list-rent"
        req = urllib.request.Request(
            url,
            headers={
                "X-Request-Id": str(uuid.uuid4()),
                "X-User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Referer": f"https://www.nobroker.in/property/x/{property_id}/detail",
                "X-Request-Device-Timezone": "Asia/Calcutta",
                "X-Origin": "nb-search",
                "Accept": "application/json",
                "X-Request-Timeout": "3000",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            body = e.read()
            status = e.code
        except Exception as e:
            self.send_json_error(502, f"Upstream request failed: {e}")
            return

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json_error(self, status, message):
        body = f'{{"error": "{message}"}}'.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8123))
    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving on port {port}")
    server.serve_forever()
