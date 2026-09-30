# 모델 이름 정리기
# 출처마다 같은 모델을 다르게 부른다. 예)
#   Epoch       claude-opus-5-5_max
#   LiveBench   claude-opus-5-5-max-effort
#   LMArena     claude-opus-5.5-high
#   AA          Claude Opus 5.5 (Adaptive Reasoning, Max Effort)
#   OpenRouter  anthropic/claude-opus-5.5
# 이것들을 (기본이름, 추론등급) 한 쌍으로 통일한다.  → ("claude-opus-5-5", "max")

import json
import os
import re

# 추론 등급 순서 (낮은 것 → 높은 것). 선으로 이을 때 이 순서를 쓴다.
EFFORT_ORDER = ["none", "minimal", "low", "medium", "default", "thinking", "high", "xhigh", "max", "promax", "ultra"]

# 화면에 보여줄 한국어 이름
EFFORT_KO = {
    "none": "추론 끔",
    "minimal": "최소",
    "low": "낮음",
    "medium": "중간",
    "default": "기본",
    "thinking": "추론 켬",
    "high": "높음",
    "xhigh": "매우 높음",
    "max": "최대",
    "promax": "프로 최대",
    "ultra": "울트라 (여러 에이전트)",
}

# 이름 속 단어 → 추론 등급
_EFFORT_WORDS = {
    "none": "none", "nothinking": "none", "non-reasoning": "none", "nonreasoning": "none",
    "no-thinking": "none", "noreasoning": "none",
    "minimal": "minimal",
    "low": "low", "lowthinking": "low",
    "medium": "medium", "med": "medium", "mediumthinking": "medium",
    "high": "high", "highthinking": "high",
    "xhigh": "xhigh", "extra-high": "xhigh", "extrahigh": "xhigh", "x-high": "xhigh",
    "max": "max", "maximum": "max",
    "promax": "promax",
}

# OpenRouter 공식 등급 목록 등에서 배운 '처음 보는 등급 이름' (예: 회사가 새 등급을 만들면 자동으로 인식)
#  · 이름 끝의 '-단어' 로는 쓰지 않음 (Nemotron 3 Ultra 처럼 모델 이름일 수 있어서)
LEARNED = set()


def learn_efforts(words):
    """새 등급 이름 배우기 → 처음 보는 것만 돌려줌"""
    new = set()
    for w in words or []:
        w = str(w).strip().lower()
        if re.fullmatch(r"[a-z]{2,15}", w) and w not in _EFFORT_WORDS and w not in EFFORT_ORDER and w not in LEARNED:
            LEARNED.add(w)
            new.add(w)
    return new


# 등급 정보는 아니지만 이름 끝에 붙는 군더더기
_NOISE_WORDS = {"effort", "auto", "adaptive", "latest", "default", "fallback", "reasoning-effort"}
_THINK_WORDS = {"thinking", "reasoning", "think"}

_DATE8 = re.compile(r"-?(20\d{2})(\d{2})(\d{2})$")        # -20251101
_DATE_DASH = re.compile(r"-(20\d{2})-(\d{2})-(\d{2})")     # -2025-12-11
_BUDGET = re.compile(r"^\d+k$")                           # 16k, 64k (생각 토큰 한도)

_ALIAS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "이름_보정표.json")
try:
    with open(_ALIAS_PATH, encoding="utf-8") as f:
        _ALIAS = json.load(f)
except (OSError, ValueError):
    _ALIAS = {}

# 'max'가 등급이 아니라 모델 이름의 일부인 경우 (예: Qwen3.8-Max)
_MAX_IS_NAME = [re.compile(p) for p in _ALIAS.get("max가_이름인_모델", [r"^qwen[\d.\-]*$"])]
_BASE_ALIAS = _ALIAS.get("기본이름_별칭", {})


def _slug(s):
    """소문자 + 점/밑줄/공백 → 하이픈"""
    s = s.lower().strip()
    s = re.sub(r"[\s_.:]+", "-", s)
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def _effort_from_text(text):
    """괄호 속 글 같은 자유 문장에서 등급 찾기. 예: 'Adaptive Reasoning, Max Effort' → max"""
    t = text.lower()
    if re.search(r"non[- ]?reasoning|no[- ]?thinking|thinking[- ]?off", t):
        return "none"
    for word, eff in [("ultra", "ultra"), ("promax", "promax"), ("xhigh", "xhigh"), ("extra high", "xhigh"), ("extra-high", "xhigh"),
                      ("maximum", "max"), ("max", "max"), ("minimal", "minimal"), ("medium", "medium"),
                      ("high", "high"), ("low", "low"), ("none", "none")]:
        if re.search(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])", t):
            return eff
    for word in sorted(LEARNED):
        if re.search(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])", t):
            return word
    if re.search(r"reasoning|thinking", t):
        return "thinking"
    return None


def split_name(raw):
    """아무 출처의 모델 이름 → (기본이름, 등급). 등급을 모르면 'default'."""
    if not raw:
        return None, None
    s = raw.strip()
    effort = None

    # 1) 괄호 속 내용 (AA, LMArena 일부)
    m = re.search(r"\(([^)]*)\)", s)
    if m:
        effort = _effort_from_text(m.group(1))
        s = (s[:m.start()] + s[m.end():]).strip()

    # 2) 회사 접두어 제거 (anthropic/claude-..., fireworks/kimi-...)
    if "/" in s:
        s = s.split("/")[-1]

    # 3) Epoch 형식: 밑줄 뒤가 등급  (gpt-5.6-sol_max, gpt-5.6-sol_proxhigh)
    pro = False
    m = re.match(r"^(.*)_([a-z0-9]+)$", s.strip(), re.I)
    if m and effort is None:
        tail = m.group(2).lower()
        if tail.startswith("pro") and tail != "pro" and tail[3:] in _EFFORT_WORDS or tail in ("prounknown",):
            pro = True
            tail = tail[3:]
        if tail == "ultra":
            effort = "ultra"
            s = m.group(1)
        elif tail in _EFFORT_WORDS:
            effort = _EFFORT_WORDS[tail]
            s = m.group(1)
        elif tail in LEARNED:
            effort = tail
            s = m.group(1)
        elif tail == "unknown":
            effort = "unknown"
            s = m.group(1)
        elif _BUDGET.match(tail):
            effort = "thinking"
            s = m.group(1)

    s = _DATE_DASH.sub("", s)
    s = _slug(s)
    s = _DATE8.sub("", s)

    # 4) 끝에서부터 등급/군더더기 단어 떼어내기
    parts = s.split("-")
    think = False
    while len(parts) > 1:
        last = parts[-1]
        two = parts[-2] + "-" + last
        if two in _EFFORT_WORDS and effort is None:
            effort = _EFFORT_WORDS[two]
            parts = parts[:-2]
            continue
        if two == "non-reasoning":
            effort = effort or "none"
            parts = parts[:-2]
            continue
        if last in _EFFORT_WORDS:
            if last == "max" and any(p.match("-".join(parts[:-1])) for p in _MAX_IS_NAME):
                break
            if effort is None:
                effort = _EFFORT_WORDS[last]
            parts = parts[:-1]
            continue
        if last in _NOISE_WORDS or _BUDGET.match(last):
            parts = parts[:-1]
            continue
        if last in _THINK_WORDS:
            think = True
            parts = parts[:-1]
            continue
        if re.fullmatch(r"20\d{6}", last):
            parts = parts[:-1]
            continue
        break
    base = "-".join(parts)
    if pro:
        base += "-pro"
    if effort is None:
        effort = "thinking" if think else "default"
    base = _BASE_ALIAS.get(base, base)
    return base, effort


def pretty_name(base):
    """이름표가 없을 때 기본이름을 보기 좋게: claude-opus-5-5 → Claude Opus 5.5"""
    parts = base.split("-")
    out = []
    for p in parts:
        if out and re.fullmatch(r"\d+", p) and re.search(r"\d$", out[-1]):
            out[-1] += "." + p
        elif p in ("gpt", "glm"):
            out.append(p.upper())
        else:
            out.append(p[:1].upper() + p[1:])
    name = " ".join(out)
    return name.replace("GPT ", "GPT-").replace("GLM ", "GLM-")


# 회사 이름 통일
_COMPANY = [
    (r"openai|^gpt|^o\d|chatgpt", "OpenAI"),
    (r"anthropic|^claude", "Anthropic"),
    (r"google|deepmind|^gemini|^gemma", "Google"),
    (r"x-?ai|^grok", "xAI"),
    (r"deepseek", "DeepSeek"),
    (r"moonshot|^kimi", "Moonshot"),
    (r"alibaba|qwen", "Alibaba"),
    (r"zhipu|z-ai|^glm|z\.ai", "Zhipu"),
    (r"minimax", "MiniMax"),
    (r"xiaomi|^mimo", "Xiaomi"),
    (r"mistral|magistral|devstral", "Mistral"),
    (r"meta|^llama|^muse", "Meta"),
    (r"nvidia|nemotron", "NVIDIA"),
    (r"bytedance|seed|dola", "ByteDance"),
    (r"baidu|ernie", "Baidu"),
    (r"tencent|^hy\d|hunyuan", "Tencent"),
    (r"amazon|nova", "Amazon"),
    (r"microsoft|^phi", "Microsoft"),
]


def company_of(*hints):
    for h in hints:
        if not h:
            continue
        h2 = h.lower()
        for pat, name in _COMPANY:
            if re.search(pat, h2):
                return name
    for h in hints:
        if h:
            return h.split("/")[0].strip().title()
    return "기타"


if __name__ == "__main__":
    # 간단 확인용
    for t in ["claude-opus-5-5_max", "claude-opus-5-5-max-effort", "claude-opus-5.5-high",
              "Claude Opus 5.5 (Adaptive Reasoning, Max Effort)", "anthropic/claude-opus-5.5",
              "gpt-5.6-sol_proxhigh", "gpt-5.2-2025-12-11-high", "claude-opus-4-5-20251101-thinking-64k-high-effort",
              "gemini-2.5-pro-06-05-highthinking", "qwen3.8-max", "muse-spark-1.2 (xHigh)", "GPT-5.5 (Non-reasoning)",
              "gemini-3-flash (thinking-minimal)", "claude-sonnet-4-6-thinking-auto-medium-effort",
              "gpt-5.4-2026-03-05_low", "claude-sonnet-4-5-20250929-high-32k", "grok-4-1-fast-reasoning",
              "deepseek-v4-pro-0813_max", "kimi-k3", "gpt-6-astra_promax", "Gemini 2.5 Flash (Reasoning)"]:
        print(f"{t:55s} → {split_name(t)}")
