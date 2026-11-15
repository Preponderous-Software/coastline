"""Serves Coastline's web/ folder on this PC only (127.0.0.1), with the right
types for .js and .wasm (Windows' registry often says text/plain for .js) and
no caching, so the browser always runs the files just copied.

    py -3 tools/serve.py <web dir> [port] [--open URL]
"""
import functools, http.server, sys, threading, webbrowser


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".css": "text/css"})

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    args = [a for a in sys.argv[1:]]
    url = None
    if "--open" in args:
        i = args.index("--open"); url = args[i + 1]; del args[i:i + 2]
    root = args[0] if args else "web"
    port = int(args[1]) if len(args) > 1 else 8784
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=root))
    print(f"Coastline is at http://127.0.0.1:{port}/  (close this window to stop it)")
    if url:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
