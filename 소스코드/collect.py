# AI 모델 성능비교판 — 데이터 수집기
# 실행하면 여러 벤치마크 출처에서 최신 데이터를 받아 종합 점수를 계산하고
# 웹/data.js 파일로 저장한다. (웹/index.html 이 이 파일을 읽어 그래프를 그린다)
#
#   python collect.py
#
import sys

sys.dont_write_bytecode = True          # 구글 드라이브에 __pycache__ 만들지 않기

import json
import math
import os
import time
import traceback
from collections import Counter

import combine
import sources
from names import EFFORT_KO, EFFORT_ORDER, company_of, learn_efforts, pretty_name

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JS = os.path.join(HERE, "웹", "data.js")
OUT_JSON = os.path.join(HERE, "웹", "data.json")
# 마지막으로 모든 기관 데이터가 정상이던 결과 — 받아 둔 원본과 같은 곳(구글 드라이브·저장소 밖)에 둔다
#  (GitHub 에서는 받아 둔 원본 폴더째 캐시로 보관되어 다음 실행으로 이어짐 → 공개 저장소에 데이터를 올리지 않음)
LAST_GOOD = os.environ.get("LAST_GOOD_PATH") or os.path.join(sources.CACHE_DIR, "마지막_정상_데이터.json")
STATE = os.path.join(sources.CACHE_DIR, "수집_상태.json")    # 기관별 '언제부터 실패 중인지' (자동 점검이 씀)
KEEP_PREVIOUS_HOURS = 7 * 24   # 한 기관이 실패해도 이 기간까지는 마지막 정상 데이터를 유지
STALE_SOURCE_HOURS = 6         # 받아 둔 원본이 이보다 오래됐으면 '새로 받지 못함'으로 봄

try:
    with open(os.path.join(HERE, "이름_보정표.json"), encoding="utf-8") as f:
        ALIAS = json.load(f)
    if not isinstance(ALIAS, dict):
        raise ValueError("맨 바깥이 {...} 형식이 아님")
except (OSError, ValueError) as e:
    print(f"  ! 이름_보정표.json 을 읽지 못해 보정 없이 진행합니다: {e}")
    ALIAS = {}
EXCLUDE = [str(w).lower() for w in (ALIAS.get("제외할_이름_포함어") or []) if isinstance(w, str)]

# 출처 소개 (화면에 보여줌)
SOURCE_INFO = {
    "epoch": {"name": "Epoch AI", "url": "https://epoch.ai/benchmarks",
              "desc": "비영리 연구기관. 수학·과학·코딩·에이전트 등 약 60개 벤치마크를 난이도까지 고려해 하나의 능력치로 합침 (ECI 방식)",
              "license": "CC-BY 4.0"},
    "aa": {"name": "Artificial Analysis", "url": "https://artificialanalysis.ai/",
           "desc": "독립 평가 회사. 에이전트·코딩·과학 등 10개 평가를 직접 돌려 만든 지능 지수",
           "license": "출처 표시 필요"},
}
# 받은 원본 파일 이름 앞부분 → 화면 이름 (원본이 오래됐는지 볼 때)
RAW_FILES = {"Epoch AI": "epoch_", "Artificial Analysis": "aa_page", "OpenRouter": "openrouter_", "LiveBench": "livebench_"}


def log(msg):
    print(msg, flush=True)


def _num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def healthy(data):
    """모든 점수 출처(Epoch AI, Artificial Analysis)를 정상으로 받고, AA 눈금 맞춤까지 된 결과인지"""
    if not isinstance(data, dict):
        return False
    src = data.get("sources")
    if not isinstance(src, dict) or not src:
        return False
    for s in SOURCE_INFO:
        x = src.get(s)
        if not isinstance(x, dict) or not x.get("ok") or not x.get("count"):
            return False
    fit = src["aa"].get("fit")
    return not (isinstance(fit, dict) and fit.get("used") is False)


def _age_hours(d):
    """generated 시각이 몇 시간 전인지 (해석 못 하면 무한대 → 다시 쓰지 않음)"""
    try:
        return (time.time() - time.mktime(time.strptime(str(d.get("generated") or ""), "%Y-%m-%d %H:%M"))) / 3600
    except (ValueError, TypeError, OverflowError):
        return math.inf


def _read_json(p):
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def local_candidates():
    """이 컴퓨터에 있는 정상 데이터들 (지금 화면 데이터 · 마지막 정상 데이터) → 최신순"""
    cands = [d for d in (_read_json(OUT_JSON), _read_json(LAST_GOOD)) if healthy(d)]
    return sorted(cands, key=_age_hours)


def previous_good():
    """반쪽 데이터 대신 쓸 '마지막 정상 데이터' 찾기 → 가장 최근 것
    ① 이 컴퓨터의 지금 화면 데이터 ② 마지막 정상 데이터 ③ 인터넷 사이트에 올라가 있는 데이터"""
    cands = local_candidates()
    site = os.environ.get("SITE_BASE_URL")
    key = (os.environ.get("SITE_SECRET") or os.environ.get("AA_API_KEY") or "").strip()
    if site and key:
        try:
            import urllib.request

            from build_site import site_folder
            # 사이트에는 data.js ("window.MODEL_DATA=...;") 만 올라가 있음
            url = site.rstrip("/") + "/" + site_folder(key) + "/data.js"
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": sources.UA}), timeout=30) as r:
                txt = r.read().decode("utf-8").strip()
            d = json.loads(txt[txt.index("=") + 1:].rstrip(";"))
            if healthy(d):
                cands.append(d)
        except Exception as e:  # noqa: BLE001 — 사이트 데이터는 마지막 대비책일 뿐
            log(f"  ! 사이트의 예전 데이터 받기 실패: {type(e).__name__}")
    if not cands:
        return None
    best = min(cands, key=_age_hours)
    age_h = _age_hours(best)
    # 한 기관이 아주 오래(7일 넘게) 데이터를 못 주면, 멈춘 옛 화면 대신 받을 수 있는 기관만으로 새로 계산
    #  (사이트가 영원히 옛날 데이터에 멈추지 않게 — 화면 맨 위에 어느 기관이 빠졌는지 안내가 나옴)
    if age_h > KEEP_PREVIOUS_HOURS:
        if math.isfinite(age_h):
            log(f"  ! 마지막 정상 데이터가 {age_h / 24:.0f}일 전 것이라 쓰지 않음 → 받을 수 있는 기관만으로 계산")
        return None
    return best


def _dumps(data):
    # NaN·무한대가 섞이면 브라우저가 data.js 를 못 읽으므로 쓰기 전에 막는다
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _write_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def write_data(data):
    """화면 파일 쓰기 — 다 쓴 뒤 한 번에 바꿔 끼움 (쓰는 도중 끊겨도 반쯤 잘린 파일이 남지 않게)"""
    txt = _dumps(data)
    _write_atomic(OUT_JS, "window.MODEL_DATA=" + txt + ";\n")
    _write_atomic(OUT_JSON, txt)


def _update_state(failing, now_stamp):
    """기관별로 '언제부터 실패 중인지' 기록 → {이름: 처음 실패한 시각}"""
    st = _read_json(STATE) or {}
    old = st.get("fail_since")
    since = {k: v for k, v in old.items() if k in failing} if isinstance(old, dict) else {}
    for k in failing:
        since.setdefault(k, now_stamp)
    try:
        _write_atomic(STATE, json.dumps({"fail_since": since}, ensure_ascii=False))
    except OSError as e:
        log(f"  ! 수집 상태 기록 실패: {e}")
    return since


def _prices_from(prev):
    """OpenRouter 를 못 받았을 때: 마지막 정상 데이터의 가격·등급 정보를 모델별로 가져옴 (가격표는 자주 바뀌지 않음)
    표시 이름·날짜도 지난번 것을 그대로 넘김 (OpenRouter 가 빠진 날 이름이 'Sonar' → 'Sonar Reasoning' 처럼 바뀌지 않게)"""
    out = {}
    for m in (prev or {}).get("models") or []:
        p = m.get("price") if isinstance(m, dict) else None
        if not isinstance(p, dict) or _num(p.get("in")) is None or _num(p.get("out")) is None:
            continue
        name, date = m.get("name"), m.get("date")
        out[m["key"]] = {"id": p.get("id"), "in": p["in"], "out": p["out"],
                         "name": name if isinstance(name, str) and name else None,
                         "created": date if isinstance(date, str) and date else None,
                         "efforts": m.get("efforts_supported") or [], "default_effort": m.get("effort_default_or"),
                         "reasoning_mandatory": m.get("reasoning_mandatory")}
    return out


def _efforts_by_base(raw):
    """모호한 등급 정리(combine.drop_ambiguous)가 보게 될 등급들 → (점수 쪽, 비용 쪽) 각각 {기본이름: 등급 모음}
    Epoch 점수는 벤치마크가 너무 적으면 능력치 계산에서 빠지므로 같은 기준으로 세지 않음"""
    ep = raw["epoch"]
    edi, info = ep.get("edi") or {}, ep.get("info") or {}
    score: dict[str, set] = {}
    cost: dict[str, set] = {}
    for (b, e), bm in ep["obs"].items():
        if combine.enough_benchmarks(sum(1 for x in bm if x in edi), info.get(b, {}).get("eci") is not None):
            score.setdefault(b, set()).add(e)
    for b, e in (raw.get("aa") or {}).get("scores", {}):
        score.setdefault(b, set()).add(e)
    for d in [*(ep.get("costs") or {}).values(), (raw.get("aa") or {}).get("costs") or {}, (raw.get("livebench") or {}).get("costs") or {}]:
        for b, e in d:
            cost.setdefault(b, set()).add(e)
    return score, cost


def _merge_loses_points(members, score, cost):
    """이 기본이름들을 한 모델로 합치면 모호한 점('기본'·'추론 켬')이 새로 지워지는지
    · 명시 등급(낮음·높음 등)이 있는 모델의 모호한 점은 지워진다 (drop_ambiguous)
    · 그래서 명시 등급이 없던 이름(그룹 쪽이든 버전 쪽이든)이 명시 등급이 있는 이름과 합쳐지면,
      따로 있을 땐 남았을 그 이름의 모호한 점을 잃음
      (2026-10-02: Gemma 4 26B A4B 에 Epoch 의 '-it 최소' 를 합쳤더니 Epoch '기본'·AA '추론 켬' 점이 사라졌음)
    점수 쪽은 점수 출처의 명시 등급만, 비용 쪽은 점수·비용 출처 모두의 명시 등급으로 판단 (collect.main 과 같게)"""
    def explicit(es):
        return any(e in combine.EXPLICIT and e != "none" for e in es)

    def ambiguous(es):
        return any(e in combine.AMBIGUOUS for e in es)
    s_ex = {b: explicit(score.get(b, ())) for b in members}
    c_ex = {b: s_ex[b] or explicit(cost.get(b, ())) for b in members}
    g_s, g_c = any(s_ex.values()), any(c_ex.values())
    return any((g_s and not s_ex[b] and ambiguous(score.get(b, ())))
               or (g_c and not c_ex[b] and ambiguous(cost.get(b, ()))) for b in members)


def _share_prices(raw, cand):
    """OpenRouter 가 버전 이름으로만 가격을 적어 둔 경우 그룹 이름에도 같은 가격을 씀 (같은 모델이므로)
    예) google/gemma-4-26b-a4b-it → gemma-4-26b-a4b, mistral-large-2512 → mistral-large-3 → 개수"""
    prices = (raw.get("openrouter") or {}).get("prices")
    if not isinstance(prices, dict):
        return 0
    n = 0
    for gb in sorted(set(cand.values())):
        got = [prices[vb] for vb in sorted(cand) if cand[vb] == gb and vb in prices]
        if gb not in prices and got:
            prices[gb] = min(got, key=lambda p: len(str(p.get("id") or "")))   # 여러 개면 id 가 짧은(정식) 것
            n += 1
    return n


def merge_epoch_groups(raw):
    """Epoch 버전 기본이름 → 그룹 기본이름으로 바꿔 다른 기관과 같은 모델로 묶음 → 바꾼 개수
    · 합치면 모호한 점이 새로 지워지는 경우엔 합치지 않음 (_merge_loses_points) → 따로 두면 모든 점이 남음
    · 가격은 합치지 않은 경우에도 그룹 이름으로 나눠 씀 (_share_prices)"""
    ep = raw["epoch"]
    alias = ep.get("group_alias") or {}
    aa_bases = {k[0] for k in (raw.get("aa") or {}).get("scores", {})}
    cand = {vb: gb for vb, gb in alias.items() if gb in aa_bases and vb not in aa_bases}
    n_price = _share_prices(raw, cand)
    if n_price:
        log(f"  버전 이름의 OpenRouter 가격을 그룹 이름에도 씀: {n_price}개")
    score, cost = _efforts_by_base(raw)
    use: dict[str, str] = {}
    kept = []
    for vb, gb in cand.items():          # Epoch 원본 순서대로 (같은 그룹에 여러 판이면 먼저 나온 판의 날짜·이름을 씀)
        if _merge_loses_points([gb, *(v for v, g in use.items() if g == gb), vb], score, cost):
            kept.append(vb)
        else:
            use[vb] = gb
    if kept:
        log(f"  합치면 '기본'·'추론 켬' 점이 지워져서 따로 둔 Epoch 이름: {len(kept)}개 ({', '.join(f'{v}→{cand[v]}' for v in kept[:5])}{' …' if len(kept) > 5 else ''})")
    if not use:
        return 0

    def rekey(d):
        out: dict = {}
        for (b, e), v in d.items():
            k = (use.get(b, b), e)
            if k in out and isinstance(v, dict) and isinstance(out[k], dict):
                for bench, p in v.items():          # 같은 벤치마크 여러 번이면 가장 좋은 것 (Epoch 방식)
                    out[k][bench] = max(out[k].get(bench, 0.0), p)
            elif k not in out:
                out[k] = v
        return out
    ep["obs"] = rekey(ep["obs"])
    for label, d in ep["costs"].items():
        logs: dict[tuple, list] = {}
        for (b, e), c in d.items():
            logs.setdefault((use.get(b, b), e), []).append(math.log(c))
        ep["costs"][label] = {k: math.exp(sum(v) / len(v)) for k, v in logs.items()}
    # LiveBench 비용이 버전 이름으로 적혀 있으면 같이 옮김 (그룹 이름 쪽에 이미 있으면 그것을 둠)
    lb = (raw.get("livebench") or {}).get("costs")
    if isinstance(lb, dict):
        for b, e in [k for k in lb if k[0] in use]:
            c = lb.pop((b, e))
            lb.setdefault((use[b], e), c)
    for vb, gb in use.items():
        if vb in ep["info"]:
            inf = ep["info"].pop(vb)
            if gb not in ep["info"]:
                ep["info"][gb] = inf
    log(f"  같은 모델로 합친 Epoch 이름: {len(use)}개 ({', '.join(f'{a}→{b}' for a, b in list(use.items())[:5])}{' …' if len(use) > 5 else ''})")
    return len(use)


def _sig4(x):
    """유효숫자 4자리 (아주 싼 모델도 자릿수가 사라지지 않게)"""
    return float(f"{x:.4g}")


def main(force=False):
    """force=True: 받아둔 원본을 거의 쓰지 않고 새로 받는다 ('지금 최신으로 받기' 버튼)"""
    sources.FORCE = force
    sources.USED.clear()
    t0 = time.time()
    status = {}
    raw = {}
    prev_any = (local_candidates() or [None])[0]       # 비교·보충용 (나이 제한 없음)
    loaders = [
        ("openrouter", sources.load_openrouter),      # 먼저: 공식 등급 목록에서 새 등급 이름을 배운 뒤 다른 기관 이름을 해석
        ("epoch", lambda: sources.load_epoch(EXCLUDE)),
        ("livebench", lambda: sources.load_livebench(EXCLUDE)),
        ("aa", lambda: sources.load_aa(EXCLUDE)),
    ]
    for name, fn in loaders:
        log(f"· {name} 받는 중...")
        try:
            raw[name] = fn()
            status[name] = {"ok": True, "updated": raw[name].get("updated")}
            if name == "openrouter":
                vocab = {e for p in raw[name].get("prices", {}).values() for e in (p.get("efforts") or [])}
                new_words = learn_efforts(vocab)
                if new_words:
                    log(f"  ★ 처음 보는 공식 등급 이름: {sorted(new_words)} → 자동으로 인식")
        except Exception as e:  # noqa: BLE001 — 한 기관이 실패해도 나머지로 계속 (실패는 기록해서 알림)
            status[name] = {"ok": False, "error": str(e)[:300]}
            log(f"  ✗ {name} 실패: {e}")
            if name == "epoch":
                traceback.print_exc()

    if "epoch" not in raw:
        log("Epoch 데이터가 없으면 기준 눈금을 못 만들어서 중단합니다.")
        return 1

    # ── 0. 같은 모델인데 Epoch 만 다른 이름(날짜 코드 등)으로 부르는 경우 → Epoch 그룹 이름으로 합침
    #  (AA 가 그룹 이름 쪽을 쓰고 버전 이름은 쓰지 않을 때만 — 다른 기관이 버전 이름을 쓰면 그대로 둬야 함께 묶임)
    #  (합치면 '기본'·'추론 켬' 점이 지워지는 경우도 합치지 않음. 가격은 이때도 그룹 이름에 나눠 씀)
    merge_epoch_groups(raw)

    # ── 1. 출처별 점수 모으기
    log("· Epoch 방식 능력치 계산 중 (등급별)...")
    ep_scores, _ep_meta = combine.epoch_capability(raw["epoch"])
    score_src = {"epoch": {k: (v[0], v[1]) for k, v in ep_scores.items()}}
    raw_names: dict[tuple, dict] = {}
    # 점수 출처: Epoch AI + Artificial Analysis 두 곳
    #  · 2026-09-30 검증: 다른 기관을 더 넣어 '서로를 얼마나 잘 맞히는지' 비교했으나 모두 정확도가 떨어져서 넣지 않음
    #    - ARC Prize 공식 결과로 Epoch 의 ARC 점수 보충: 두 곳 일치도 0.951→0.946, 점수 차이 1.73→1.82점 (퍼즐 한 분야라 치우침)
    #  · LiveBench 도 넣어 검증해 봤으나 (2026-09-30) 다른 두 곳과 일치도가 낮고(상관 0.86~0.87, Epoch-AA 는 0.95),
    #    넣으면 서로를 맞히는 오차가 오히려 커져서(1.90→2.19점, 3.12→3.36점) 점수에는 쓰지 않음. 비용 기록에만 씀.
    if "aa" in raw and raw["aa"].get("scores"):
        d = {}
        for k, v in raw["aa"]["scores"].items():
            se = _num(v.get("ci"))
            d[k] = (v["score"], se / 1.96 if se else 0.0)
            raw_names.setdefault(k, {})["aa"] = v["raw"]
        score_src["aa"] = d

    cost_src = {}
    if "livebench" in raw:
        cost_src["LiveBench"] = dict(raw["livebench"]["costs"])
    if "aa" in raw:
        cost_src["Artificial Analysis"] = dict(raw["aa"]["costs"])
    for label, d in raw["epoch"]["costs"].items():
        cost_src[label] = dict(d)

    # 모호한 등급('기본'·'추론 켬') 정리: 점수는 점수 출처의 명시 등급만으로 판단 (비용 기록 때문에 점수가 지워지지 않게)
    score_explicit = combine.explicit_bases(score_src.values())
    combine.drop_ambiguous(score_src, explicit=score_explicit)
    combine.drop_ambiguous(cost_src, explicit=score_explicit | combine.explicit_bases(cost_src.values()))

    # ── 2. 종합 점수
    log("· 출처끼리 눈금 맞추는 중...")
    mapped, src_fit = combine.consensus_scores(score_src)
    n_filled = combine.fill_within_model(mapped)
    log(f"  같은 모델 안에서 채운 점수: {n_filled}개")

    # ── 3. 비용 (LiveBench 가 빠진 날에도 같은 단위가 되도록 지난번 환산 비율을 기준으로)
    log("· 비용 환산 중...")
    anchor = {k: v.get("factor") for k, v in ((prev_any or {}).get("cost_sources") or {}).items() if isinstance(v, dict)}
    merged, cost_info = combine.combine_costs(cost_src, anchor=anchor)
    ladder, _ladder_n = combine.effort_ladder(merged)
    prices = raw.get("openrouter", {}).get("prices", {})
    if "openrouter" not in raw and prev_any:
        prices = _prices_from(prev_any)
        log(f"  ! OpenRouter 를 못 받아 마지막 정상 데이터의 가격·등급 정보 {len(prices)}개를 그대로 씀")
    costs, _k_price = combine.fill_costs(list(mapped.keys()), merged, ladder, prices)

    # ── 4. 모델 단위로 묶기
    ep_info = raw["epoch"]["info"]
    aa_info = raw.get("aa", {}).get("info", {})
    aa_speed = raw.get("aa", {}).get("speed", {})
    models: dict[str, dict] = {}
    for key, per in mapped.items():
        base, eff = key
        m = models.setdefault(base, {"key": base, "variants": []})
        v = {"effort": eff, "effort_ko": EFFORT_KO.get(eff, eff), "src": {}}
        for s, x in per.items():
            val, var = x[0], x[1]
            if not (math.isfinite(val) and math.isfinite(var)):
                continue
            v["src"][s] = {"m": round(val, 2), "var": max(0.01, round(var, 2))}
            if len(x) > 2:
                # 다른 등급 값에서 추정한 점수
                v["src"][s]["est"] = x[2].split(":", 1)[1]
                continue
            v["src"][s]["raw"] = round(score_src[s][key][0], 3)
            if s == "epoch":
                v["src"][s]["n"] = ep_scores[key][2]
            elif key in raw_names and s in raw_names[key]:
                v["src"][s]["name"] = raw_names[key][s]
        if not v["src"]:
            continue
        c = costs.get(key)
        if c and math.isfinite(c[0]) and c[0] > 0:
            v["cost"] = _sig4(c[0])
            v["cost_kind"] = c[1]
            v["cost_src"] = c[2]
        if key in aa_speed:
            v["speed"] = round(aa_speed[key], 1)
        m["variants"].append(v)

    out_models = []
    cutoff = "2024-09-01"
    for base, m in models.items():
        if not m["variants"]:
            continue
        ei = ep_info.get(base, {})
        ai = aa_info.get(base) or {}
        pr = prices.get(base)
        date = ei.get("date") or ai.get("date") or (pr or {}).get("created")
        n_src = max(len(v["src"]) for v in m["variants"])
        if date and date < cutoff:
            continue
        if not date and n_src < 2:
            continue
        # 화면 이름: Epoch 공식 이름 → OpenRouter 이름 → AA 이름 → 기본이름을 다듬은 것
        name = ei.get("name")
        if not name and pr and pr.get("name"):
            name = pr["name"].split(": ", 1)[-1]
        if not name and ai.get("name"):
            name = ai["name"]
        if not name:
            name = pretty_name(base)
        if base.endswith("-pro") and "pro" not in name.lower():
            name += " Pro"
        m["name"] = name
        m["company"] = company_of(ei.get("company"), ai.get("company"), names=((pr or {}).get("id"), base))
        m["date"] = (date or "")[:10] or None
        if pr:
            m["price"] = {"in": round(pr["in"], 4), "out": round(pr["out"], 4), "id": pr["id"]}
            # 이 모델이 지원하는 추론 등급 (OpenRouter 기준) — 화면에서 '설정 방법' 안내에 씀
            if pr.get("efforts"):
                m["efforts_supported"] = pr["efforts"]
            if pr.get("default_effort"):
                m["effort_default_or"] = pr["default_effort"]
            # True = 생각(추론)을 끌 수 없음 → '생각 없이' 등급은 실제로 고를 수 없음
            if pr.get("reasoning_mandatory") is not None:
                m["reasoning_mandatory"] = bool(pr["reasoning_mandatory"])
        if ei.get("eci") is not None:
            m["eci"] = ei["eci"]
        m["variants"].sort(key=lambda v: EFFORT_ORDER.index(v["effort"]) if v["effort"] in EFFORT_ORDER else 99)
        out_models.append(m)
    out_models.sort(key=lambda m: (m["name"], m["key"]))
    dup = [n for n, c in Counter(m["name"] for m in out_models).items() if c > 1]
    if dup:
        log(f"  · 표시 이름이 같은 모델 {len(dup)}종 (화면에서 출시월·키로 구분): {', '.join(dup[:8])}{' …' if len(dup) > 8 else ''}")

    src_out = {}
    for s, inf in SOURCE_INFO.items():
        st = status.get(s, {"ok": False, "error": "받지 않음"})
        src_out[s] = dict(inf, ok=st["ok"], updated=st.get("updated"), error=st.get("error"),
                          fit=src_fit.get(s), count=len(score_src.get(s, {})))
    if "aa" in raw and raw["aa"].get("version"):
        src_out["aa"]["version"] = raw["aa"]["version"]

    stamp = time.strftime("%Y-%m-%d %H:%M")
    data = {
        "generated": stamp,
        "sources": src_out,
        "openrouter": status.get("openrouter"),
        "cost_sources": cost_info,
        "effort_ladder": {e: round(math.exp(v), 3) for e, v in ladder.items()},
        "effort_ko": EFFORT_KO,
        "effort_order": EFFORT_ORDER,
        "models": out_models,
    }
    # 자동 점검용 기록: 실패한 기관, 오래된 원본, 처음 보는 등급 이름 (화면 알림과 GitHub 알림에 씀)
    seen = {v["effort"] for m in out_models for v in m["variants"]}
    failed = [SOURCE_INFO[s]["name"] for s in SOURCE_INFO if not (src_out[s]["ok"] and src_out[s]["count"])]
    if src_out["aa"]["ok"] and (src_out["aa"].get("fit") or {}).get("used") is False:
        failed.append("Artificial Analysis")   # 받긴 했지만 눈금을 못 맞춰 점수에 쓰지 못함
    failed += [] if status.get("openrouter", {}).get("ok") else ["OpenRouter"]
    stale = {}
    for label, prefix in RAW_FILES.items():
        ts = [t for n, t in sources.USED.items() if n.startswith(prefix)]
        if ts and (time.time() - min(ts)) / 3600 > STALE_SOURCE_HOURS:
            stale[label] = round((time.time() - min(ts)) / 3600)
    failing = set(failed) | set(stale) | (set() if status.get("livebench", {}).get("ok") else {"LiveBench"})
    cost_ref = next((s for s, v in cost_info.items() if v.get("ref")), None)
    health = {
        "checked": stamp,
        "failed": sorted(set(failed), key=failed.index),
        "new_efforts": sorted(e for e in seen if e not in EFFORT_ORDER and e != "unknown"),
        "cost_ref": cost_ref,
        "fail_since": _update_state(failing, stamp),
    }
    if stale:
        health["stale_hours"] = stale
    data["health"] = health
    # 결과에 파일로 쓸 수 없는 값(무한대 등)이 섞였으면 수집 전체가 멈추지 않게, 원인을 기록하고 마지막 정상 데이터를 씀
    try:
        _dumps(data)
    except (ValueError, TypeError) as e:
        health["write_error"] = f"{type(e).__name__}: {e}"[:300]
        log(f"  ✗ 결과에 파일로 쓸 수 없는 값이 있음: {e}")
    # 한 기관이라도 받기에 실패했으면 반쪽 데이터를 내보내지 않는다 (2026-09-30: AA 429 오류로 모델 494→193개가 된 적 있음)
    if "write_error" in health or not healthy(data):
        bad = [x for x in health["failed"] if x != "OpenRouter"] or ["일부 기관"]
        why = "결과 값 이상" if "write_error" in health else f"{', '.join(bad)} 받기 실패"
        prev = previous_good()
        if prev:
            prev["health"] = dict(health, using_previous=True)
            write_data(prev)
            log(f"⚠ {why} → 이번 결과 대신 마지막 정상 데이터({prev.get('generated')})를 그대로 씀")
            return 0
        if "write_error" in health:
            log(f"⚠ {why}, 쓸 수 있는 이전 정상 데이터도 없어 화면 파일을 바꾸지 않고 끝냄")
            return 1
        log(f"⚠ {why}, 쓸 수 있는 이전 정상 데이터도 없어 받은 것만으로 만듦")
        health["partial"] = True
    write_data(data)
    if healthy(data):
        try:
            _write_atomic(LAST_GOOD, _dumps(data))
        except OSError as e:
            log(f"  ! 마지막 정상 데이터 저장 실패: {e}")

    nv = sum(len(m["variants"]) for m in out_models)
    log(f"완료: 모델 {len(out_models)}개, 점 {nv}개  ({time.time() - t0:.0f}초)")
    for inf in src_out.values():
        mark = "✓" if inf["ok"] else "✗"
        log(f"  {mark} {inf['name']}: {inf['count']}개 {'' if inf['ok'] else inf.get('error')}  맞춤={inf.get('fit')}")
    log(f"  비용 출처: {cost_info}")
    log(f"  등급별 비용 배율: {data['effort_ladder']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
