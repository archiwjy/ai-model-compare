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
import unicodedata

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
    "no-thinking": "none", "noreasoning": "none", "non-thinking": "none", "nothink": "none",
    "minimal": "minimal",
    "low": "low", "lowthinking": "low",
    "medium": "medium", "med": "medium", "mediumthinking": "medium",
    "high": "high", "highthinking": "high",
    "xhigh": "xhigh", "extra-high": "xhigh", "extrahigh": "xhigh", "x-high": "xhigh",
    "max": "max", "maximum": "max",
}

# 등급 정보는 아니지만 이름 끝에 붙는 군더더기
_NOISE_WORDS = {"effort", "auto", "adaptive", "latest", "default", "fallback", "reasoning-effort"}
_THINK_WORDS = {"thinking", "reasoning", "think"}
# 외부 목록에서 '새 등급'으로 배우면 안 되는 흔한 단어 (배우면 수백 개 모델의 해석이 바뀜)
_NOT_EFFORT = _NOISE_WORDS | _THINK_WORDS | {"on", "off", "true", "false", "enabled", "disabled", "dynamic", "standard", "normal",
                                             "fast", "slow", "pro", "mini", "base", "instruct", "chat", "preview", "beta"}

# OpenRouter 공식 등급 목록 등에서 배운 '처음 보는 등급 이름' (예: 회사가 새 등급을 만들면 자동으로 인식)
#  · 이름 끝의 '-단어' 로는 쓰지 않음 (Nemotron 3 Ultra 처럼 모델 이름일 수 있어서)
LEARNED: set[str] = set()


def learn_efforts(words):
    """새 등급 이름 배우기 → 처음 보는 것만 돌려줌"""
    new = set()
    for raw in words or []:
        w = str(raw).strip().lower() if raw is not None else ""
        if (re.fullmatch(r"[a-z]{3,15}", w) and w not in _EFFORT_WORDS and w not in EFFORT_ORDER
                and w not in _NOT_EFFORT and w not in LEARNED):
            LEARNED.add(w)
            new.add(w)
    return new


_DATE8 = re.compile(r"-?(20\d{2})(\d{2})(\d{2})$")        # -20251101
_DATE_DASH = re.compile(r"-(20\d{2})-(\d{2})-(\d{2})")     # -2025-12-11
_BUDGET = re.compile(r"^\d+k$")                           # 16k, 64k (생각 토큰 한도)
_DASHES = re.compile("[‐‑‒–—―−]")   # 여러 가지 하이픈·대시


def _load_alias():
    """손으로 고치는 이름_보정표.json — 형식이 틀려도 수집이 멈추지 않게 검사하며 읽음"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "이름_보정표.json")
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  ! 이름_보정표.json 을 읽지 못해 보정 없이 진행합니다: {e}")
        return {}
    return d if isinstance(d, dict) else {}


def _patterns(items, where):
    out = []
    for i, p in enumerate(items if isinstance(items, list) else []):
        try:
            out.append(re.compile(str(p)))
        except re.error as e:
            print(f"  ! 이름_보정표.json '{where}' {i + 1}번째 패턴이 잘못돼 건너뜀: {e}")
    return out


_ALIAS = _load_alias()
_BASE_ALIAS = {str(k): str(v) for k, v in (_ALIAS.get("기본이름_별칭") or {}).items()} if isinstance(_ALIAS.get("기본이름_별칭"), dict) else {}
# 등급 단어가 등급이 아니라 모델 이름의 일부인 경우 (예: Qwen3.8-Max, GPT-5.1-Codex-Max, Mistral Medium)
_WORD_IS_NAME: dict[str, list[re.Pattern[str]]] = {"max": _patterns(_ALIAS.get("max가_이름인_모델") or [r"^qwen[\d.\-]*$"], "max가_이름인_모델")}
_raw_words = _ALIAS.get("등급단어가_이름인_모델")
for _w, _ps in (_raw_words.items() if isinstance(_raw_words, dict) else []):
    _WORD_IS_NAME.setdefault(str(_w), []).extend(_patterns(_ps, "등급단어가_이름인_모델"))
# '-thinking' 이 붙은 이름이 등급이 아니라 따로 출시된 모델인 경우 (예: Kimi K2 Thinking)
_THINK_IS_NAME = _patterns(_ALIAS.get("추론이_별개모델") or [], "추론이_별개모델")
# 특정 원래 이름 → 등급 (예: deepseek-reasoner = 생각 켬)
_VERSION_EFFORT = {str(k).lower(): str(v) for k, v in (_ALIAS.get("이름별_등급") or {}).items()} if isinstance(_ALIAS.get("이름별_등급"), dict) else {}


def _word_is_name(word, rest):
    return any(p.match(rest) for p in _WORD_IS_NAME.get(word, []))


def _slug(s):
    """소문자 + 점/밑줄/공백 → 하이픈 (악센트·특수 하이픈 정리, '+' → '-plus', 소수점 'p' → '-')"""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = _DASHES.sub("-", s).lower().strip()
    s = s.replace("+", "-plus")
    s = re.sub(r"[\s_.:]+", "-", s)
    s = re.sub(r"(?<=\d)p(?=\d)", "-", s)        # Fireworks 식 'v3p2' → 'v3-2'
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


_NEG = re.compile(r"(?<![a-z])(non|no|without)[- ]?(reasoning|thinking|think)(?![a-z])"
                  r"|(?<![a-z])(reasoning|thinking)[- :]*(off|disabled|none)(?![a-z])")


def _effort_from_text(text):
    """괄호 속 글 같은 자유 문장에서 등급 찾기. 예: 'Adaptive Reasoning, Max Effort' → max"""
    t = text.lower()
    if _NEG.search(t):
        return "none"
    for word, eff in [("ultra", "ultra"), ("xhigh", "xhigh"), ("extra high", "xhigh"), ("extra-high", "xhigh"),
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


def _claude_order(s):
    """Claude 의 두 가지 어순을 하나로: 'claude-4-5-sonnet' → 'claude-sonnet-4-5' (AA 는 버전이 앞, 다른 곳은 종류가 앞)"""
    return re.sub(r"^claude-(\d+(?:-\d+)?)-(opus|sonnet|haiku)(?=-|$)", r"claude-\2-\1", s)


def split_name(raw):
    """아무 출처의 모델 이름 → (기본이름, 등급). 등급을 모르면 'default'.
    이름이 비었거나 등급 단어뿐이면 (None, None) — 이름 없는 유령 모델을 만들지 않게."""
    if raw is None:
        return None, None
    s = str(raw).strip()
    if not s:
        return None, None
    forced = _VERSION_EFFORT.get(s.lower())
    effort = None
    pro = False

    # 1) 괄호 속 내용 (AA, LMArena 일부) — 괄호가 여러 개면 모두 보고, '생각 끔' 표현이 있으면 그것을 우선
    found = []
    for m in re.finditer(r"\(([^)]*)\)", s):
        e = _effort_from_text(m.group(1))
        if e:
            found.append(e)
        if re.search(r"(?<![a-z])pro(?![a-z])", m.group(1).lower()) and e:
            pro = True
    if found:
        effort = "none" if "none" in found else found[0]
    s = re.sub(r"\([^)]*\)", " ", s).strip()

    # 2) 회사 접두어 제거 (anthropic/claude-..., fireworks/kimi-...)
    if "/" in s:
        s = s.split("/")[-1]

    # 3) Epoch 형식: 밑줄 뒤가 등급  (gpt-5.6-sol_max, gpt-5.6-sol_proxhigh)
    um = re.match(r"^(.*)_([a-z0-9]+)$", s.strip(), re.I)
    if um and effort is None:
        tail = um.group(2).lower()
        if (tail.startswith("pro") and tail != "pro" and tail[3:] in _EFFORT_WORDS) or tail == "prounknown":
            pro = True
            tail = tail[3:]
        if tail == "ultra":
            effort = "ultra"
            s = um.group(1)
        elif tail in _EFFORT_WORDS:
            effort = _EFFORT_WORDS[tail]
            s = um.group(1)
        elif tail in LEARNED:
            effort = tail
            s = um.group(1)
        elif tail == "unknown":
            effort = "unknown"
            s = um.group(1)
        elif _BUDGET.match(tail):
            effort = "thinking"
            s = um.group(1)

    s = _DATE_DASH.sub("", s)
    s = _slug(s)
    s = _DATE8.sub("", s)
    s = _claude_order(s)
    s = re.sub(r"-it$", "-instruct", s)          # Gemma 식 '-it'(지시 학습) = 다른 곳의 'Instruct'

    # 4) 끝에서부터 등급/군더더기 단어 떼어내기
    parts = s.split("-") if s else []
    think = False
    while len(parts) > 1:
        last = parts[-1]
        rest = "-".join(parts[:-1])
        two = parts[-2] + "-" + last
        if two in _EFFORT_WORDS and not _word_is_name(two, "-".join(parts[:-2])):
            if effort is None:
                effort = _EFFORT_WORDS[two]
            parts = parts[:-2]
            continue
        if two == "non-reasoning":
            effort = effort or "none"
            parts = parts[:-2]
            continue
        if last == "promax":                       # 하이픈형 'gpt-6-astra-promax' = Pro 모델의 최대 (밑줄형과 같게)
            pro = True
            effort = effort or "max"
            parts = parts[:-1]
            continue
        if last in _EFFORT_WORDS:
            if _word_is_name(last, rest):
                break
            if effort is None:
                effort = _EFFORT_WORDS[last]
            parts = parts[:-1]
            continue
        if last in _NOISE_WORDS or _BUDGET.match(last):
            parts = parts[:-1]
            continue
        if last in _THINK_WORDS:
            if any(p.match("-".join(parts)) for p in _THINK_IS_NAME):
                break
            think = True
            parts = parts[:-1]
            continue
        if re.fullmatch(r"20\d{6}", last):
            parts = parts[:-1]
            continue
        break
    base = "-".join(parts)
    # 이름이 비었거나 등급·군더더기 단어뿐이면 모델이 아님
    if not base or not re.search(r"[a-z0-9]", base) or base in _EFFORT_WORDS or base in _NOISE_WORDS or base in _THINK_WORDS:
        return None, None
    if pro and not base.endswith("-pro"):
        base += "-pro"
    if effort is None:
        effort = "thinking" if think else "default"
    if forced:
        effort = forced
    base = _BASE_ALIAS.get(base, base)
    return base, effort


def pretty_name(base):
    """이름표가 없을 때 기본이름을 보기 좋게: claude-opus-5-5 → Claude Opus 5.5, qwen3-0-6b → Qwen3 0.6B
    (점과 하이픈의 구분이 이미 사라진 이름이라 최후의 수단 — 기관이 붙인 원래 이름이 있으면 그것을 씀)"""
    parts = [p for p in (base or "").split("-") if p]
    out: list[str] = []
    i = 0
    while i < len(parts):
        p = parts[i]
        nxt = parts[i + 1] if i + 1 < len(parts) else ""
        if re.fullmatch(r"\d{1,2}", p) and re.fullmatch(r"\d+(\.\d+)?[bmk]", nxt):   # 0-6b → 0.6B (크기)
            out.append(f"{p}.{nxt[:-1]}{nxt[-1].upper()}")
            i += 2
            continue
        if out and re.fullmatch(r"\d{1,2}", p) and re.search(r"\d$", out[-1]) and not re.search(r"[bmk]$", out[-1].lower()):
            out[-1] += "." + p                     # 5-5 → 5.5
        elif p in ("gpt", "glm"):
            out.append(p.upper())
        elif re.fullmatch(r"\d+(\.\d+)?[bmk]", p):
            out.append(p[:-1] + p[-1].upper())     # 70b → 70B
        else:
            out.append(p[:1].upper() + p[1:])
        i += 1
    name = " ".join(out)
    return name.replace("GPT ", "GPT-").replace("GLM ", "GLM-")


# 회사 이름 통일 (모델 이름에서 회사를 짐작할 때는 이름 맨 앞이나 단어 경계에서만)
_COMPANY = [
    (r"openai|^gpt|^o\d|chatgpt", "OpenAI"),
    (r"anthropic|^claude", "Anthropic"),
    (r"google|deepmind|^gemini|^gemma", "Google"),
    (r"spacex|(?<![a-z])x-?ai|^grok", "xAI"),
    (r"deepseek", "DeepSeek"),
    (r"moonshot|^kimi", "Moonshot"),
    (r"alibaba|^qwen|^qwq", "Alibaba"),
    (r"zhipu|^z[\s.\-]?ai(?![a-z])|^glm", "Zhipu"),
    (r"minimax", "MiniMax"),
    (r"xiaomi|^mimo", "Xiaomi"),
    (r"^mistral|magistral|devstral|ministral|codestral", "Mistral"),
    (r"^meta(?![a-z])|meta-llama|^llama|^muse", "Meta"),
    (r"nvidia|^nemotron", "NVIDIA"),
    (r"bytedance|^seed(?![a-z])|^doubao|^dola", "ByteDance"),
    (r"baidu|^ernie", "Baidu"),
    (r"tencent|^hy\d|^hunyuan", "Tencent"),
    (r"^amazon|amazon[./]|^nova(?![a-z])", "Amazon"),
    (r"microsoft|^phi(?![a-z])", "Microsoft"),
]


def _canon(h):
    h2 = h.lower().strip()
    for pat, name in _COMPANY:
        if re.search(pat, h2):
            return name
    return None


def _clean_company(h):
    """원래 표기를 살림 (IBM, SK Telecom). 쉼표로 여러 회사가 적혀 있으면 첫 회사, 전부 소문자면 첫 글자만 대문자"""
    h = h.split(",")[0].split("/")[0].strip()
    return h.title() if h == h.lower() else h


def company_of(*hints, names=()):
    """회사 이름 정하기
    · hints: 회사 이름 힌트 (Epoch organization, AA creator 등) — 비어 있지 않은 첫 번째가 이김
      (통일 표에 있으면 통일 이름, 없으면 그 이름 그대로 — 모델 이름의 우연한 글자 일치보다 우선)
    · names: 모델 이름 힌트 (OpenRouter id, 기본이름) — 회사 힌트가 하나도 없을 때만 씀"""
    for h in hints:
        if isinstance(h, str) and h.strip():
            return _canon(h) or _clean_company(h)
    for h in names:
        if isinstance(h, str) and h.strip():
            c = _canon(h)
            if c:
                return c
    for h in names:
        if isinstance(h, str) and "/" in h:
            return _clean_company(h)
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
