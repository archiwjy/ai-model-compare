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

from names import EFFORT_KO, EFFORT_ORDER, company_of, learn_efforts, pretty_name
import sources
import combine

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JS = os.path.join(HERE, "웹", "data.js")
OUT_JSON = os.path.join(HERE, "웹", "data.json")
# 마지막으로 모든 기관 데이터가 정상이던 결과 (올리기 할 때 함께 저장소에 올라감)
LAST_GOOD = os.path.join(HERE, "마지막_정상_데이터.json")
KEEP_PREVIOUS_HOURS = 7 * 24   # 한 기관이 실패해도 이 기간까지는 마지막 정상 데이터를 유지

with open(os.path.join(HERE, "이름_보정표.json"), encoding="utf-8") as f:
    ALIAS = json.load(f)
EXCLUDE = ALIAS.get("제외할_이름_포함어", [])

# 출처 소개 (화면에 보여줌)
SOURCE_INFO = {
    "epoch": {"name": "Epoch AI", "url": "https://epoch.ai/benchmarks",
              "desc": "비영리 연구기관. 수학·과학·코딩·에이전트 등 약 60개 벤치마크를 난이도까지 고려해 하나의 능력치로 합침 (ECI 방식)",
              "license": "CC-BY 4.0"},
    "aa": {"name": "Artificial Analysis", "url": "https://artificialanalysis.ai/",
           "desc": "독립 평가 회사. 에이전트·코딩·과학 등 10개 평가를 직접 돌려 만든 지능 지수",
           "license": "출처 표시 필요"},
}


# 분야별 점수 (여러 벤치마크를 합쳐 공정하게) — 벤치마크 이름은 Epoch 목록 기준, aa 는 AA 분야 지수
CATEGORIES = {
    "agent": {"name": "도구 다루기 (MCP·에이전트)", "short": "도구·MCP",
              "desc": "MCP·에이전트로 프로그램을 조작하고 여러 단계 작업을 끝까지 해내는 능력",
              "epoch": {"APEX-Agents": "APEX-Agents (전문 업무)", "OSWorld 2.0": "OSWorld 2.0 (컴퓨터 화면 조작)",
                        "Remote Labor Index": "Remote Labor Index (실제 외주 작업)"},
              "aa": "agent", "aa_label": "AA 에이전트 지수"},
    "code": {"name": "스크립트·코딩", "short": "코딩",
             "desc": "그래스호퍼·블렌더 스크립트, 자동화 프로그램을 짜는 능력",
             "epoch": {"DeepSWE": "DeepSWE", "FrontierCode": "FrontierCode", "Terminal Bench": "Terminal Bench",
                       "SWE-Bench verified": "SWE-bench Verified"},
             "aa": "code", "aa_label": "AA 코딩 지수"},
    "space": {"name": "3D·공간·모델링", "short": "3D·모델링",
              "desc": "3D 형태와 공간을 이해하고 모델링하는 능력",
              "epoch": {"Furniture Assembly": "Furniture Assembly (3D 조립)", "Blueprint Bench 2": "Blueprint Bench 2 (사진 → 평면도)",
                        "Surface Evolver Bench": "Surface Evolver (3D 곡면 스크립트)", "CadEval": "CadEval (CAD 모델링)"},
              "aa": None},
    "research": {"name": "논문·정확한 지식", "short": "논문·지식",
                 "desc": "사실을 정확히 말하고(지어내지 않고) 전문 지식으로 조사·정리하는 능력",
                 "epoch": {"SimpleQA Verified": "SimpleQA Verified (사실 정확성)", "HLE": "HLE (전문가 지식)",
                           "GPQA diamond": "GPQA Diamond (과학 전문 지식)", "DeepResearch Bench": "DeepResearch Bench (조사 보고서)"},
                 "aa": None},
}


def log(msg):
    print(msg, flush=True)


def healthy(data):
    """모든 점수 출처(Epoch AI, Artificial Analysis)를 정상으로 받은 결과인지"""
    src = (data or {}).get("sources") or {}
    return bool(src) and all(src.get(s, {}).get("ok") and src.get(s, {}).get("count") for s in SOURCE_INFO)


def previous_good():
    """반쪽 데이터 대신 쓸 '마지막 정상 데이터' 찾기 → 가장 최근 것
    ① 이 컴퓨터의 지금 화면 데이터 ② 저장소에 올려 둔 마지막 정상 데이터 ③ 인터넷 사이트에 올라가 있는 데이터"""
    cands = []
    for p in (OUT_JSON, LAST_GOOD):
        try:
            with open(p, encoding="utf-8") as f:
                cands.append(json.load(f))
        except (OSError, ValueError):
            pass
    site = os.environ.get("SITE_BASE_URL")
    key = (os.environ.get("AA_API_KEY") or "").strip()
    if site and key:
        try:
            from build_site import site_folder
            # 사이트에는 data.js ("window.MODEL_DATA=...;") 만 올라가 있음
            url = site.rstrip("/") + "/" + site_folder(key) + "/data.js"
            import urllib.request
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": sources.UA}), timeout=30) as r:
                txt = r.read().decode("utf-8").strip()
            cands.append(json.loads(txt[txt.index("=") + 1:].rstrip(";")))
        except Exception as e:
            log(f"  ! 사이트의 예전 데이터 받기 실패: {e}")
    good = [d for d in cands if healthy(d)]
    if not good:
        return None
    best = max(good, key=lambda d: d.get("generated") or "")
    # 한 기관이 아주 오래(7일 넘게) 데이터를 못 주면, 멈춘 옛 화면 대신 받을 수 있는 기관만으로 새로 계산
    #  (사이트가 영원히 옛날 데이터에 멈추지 않게 — 화면 맨 위에 어느 기관이 빠졌는지 안내가 나옴)
    try:
        age_h = (time.time() - time.mktime(time.strptime(best.get("generated") or "", "%Y-%m-%d %H:%M"))) / 3600
    except ValueError:
        age_h = 0
    if age_h > KEEP_PREVIOUS_HOURS:
        log(f"  ! 마지막 정상 데이터가 {age_h / 24:.0f}일 전 것이라 쓰지 않음 → 받을 수 있는 기관만으로 계산")
        return None
    return best


def write_data(data):
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    txt = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("window.MODEL_DATA=" + txt + ";\n")
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        f.write(txt)


def main(force=False):
    """force=True: 받아둔 원본을 거의 쓰지 않고 새로 받는다 ('지금 최신으로 받기' 버튼)"""
    sources.FORCE = force
    t0 = time.time()
    status = {}
    raw = {}
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
        except Exception as e:
            status[name] = {"ok": False, "error": str(e)}
            log(f"  ✗ {name} 실패: {e}")
            if name == "epoch":
                traceback.print_exc()

    if "epoch" not in raw:
        log("Epoch 데이터가 없으면 기준 눈금을 못 만들어서 중단합니다.")
        return 1

    # ── 1. 출처별 점수 모으기
    log("· Epoch 방식 능력치 계산 중 (등급별)...")
    ep_scores, ep_meta = combine.epoch_capability(raw["epoch"])
    score_src = {"epoch": {k: (v[0], v[1]) for k, v in ep_scores.items()}}
    raw_names = {}
    # 점수 출처: Epoch AI + Artificial Analysis 두 곳
    #  · 2026-09-30 검증: 다른 기관을 더 넣어 '서로를 얼마나 잘 맞히는지' 비교했으나 모두 정확도가 떨어져서 넣지 않음
    #    - ARC Prize 공식 결과로 Epoch 의 ARC 점수 보충: 두 곳 일치도 0.951→0.946, 점수 차이 1.73→1.82점 (퍼즐 한 분야라 치우침)
    #  · LiveBench 도 넣어 검증해 봤으나 (2026-09-30) 다른 두 곳과 일치도가 낮고(상관 0.86~0.87, Epoch-AA 는 0.95),
    #    넣으면 서로를 맞히는 오차가 오히려 커져서(1.90→2.19점, 3.12→3.36점) 점수에는 쓰지 않음. 비용 기록에만 씀.
    for s in ("aa",):
        if s in raw and raw[s].get("scores"):
            d = {}
            for k, v in raw[s]["scores"].items():
                se = v.get("ci")
                d[k] = (v["score"], se / 1.96 if se else 0.0)
                raw_names.setdefault(k, {})[s] = v["raw"]
            score_src[s] = d

    cost_src = {}
    if "livebench" in raw:
        cost_src["LiveBench"] = dict(raw["livebench"]["costs"])
    if "aa" in raw:
        cost_src["Artificial Analysis"] = dict(raw["aa"]["costs"])
    for label, d in raw["epoch"]["costs"].items():
        cost_src[label] = dict(d)

    explicit_bases = combine.drop_ambiguous({**score_src, **{"c_" + k: v for k, v in cost_src.items()}})

    # ── 2. 종합 점수
    log("· 출처끼리 눈금 맞추는 중...")
    mapped, src_fit = combine.consensus_scores(score_src)
    n_filled = combine.fill_within_model(mapped)
    log(f"  같은 모델 안에서 채운 점수: {n_filled}개")

    # ── 2-1. 분야별 점수 (종합 점수와 같은 눈금)
    log("· 분야별 점수 계산 중...")
    overall = {}
    for k, per in mapped.items():
        num = den = 0.0
        for x in per.values():
            if len(x) > 2:      # 다른 등급에서 추정한 값은 기준으로 쓰지 않음
                continue
            num += x[0] / x[1]
            den += 1 / x[1]
        if den:
            overall[k] = num / den
    # 등급이 '알 수 없음·기본'으로만 적힌 기록 → 그 모델의 공식 기본 등급(OpenRouter)으로 봄
    #  (평가기관은 보통 따로 설정하지 않은 기본 상태로 시험함. 그 등급에 실제 기록이 있으면 실제 기록을 씀)
    #  이렇게 가정한 점수는 화면 말풍선에 '등급 불명 → 기본 등급으로 봄'으로 표시
    or_prices = raw.get("openrouter", {}).get("prices", {})
    efforts_of = {}
    for (b, e) in mapped:
        efforts_of.setdefault(b, []).append(e)
    allobs, assumed = {}, {}
    for bench, d in raw["epoch"].get("allobs", {}).items():
        nd = {}
        for (b, e), p in d.items():
            k = (b, e)
            if k not in mapped and e in ("unknown", "default", "thinking"):
                de = (or_prices.get(b) or {}).get("default_effort")
                if de and (b, de) in mapped:
                    k = (b, de)
                elif len(efforts_of.get(b, [])) == 1:
                    k = (b, efforts_of[b][0])
                else:
                    continue
                if k in d:
                    continue
                assumed.setdefault(k, set()).add(bench)
            nd[k] = max(nd.get(k, 0.0), p)
        allobs[bench] = nd
    cat_scores, cat_info = {}, {}
    for ck, cd in CATEGORIES.items():
        aa_cat = raw.get("aa", {}).get("cats", {}).get(cd["aa"]) if cd["aa"] else None
        cat_scores[ck], cat_info[ck] = combine.category_scores(
            allobs, raw["epoch"]["edi"], overall, list(cd["epoch"]), aa_cat,
            sigma2=ep_meta.get("sigma2", 0.01))
        log(f"  {cd['name']}: {cat_info[ck]['count']}개 등급 (시험: {', '.join(cat_info[ck]['tests'])})")

    # ── 3. 비용
    log("· 비용 환산 중...")
    merged, cost_info = combine.combine_costs(cost_src)
    ladder, ladder_n = combine.effort_ladder(merged)
    prices = raw.get("openrouter", {}).get("prices", {})
    costs, k_price = combine.fill_costs(list(mapped.keys()), merged, ladder, prices)

    # ── 4. 모델 단위로 묶기
    ep_info = raw["epoch"]["info"]
    aa_info = raw.get("aa", {}).get("info", {})
    aa_speed = raw.get("aa", {}).get("speed", {})
    arena_scores = raw.get("arena", {}).get("scores", {})
    models = {}
    for key, per in mapped.items():
        base, eff = key
        m = models.setdefault(base, {"key": base, "variants": []})
        v = {"effort": eff, "effort_ko": EFFORT_KO.get(eff, eff), "src": {}}
        for s, x in per.items():
            val, var = x[0], x[1]
            v["src"][s] = {"m": round(val, 2), "var": round(var, 2)}
            if len(x) > 2:
                # 다른 등급 값에서 추정한 점수
                v["src"][s]["est"] = x[2].split(":", 1)[1]
                continue
            v["src"][s]["raw"] = round(score_src[s][key][0], 3)
            if s == "epoch":
                v["src"][s]["n"] = ep_scores[key][2]
            elif key in raw_names and s in raw_names[key]:
                v["src"][s]["name"] = raw_names[key][s]
        c = costs.get(key)
        if c:
            v["cost"] = round(c[0], 5)
            v["cost_kind"] = c[1]
            v["cost_src"] = c[2]
        if key in aa_speed:
            v["speed"] = round(aa_speed[key], 1)
        # 분야별 점수 (있는 분야만): {분야: {출처: {m, var, raw 또는 n}}}
        cv = {}
        for ck, sc in cat_scores.items():
            if key in sc:
                cv[ck] = {s2: ({"m": round(val, 2), "var": round(var, 2), "n": ex} if s2 == "epoch"
                               else {"m": round(val, 2), "var": round(var, 2), "raw": round(ex, 2)})
                          for s2, (val, var, ex) in sc[key].items()}
                asm = len(assumed.get(key, set()) & set(CATEGORIES[ck]["epoch"]))
                if asm and "epoch" in cv[ck]:
                    cv[ck]["epoch"]["asm"] = asm     # 이 중 몇 개 시험은 '등급 불명 → 기본 등급'으로 본 것
        if cv:
            v["cat"] = cv
        m["variants"].append(v)

    out_models = []
    cutoff = "2024-09-01"
    for base, m in models.items():
        ei = ep_info.get(base, {})
        ai = aa_info.get(base, {})
        pr = prices.get(base)
        arena_org = next((arena_scores[k].get("org") for k in arena_scores if k[0] == base and arena_scores[k].get("org")), None)
        date = ei.get("date") or (ai.get("date") if ai else None) or (pr or {}).get("created")
        n_src = max(len(v["src"]) for v in m["variants"])
        if date and date < cutoff:
            continue
        if not date and n_src < 2:
            continue
        name = ei.get("name")
        if not name and pr and pr.get("name"):
            name = pr["name"].split(": ", 1)[-1]
        if not name:
            name = pretty_name(base)
        if base.endswith("-pro") and "pro" not in name.lower():
            name += " Pro"
        m["name"] = name
        m["company"] = company_of(ei.get("company"), ai.get("company") if ai else None, (pr or {}).get("id"), arena_org, base)
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
    out_models.sort(key=lambda m: m["name"])

    src_out = {}
    for s, inf in SOURCE_INFO.items():
        st = status.get(s, {"ok": False, "error": "받지 않음"})
        src_out[s] = dict(inf, ok=st["ok"], updated=st.get("updated"), error=st.get("error"),
                          fit=src_fit.get(s), count=len(score_src.get(s, {})))
    if "aa" in raw and raw["aa"].get("version"):
        src_out["aa"]["version"] = raw["aa"]["version"]

    data = {
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "sources": src_out,
        "openrouter": status.get("openrouter"),
        "cost_sources": cost_info,
        "effort_ladder": {e: round(math.exp(v), 3) for e, v in ladder.items()},
        "effort_ko": EFFORT_KO,
        "effort_order": EFFORT_ORDER,
        # 실제로 계산에 쓰인 시험 (화면 설명용 이름)
        "categories": {ck: {"name": cd["name"], "short": cd["short"], "desc": cd["desc"],
                            "tests": ([cd["aa_label"]] if cd.get("aa") and raw.get("aa", {}).get("cats", {}).get(cd["aa"]) else [])
                                     + [cd["epoch"][b] for b in cat_info[ck]["tests"]],
                            "count": cat_info[ck]["count"], "aa_label": cd.get("aa_label")}
                       for ck, cd in CATEGORIES.items()},
        "models": out_models,
    }
    # 자동 점검용 기록: 실패한 기관, 처음 보는 등급 이름 (화면 알림과 GitHub 알림에 씀)
    seen = {v["effort"] for m in out_models for v in m["variants"]}
    health = {
        "checked": time.strftime("%Y-%m-%d %H:%M"),
        "failed": [SOURCE_INFO[s]["name"] for s in SOURCE_INFO if not (src_out[s]["ok"] and src_out[s]["count"])]
                  + ([] if status.get("openrouter", {}).get("ok") else ["OpenRouter"]),
        "new_efforts": sorted(e for e in seen if e not in EFFORT_ORDER and e != "unknown"),
    }
    data["health"] = health
    # 한 기관이라도 받기에 실패했으면 반쪽 데이터를 내보내지 않는다 (2026-09-30: AA 429 오류로 모델 494→193개가 된 적 있음)
    if not healthy(data):
        bad = [SOURCE_INFO[s]["name"] for s in SOURCE_INFO if not (src_out[s]["ok"] and src_out[s]["count"])]
        prev = previous_good()
        if prev:
            prev["health"] = dict(health, using_previous=True)
            write_data(prev)
            log(f"⚠ {', '.join(bad)} 받기 실패 → 반쪽 데이터 대신 마지막 정상 데이터({prev.get('generated')})를 그대로 씀")
            return 0
        log(f"⚠ {', '.join(bad)} 받기 실패, 이전 정상 데이터도 없어 받은 것만으로 만듦")
    write_data(data)

    nv = sum(len(m["variants"]) for m in out_models)
    log(f"완료: 모델 {len(out_models)}개, 점 {nv}개  ({time.time() - t0:.0f}초)")
    for s, inf in src_out.items():
        mark = "✓" if inf["ok"] else "✗"
        log(f"  {mark} {inf['name']}: {inf['count']}개 {'' if inf['ok'] else inf.get('error')}  맞춤={inf.get('fit')}")
    log(f"  비용 출처: {cost_info}")
    log(f"  등급별 비용 배율: {data['effort_ladder']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
