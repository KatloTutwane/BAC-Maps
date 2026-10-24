"""A demo server for the browser tests: server/server.py on a free port with a
throwaway database, so server/campus.db is never touched.

    with DemoServer() as base:      # base = "http://127.0.0.1:<port>"
        ...
"""
import pathlib, socket, subprocess, sys, tempfile, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


class DemoServer:
    def __enter__(self):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        db = pathlib.Path(tempfile.mkdtemp()) / "campus-test.db"
        launcher = ("import sys, pathlib; sys.path.insert(0, %r); import db; db.DB_PATH = pathlib.Path(%r); "
                    "import server; sys.argv = ['server.py', '--port', '%d']; server.main()") % (str(ROOT / "server"), str(db), port)
        self.proc = subprocess.Popen([sys.executable, "-c", launcher], cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.base = "http://127.0.0.1:%d" % port
        for _ in range(100):
            try:
                urllib.request.urlopen(self.base + "/site/login.html"); break
            except Exception:
                time.sleep(0.1)
        if not (ROOT / "site" / "index.html").exists():
            sys.exit("site/ is not built: run `npm install` and `npm run build` in frontend/ first.")
        return self.base

    def __exit__(self, *exc):
        self.proc.terminate()
