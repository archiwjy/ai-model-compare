# 데이터 수집기 전체 흐름(collect.py) 시험 — 기관 응답을 가짜로 바꿔 끼우고 처음부터 끝까지 돌려 봄
import json
import math
import os
import shutil
import tempfile
import time
import unittest
from typing import Any
from unittest import mock

import testutil  # noqa: F401
import collect
import sources


def _sig(x):
    return 1 / (1 + math.exp(-x))


def fake_world(n=14):
    """답을 아는 가짜 세상: 모델 n개 × 등급 2개 (high, max)"""
    edi = {f"B{i}": (120 + i * 5.0, 0.12) for i in range(10)}
    obs, info, aa_info = {}, {}, {}
    aa_scores, aa_costs, lb_costs, deep = {}, {}, {}, {}
    for k in range(n):
        base = f"model-{k}"
        for eff, bump, mul in (("high", 0.0, 1.0), ("max", 2.0, 2.2)):
            c = 130 + k * 2.5 + bump
            obs[(base, eff)] = {b: _sig(s * (c - d)) for b, (d, s) in edi.items()}
            aa_scores[(base, eff)] = {"raw": f"Model {k} ({eff})", "score": (c - 130) / 0.6, "ci": 1.0}
            lb_costs[(base, eff)] = 0.05 * (k + 1) * mul
            aa_costs[(base, eff)] = lb_costs[(base, eff)] * 5.0
            deep[(base, eff)] = lb_costs[(base, eff)] * 12.0
        info[base] = {"name": f"Model {k}", "company": "Anthropic" if k % 2 else "OpenAI", "date": f"2026-0{1 + k % 9}-01",
                      "eci": 132 + k * 2.5, "group": f"Model {k}"}
        aa_info[base] = {"company": "Anthropic" if k % 2 else "OpenAI", "date": f"2026-0{1 + k % 9}-01"}
    return {
        "epoch": {"obs": obs, "edi": edi, "info": info, "costs": {"DeepSWE": deep}, "updated": "2026-10-01"},
        "aa": {"scores": aa_scores, "costs": aa_costs, "speed": {}, "info": aa_info, "updated": "2026-10-01", "version": 4.3},
        "livebench": {"scores": {}, "costs": lb_costs, "updated": "2026-09-20"},
        "openrouter": {"prices": {f"model-{k}": {"id": f"x/model-{k}", "in": 1.0, "out": 4.0, "name": f"X: Model {k}", "created": "2026-01-01",
                                                  "efforts": ["high", "max"], "default_effort": "high", "reasoning_mandatory": True} for k in range(n)},
                       "updated": "2026-10-01"},
    }


def _boom(*_a, **_k):
    raise RuntimeError("가짜 실패")


class Pipeline(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="collect_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.paths = {
            "OUT_JS": os.path.join(self.dir, "data.js"),
            "OUT_JSON": os.path.join(self.dir, "data.json"),
            "LAST_GOOD": os.path.join(self.dir, "last_good.json"),
        }
        for k, v in self.paths.items():
            p = mock.patch.object(collect, k, v)
            p.start()
            self.addCleanup(p.stop)
        self.world = fake_world()

    def run_main(self, fail=()):
        w = self.world
        patches: dict[str, Any] = {
            "load_openrouter": (lambda: w["openrouter"]),
            "load_epoch": (lambda ex: w["epoch"]),
            "load_livebench": (lambda ex: w["livebench"]),
            "load_aa": (lambda ex: w["aa"]),
        }
        for name in fail:
            patches[name] = _boom
        with mock.patch.multiple(sources, **patches), mock.patch("builtins.print"):
            code = collect.main()
        out = None
        if os.path.exists(self.paths["OUT_JSON"]):
            with open(self.paths["OUT_JSON"], encoding="utf-8") as f:
                out = json.load(f)
        return code, out

    def test_full_run_schema(self):
        code, d = self.run_main()
        self.assertEqual(code, 0)
        self.assertTrue(collect.healthy(d))
        for k in ("generated", "sources", "cost_sources", "effort_ladder", "effort_ko", "effort_order", "models", "health"):
            self.assertIn(k, d)
        self.assertEqual(len(d["models"]), 14)
        for m in d["models"]:
            self.assertTrue(m["key"] and m["name"] and m["company"])
            self.assertEqual([v["effort"] for v in m["variants"]], ["high", "max"])
            for v in m["variants"]:
                self.assertTrue(set(v["src"]) <= {"epoch", "aa"})
                for s in v["src"].values():
                    self.assertTrue(math.isfinite(s["m"]) and s["var"] > 0)
                if "cost" in v:
                    self.assertGreater(v["cost"], 0)
                    self.assertIn(v["cost_kind"], ("측정", "등급 환산", "가격 추정"))
        # data.js 는 브라우저가 읽는 형식
        with open(self.paths["OUT_JS"], encoding="utf-8") as f:
            js = f.read()
        self.assertTrue(js.startswith("window.MODEL_DATA=") and js.rstrip().endswith(";"))
        self.assertEqual(json.loads(js[len("window.MODEL_DATA="):].rstrip().rstrip(";")), d)

    def test_scores_follow_truth(self):
        _, d = self.run_main()
        best = {m["key"]: max(v["src"]["epoch"]["m"] for v in m["variants"] if "epoch" in v["src"]) for m in d["models"]}
        order = sorted(best, key=lambda k: best[k])
        self.assertEqual(order[0], "model-0")
        self.assertEqual(order[-1], "model-13")

    def test_costs_in_livebench_unit(self):
        _, d = self.run_main()
        m = next(x for x in d["models"] if x["key"] == "model-3")
        hi = next(v for v in m["variants"] if v["effort"] == "high")
        self.assertAlmostEqual(hi["cost"], 0.05 * 4, delta=1e-4)

    def test_missing_livebench_keeps_cost_unit(self):
        # 오늘 LiveBench 가 실패해도 비용 단위(문제 1개 기준)는 어제와 같아야 함 → 비용이 갑자기 5배로 뛰면 안 됨
        _, d1 = self.run_main()
        _, d2 = self.run_main(fail=("load_livebench",))
        c1 = {(m["key"], v["effort"]): v["cost"] for m in d1["models"] for v in m["variants"] if "cost" in v}
        c2 = {(m["key"], v["effort"]): v["cost"] for m in d2["models"] for v in m["variants"] if "cost" in v}
        self.assertTrue(c2)
        for k, v in c2.items():
            self.assertAlmostEqual(v / c1[k], 1.0, delta=0.02, msg=str(k))

    def test_aa_failure_uses_last_good(self):
        _, good = self.run_main()
        shutil.copy(self.paths["OUT_JSON"], self.paths["LAST_GOOD"])
        os.remove(self.paths["OUT_JSON"])
        code, d = self.run_main(fail=("load_aa",))
        self.assertEqual(code, 0)
        self.assertTrue(d["health"]["using_previous"])
        self.assertIn("Artificial Analysis", d["health"]["failed"])
        self.assertEqual(len(d["models"]), len(good["models"]))

    def test_old_last_good_is_not_used(self):
        _, good = self.run_main()
        good["generated"] = time.strftime("%Y-%m-%d %H:%M", time.localtime(time.time() - 9 * 86400))
        with open(self.paths["LAST_GOOD"], "w", encoding="utf-8") as f:
            json.dump(good, f, ensure_ascii=False)
        os.remove(self.paths["OUT_JSON"])
        code, d = self.run_main(fail=("load_aa",))
        self.assertEqual(code, 0)
        self.assertFalse(d["health"].get("using_previous"))
        self.assertFalse(d["sources"]["aa"]["ok"])

    def test_epoch_failure_stops_without_breaking_files(self):
        _, good = self.run_main()
        code, d = self.run_main(fail=("load_epoch",))
        self.assertEqual(code, 1)
        self.assertEqual(d, good)         # 화면 파일은 그대로

    def test_openrouter_failure_is_not_fatal(self):
        code, d = self.run_main(fail=("load_openrouter",))
        self.assertEqual(code, 0)
        self.assertIn("OpenRouter", d["health"]["failed"])

    def test_write_is_atomic(self):
        # 쓰는 도중 실패해도 예전 파일이 반쯤 지워진 채로 남지 않아야 함
        self.run_main()
        with open(self.paths["OUT_JSON"], encoding="utf-8") as f:
            before = f.read()
        with mock.patch("json.dumps", side_effect=ValueError("쓰기 실패")), self.assertRaises(ValueError):
            collect.write_data({"x": 1})
        with open(self.paths["OUT_JSON"], encoding="utf-8") as f:
            self.assertEqual(f.read(), before)


class Healthy(unittest.TestCase):
    def test_odd_inputs(self):
        odd: list[Any] = [None, {}, {"sources": None}, {"sources": {"epoch": None, "aa": None}}, {"sources": {"epoch": {"ok": True, "count": 3}}},
                  {"sources": {"epoch": {"ok": True, "count": 0}, "aa": {"ok": True, "count": 5}}}, "문자열", 5, []]
        for d in odd:
            with self.subTest(d=d):
                self.assertFalse(collect.healthy(d))

    def test_ok(self):
        self.assertTrue(collect.healthy({"sources": {"epoch": {"ok": True, "count": 3}, "aa": {"ok": True, "count": 5}}}))


class PreviousGood(unittest.TestCase):
    def test_broken_files_are_ignored(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        a, b = os.path.join(d, "a.json"), os.path.join(d, "b.json")
        with open(a, "w", encoding="utf-8") as f:
            f.write("{망가짐")
        with open(b, "w", encoding="utf-8") as f:
            f.write("[1, 2]")
        with mock.patch.object(collect, "OUT_JSON", a), mock.patch.object(collect, "LAST_GOOD", b):
            self.assertIsNone(collect.previous_good())


if __name__ == "__main__":
    unittest.main()
