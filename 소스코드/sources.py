# 데이터 받아오기
# 각 출처에서 원본 데이터를 내려받아, 공통 형식으로 바꾼다.
# 공통 형식:  {(기본이름, 등급): {"raw": 원래이름, "score": 점수, ...}}
# 파이썬 기본 기능만 사용 (따로 설치할 것 없음)

import csv
import io
import json
import os
import re
import tempfile
import time
import urllib.request
import zipfile

from names import split_name

UA = "Mozilla/5.0 (AI-model-compare personal dashboard)"

# 내려받은 파일 임시 보관 장소 (구글 드라이브 밖)
CACHE_DIR = os.environ.get("CACHE_DIR") or (
    r"C:\개발_임시작업\2026-09_AI모델_성능비교판\cache"
    if os.name == "nt" else os.path.join(tempfile.gettempdir(), "ai_compare_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)


def log(msg):
    print(msg, flush=True)


# '지금 최신으로 받기' 버튼을 누르면 True → 받아둔 파일을 5분까지만 재사용
FORCE = False
FORCE_MAX_AGE_HOURS = 5 / 60


def fetch(url, name, headers=None, max_age_hours=1, timeout=30, attempts=2):
    """URL 내려받기. 1시간 안에 받은 게 있으면 재사용(기관들은 보통 하루 한 번 갱신).
    실패하면 예전 파일이라도 쓴다."""
    path = os.path.join(CACHE_DIR, name)
    if FORCE:
        max_age_hours = min(max_age_hours, FORCE_MAX_AGE_HOURS)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < max_age_hours * 3600:
        with open(path, "rb") as f:
            return f.read()
    h = {"User-Agent": UA}
    h.update(headers or {})
    last_err = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return data
        except Exception as e:  # 네트워크 오류는 몇 번 다시 시도
            last_err = e
            time.sleep(2 * (attempt + 1))
    if os.path.exists(path):
        log(f"  ! {name} 새로 받기 실패 → 예전 파일 사용 ({last_err})")
        with open(path, "rb") as f:
            return f.read()
    raise last_err


def _num(v):
    try:
        if v is None or v == "":
            return None
        return float(str(v).replace("%", "").replace("$", "").replace(",", ""))
    except ValueError:
        return None


def _excluded(raw, words):
    r = raw.lower()
    return any(w in r for w in words)


# ───────────────────────── Epoch AI ─────────────────────────
def load_epoch(exclude_words):
    """Epoch AI 벤치마크 모음.
    반환: obs[(기본이름,등급)] = {벤치마크: 정규화점수}, 벤치마크 난이도표, 모델 정보, 비용 기록"""
    data = fetch("https://epoch.ai/data/benchmark_data.zip", "epoch_benchmark_data.zip")
    z = zipfile.ZipFile(io.BytesIO(data))
    names = {os.path.basename(n): n for n in z.namelist()}

    def read_csv(fname):
        if fname not in names:
            return []
        with z.open(names[fname]) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")))

    edi = {r["benchmark_name"]: (float(r["edi"]), float(r["estimated_slope_scaled"]))
           for r in read_csv("edi_scores.csv")}
    bench_meta = read_csv("benchmark_metadata.csv")
    model_meta = {r["model_version"]: r for r in read_csv("model_metadata.csv") if r["model_version"]}
    eci = {r["Model"]: r for r in read_csv("eci_scores.csv")}

    obs = {}          # (base, effort) → {bench: 점수}
    info = {}         # base → {name, company, date}
    for b in bench_meta:
        bname = b["benchmark"]
        if bname not in edi or not b["source_file"]:
            continue
        col = b["score_column"]
        scale, bl, ce = float(b["scale"] or 1), float(b["random_baseline"] or 0), float(b["score_ceiling"] or 1)
        for r in read_csv(b["source_file"]):
            ver = r.get("Model version")
            v = _num(r.get(col))
            if not ver or v is None or _excluded(ver, exclude_words):
                continue
            p = (v * scale - bl) / (ce - bl)
            p = min(1.0, max(0.0, p))
            base, eff = split_name(ver)
            if not base or eff == "unknown":
                continue
            d = obs.setdefault((base, eff), {})
            d[bname] = max(d.get(bname, 0.0), p)   # 같은 벤치마크 여러 번이면 가장 좋은 것 (Epoch 방식)
            mm = model_meta.get(ver, {})
            inf = info.setdefault(base, {})
            if mm.get("model_group") and not inf.get("group"):
                inf["group"] = mm["model_group"]
            if mm.get("organization") and not inf.get("company"):
                inf["company"] = mm["organization"]
            dt = mm.get("date") or r.get("Release date")
            if dt and not inf.get("date"):
                inf["date"] = dt[:10]

    # 모델(그룹) 단위 공식 ECI 점수
    for base, inf in info.items():
        g = inf.get("group")
        if g and g in eci:
            inf["eci"] = float(eci[g]["eci"])
            inf["name"] = eci[g].get("Display name") or g
            inf["date"] = inf.get("date") or eci[g].get("date")
        elif g:
            inf["name"] = g

    # 비용 기록이 있는 외부 벤치마크들  (파일, 비용 열, 등급 열(없으면 이름에서))
    cost_files = [
        ("deepswe_external.csv", "Mean cost (USD)", "DeepSWE"),
        ("cursorbench_external.csv", "Cost per task", "CursorBench"),
        ("weirdml_v3_external.csv", "Cost per run", "WeirdML v3"),
        ("arc_agi_2_external.csv", "Cost per task", "ARC-AGI-2"),
        ("frontierswe_external.csv", "Average cost (USD)", "FrontierSWE"),
        ("osworld_2_external.csv", "Estimated cost (USD)", "OSWorld 2"),
        ("critpt_external.csv", "Cost", "CritPt"),
        ("proofbench_external.csv", "Cost per test (USD)", "ProofBench"),
    ]
    costs = {}
    for fname, col, label in cost_files:
        d = {}
        for r in read_csv(fname):
            ver = r.get("Model version")
            c = _num(r.get(col))
            if not ver or not c or c <= 0 or _excluded(ver, exclude_words):
                continue
            base, eff = split_name(ver)
            if not base or eff == "unknown":
                continue
            key = (base, eff)
            d[key] = min(d.get(key, c), c) if key in d else c
        if d:
            costs[label] = d
    try:
        updated = "%04d-%02d-%02d" % max(zi.date_time for zi in z.infolist())[:3]
    except ValueError:
        updated = None
    return {"obs": obs, "edi": edi, "info": info, "costs": costs, "updated": updated}


# ───────────────────────── LiveBench ─────────────────────────
def load_livebench(exclude_words):
    """LiveBench: 매달 새 문제로 채점. 종합 = 분야별 평균의 평균 (사이트와 같은 방식)"""
    release = None
    try:
        html = fetch("https://livebench.ai/", "livebench_index.html").decode("utf-8", "ignore")
        m = re.search(r'src="(/static/js/main\.[^"]+\.js)"', html)
        if m:
            js = fetch("https://livebench.ai" + m.group(1), "livebench_main.js").decode("utf-8", "ignore")
            dates = re.findall(r'"(20\d{2}-\d{2}-\d{2})"', js)
            if dates:
                release = max(dates)
    except Exception as e:
        log(f"  ! LiveBench 최신 날짜 확인 실패: {e}")
    candidates = [release] if release else []
    candidates.append("2026-06-25")
    table = cats = cost = None
    for rel in candidates:
        tag = rel.replace("-", "_")
        try:
            table = fetch(f"https://livebench.ai/table_{tag}.csv", f"livebench_table_{tag}.csv").decode("utf-8")
            cats = json.loads(fetch(f"https://livebench.ai/categories_{tag}.json", f"livebench_cat_{tag}.json"))
            try:
                cost = fetch(f"https://livebench.ai/cost_{tag}.csv", f"livebench_cost_{tag}.csv").decode("utf-8")
            except Exception:
                cost = None
            release = rel
            break
        except Exception as e:
            log(f"  ! LiveBench {rel} 받기 실패: {e}")
    if table is None:
        raise RuntimeError("LiveBench 데이터를 받지 못함")

    scores, costs = {}, {}
    for r in csv.DictReader(io.StringIO(table)):
        raw = r["model"]
        if _excluded(raw, exclude_words):
            continue
        cat_means = []
        for cat, tasks in cats.items():
            vals = [_num(r.get(t)) for t in tasks]
            vals = [v for v in vals if v is not None]
            if vals:
                cat_means.append(sum(vals) / len(vals))
        if len(cat_means) < max(3, len(cats) - 1):
            continue
        key = split_name(raw)
        scores[key] = {"raw": raw, "score": sum(cat_means) / len(cat_means)}
    if cost:
        for r in csv.DictReader(io.StringIO(cost)):
            c = _num(r.get("cost_per_question"))
            if c and c > 0 and not _excluded(r["model"], exclude_words):
                costs[split_name(r["model"])] = c
    return {"scores": scores, "costs": costs, "updated": release}


# ───────────────────────── LMArena ─────────────────────────
def load_arena(exclude_words):
    """LMArena(사람 투표 순위). 문체 보정(style control) 전체 순위를 쓴다."""
    base_url = "https://datasets-server.huggingface.co"
    ds = "dataset=lmarena-ai/leaderboard-dataset&config=text_style_control&split=latest"
    rows = []
    # 방법1: 앞에서부터 차례로 읽기 ('전체' 순위가 맨 앞에 있어서 5번쯤이면 끝남, 빠름)
    try:
        off, seen = 0, False
        while off < 3000:
            d = json.loads(fetch(f"{base_url}/rows?{ds}&offset={off}&length=100", f"arena_rows_{off}.json", timeout=25))
            page = [x["row"] for x in d.get("rows", [])]
            ov = [r for r in page if r.get("category") == "overall"]
            rows += ov
            if ov:
                seen = True
            if (seen and len(ov) < len(page)) or not page:
                break
            off += 100
        if not rows:
            raise RuntimeError("'전체' 순위를 찾지 못함")
    except Exception as e:
        # 방법2: 조건 검색 (느릴 때가 있음)
        log(f"  ! LMArena 차례 읽기 실패 → 조건 검색으로 전환 ({e})")
        rows = []
        off = 0
        while True:
            url = f"{base_url}/filter?{ds}&where=%22category%22%3D%27overall%27&offset={off}&length=100"
            d = json.loads(fetch(url, f"arena_filter_{off}.json", timeout=30))
            page = [x["row"] for x in d.get("rows", [])]
            rows += page
            off += 100
            if len(page) < 100 or off >= d.get("num_rows_total", 0):
                break
    scores, updated = {}, None
    for r in rows:
        if r.get("category") != "overall":
            continue
        raw = r["model_name"]
        if _excluded(raw, exclude_words):
            continue
        key = split_name(raw)
        ci = None
        if r.get("rating_upper") is not None and r.get("rating_lower") is not None:
            ci = (r["rating_upper"] - r["rating_lower"]) / 2
        prev = scores.get(key)
        if prev is None or (r.get("vote_count") or 0) > prev.get("votes", 0):
            scores[key] = {"raw": raw, "score": r["rating"], "ci": ci, "votes": r.get("vote_count") or 0,
                           "org": r.get("organization")}
        updated = max(updated or "", str(r.get("leaderboard_publish_date") or "")[:10]) or updated
    if not scores:
        raise RuntimeError("LMArena 순위를 찾지 못함")
    return {"scores": scores, "updated": updated}


# ───────────────────────── Artificial Analysis (키 필요) ─────────────────────────
def aa_key():
    k = os.environ.get("AA_API_KEY")
    if k:
        return k.strip()
    for p in [os.path.join(os.path.dirname(CACHE_DIR), "aa_api_key.txt")]:
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                t = f.read().strip()
                if t:
                    return t
    return None


def load_aa(exclude_words):
    key = aa_key()
    if not key:
        raise RuntimeError("API 키 없음 (설명서의 'Artificial Analysis 키 넣기' 참고)")
    items, page = [], 1
    version = None
    while page <= 10:
        d = json.loads(fetch(f"https://artificialanalysis.ai/api/v2/language/models/free?page={page}",
                             f"aa_page{page}.json", headers={"x-api-key": key}, max_age_hours=3))
        version = d.get("intelligence_index_version", version)
        items += d.get("data", [])
        pg = d.get("pagination") or {}
        if not pg.get("has_more"):
            break
        page += 1
    scores, costs, speed, info = {}, {}, {}, {}
    for m in items:
        raw = m.get("name") or m.get("slug")
        if not raw or _excluded(raw, exclude_words):
            continue
        key2 = split_name(raw)
        ev = m.get("evaluations") or {}
        s = ev.get("artificial_analysis_intelligence_index")
        if s is not None:
            scores[key2] = {"raw": raw, "score": float(s)}
        cost = (m.get("artificial_analysis_intelligence_index_cost") or {})
        cpt = (cost.get("cost_per_task") or {}).get("total_cost")
        if cpt:
            costs[key2] = float(cpt)
        perf = m.get("performance") or {}
        if perf.get("median_output_tokens_per_second"):
            speed[key2] = float(perf["median_output_tokens_per_second"])
        info[key2[0]] = {"company": (m.get("model_creator") or {}).get("name"), "date": m.get("release_date")}
    if not scores:
        raise RuntimeError("AA 응답에 점수가 없음")
    return {"scores": scores, "costs": costs, "speed": speed, "info": info, "updated": time.strftime("%Y-%m-%d"),
            "version": version}


# ───────────────────────── OpenRouter 가격표 ─────────────────────────
def load_openrouter():
    d = json.loads(fetch("https://openrouter.ai/api/v1/models", "openrouter_models.json"))
    out = {}
    for m in d.get("data", []):
        mid = m.get("id", "")
        if mid.startswith("~") or ":" in mid or mid.startswith("openrouter/"):
            continue
        pr = m.get("pricing") or {}
        pin, pout = _num(pr.get("prompt")), _num(pr.get("completion"))
        if pin is None or pout is None or pin < 0 or pout < 0 or (pin == 0 and pout == 0):
            continue
        base, eff = split_name(mid)
        if eff not in ("default", "thinking"):
            # 이름에 등급이 붙은 특수 상품은 건너뜀
            continue
        rec = {"id": mid, "in": pin * 1e6, "out": pout * 1e6, "name": m.get("name"),
               "created": time.strftime("%Y-%m-%d", time.gmtime(m["created"])) if m.get("created") else None,
               "efforts": (m.get("reasoning") or {}).get("supported_efforts") or [],
               "default_effort": (m.get("reasoning") or {}).get("default_effort"),
               "reasoning_mandatory": (m.get("reasoning") or {}).get("mandatory")}
        # 같은 기본이름이 여러 개면 원래 id가 더 짧은(정식) 것을 쓴다
        if base not in out or len(mid) < len(out[base]["id"]):
            out[base] = rec
    return {"prices": out, "updated": time.strftime("%Y-%m-%d")}
