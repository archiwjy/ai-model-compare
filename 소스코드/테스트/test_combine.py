# 종합 점수·비용 계산(combine.py) 시험 — 답을 아는 가짜 데이터로 계산이 맞는지 확인
import math
import random
import statistics
import unittest
from typing import ClassVar
from unittest import mock

import testutil  # noqa: F401
import combine


def _p(c, d, s):
    return combine._sig(s * (c - d))


class FitOne(unittest.TestCase):
    def test_sigmoid_never_overflows(self):
        for x in (-1e9, -41, -40, 0, 40, 41, 1e9, float("inf"), float("-inf")):
            v = combine._sig(x)
            self.assertTrue(0.0 <= v <= 1.0)

    def test_recovers_known_ability(self):
        # 능력치 150 인 모델의 '정확한' 점수들 → 다시 150 이 나와야 함
        bench = [(120, 0.1), (135, 0.15), (145, 0.12), (150, 0.2), (160, 0.1), (170, 0.15), (155, 0.08), (140, 0.3)]
        for true_c in (110.0, 150.0, 172.5):
            obs = [(_p(true_c, d, s), d, s) for d, s in bench]
            c, h, resid = combine._fit_one(obs)
            with self.subTest(true_c=true_c):
                self.assertAlmostEqual(c, true_c, delta=0.05)
                self.assertGreater(h, 0)
                self.assertLess(resid, 1e-6)

    def test_prior_pulls_when_data_is_weak(self):
        obs = [(0.5, 150, 0.1)]
        c_free, _, _ = combine._fit_one(obs)
        c_pull, _, _ = combine._fit_one(obs, prior=160, lam=10.0)
        self.assertGreater(c_pull, c_free)

    def test_extreme_scores_stay_finite(self):
        for p in (0.0, 1.0):
            c, h, resid = combine._fit_one([(p, 150, 0.1)] * 5)
            self.assertTrue(math.isfinite(c) and math.isfinite(h) and math.isfinite(resid))


class EpochCapability(unittest.TestCase):
    def test_simple(self):
        rnd = random.Random(1)
        edi = {f"b{i}": (110 + i * 4, 0.1 + (i % 3) * 0.05) for i in range(15)}
        obs, info = {}, {}
        for k, true_c in enumerate((130, 145, 160)):
            base = f"m{k}"
            obs[(base, "high")] = {b: min(1, max(0, _p(true_c, d, s) + rnd.uniform(-0.01, 0.01))) for b, (d, s) in edi.items()}
            info[base] = {"eci": true_c}
        out, meta = combine.epoch_capability({"edi": edi, "obs": obs, "info": info})
        for k, true_c in enumerate((130, 145, 160)):
            score, se, n = out[(f"m{k}", "high")]
            self.assertAlmostEqual(score, true_c, delta=1.5)
            self.assertGreater(se, 0)
            self.assertEqual(n, 15)
        self.assertIn("sigma2", meta)

    def test_too_few_benchmarks_dropped(self):
        edi = {"b0": (150, 0.1), "b1": (140, 0.1)}
        out, _ = combine.epoch_capability({"edi": edi, "obs": {("m", "high"): {"b0": 0.5, "b1": 0.6}}, "info": {}})
        self.assertEqual(out, {})

    def test_empty(self):
        out, meta = combine.epoch_capability({"edi": {}, "obs": {}, "info": {}})
        self.assertEqual(out, {})
        self.assertTrue(math.isfinite(meta["sigma2"]))


class Consensus(unittest.TestCase):
    def test_linear_mapping_is_recovered(self):
        # AA 점수 = (Epoch − 130) / 0.6 → 눈금을 맞추면 Epoch 와 같은 값이 돼야 함
        rnd = random.Random(2)
        ep, aa = {}, {}
        for i in range(40):
            c = 135 + i * 0.9
            ep[(f"m{i}", "high")] = (c + rnd.uniform(-0.3, 0.3), 1.0)
            aa[(f"m{i}", "high")] = ((c - 130) / 0.6 + rnd.uniform(-0.3, 0.3), 0.5)
        mapped, info = combine.consensus_scores({"epoch": ep, "aa": aa})
        self.assertTrue(info["aa"]["used"])
        self.assertAlmostEqual(info["aa"]["b"], 0.6, delta=0.03)
        for per in mapped.values():
            self.assertAlmostEqual(per["aa"][0], per["epoch"][0], delta=1.5)

    def test_too_little_overlap(self):
        mapped, info = combine.consensus_scores({"epoch": {("a", "high"): (150.0, 1.0)}, "aa": {("b", "high"): (50.0, 1.0)}})
        self.assertIn(("a", "high"), mapped)
        self.assertNotIn(("b", "high"), mapped)   # 눈금을 못 맞춘 출처는 쓰지 않음
        self.assertFalse(info["aa"]["used"])

    def test_zero_or_missing_error(self):
        mapped, _ = combine.consensus_scores({"epoch": {("a", "high"): (150.0, 0.0), ("b", "high"): (140.0, None)}})
        for per in mapped.values():
            self.assertTrue(math.isfinite(per["epoch"][1]) and per["epoch"][1] > 0)


class FillWithinModel(unittest.TestCase):
    def test_fills_missing_source_from_other_effort(self):
        mapped = {("m", "high"): {"epoch": (160.0, 2.0), "aa": (161.0, 2.0)}, ("m", "low"): {"aa": (150.0, 2.0)}}
        n = combine.fill_within_model(mapped)
        self.assertEqual(n, 1)
        got = list(mapped[("m", "low")]["epoch"])      # (값, 분산, '추정:다른등급')
        self.assertAlmostEqual(float(got[0]), 149.0, delta=0.01)
        self.assertTrue(str(got[2]).startswith("추정:"))

    def test_no_estimate_from_estimate(self):
        mapped = {("m", "a"): {"epoch": (1.0, 1.0, "추정:x")}, ("m", "b"): {"aa": (2.0, 1.0)}}
        self.assertEqual(combine.fill_within_model(mapped), 0)


class Costs(unittest.TestCase):
    def test_combine_converts_to_reference_unit(self):
        lb = {(f"m{i}", "high"): 0.1 * (i + 1) for i in range(6)}
        aa = {k: v * 5.0 for k, v in lb.items()}      # AA 는 같은 일을 5배 단위로 셈
        merged, info = combine.combine_costs({"LiveBench": lb, "Artificial Analysis": aa})
        self.assertAlmostEqual(info["Artificial Analysis"]["factor"], 0.2, delta=1e-6)
        for k, c in lb.items():
            self.assertAlmostEqual(math.exp(merged[k][0]), c, delta=1e-9)

    def test_missing_reference_keeps_unit_with_anchor(self):
        # LiveBench 가 하루 빠져도, 지난번 환산 비율(anchor)이 있으면 같은 단위를 유지 (비용이 갑자기 몇 배로 뛰지 않게)
        aa = {(f"m{i}", "high"): 0.5 * (i + 1) for i in range(6)}
        merged, info = combine.combine_costs({"Artificial Analysis": aa}, anchor={"Artificial Analysis": 0.2})
        for k, c in aa.items():
            self.assertAlmostEqual(math.exp(merged[k][0]), c * 0.2, delta=1e-9)
        self.assertAlmostEqual(info["Artificial Analysis"]["factor"], 0.2, delta=1e-6)

    def test_bad_costs_ignored(self):
        merged, _ = combine.combine_costs({"LiveBench": {("a", "high"): 0.0, ("b", "high"): -1.0, ("c", "high"): float("nan"), ("d", "high"): float("inf"), ("e", "high"): 0.3}})
        self.assertEqual(set(merged), {("e", "high")})

    def test_empty(self):
        merged, info = combine.combine_costs({})
        self.assertEqual(merged, {})
        self.assertIsInstance(info, dict)

    def test_ladder_defaults_without_data(self):
        lad, _counts = combine.effort_ladder({})
        self.assertAlmostEqual(lad["high"], 0.0)
        self.assertLess(lad["low"], lad["high"])
        self.assertLess(lad["high"], lad["max"])
        self.assertTrue(all(math.isfinite(v) for v in lad.values()))

    # 비용 출처끼리 맞물려 예전엔 200번을 돌아도 두 값 사이를 오가던 자료 (로그 비용, 모델 m0~m5)
    OSC: ClassVar[dict[str, dict[str, float]]] = {
        "LiveBench": {"m0": -2.94, "m1": -3.94, "m2": -4.34, "m4": -2.6},
        "Artificial Analysis": {"m0": -3.04, "m1": -4.04, "m2": -4.44, "m3": -2.48, "m4": -2.7},
        "DeepSWE": {"m0": -4.41, "m2": -4.49, "m3": -2.28, "m4": -2.6, "m5": -4.58},
        "CursorBench": {"m1": -3.57, "m2": -3.48, "m3": -2.81, "m4": -2.77, "m5": -4.44},
    }

    def _src(self, names):
        return {s: {(k, "high"): math.exp(v) for k, v in self.OSC[s].items()} for s in names}

    def _worst_mismatch(self, info, names):
        """맞춘 비율이 정말 '고정점'인지: 각 출처 비율 = 다른 출처와의 차이의 가운데값 이어야 함 → 가장 큰 어긋남"""
        off = {s: math.log(v["factor"]) for s, v in info.items()}
        worst = 0.0
        for s in names:
            if info[s].get("ref"):
                continue
            diffs = []
            for k, v in self.OSC[s].items():
                others = [self.OSC[s2][k] + off[s2] for s2 in names if s2 != s and k in self.OSC[s2]]
                if others:
                    diffs.append(sum(others) / len(others) - v)
            worst = max(worst, abs(statistics.median(diffs) - off[s]))
        return worst

    def test_combine_converges_even_without_reference(self):
        # 기준(LiveBench)이 있는 날 → 비율 기록, 기준이 빠진 날 → 기록한 비율로 이어서 맞춤. 두 경우 모두 끝까지 맞춰져야 함
        with mock.patch("builtins.print") as pr:
            _, full = combine.combine_costs(self._src(self.OSC))
            anchor = {s: v["factor"] for s, v in full.items()}
            rest = [s for s in self.OSC if s != "LiveBench"]
            _, info = combine.combine_costs(self._src(rest), anchor=anchor)
        pr.assert_not_called()             # '덜 맞춰짐' 안내가 나오지 않아야 함
        for got, names in ((full, list(self.OSC)), (info, rest)):
            self.assertTrue(all(v.get("converged", True) for v in got.values()))
            self.assertLess(self._worst_mismatch(got, names), 1e-3)   # 예전 방식은 0.03 넘게 어긋난 채 멈춤
        self.assertAlmostEqual(info["Artificial Analysis"]["factor"], full["Artificial Analysis"]["factor"], delta=1e-4)

    def test_combine_reports_when_not_converged(self):
        # 반복 횟수를 다 써도 못 맞추면 멈추지 않고 마지막 값을 쓰되, 기록(converged: False)과 안내를 남김
        with mock.patch.object(combine, "MAX_ITER", 1), mock.patch("builtins.print") as pr:
            _, info = combine.combine_costs(self._src(self.OSC))
        pr.assert_called()
        self.assertIs(info["DeepSWE"]["converged"], False)
        self.assertNotIn("converged", info["LiveBench"])          # 기준 출처는 맞출 것이 없음

    def _ladder_world(self, n_link=0, ratio=20.0):
        """명시 등급(추론 끔·중간·높음)을 잰 모델 10개 + '기본'·'추론 켬'을 잰 모델 10개 (두 묶음은 따로)
        + '추론 끔'과 '추론 켬'을 함께 잰 '잇는 모델' n_link 개 (추론 켬 = 추론 끔 × ratio)"""
        m = {}
        for i in range(10):
            c = 0.01 * (i + 1)
            m[(f"e{i}", "none")] = (math.log(c * (0.15 + 0.01 * i)), ["X"])
            m[(f"e{i}", "medium")] = (math.log(c * 0.6), ["X"])
            m[(f"e{i}", "high")] = (math.log(c), ["X"])
            m[(f"a{i}", "default")] = (math.log(c), ["X"])
            m[(f"a{i}", "thinking")] = (math.log(c * (1.2 + 0.07 * i)), ["X"])
        for j in range(n_link):
            m[(f"link{j}", "none")] = (math.log(0.01), ["X"])
            m[(f"link{j}", "thinking")] = (math.log(0.01 * ratio), ["X"])
        return m

    def test_ladder_one_linking_model_does_not_move_levels(self):
        # 예전: 잇는 모델 하나가 '기본'·'추론 켬' 묶음의 높이를 통째로 정해 배율이 0.26~10배로 흔들렸음
        base, _ = combine.effort_ladder(self._ladder_world())
        for ratio in (2.0, 20.0, 80.0):
            lad, _ = combine.effort_ladder(self._ladder_world(n_link=1, ratio=ratio))
            for e in ("none", "default", "thinking", "high"):
                with self.subTest(ratio=ratio, e=e):
                    self.assertAlmostEqual(lad[e], base[e], delta=0.01)
        # 잇는 모델이 충분하면(3개 이상) 두 묶음을 이어 자료대로 높이를 정함: 추론 켬 ≈ 추론 끔 × 20
        lad, _ = combine.effort_ladder(self._ladder_world(n_link=3, ratio=20.0))
        self.assertAlmostEqual(math.exp(lad["thinking"] - lad["none"]), 20.0, delta=2.0)
        self.assertAlmostEqual(lad["high"], 0.0)
        self.assertLessEqual(lad["none"], lad["medium"])
        self.assertLessEqual(lad["medium"], lad["high"])

    def test_components_need_enough_links(self):
        # 함께 잰 모델이 3개 이상인 등급끼리만 한 묶음 ('추론 끔'+'추론 켬' 모델 하나로는 잇지 않음)
        by_base = {"link": {"none": 0, "thinking": 0}}
        for i in range(3):
            by_base[f"e{i}"] = {"none": 0, "high": 0}
            by_base[f"a{i}"] = {"default": 0, "thinking": 0}
        efforts = ["none", "high", "default", "thinking"]
        self.assertEqual(sorted(map(sorted, combine._components(by_base, efforts))), [["default", "thinking"], ["high", "none"]])
        self.assertEqual(len(combine._components(by_base, efforts, min_links=1)), 1)

    def test_fill_costs_kinds(self):
        merged = {("m", "high"): (math.log(1.0), ["LiveBench"])}
        lad, _ = combine.effort_ladder(merged)
        prices = {"p": {"in": 1.0, "out": 4.0}, "z": {"in": 0.0, "out": 0.0}}
        out, k = combine.fill_costs([("m", "high"), ("m", "max"), ("p", "high"), ("z", "high"), ("q", "turbo")], merged, lad, prices)
        self.assertEqual(out[("m", "high")][1], "측정")
        self.assertEqual(out[("m", "max")][1], "등급 환산")
        self.assertGreater(out[("m", "max")][0], out[("m", "high")][0])
        self.assertEqual(out[("p", "high")][1], "가격 추정")
        self.assertNotIn(("z", "high"), out)      # 가격 0 → 추정하지 않음
        self.assertNotIn(("q", "turbo"), out)     # 근거 없음
        self.assertTrue(math.isfinite(k))


class DropAmbiguous(unittest.TestCase):
    def test_drop(self):
        d = {"s": {("a", "default"): 1, ("a", "high"): 2, ("b", "default"): 3, ("c", "none"): 4, ("c", "default"): 5}}
        combine.drop_ambiguous(d)
        self.assertEqual(set(d["s"]), {("a", "high"), ("b", "default"), ("c", "none"), ("c", "default")})


if __name__ == "__main__":
    unittest.main()
