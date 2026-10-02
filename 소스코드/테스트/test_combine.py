# 종합 점수·비용 계산(combine.py) 시험 — 답을 아는 가짜 데이터로 계산이 맞는지 확인
import math
import random
import unittest

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
