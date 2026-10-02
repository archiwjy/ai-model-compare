# 데이터 받아오기(sources.py) 시험 — 인터넷에 접속하지 않고, 기관 응답을 가짜로 만들어 넣는다
#  (형식이 조금 바뀌거나 값이 비어 있어도 전체가 멈추지 않는지가 핵심)
import csv
import io
import json
import math
import os
import time
import unittest
import zipfile
from typing import Any
from unittest import mock

import testutil  # noqa: F401  (경로·임시 캐시 준비)
import sources


def _csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def _stored_zip(body):
    """압축하지 않은(ZIP_STORED) 파일 하나짜리 zip"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("data/a.csv", body)
    return buf.getvalue()


class FakeNet:
    """URL 일부 → 돌려줄 바이트 (없으면 네트워크 오류)"""
    def __init__(self, table):
        self.table = table
        self.calls = []

    def __call__(self, url, name, **kw):
        self.calls.append(url)
        for part, body in self.table.items():
            # 'xxx$' = 주소 끝이 정확히 xxx 일 때만, 그 밖엔 주소에 들어 있으면
            if (url.endswith(part[:-1]) if part.endswith("$") else part in url):
                if isinstance(body, Exception):
                    raise body
                return body if isinstance(body, bytes) else body.encode("utf-8")
        raise OSError("가짜 네트워크: 없는 주소 " + url)


class Num(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(sources._num("1,234.5"), 1234.5)
        self.assertEqual(sources._num("$0.25"), 0.25)
        self.assertEqual(sources._num("12%"), 12.0)
        self.assertEqual(sources._num(3), 3.0)

    def test_rejects_garbage(self):
        odd: list[Any] = [None, "", "abc", "nan", "NaN", "inf", "-inf", float("nan"), float("inf"), [], {}]
        for v in odd:
            with self.subTest(v=v):
                self.assertIsNone(sources._num(v))


class Fetch(unittest.TestCase):
    def setUp(self):
        os.makedirs(sources.CACHE_DIR, exist_ok=True)
        self.path = os.path.join(sources.CACHE_DIR, "t.bin")
        if os.path.exists(self.path):
            os.remove(self.path)

    def test_uses_fresh_cache_without_network(self):
        with open(self.path, "wb") as f:
            f.write(b"cached")
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("인터넷 쓰면 안 됨")):
            self.assertEqual(sources.fetch("http://x", "t.bin"), b"cached")

    def test_falls_back_to_old_file(self):
        with open(self.path, "wb") as f:
            f.write(b"old")
        old = time.time() - 10 * 3600
        os.utime(self.path, (old, old))
        with mock.patch("urllib.request.urlopen", side_effect=OSError("끊김")), mock.patch("time.sleep"):
            self.assertEqual(sources.fetch("http://x", "t.bin"), b"old")

    def test_raises_real_error_when_nothing(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("끊김")), mock.patch("time.sleep"):
            with self.assertRaises(OSError):
                sources.fetch("http://x", "t.bin")
            # 시도 횟수 0 이어도 'None 을 raise' 같은 엉뚱한 오류가 아니라 이해할 수 있는 오류
            with self.assertRaises(OSError):
                sources.fetch("http://x", "t.bin", attempts=0)

    def test_crc_broken_zip_does_not_replace_good_original(self):
        # 압축 파일 속 데이터가 깨졌는데(검사값 불일치) 예전엔 통과시켜 받아 둔 정상 원본을 덮어썼음
        good = _stored_zip(b"model,score\nA,1\n" * 20)
        bad = bytearray(good)
        i = bad.index(b"A,1")
        bad[i] = ord("B")                         # 내용 한 글자만 바꿈 (압축하지 않은 형식이라 그대로 들어 있음)
        with self.assertRaises(zipfile.BadZipFile):
            sources._check_zip(bytes(bad))
        sources._check_zip(good)                  # 멀쩡한 것은 통과
        with open(self.path, "wb") as f:
            f.write(good)
        old = time.time() - 5 * 3600              # 새로 받을 때가 된 (하지만 아직 쓸 수 있는) 원본
        os.utime(self.path, (old, old))
        with mock.patch.object(sources, "_download", return_value=bytes(bad)), mock.patch("time.sleep"):
            got = sources.fetch("http://x", "t.bin", validate=sources._check_zip)
        self.assertEqual(got, good)
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), good)

    def test_cache_name_cannot_escape_folder(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("끊김")), mock.patch("time.sleep"), self.assertRaises((OSError, ValueError)):
            sources.fetch("http://x", "../../밖으로.txt")


class LiveBench(unittest.TestCase):
    TABLE = _csv([{"model": f"model-{i}-high", "t1": 50 + i, "t2": 40 + i, "t3": 30 + i, "t4": 20 + i} for i in range(5)])
    CATS = json.dumps({"a": ["t1"], "b": ["t2"], "c": ["t3"], "d": ["t4"]})
    COST = _csv([{"model": "model-1-high", "cost_per_question": "0.05"}, {"model": "model-2-high", "cost_per_question": "-1"}, {"model": "", "cost_per_question": "0.1"}])

    def test_page_layout_changed_still_works(self):
        # 사이트 첫 화면 구조가 바뀌어 최신 날짜를 못 찾아도 → 알려진 날짜로 받아야 함 (예전엔 변수 오류로 통째로 실패)
        net = FakeNet({"table_2026_06_25": self.TABLE, "categories_2026_06_25": self.CATS, "cost_2026_06_25": self.COST,
                       "livebench.ai/$": "<html>main.js 없음</html>"})
        with mock.patch.object(sources, "fetch", net):
            out = sources.load_livebench([])
        self.assertEqual(out["updated"], "2026-06-25")
        self.assertEqual(len(out["scores"]), 5)
        self.assertEqual(set(out["costs"]), {("model-1", "high")})
        self.assertAlmostEqual(out["costs"][("model-1", "high")], 0.05)

    def test_newest_release_first(self):
        js = b'x="2026-09-20";y="2026-08-01";z="2025-01-01"'
        net = FakeNet({"main.": js, "table_2026_09_20": self.TABLE, "categories_2026_09_20": self.CATS,
                       "livebench.ai/$": b'<script src="/static/js/main.abc.js"></script>'})
        with mock.patch.object(sources, "fetch", net):
            out = sources.load_livebench([])
        self.assertEqual(out["updated"], "2026-09-20")
        self.assertEqual(out["costs"], {})     # 비용 파일 없음 → 비용만 빈 채로

    def test_nothing_available(self):
        with mock.patch.object(sources, "fetch", FakeNet({})), self.assertRaises(RuntimeError):
            sources.load_livebench([])


class AA(unittest.TestCase):
    def page(self, items, more):
        return json.dumps({"data": items, "pagination": {"has_more": more}, "intelligence_index_version": 4.3})

    def test_parse_and_skip_bad(self):
        items = [
            {"name": "Model A (High Effort)", "evaluations": {"artificial_analysis_intelligence_index": 55.5},
             "artificial_analysis_intelligence_index_cost": {"cost_per_task": {"total_cost": 0.3}},
             "performance": {"median_output_tokens_per_second": 80}, "model_creator": {"name": "SK Telecom"}, "release_date": "2026-09-01"},
            {"name": "Model B", "evaluations": {"artificial_analysis_intelligence_index": None}},
            {"name": "", "evaluations": {"artificial_analysis_intelligence_index": 40}},
            {"name": "(High)", "evaluations": {"artificial_analysis_intelligence_index": 40}},
            {"slug": "model-c", "evaluations": {"artificial_analysis_intelligence_index": "45"},
             "artificial_analysis_intelligence_index_cost": {"cost_per_task": {"total_cost": "abc"}}},
            {"name": "Model D", "evaluations": None, "model_creator": None},
            "망가진 항목",
        ]
        net = FakeNet({"page=1": self.page(items, False)})
        with mock.patch.object(sources, "fetch", net), mock.patch.object(sources, "aa_key", return_value="k"):
            out = sources.load_aa([])
        self.assertEqual(set(out["scores"]), {("model-a", "high"), ("model-c", "default")})
        self.assertEqual(out["costs"], {("model-a", "high"): 0.3})
        self.assertEqual(out["info"]["model-a"]["company"], "SK Telecom")
        self.assertEqual(out["version"], 4.3)

    def test_pages_stop(self):
        item = {"name": "M", "evaluations": {"artificial_analysis_intelligence_index": 50}}
        net = FakeNet({"page=1": self.page([item], True), "page=2": self.page([], True)})
        with mock.patch.object(sources, "fetch", net), mock.patch.object(sources, "aa_key", return_value="k"):
            sources.load_aa([])
        self.assertLessEqual(len(net.calls), 3)   # 빈 페이지에서 멈춤 (has_more 가 계속 True 여도)

    def test_no_key(self):
        with mock.patch.object(sources, "aa_key", return_value=None), self.assertRaises(RuntimeError):
            sources.load_aa([])


class OpenRouter(unittest.TestCase):
    def test_parse(self):
        data = {"data": [
            {"id": "anthropic/claude-opus-5.5", "name": "Anthropic: Claude Opus 5.5", "pricing": {"prompt": "0.000004", "completion": "0.00002"},
             "created": 1758000000, "reasoning": {"supported_efforts": ["low", "high"], "default_effort": "high", "mandatory": True}},
            {"id": "x/free", "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "x/neg", "pricing": {"prompt": "-1", "completion": "0.1"}},
            {"id": "x/bad", "pricing": {"prompt": "abc"}},
            {"id": "~alias/model", "pricing": {"prompt": "1", "completion": "1"}},
            {"id": "x/m:free", "pricing": {"prompt": "1", "completion": "1"}},
            {"id": "x/weird", "pricing": None, "created": "어제"},
            {"id": "x/ts", "pricing": {"prompt": "0.000001", "completion": "0.000001"}, "created": "어제", "reasoning": None},
            {"pricing": {"prompt": "1", "completion": "1"}},
            None,
        ]}
        with mock.patch.object(sources, "fetch", FakeNet({"openrouter": json.dumps(data)})):
            out = sources.load_openrouter()["prices"]
        p = out["claude-opus-5-5"]
        self.assertAlmostEqual(p["in"], 4.0)
        self.assertAlmostEqual(p["out"], 20.0)
        self.assertEqual(p["efforts"], ["low", "high"])
        self.assertTrue(p["reasoning_mandatory"])
        self.assertIn("ts", out)
        self.assertIsNone(out["ts"]["created"])
        self.assertNotIn("free", out)
        self.assertNotIn("neg", out)

    def test_huge_values_skip_only_that_row(self):
        # 100만 배 하면 무한대가 되는 가격·변환할 수 없는 등록 시각 → 그 줄(또는 날짜)만 건너뛰고 나머지는 받음
        #  (예전엔 무한대 가격이 그대로 들어가 data.js 쓰기가 통째로 실패할 수 있었음)
        data = {"data": [
            {"id": "x/huge", "pricing": {"prompt": "1e303", "completion": "0.000001"}},
            {"id": "x/future", "pricing": {"prompt": "0.000001", "completion": "0.000002"}, "created": 1e20},
            {"id": "x/past", "pricing": {"prompt": "0.000001", "completion": "0.000002"}, "created": -5},
            {"id": "x/ok", "pricing": {"prompt": "0.000001", "completion": "0.000002"}, "created": 1758000000},
        ]}
        with mock.patch.object(sources, "fetch", FakeNet({"openrouter": json.dumps(data)})):
            out = sources.load_openrouter()["prices"]
        self.assertNotIn("huge", out)
        self.assertEqual(set(out), {"future", "past", "ok"})
        self.assertIsNone(out["future"]["created"])
        self.assertIsNone(out["past"]["created"])
        self.assertEqual(out["ok"]["created"], "2025-09-16")
        for p in out.values():
            self.assertTrue(math.isfinite(p["in"]) and math.isfinite(p["out"]))
        json.dumps(out, allow_nan=False)          # 그대로 파일로 쓸 수 있어야 함

    def test_created_date_odd_values(self):
        for v in (None, "어제", 0, -1, 4e9, 1e300, float("inf"), float("nan"), True):
            with self.subTest(v=v):
                self.assertIsNone(sources._created_date(v))
        with mock.patch("time.gmtime", side_effect=OSError("변환 실패")):
            self.assertIsNone(sources._created_date(1758000000))


class Epoch(unittest.TestCase):
    def make_zip(self, bad=False):
        files = {
            "edi_scores.csv": _csv([{"benchmark_name": f"B{i}", "edi": str(120 + i * 5), "estimated_slope_scaled": "0.12"} for i in range(10)]
                                   + ([{"benchmark_name": "Bad", "edi": "", "estimated_slope_scaled": "x"}] if bad else [])),
            "benchmark_metadata.csv": _csv([{"benchmark": f"B{i}", "source_file": f"b{i}.csv", "score_column": "score", "scale": "1",
                                             "random_baseline": "0", "score_ceiling": "1"} for i in range(10)]
                                           + ([{"benchmark": "Bad", "source_file": "bad.csv", "score_column": "score", "scale": "x", "random_baseline": "", "score_ceiling": "0"}] if bad else [])),
            "model_metadata.csv": _csv([{"model_version": "model-a_high", "model_group": "Model A", "organization": "Lab", "date": "2026-09-01"}]),
            "eci_scores.csv": _csv([{"Model": "Model A", "eci": "150", "Display name": "Model A", "date": "2026-09-01"}]),
            "deepswe_external.csv": _csv([{"Model version": "model-a_high", "Mean cost (USD)": "1.5"}, {"Model version": "model-a_high", "Mean cost (USD)": "0"}]),
        }
        for i in range(10):
            files[f"b{i}.csv"] = _csv([{"Model version": "model-a_high", "score": str(0.1 * i)}, {"Model version": "", "score": "0.5"},
                                       {"Model version": "model-b_unknown", "score": "0.3"}])
        if bad:
            files["bad.csv"] = _csv([{"Model version": "model-a_high", "score": "0.5"}])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for n, t in files.items():
                z.writestr("data/" + n, t)
        return buf.getvalue()

    def test_parse(self):
        with mock.patch.object(sources, "fetch", FakeNet({"epoch.ai": self.make_zip()})):
            out = sources.load_epoch([])
        self.assertEqual(len(out["obs"][("model-a", "high")]), 10)
        self.assertEqual(out["info"]["model-a"]["eci"], 150.0)
        self.assertEqual(set(out["costs"]["DeepSWE"]), {("model-a", "high")})
        self.assertAlmostEqual(out["costs"]["DeepSWE"][("model-a", "high")], 1.5)
        self.assertNotIn(("model-b", "unknown"), out["obs"])

    def test_bad_rows_are_skipped_not_fatal(self):
        # 한 벤치마크 줄의 숫자가 비어 있어도 나머지는 그대로 받아야 함
        with mock.patch.object(sources, "fetch", FakeNet({"epoch.ai": self.make_zip(bad=True)})):
            out = sources.load_epoch([])
        self.assertEqual(len(out["obs"][("model-a", "high")]), 10)

    def test_broken_zip(self):
        with mock.patch.object(sources, "fetch", FakeNet({"epoch.ai": b"PK not a zip"})), self.assertRaises(Exception) as cm:
            sources.load_epoch([])
        self.assertNotIsInstance(cm.exception, (NameError, UnboundLocalError, TypeError))


class Excluded(unittest.TestCase):
    def test_excluded(self):
        self.assertTrue(sources._excluded("GPT-5 Preview", ["preview"]))
        self.assertFalse(sources._excluded("GPT-5", ["preview"]))
        self.assertFalse(sources._excluded("", []))


if __name__ == "__main__":
    unittest.main()
