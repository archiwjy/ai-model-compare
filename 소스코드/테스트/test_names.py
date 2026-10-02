# 모델 이름 정리기(names.py) 시험
import unittest
from typing import ClassVar

import testutil  # noqa: F401  (경로 준비)
import names


class SplitName(unittest.TestCase):
    # 출처마다 다른 이름 → (기본이름, 등급)  — 실제 기관 데이터에서 본 이름들
    KNOWN: ClassVar[dict[str, tuple[str, str]]] = {
        "claude-opus-5-5_max": ("claude-opus-5-5", "max"),
        "claude-opus-5-5-max-effort": ("claude-opus-5-5", "max"),
        "claude-opus-5.5-high": ("claude-opus-5-5", "high"),
        "Claude Opus 5.5 (Adaptive Reasoning, Max Effort)": ("claude-opus-5-5", "max"),
        "anthropic/claude-opus-5.5": ("claude-opus-5-5", "default"),
        "gpt-5.6-sol_proxhigh": ("gpt-5-6-sol-pro", "xhigh"),
        "gpt-5.2-2025-12-11-high": ("gpt-5-2", "high"),
        "claude-opus-4-5-20251101-thinking-64k-high-effort": ("claude-opus-4-5", "high"),
        "qwen3.8-max": ("qwen3-8-max", "default"),
        "qwen3.8-max_high": ("qwen3-8-max", "high"),
        "muse-spark-1.2 (xHigh)": ("muse-spark-1-2", "xhigh"),
        "GPT-5.5 (Non-reasoning)": ("gpt-5-5", "none"),
        "gemini-3-flash (thinking-minimal)": ("gemini-3-flash", "minimal"),
        "claude-sonnet-4-6-thinking-auto-medium-effort": ("claude-sonnet-4-6", "medium"),
        "gpt-5.4-2026-03-05_low": ("gpt-5-4", "low"),
        "claude-sonnet-4-5-20250929-high-32k": ("claude-sonnet-4-5", "high"),
        "grok-4-1-fast-reasoning": ("grok-4-1-fast", "thinking"),
        "deepseek-v4-pro-0813_max": ("deepseek-v4-pro-0813", "max"),
        "kimi-k3": ("kimi-k3", "default"),
        "gpt-6-astra_promax": ("gpt-6-astra-pro", "max"),
        "Gemini 2.5 Flash (Reasoning)": ("gemini-2-5-flash", "thinking"),
        "o3-mini-high": ("o3-mini", "high"),
        "gpt-oss-120b (high)": ("gpt-oss-120b", "high"),
        "nemotron-3-ultra": ("nemotron-3-ultra", "default"),   # ultra 는 이름 끝에선 모델 이름 (등급 아님)
    }

    def test_known_names(self):
        for raw, want in self.KNOWN.items():
            with self.subTest(raw=raw):
                self.assertEqual(names.split_name(raw), want)

    def test_same_model_from_every_source(self):
        # 다섯 출처의 이름이 모두 같은 기본이름으로 모여야 같은 모델로 합쳐짐
        bases = {names.split_name(x)[0] for x in (
            "claude-opus-5-5_max", "claude-opus-5-5-max-effort", "claude-opus-5.5-high",
            "Claude Opus 5.5 (Adaptive Reasoning, Max Effort)", "anthropic/claude-opus-5.5")}
        self.assertEqual(bases, {"claude-opus-5-5"})

    def test_empty_or_meaningless_names_give_none(self):
        # 이름이 비었거나 등급 단어만 있으면 모델로 만들지 않음 (빈 이름의 유령 모델 방지)
        for raw in (None, "", "   ", "(High)", "/", "_max", "-", "...", "()", "max", "high-effort"):
            with self.subTest(raw=raw):
                self.assertEqual(names.split_name(raw), (None, None))

    def test_never_crashes_on_odd_input(self):
        for raw in ("a" * 5000, "((((", "))))", "모델-이름_최대", "gpt\x00-5", "😀-max", "(high)(low)", "x_" * 300, 123, 4.5):
            with self.subTest(raw=str(raw)[:20]):
                base, eff = names.split_name(raw)
                self.assertTrue(base is None or isinstance(base, str))
                self.assertTrue(eff is None or isinstance(eff, str))

    def test_learned_effort_words(self):
        try:
            new = names.learn_efforts(["Turbo", "high", "x", "  ", None, "turbo"])
            self.assertEqual(new, {"turbo"})
            self.assertEqual(names.split_name("some-model_turbo"), ("some-model", "turbo"))
            self.assertEqual(names.learn_efforts(["turbo"]), set())   # 두 번째는 새로 배운 것 아님
        finally:
            names.LEARNED.discard("turbo")


class Company(unittest.TestCase):
    def test_known_companies(self):
        cases = {
            ("Anthropic",): "Anthropic", (None, None, "openai/gpt-5"): "OpenAI", ("google",): "Google",
            ("x-ai",): "xAI", (None, "Moonshot AI"): "Moonshot", ("qwen",): "Alibaba", ("z-ai",): "Zhipu",
        }
        for hints, want in cases.items():
            with self.subTest(hints=hints):
                self.assertEqual(names.company_of(*hints), want)

    def test_keeps_original_capitals(self):
        # 약자·고유 표기는 그대로 (예전: 'SK Telecom' → 'Sk Telecom', 'IBM' → 'Ibm')
        for raw in ("SK Telecom", "IBM", "LG AI Research", "Liquid AI", "AI21 Labs"):
            with self.subTest(raw=raw):
                self.assertEqual(names.company_of(raw), raw)

    def test_lowercase_company_gets_title_case(self):
        self.assertEqual(names.company_of("stepfun"), "Stepfun")

    def test_no_hints(self):
        self.assertEqual(names.company_of(None, "", None), "기타")


class PrettyName(unittest.TestCase):
    def test_pretty(self):
        self.assertEqual(names.pretty_name("claude-opus-5-5"), "Claude Opus 5.5")
        self.assertEqual(names.pretty_name("gpt-6-1-sol"), "GPT-6.1 Sol")
        self.assertEqual(names.pretty_name("glm-5-3"), "GLM-5.3")

    def test_pretty_edge(self):
        self.assertEqual(names.pretty_name(""), "")
        self.assertEqual(names.pretty_name("x"), "X")


class Tables(unittest.TestCase):
    def test_every_effort_has_korean_name(self):
        for e in names.EFFORT_ORDER:
            self.assertIn(e, names.EFFORT_KO)

    def test_effort_order_unique(self):
        self.assertEqual(len(names.EFFORT_ORDER), len(set(names.EFFORT_ORDER)))


if __name__ == "__main__":
    unittest.main()
