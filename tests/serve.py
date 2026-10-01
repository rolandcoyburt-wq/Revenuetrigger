"""Local-only static preview with Cloudflare-style clean HTML paths."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[1] / 'frontend/public')
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        from urllib.parse import urlsplit
        path=urlsplit(self.path).path
        if path != '/' and not Path('.'+path).suffix and Path('.'+path+'.html').is_file():
            self.path=path+'.html'
        super().do_GET()
ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
