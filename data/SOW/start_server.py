#!/usr/bin/env python3
"""
Simple HTTP server for SOW Analysis Website.
Serves files from the data/SOW/ directory.

Usage:
    python start_server.py

Then open: http://localhost:8080/website/index.html
"""

import http.server
import socketserver
import os
import sys

PORT = 8080
SERVE_DIR = os.path.dirname(os.path.abspath(__file__))


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SERVE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress noisy logs, only show errors
        if args[1] not in ("200", "304"):
            super().log_message(format, *args)


def main():
    os.chdir(SERVE_DIR)
    print(f"Serving SOW Analysis from: {SERVE_DIR}")
    print(f"Open your browser at: http://localhost:{PORT}/website/index.html")
    print("Press Ctrl+C to stop.\n")

    with socketserver.TCPServer(("", PORT), CORSHandler) as httpd:
        httpd.allow_reuse_address = True
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)


if __name__ == "__main__":
    main()
