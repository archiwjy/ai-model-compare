# 종합 점수·비용 계산
#
# [종합 성능 점수]
#  1) Epoch 방식 능력치: 벤치마크마다 '난이도'와 '변별력'이 정해져 있다.
#     모델(등급별)의 점수들을 가장 잘 설명하는 능력치 하나를 찾는다 (문항반응이론).
#     → Epoch 공식 ECI와 같은 눈금 (GPT-5 = 150, Claude 3.5 Sonnet = 130)
#  2) 다른 출처(AA, LiveBench, LMArena)는 겹치는 모델을 이용해 같은 눈금으로 옮긴다 (직선 맞춤).
#  3) 출처마다 '다른 출처들의 합의와 얼마나 어긋나는지'를 재서, 덜 어긋나는 출처에 더 큰 비중을 준다.
#     한 출처가 혼자 튀면 비중이 줄어들고, 화면에 '의견 차이'로 드러난다.
#
# [문제당 비용]
#  실제 측정 비용(LiveBench, AA, DeepSWE 등)을 LiveBench 문제 1개 기준으로 환산해 합친다.
#  측정이 없는 등급은 '등급별 비용 배율'로, 그것도 없으면 가격표로 추정하고 '추정'으로 표시한다.

import math
import statistics

from names import EFFORT_ORDER

EXPLICIT = {"none", "minimal", "low", "medium", "high", "xhigh", "max", "promax"}
AMBIGUOUS = {"default", "thinking"}


def _sig(x):
    if x < -40:
        return 0.0
    if x > 40:
        return 1.0
    return 1.0 / (1.0 + math.exp(-x))


def _fit_one(obs, prior=None, lam=0.0):
    """obs = [(점수0~1, 난이도, 변별력)] → 능력치, 곡률"""
    def loss(c):
        l = sum((p - _sig(s * (c - d))) ** 2 for p, d, s in obs)
        if prior is not None:
            l += lam * (c - prior) ** 2
        return l
    best = min(range(40, 221), key=loss)
    lo, hi = best - 1.0, best + 1.0
    c = min((lo + i * 0.02 for i in range(101)), key=loss)
    h = sum((s * _sig(s * (c - d)) * (1 - _sig(s * (c - d)))) ** 2 for p, d, s in obs)
    if prior is not None:
        h += lam
    resid = sum((p - _sig(s * (c - d))) ** 2 for p, d, s in obs)
    return c, h, resid


def epoch_capability(ep):
    """Epoch 원본 점수 → 등급별 능력치 {key: (점수, 표준오차, 벤치마크수)}"""
    edi, info = ep["edi"], ep["info"]
    items = {}
    for key, bm in ep["obs"].items():
        o = [(p, edi[b][0], edi[b][1]) for b, p in bm.items() if b in edi]
        if o:
            items[key] = o

    # 1단계: 벤치마크가 충분한 것들로 '오차 크기'와 '등급별 평균 차이' 파악
    res, offs = [], {}
    for key, o in items.items():
        if len(o) >= 8:
            c, h, r = _fit_one(o)
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
        if len(o) < 3 or (prior is None and len(o) < 4):
            continue
        c, h, _ = _fit_one(o, prior, lam if prior is not None else 0.0)
        se = min(15.0, math.sqrt(sigma2 / max(h, 1e-9)))
        out[key] = (round(c, 2), round(se, 2), len(o))
    return out, {"sigma2": sigma2, "effort_offset": delta}


def drop_ambiguous(all_keys_by_source):
    """명시 등급(낮음/높음 등)이 있는 모델에서 '기본'·'추론 켬'처럼 모호한 이름은 버린다.
    단 '추론 끔'만 명시된 모델은 '기본'이 곧 추론 켠 상태이므로 버리지 않는다."""
    explicit_bases = set()
    for d in all_keys_by_source.values():
        for (b, e) in d:
            if e in EXPLICIT and e != "none":
                explicit_bases.add(b)
    for name, d in all_keys_by_source.items():
        for k in [k for k in d if k[1] in AMBIGUOUS and k[0] in explicit_bases]:
            del d[k]
    return explicit_bases


def _ols(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
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
    예) LiveBench에 GPT-6 Astra '최대'만 있으면, Epoch에서 본 '최대→중간' 차이만큼 빼서 '중간' 값을 추정.
    이렇게 하면 한 모델의 모든 점이 같은 출처 조합으로 계산돼 선 모양이 뒤틀리지 않는다."""
    by_base = {}
    for (b, e), per in mapped.items():
        by_base.setdefault(b, {})[e] = per
    added = 0
    for b, effs in by_base.items():
        all_src = set()
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
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def consensus_scores(src):
    """src = {출처: {key: (값, 표준오차)}}  — 'epoch'가 눈금 기준.
    반환: 등급별 출처 점수(같은 눈금), 출처별 맞춤 정보"""
    mapping = {"epoch": (0.0, 1.0)}
    noise = {s: 9.0 for s in src}
    mapped = {}

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
                    continue
                # 크게 튀는 점을 빼고 다시 맞춤
                a, b = fit
                r = [y - (a + b * x) for x, y in pairs]
                mad = statistics.median([abs(v) for v in r]) or 1.0
                keep = [p for p, rv in zip(pairs, r) if abs(rv) <= 4 * 1.48 * mad]
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


def combine_costs(cost_src, ref="LiveBench"):
    """비용 출처들을 기준 출처(LiveBench 문제 1개) 단위로 환산해 합친다 (로그 평균)."""
    logs = {s: {k: math.log(c) for k, c in d.items() if c > 0} for s, d in cost_src.items()}
    off = {ref: 0.0} if ref in logs else {}
    if not off and logs:
        first = max(logs, key=lambda s: len(logs[s]))
        off[first] = 0.0
    info = {}
    cons = {}
    for _ in range(8):
        cons = {}
        for s, d in logs.items():
            if s not in off:
                continue
            for k, v in d.items():
                cons.setdefault(k, []).append((s, v + off[s]))
        for s, d in logs.items():
            if s == ref:
                continue
            diffs = []
            for k, v in d.items():
                others = [x for (s2, x) in cons.get(k, []) if s2 != s]
                if others:
                    diffs.append(sum(others) / len(others) - v)
            if len(diffs) >= 3:
                off[s] = statistics.median(diffs)
                info[s] = {"n": len(diffs), "factor": round(math.exp(off[s]), 4)}
    merged = {k: (sum(x for _, x in v) / len(v), sorted({s for s, _ in v})) for k, v in cons.items()}
    info[ref] = {"n": len(logs.get(ref, {})), "factor": 1.0}
    return merged, info


DEFAULT_EFFORT_LOG = {"none": math.log(0.15), "minimal": math.log(0.25), "low": math.log(0.4),
                      "medium": math.log(0.65), "default": 0.0, "thinking": 0.0, "high": 0.0,
                      "xhigh": math.log(1.5), "max": math.log(2.3), "promax": math.log(4.0)}


def effort_ladder(merged):
    """같은 모델 안에서 등급을 올리면 비용이 몇 배 되는지 (데이터로 추정, 부족하면 기본값)"""
    by_base = {}
    for (b, e), (l, _) in merged.items():
        by_base.setdefault(b, {})[e] = l
    lad = dict(DEFAULT_EFFORT_LOG)
    counts = {}
    for _ in range(30):
        new = {}
        for e in lad:
            vals = []
            for b, d in by_base.items():
                if e in d:
                    for e2, l2 in d.items():
                        if e2 != e and e2 in lad:
                            vals.append(d[e] - l2 + lad[e2])
            counts[e] = len(vals)
            if vals:
                est = statistics.median(vals)
                w = min(1.0, len(vals) / 8)       # 자료가 적으면 기본값 쪽으로
                new[e] = w * est + (1 - w) * DEFAULT_EFFORT_LOG[e]
            else:
                new[e] = lad[e]
        shift = new["high"]
        lad = {e: v - shift for e, v in new.items()}
    return lad, counts


def fill_costs(keys, merged, ladder, prices):
    """모든 등급에 비용 채우기 → {key: (비용$, 종류, 출처목록)}"""
    by_base = {}
    for (b, e), (l, s) in merged.items():
        by_base.setdefault(b, {})[e] = l
    # 가격표 → 비용 환산 계수
    ks = []
    for (b, e), (l, _) in merged.items():
        p = prices.get(b)
        if p:
            pi = p["in"] + p["out"]
            if pi > 0:
                ks.append(l - ladder.get(e, 0) - math.log(pi))
    k_price = statistics.median(ks) if ks else math.log(0.01)
    out = {}
    for key in keys:
        b, e = key
        if key in merged:
            l, srcs = merged[key]
            out[key] = (math.exp(l), "측정", srcs)
            continue
        d = by_base.get(b)
        if d:
            ests = [l2 - ladder.get(e2, 0) for e2, l2 in d.items()]
            l = statistics.fmean(ests) + ladder.get(e, 0)
            out[key] = (math.exp(l), "등급 환산", [])
            continue
        p = prices.get(b)
        if p and p["in"] + p["out"] > 0:
            l = math.log(p["in"] + p["out"]) + k_price + ladder.get(e, 0)
            out[key] = (math.exp(l), "가격 추정", [])
    return out, k_price
