"""Serve web/ and open the map in your browser. Browser caching is off, so an outdated page or
script is never reused.

    python tools/serve.py                    serve on port 8765 and open the map in the default browser
    python tools/serve.py --browser chrome   open it in a particular browser (chrome, firefox, edge, ...)
    python tools/serve.py --no-browser       only serve (for the preview pane and tests)
    python tools/serve.py --port 9000        another port

If the map is already being served on that port (an earlier run still going), it just opens it.
"""
import argparse, errno, functools, http.server, pathlib, socket, subprocess, sys, threading, webbrowser

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
# Windows program names, for browsers Python's webbrowser module does not know there
WINDOWS_BROWSERS = {"chrome": "chrome", "edge": "msedge", "firefox": "firefox", "brave": "brave", "opera": "opera"}


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):            # keep the run window readable: only report failures
        if args and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = False                     # on Windows reuse would let a second server share the port silently
    daemon_threads = True


def already_serving(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def open_in_browser(url, name):
    if name and sys.platform == "win32" and name.lower() in WINDOWS_BROWSERS:
        # "start" finds installed browsers by their registered program name
        subprocess.Popen(["cmd", "/c", "start", "", WINDOWS_BROWSERS[name.lower()], url])
        return
    try:
        (webbrowser.get(name) if name else webbrowser).open(url)
    except webbrowser.Error:
        print(f"Could not find the browser '{name}', opening the default one instead.")
        webbrowser.open(url)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("port_pos", nargs="?", type=int, help=argparse.SUPPRESS)          # old form: serve.py 8765
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--browser", default="", help="chrome, firefox, edge, ... (default: your default browser)")
    ap.add_argument("--no-browser", action="store_true", help="serve only, do not open a browser")
    a = ap.parse_args()
    port = a.port_pos or a.port
    url = f"http://localhost:{port}/pathfinder.html"
    if already_serving(port):                     # an earlier run is still going: reuse it
        print(f"Port {port} is already serving the map (an earlier run is still going). Opening {url}", flush=True)
        if not a.no_browser:
            open_in_browser(url, a.browser)
        return
    try:
        server = Server(("127.0.0.1", port), functools.partial(NoStore, directory=str(WEB)))
    except OSError as e:
        if e.errno in (errno.EADDRINUSE, errno.EACCES, 10048, 10013):
            sys.exit(f"Port {port} is used by another program. Try: python tools/serve.py --port 8790")
        raise
    print(f"Campus Pathfinder: {url}", flush=True)
    print("Stop with the red square in IntelliJ, or Ctrl+C.", flush=True)
    if not a.no_browser:
        threading.Timer(0.4, open_in_browser, (url, a.browser)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
