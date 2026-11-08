#!/usr/bin/env python3
"""Loopback-network-only HTTPS server for reviewed local release archives."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl


class ArchiveHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="/srv/archives", **kwargs)

    def log_message(self, fmt, *args):
        # Request paths contain only fixed archive names in this drill.
        print(f"local-release-archive: {fmt % args}", flush=True)


server = ThreadingHTTPServer(("0.0.0.0", 8443), ArchiveHandler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.minimum_version = ssl.TLSVersion.TLSv1_2
context.load_cert_chain("/tls/cert.pem", "/tls/key.pem")
server.socket = context.wrap_socket(server.socket, server_side=True)
print(f"Serving {len(list(Path('/srv/archives').glob('*.tar.gz')))} reviewed archives on https://archive:8443", flush=True)
server.serve_forever()
