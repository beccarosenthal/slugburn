#!/usr/bin/env python3
"""Static dev server for Slugburn.

Identical to `python3 -m http.server` except that it refuses to let anything
be cached. Browsers cache ES modules aggressively, and a stale module means
edits appear to do nothing — worse, tests.html reports a green run against
code you already changed. no-store costs nothing locally and removes a whole
category of confusing debugging.
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"Slugburn  →  http://localhost:{PORT}")
    print(f"tests     →  http://localhost:{PORT}/tests.html")
    ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
