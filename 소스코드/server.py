# 성능비교판 도우미 (창 없이 뒤에서 실행)
# - 웹/ 폴더의 화면을 http://127.0.0.1:8770 으로 보여준다 (이 컴퓨터에서만 접속 가능)
# - 화면의 '최신 데이터 받기' 버튼 → /api/refresh → 수집기 실행
# - 화면이 열려 있는 동안 1분마다 신호(/api/ping)를 보낸다.
#   신호가 15분 동안 없으면(창을 닫으면) 스스로 꺼진다. (컴퓨터가 잠들었다 깨어난 직후에는 기다려 줌)
# - 다른 사이트가 몰래 '최신 받기'를 누르게 하거나(CSRF), 주소를 바꿔 끼워 들어오는 것(DNS 리바인딩)은 막는다.
import sys

sys.dont_write_bytecode = True

import io

# 창 없이 실행(pythonw)하면 출력 통로가 없어서, 글자를 출력하는 순간 멈출 수 있다 → 빈 통로 연결
if sys.stdout is None:
    sys.stdout = io.StringIO()
if sys.stderr is None:
    sys.stderr = io.StringIO()

import contextlib
import hashlib
import json
import os
import socket
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "웹")
PORT = 8770
IDLE_LIMIT = 15 * 60         # 이 시간 동안 화면에서 아무 요청이 없으면 종료
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]"}

_last_seen = time.time()
_lock = threading.Lock()     # 수집기는 한 번에 하나만


def _read_data():
    try:
        with open(os.path.join(WEB, "data.json"), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _generated():
    d = _read_data()
    return d.get("generated") if d else None


def _signature():
    """실제 내용(모델 점수·비용·가격)의 지문 — 내용이 바뀌었는지 판단용
    (갱신 시각·점검 시각처럼 매번 바뀌는 값은 빼야 '이미 최신이에요'가 제대로 나옴)"""
    d = _read_data()
    if d is None:
        return None
    core = {k: d.get(k) for k in ("models", "effort_ladder", "cost_sources")}
    return hashlib.sha256(json.dumps(core, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def _health():
    d = _read_data() or {}
    hv = d.get("health")
    h = hv if isinstance(hv, dict) else {}
    return {"failed": [x for x in (h.get("failed") or []) if isinstance(x, str)], "using_previous": bool(h.get("using_previous"))}


def _run_collect(force):
    """수집기 실행 → (성공여부, 마지막 몇 줄)
    도우미가 오래 켜져 있어도 항상 최신 코드로 계산하도록, 실행할 때마다 코드를 새로 불러온다.
    코드·설정 파일 오류가 나도 도우미는 꺼지지 않고, 무엇이 문제인지 한국어로 돌려준다."""
    buf = io.StringIO()
    code = 1
    with contextlib.redirect_stdout(buf):
        try:
            import importlib

            import collect
            import combine
            import names
            import sources
            for mod in (names, sources, combine, collect):
                importlib.reload(mod)
            code = collect.main(force=force)
        except Exception as e:  # noqa: BLE001 — 어떤 오류든 도우미는 살아 있어야 함
            print("오류:", e)
            traceback.print_exc(limit=3, file=buf)
            code = 1
    lines = [ln for ln in buf.getvalue().splitlines() if ln.strip()]
    return code == 0, lines[-8:]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *a):  # 조용히
        pass

    def end_headers(self):
        # data.js 가 옛날 것으로 남지 않게
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _host_ok(self):
        """주소창의 이름이 이 컴퓨터(127.0.0.1·localhost)일 때만 받음 — 다른 사이트 이름으로 들어오는 것(DNS 리바인딩) 막기"""
        host = (self.headers.get("Host") or "").strip().lower()
        name = host.rsplit(":", 1)[0] if not host.startswith("[") else host.split("]")[0] + "]"
        return name in LOCAL_HOSTS

    def _same_site(self):
        """이 화면에서 보낸 요청인지 — 다른 사이트가 몰래 보낸 요청(CSRF)이면 False"""
        if (self.headers.get("Sec-Fetch-Site") or "").lower() in ("cross-site", "same-site"):
            return False
        origin = self.headers.get("Origin")
        if origin:
            o = urlparse(origin)
            if (o.hostname or "") not in {h.strip("[]") for h in LOCAL_HOSTS}:
                return False
        return True

    def do_GET(self):
        global _last_seen
        if not self._host_ok():
            return self._json({"ok": False, "message": "허용되지 않은 주소"}, 403)
        _last_seen = time.time()
        u = urlparse(self.path)
        if u.path.startswith("/api/") and not self._same_site():
            return self._json({"ok": False, "message": "다른 사이트에서 온 요청은 받지 않아요"}, 403)
        if u.path == "/api/ping":
            return self._json({"ok": True, "app": "ai-compare", "generated": _generated(), "busy": _lock.locked()})
        if u.path == "/api/refresh":
            force = parse_qs(u.query).get("force", ["0"])[0] == "1"
            if not _lock.acquire(blocking=False):
                return self._json({"ok": False, "busy": True, "message": "이미 받는 중입니다"})
            try:
                before = _signature()
                ok, tail = _run_collect(force)
                after = _signature()
                return self._json({"ok": ok, "changed": before != after, "generated": _generated(), "log": tail, **_health()})
            finally:
                _lock.release()
        return super().do_GET()

    def do_HEAD(self):
        if not self._host_ok():
            return self._json({"ok": False}, 403)
        return super().do_HEAD()


class Server(ThreadingHTTPServer):
    # 윈도우는 SO_REUSEADDR 가 켜져 있으면 같은 포트에 도우미가 두 개 뜰 수 있음 → 끄고, 독점 사용으로 연다
    allow_reuse_address = False
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _watchdog(server):
    global _last_seen
    prev = time.time()
    while True:
        time.sleep(20)
        now = time.time()
        if now - prev > 90:          # 컴퓨터가 잠들었다 깨어남 → 화면이 다시 신호를 보낼 시간을 줌
            _last_seen = now
        prev = now
        if now - _last_seen > IDLE_LIMIT and not _lock.locked():
            server.shutdown()
            return


def main():
    try:
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        return 1   # 이미 켜져 있음 (또는 다른 프로그램이 이 번호를 씀)
    threading.Thread(target=_watchdog, args=(server,), daemon=True).start()
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
