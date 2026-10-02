# 종합 점수·비용 계산
#
# [종합 성능 점수]
#  1) Epoch 방식 능력치: 벤치마크마다 '난이도'와 '변별력'이 정해져 있다.
#     모델(등급별)의 점수들을 가장 잘 설명하는 능력치 하나를 찾는다 (문항반응이론).
#     → Epoch 공식 ECI와 같은 눈금 (GPT-5 = 150, Claude 3.5 Sonnet = 130)
#  2) 다른 출처(AA)는 겹치는 모델을 이용해 같은 눈금으로 옮긴다 (직선 맞춤).
#  3) 출처마다 '다른 출처의 값과 얼마나 어긋나는지'를 재서 오차(±)로 쓴다.
#     지금은 출처가 두 곳뿐이라 어긋남에는 두 출처의 오차가 함께 들어 있다 → 각 출처 몫을 나눌 근거가 없어
#     둘 다 전체 어긋남을 자기 오차로 잡는다 (± 범위를 넉넉하게 = 보수적으로 보여 줌).
#
# [문제당 비용]
#  실제 측정 비용(LiveBench, AA, DeepSWE 등)을 LiveBench 문제 1개 기준으로 환산해 합친다.
#  측정이 없는 등급은 '등급별 비용 배율'로, 그것도 없으면 가격표로 추정하고 '추정'으로 표시한다.

import math
import statistics

EXPLICIT = {"none", "minimal", "low", "medium", "high", "xhigh", "max", "promax", "ultra"}
AMBIGUOUS = {"default", "thinking"}
# 등급을 올릴수록 비용이 줄지 않는 순서 (비용 배율을 이 순서로 맞춤)
LADDER_CHAIN = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "promax", "ultra"]
GRID = (0, 300)       # 능력치를 찾는 범위


def _sig(x):
    if x < -40:
        return 0.0
    if x > 40:
        return 1.0
    return 1.0 / (1.0 + math.exp(-x))


def _fit_one(obs, prior=None, lam=0.0):
    """obs = [(점수0~1, 난이도, 변별력)] → 능력치, 곡률, 잔차제곱합"""
    def loss(c):
        total = sum((p - _sig(s * (c - d))) ** 2 for p, d, s in obs)
        if prior is not None:
            total += lam * (c - prior) ** 2
        return total
    lo, hi = GRID
    best = min(range(lo, hi + 1, 2), key=loss)          # 2점 간격으로 대강 찾고
    a = max(float(lo), best - 2.0)
    c = min((a + i * 0.02 for i in range(int((min(float(hi), best + 2.0) - a) / 0.02) + 1)), key=loss)   # 0.02점 간격으로 다듬기
    h = sum((s * _sig(s * (c - d)) * (1 - _sig(s * (c - d)))) ** 2 for p, d, s in obs)
    if prior is not None:
        h += lam
    resid = sum((p - _sig(s * (c - d))) ** 2 for p, d, s in obs)
    return c, h, resid


def enough_benchmarks(n, has_prior):
    """벤치마크 수가 능력치를 믿을 만큼인지 (같은 모델의 공식 점수가 없으면 하나 더 필요)
    collect 가 '합치면 지워질 점이 있는지' 볼 때도 같은 기준을 씀"""
    return n >= 3 and (has_prior or n >= 4)


def epoch_capability(ep):
    """Epoch 원본 점수 → 등급별 능력치 {key: (점수, 표준오차, 벤치마크수)}"""
    edi, info = ep["edi"], ep["info"]
    items = {}
    for key, bm in ep["obs"].items():
        o = [(p, edi[b][0], edi[b][1]) for b, p in bm.items() if b in edi]
        if o:
            items[key] = o

    # 1단계: 벤치마크가 충분한 것들로 '오차 크기'와 '등급별 평균 차이' 파악
    res: list[float] = []
    offs: dict[str, list[float]] = {}
    for key, o in items.items():
        if len(o) >= 8:
            c, _h, r = _fit_one(o)
            res.append(r / max(1, len(o) - 1))
            e = info.get(key[0], {}).get("eci")
            if e is not None:
                offs.setdefault(key[1], []).append(c - e)
    sigma2 = statistics.median(res) if res else 0.01
    delta = {e: statistics.median(v) for e, v in offs.items() if len(v) >= 3}
    tau = 5.0                       # 사전 추정의 불확실성 (점)
    lam = sigma2 / tau ** 2

    # 2단계: 모든 등급 계산. 벤치마크가 적으면 '같은 모델의 공식 점수 + 등급별 평균 차이' 쪽으로 살짝 당김
    out = {}
    for key, o in items.items():
        e = info.get(key[0], {}).get("eci")
        prior = e + delta.get(key[1], 0.0) if e is not None else None
        # 벤치마크가 너무 적으면 믿기 어려우므로 뺀다
        if not enough_benchmarks(len(o), prior is not None):
            continue
        c, h, _ = _fit_one(o, prior, lam if prior is not None else 0.0)
        se = min(15.0, math.sqrt(sigma2 / max(h, 1e-9)))
        out[key] = (round(c, 2), round(se, 2), len(o))
    return out, {"sigma2": sigma2, "effort_offset": delta}


def explicit_bases(sources):
    """명시 등급(낮음/높음 등)이 하나라도 있는 기본이름들 ('추론 끔'만 있는 것은 제외)"""
    out = set()
    for d in sources:
        for (b, e) in d:
            if e in EXPLICIT and e != "none":
                out.add(b)
    return out


def drop_ambiguous(all_keys_by_source, explicit=None):
    """명시 등급(낮음/높음 등)이 있는 모델에서 '기본'·'추론 켬'처럼 모호한 이름은 버린다.
    단 '추론 끔'만 명시된 모델은 '기본'이 곧 추론 켠 상태이므로 버리지 않는다.
    explicit: 어느 모델이 명시 등급을 가졌는지 (없으면 넘겨준 출처들로 판단)"""
    bases = explicit if explicit is not None else explicit_bases(all_keys_by_source.values())
    for d in all_keys_by_source.values():
        for k in [k for k in d if k[1] in AMBIGUOUS and k[0] in bases]:
            del d[k]
    return bases


def _ols(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / sxx
    return my - b * mx, b


FOCUS_MIN = 140.0     # 눈금 맞출 때 주로 보는 구간 (이 점수 이상인 모델들)


def _rma(xs, ys):
    """양쪽 다 오차가 있을 때 쓰는 직선 맞춤 (기울기 = 표준편차 비율).
    보통 직선 맞춤은 윗부분·아랫부분을 가운데로 눌러버리는 문제가 있다."""
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs) / n)
    sy = math.sqrt(sum((y - my) ** 2 for y in ys) / n)
    r = _corr(xs, ys)
    if sx == 0 or r <= 0:
        return None
    b = sy / sx
    return my - b * mx, b


def fill_within_model(mapped):
    """같은 모델의 다른 등급에만 있는 출처 점수를, 등급 간 차이를 이용해 채운다.
    예) AA에 GPT-6 Astra '최대'만 있으면, Epoch에서 본 '최대→중간' 차이만큼 빼서 '중간' 값을 추정.
    이렇게 하면 한 모델의 모든 점이 같은 출처 조합으로 계산돼 선 모양이 뒤틀리지 않는다."""
    by_base: dict[str, dict] = {}
    for (b, e), per in mapped.items():
        by_base.setdefault(b, {})[e] = per
    added = 0
    for effs in by_base.values():
        all_src: set[str] = set()
        for per in effs.values():
            all_src |= set(per)
        for e, per in effs.items():
            for s in all_src:
                if s in per:
                    continue
                best = None
                for e2, per2 in effs.items():
                    if e2 == e or s not in per2 or len(per2[s]) > 2:
                        continue          # 추정값에서 또 추정하지 않음
                    common = [c for c in per if c in per2 and c != s and len(per[c]) == 2 and len(per2[c]) == 2]
                    if not common:
                        continue
                    wsum = sum(1 / (per[c][1] + per2[c][1]) for c in common)
                    delta = sum((per[c][0] - per2[c][0]) / (per[c][1] + per2[c][1]) for c in common) / wsum
                    var = per2[s][1] + 1 / wsum
                    if best is None or var < best[1]:
                        best = (per2[s][0] + delta, var, e2)
                if best:
                    per[s] = (best[0], best[1], "추정:" + best[2])
                    added += 1
    return added


def _corr(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / (sx * sy)


def consensus_scores(src):
    """src = {출처: {key: (값, 표준오차)}}  — 'epoch'가 눈금 기준.
    반환: 등급별 출처 점수(같은 눈금), 출처별 맞춤 정보"""
    mapping = {"epoch": (0.0, 1.0)}
    noise = dict.fromkeys(src, 9.0)
    mapped: dict[tuple, dict] = {}

    def remap():
        mapped.clear()
        for s, d in src.items():
            if s not in mapping:
                continue
            a, b = mapping[s]
            for k, (v, se) in d.items():
                mapped.setdefault(k, {})[s] = (a + b * v, noise[s] + (b * (se or 0)) ** 2)

    def loo(k, skip):
        """k 등급에 대해 skip 출처를 뺀 나머지의 합의 점수"""
        num = den = 0.0
        for s, (m, var) in mapped.get(k, {}).items():
            if s == skip:
                continue
            num += m / var
            den += 1 / var
        return num / den if den else None

    info = {}
    remap()
    for _ in range(8):
        for s, d in src.items():
            pairs = [(v, loo(k, s)) for k, (v, se) in d.items()]
            pairs = [(x, y) for x, y in pairs if y is not None]
            # 요즘 쓰는 상위권 모델 구간에서 눈금을 맞춘다 (옛날 약한 모델까지 넣으면 윗부분이 안 맞음)
            top = [p for p in pairs if p[1] >= FOCUS_MIN]
            if len(top) >= 12:
                pairs = top
            if len(pairs) < 6:
                info[s] = {"n": len(pairs), "used": s == "epoch"}
                continue
            xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
            if s != "epoch":
                fit = _rma(xs, ys)
                if not fit or fit[1] <= 0:
                    info[s] = {"n": len(pairs), "used": False}
                    mapping.pop(s, None)
                    continue
                # 크게 튀는 점을 빼고 다시 맞춤
                a, b = fit
                r = [y - (a + b * x) for x, y in pairs]
                mad = statistics.median([abs(v) for v in r]) or 1.0
                keep = [p for p, rv in zip(pairs, r, strict=True) if abs(rv) <= 4 * 1.48 * mad]
                if len(keep) >= 6:
                    fit2 = _rma([p[0] for p in keep], [p[1] for p in keep])
                    if fit2 and fit2[1] > 0:
                        a, b = fit2
                mapping[s] = (a, b)
            a, b = mapping[s]
            resid = [y - (a + b * x) for x, y in pairs]
            # 잔차 크기 → 이 출처의 '어긋남 정도'.  (Huber 식으로 큰 값 완화)
            mad = statistics.median([abs(v) for v in resid]) * 1.48
            v = statistics.fmean([min(abs(e), 3 * mad) ** 2 for e in resid])
            noise[s] = max(1.0, v)
            info[s] = {"n": len(pairs), "used": True, "a": round(a, 4), "b": round(b, 5),
                       "r": round(_corr(xs, ys), 3), "rmse": round(math.sqrt(noise[s]), 2)}
        remap()
    return mapped, info


MAX_ITER = 2000       # 비용 환산 비율을 맞추는 최대 반복 횟수


def combine_costs(cost_src, ref="LiveBench", anchor=None):
    """비용 출처들을 기준 출처(LiveBench 문제 1개) 단위로 환산해 합친다 (로그 평균).
    · 기준 출처가 오늘 비어 있으면, 지난번 환산 비율(anchor = {출처: 비율})로 같은 단위를 유지한다
      (기준이 빠졌다고 비용이 갑자기 몇 배로 뛰지 않게)
    · 그것도 없으면 가장 기록이 많은 출처를 기준으로 삼고 info 에 ref 로 표시한다"""
    logs = {s: {k: math.log(c) for k, c in d.items() if isinstance(c, (int, float)) and math.isfinite(c) and c > 0}
            for s, d in cost_src.items()}
    logs = {s: d for s, d in logs.items() if d}
    if not logs:
        return {}, {}
    fixed: dict[str, float] = {}
    if ref in logs:
        fixed[ref] = 0.0
    else:
        anc = {s: math.log(f) for s, f in (anchor or {}).items()
               if s in logs and isinstance(f, (int, float)) and math.isfinite(f) and f > 0}
        if anc:
            s0 = max(anc, key=lambda s: len(logs[s]))
            fixed[s0] = anc[s0]
        else:
            fixed[max(logs, key=lambda s: len(logs[s]))] = 0.0
    off = dict(fixed)
    n_used: dict[str, int] = {}

    def consensus():
        cons: dict[tuple, list] = {}
        for s, d in logs.items():
            if s not in off:
                continue
            for k, v in d.items():
                cons.setdefault(k, []).append((s, v + off[s]))
        return cons

    # 바뀜이 거의 없을 때까지 반복. 서로 맞물린 출처끼리 값이 오락가락하지 않게 절반씩만 고친다
    #  (예전엔 통째로 바꿔서 기준 출처가 빠진 날 200번을 다 돌아도 두 값 사이를 오갔음)
    converged = False
    for _ in range(MAX_ITER):
        cons = consensus()
        change = 0.0
        for s, d in logs.items():
            if s in fixed:
                continue
            diffs = []
            for k, v in d.items():
                others = [x for (s2, x) in cons.get(k, []) if s2 != s]
                if others:
                    diffs.append(sum(others) / len(others) - v)
            if len(diffs) >= 3:
                new = statistics.median(diffs)
                old = off.get(s)
                if old is None:
                    change = math.inf           # 처음 들어온 출처 → 한 번 더 돌아야 함
                else:
                    new = 0.5 * old + 0.5 * new
                    change = max(change, abs(new - old))
                off[s] = new
                n_used[s] = len(diffs)
        if change < 1e-9:
            converged = True
            break
    if not converged:
        print(f"  ! 비용 환산 비율이 {MAX_ITER}번 안에 다 맞춰지지 않아 마지막 값을 씀 (출처끼리 비용이 크게 어긋남)", flush=True)
    cons = consensus()           # 마지막 비율로 한 번 더 → 합친 값과 표시하는 비율이 같은 계산에서 나옴
    merged = {k: (sum(x for _, x in v) / len(v), sorted({s for s, _ in v})) for k, v in cons.items()}
    info = {}
    for s, o in off.items():
        info[s] = {"n": len(logs[s]) if s in fixed else n_used.get(s, 0), "factor": round(math.exp(o), 4)}
        if s in fixed:
            info[s]["ref"] = True
        elif not converged:
            info[s]["converged"] = False      # 자동 점검·화면에서 '비율이 덜 맞춰짐'을 알 수 있게
    return merged, info


DEFAULT_EFFORT_LOG = {"none": math.log(0.15), "minimal": math.log(0.25), "low": math.log(0.4),
                      "medium": math.log(0.65), "default": 0.0, "thinking": 0.0, "high": 0.0,
                      "xhigh": math.log(1.5), "max": math.log(2.3), "promax": math.log(4.0), "ultra": math.log(6.0)}


def _monotone(lad, counts):
    """명시 등급은 올라갈수록 비용이 줄지 않게 (이웃끼리 순서가 뒤집히면 둘을 묶어 가중 평균 — PAV)"""
    chain = [e for e in LADDER_CHAIN if e in lad]
    blocks = [[lad[e], max(1, counts.get(e, 0)), [e]] for e in chain]
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][0] > blocks[i + 1][0] + 1e-12:
            a, b = blocks[i], blocks[i + 1]
            w = a[1] + b[1]
            blocks[i] = [(a[0] * a[1] + b[0] * b[1]) / w, w, a[2] + b[2]]
            del blocks[i + 1]
            i = max(0, i - 1)
        else:
            i += 1
    out = dict(lad)
    for v, _w, es in blocks:
        for e in es:
            out[e] = v
    return out


MIN_LINKS = 3        # 두 등급 묶음을 이으려면 둘 다 잰 모델이 이만큼은 있어야 함


def _components(by_base, efforts, min_links=MIN_LINKS):
    """같은 모델 안에 함께 나오는 등급끼리 이어진 묶음들 (서로 비교할 수 있는 등급끼리)
    · 두 묶음의 등급을 함께 잰 모델이 min_links 개 이상일 때만 잇는다
      (예전엔 '추론 끔'과 '추론 켬'을 함께 잰 모델 하나가 '기본'·'추론 켬' 묶음 전체의 높이를 정해 배율이 0.6~3배로 흔들렸음)"""
    comps = [{e} for e in efforts]
    model_sets = [set(d) for d in by_base.values()]

    def linked_pair():
        """이을 수 있는 두 묶음 (없으면 None)"""
        for i in range(len(comps)):
            for j in range(i + 1, len(comps)):
                if sum(1 for es in model_sets if es & comps[i] and es & comps[j]) >= min_links:
                    return i, j
        return None
    while (pair := linked_pair()) is not None:
        comps[pair[0]] |= comps.pop(pair[1])
    return [[e for e in efforts if e in c] for c in comps]


def effort_ladder(merged):
    """같은 모델 안에서 등급을 올리면 비용이 몇 배 되는지 (데이터로 추정, 부족하면 기본값)
    · 서로 맞물린 값이라 조금씩(절반씩) 고쳐 가며 바뀜이 없을 때까지 반복 (예전엔 30번에서 끊어 값이 출렁였음)
    · 자료가 적은 등급은 기본값 쪽으로 당김 (모델 수 기준)
    · 서로 비교할 수 있는 등급 묶음마다 높이를 정함: '높음'이 든 묶음은 높음 = 1배,
      '기본'·'추론 켬'처럼 따로 떨어진 묶음은 기본값의 평균 높이 (자료 없는 등급은 기본값 그대로)
      두 묶음을 함께 잰 모델이 MIN_LINKS 개보다 적으면 따로 떨어진 묶음으로 봄 (모델 하나가 높이를 통째로 정하지 않게)
    · 명시 등급은 순서대로 비용이 줄지 않게 맞춤"""
    by_base: dict[str, dict] = {}
    for (b, e), (lv, _) in merged.items():
        by_base.setdefault(b, {})[e] = lv
    lad = dict(DEFAULT_EFFORT_LOG)
    comps = _components(by_base, list(lad))
    comp_of = {e: i for i, comp in enumerate(comps) for e in comp}
    counts: dict[str, int] = {}
    models: dict[str, int] = {}

    def anchor(x):
        for comp in comps:
            if "high" in comp:
                shift = x["high"] - DEFAULT_EFFORT_LOG["high"]
            else:
                shift = sum(x[e] - DEFAULT_EFFORT_LOG[e] for e in comp) / len(comp)
            for e in comp:
                x[e] -= shift
        return x

    for _ in range(2000):
        new = {}
        for e in lad:
            vals = []
            nm = 0
            for d in by_base.values():
                if e in d:
                    # 이어지지 않은 묶음의 등급과는 비교하지 않음 (그 묶음의 높이는 따로 정해서, 섞으면 엉뚱한 높이가 들어감)
                    got = [d[e] - l2 + lad[e2] for e2, l2 in d.items() if e2 != e and e2 in lad and comp_of[e2] == comp_of[e]]
                    if got:
                        nm += 1
                        vals += got
            counts[e] = len(vals)
            models[e] = nm
            if vals:
                w = min(1.0, nm / 8)       # 자료(모델 수)가 적으면 기본값 쪽으로
                new[e] = w * statistics.median(vals) + (1 - w) * DEFAULT_EFFORT_LOG[e]
            else:
                new[e] = DEFAULT_EFFORT_LOG[e]
        new = anchor({e: 0.5 * lad[e] + 0.5 * v for e, v in new.items()})
        change = max(abs(new[e] - lad[e]) for e in lad)
        lad = new
        if change < 1e-10:
            break
    lad = _monotone(lad, models)
    shift = lad["high"]
    chain = {e for comp in comps if "high" in comp for e in comp} | set(LADDER_CHAIN)
    lad = {e: (v - shift if e in chain else v) for e, v in lad.items()}
    return lad, counts


def fill_costs(keys, merged, ladder, prices):
    """모든 등급에 비용 채우기 → {key: (비용$, 종류, 출처목록)}
    배율을 모르는 처음 보는 등급은 짐작하지 않음 ('비용 없음'이 틀린 숫자보다 나음)"""
    by_base: dict[str, dict] = {}
    for (b, e), (lv, _s) in merged.items():
        by_base.setdefault(b, {})[e] = lv
    # 가격표 → 비용 환산 계수
    ks = []
    for (b, e), (lv, _) in merged.items():
        p = prices.get(b)
        if p and e in ladder:
            pi = p["in"] + p["out"]
            if pi > 0:
                ks.append(lv - ladder[e] - math.log(pi))
    k_price = statistics.median(ks) if ks else math.log(0.01)
    out = {}
    for key in keys:
        b, e = key
        if key in merged:
            lv, srcs = merged[key]
            out[key] = (math.exp(lv), "측정", srcs)
            continue
        if e not in ladder:
            continue
        d = by_base.get(b)
        ests = [l2 - ladder[e2] for e2, l2 in d.items() if e2 in ladder] if d else []
        if ests:
            out[key] = (math.exp(statistics.fmean(ests) + ladder[e]), "등급 환산", [])
            continue
        p = prices.get(b)
        if p and p["in"] + p["out"] > 0:
            lv = math.log(p["in"] + p["out"]) + k_price + ladder[e]
            out[key] = (math.exp(lv), "가격 추정", [])
    return out, k_price
