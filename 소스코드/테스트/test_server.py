# 로컬 도우미(server.py) 시험 — 실제로 작은 서버를 띄워 요청을 보내 봄
import http.client
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from typing import Any
from unittest import mock

import testutil  # noqa: F401
import server


class Helper(unittest.TestCase):
    dir: str
    web: str
    p: Any
    httpd: ThreadingHTTPServer
    port: int

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix="srv_")
        cls.web = os.path.join(cls.dir, "웹")
        os.makedirs(cls.web)
        with open(os.path.join(cls.web, "index.html"), "w", encoding="utf-8") as f:
            f.write("<!doctype html><title>시험</title>")
        with open(os.path.join(cls.web, "data.json"), "w", encoding="utf-8") as f:
            json.dump({"generated": "2026-10-02 18:00", "models": []}, f)
        with open(os.path.join(cls.dir, "비밀.txt"), "w", encoding="utf-8") as f:
            f.write("밖의 파일")
        cls.p = mock.patch.object(server, "WEB", cls.web)
        cls.p.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.p.stop()
        shutil.rmtree(cls.dir, True)

    def get(self, path, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", path, headers=headers or {})
        r = c.getresponse()
        body = r.read()
        c.close()
        return r.status, body, dict(r.getheaders())

    def test_ping(self):
        st, body, hd = self.get("/api/ping")
        self.assertEqual(st, 200)
        d = json.loads(body)
        self.assertEqual(d["app"], "ai-compare")
        self.assertEqual(d["generated"], "2026-10-02 18:00")
        self.assertIn("no-store", hd.get("Cache-Control", ""))

    def test_static(self):
        st, body, _ = self.get("/index.html")
        self.assertEqual(st, 200)
        self.assertIn("시험".encode(), body)

    def test_no_path_escape(self):
        for p in ("/../%EB%B9%84%EB%B0%80.txt", "/%2e%2e/%EB%B9%84%EB%B0%80.txt", "/..%2f%EB%B9%84%EB%B0%80.txt", "/%5c..%5c%EB%B9%84%EB%B0%80.txt"):
            with self.subTest(p=p):
                _st, body, _ = self.get(p)
                self.assertNotIn("밖의 파일".encode(), body)

    def test_refresh_from_other_site_is_blocked(self):
        # 다른 사이트가 몰래 '최신 받기'를 누르게 하는 공격(CSRF) 막기
        with mock.patch.object(server, "_run_collect", return_value=(True, [])) as run:
            for hd in ({"Sec-Fetch-Site": "cross-site"}, {"Origin": "https://evil.example"}, {"Host": "evil.example"}):
                with self.subTest(hd=hd):
                    st, _, _ = self.get("/api/refresh", hd)
                    self.assertEqual(st, 403)
            run.assert_not_called()

    def test_refresh_same_site(self):
        with mock.patch.object(server, "_run_collect", return_value=(True, ["완료"])):
            st, body, _ = self.get("/api/refresh?force=1", {"Sec-Fetch-Site": "same-origin"})
        self.assertEqual(st, 200)
        d = json.loads(body)
        self.assertTrue(d["ok"])
        self.assertFalse(d["changed"])

    def test_only_one_refresh_at_a_time(self):
        def slow(force):
            time.sleep(0.6)
            return True, []
        out = []
        with mock.patch.object(server, "_run_collect", side_effect=slow):
            ts = [threading.Thread(target=lambda: out.append(json.loads(self.get("/api/refresh")[1]))) for _ in range(2)]
            for t in ts:
                t.start()
                time.sleep(0.1)
            for t in ts:
                t.join()
        self.assertEqual(sorted(bool(d.get("busy")) for d in out), [False, True])

    def test_collect_crash_keeps_helper_alive(self):
        with mock.patch("collect.main", side_effect=RuntimeError("계산 실패")), mock.patch("importlib.reload", side_effect=lambda m: m):
            ok, tail = server._run_collect(False)
        self.assertFalse(ok)
        self.assertTrue(any("계산 실패" in x for x in tail))


if __name__ == "__main__":
    unittest.main()
