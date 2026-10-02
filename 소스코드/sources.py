# 데이터 받아오기
# 각 출처에서 원본 데이터를 내려받아, 공통 형식으로 바꾼다.
# 공통 형식:  {(기본이름, 등급): {"raw": 원래이름, "score": 점수, ...}}
# 파이썬 기본 기능만 사용 (따로 설치할 것 없음)
#
# 튼튼하게 받는 원칙
#  · 기관 응답에 이상한 값이 몇 개 섞여도 그 줄만 건너뛰고 나머지는 받는다 (건너뛴 개수는 기록)
#  · 받은 내용이 깨졌으면(점검 중 화면, 잘린 파일) 저장해 둔 정상 원본을 덮어쓰지 않는다
#  · 새로 받기에 실패하면 저장해 둔 원본을 쓰되, 너무 오래된 것(STALE_LIMIT_HOURS)은 쓰지 않고 실패로 알린다
#  · 저장해 둔 원본을 썼으면 그 날짜를 '갱신일'로 보고한다 (오래된 데이터가 오늘 것처럼 보이지 않게)

import contextlib
import csv
import io
import json
import math
import os
import re
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

from names import split_name

UA = "Mozilla/5.0 (AI-model-compare personal dashboard)"

# 내려받은 파일 임시 보관 장소 (구글 드라이브 밖)
CACHE_DIR = os.environ.get("CACHE_DIR") or (
    r"C:\개발_임시작업\2026-09_AI모델_성능비교판\cache"
    if os.name == "nt" else os.path.join(tempfile.gettempdir(), "ai_compare_cache"))
os.makedirs(CACHE_DIR, exist_ok=True)

STALE_LIMIT_HOURS = 72        # 새로 받기 실패 시 이보다 오래된 원본은 쓰지 않음
TOTAL_TIMEOUT = 120           # 파일 하나를 받는 데 걸릴 수 있는 최대 시간(초) — 조금씩 보내는 서버에서 무한정 기다리지 않게

# 이번 실행에서 실제로 쓴 원본 파일의 시각 (파일이름 → 시각). 새로 받았으면 지금, 저장본을 썼으면 그 파일 시각
USED: dict[str, float] = {}


def log(msg):
    print(msg, flush=True)


# '지금 최신으로 받기' 버튼을 누르면 True → 받아둔 파일을 5분까지만 재사용
FORCE = False
FORCE_MAX_AGE_HOURS = 5 / 60


def _cache_path(name):
    if not name or os.path.basename(name) != name or name in (".", ".."):
        raise ValueError(f"저장 이름이 잘못됨: {name!r}")
    return os.path.join(CACHE_DIR, name)


def _download(url, headers, timeout):
    """한 번 받기 (전체 시간 제한 포함)"""
    deadline = time.time() + TOTAL_TIMEOUT
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        chunks = []
        while True:
            b = r.read(65536)
            if not b:
                break
            chunks.append(b)
            if time.time() > deadline:
                raise TimeoutError(f"{TOTAL_TIMEOUT}초 안에 다 받지 못함")
    return b"".join(chunks)


def _write_atomic(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def fetch(url, name, headers=None, max_age_hours=1, timeout=30, attempts=2, validate=None):
    """URL 내려받기. 1시간 안에 받은 게 있으면 재사용(기관들은 보통 하루 한 번 갱신).
    validate(데이터) 가 예외를 내면 깨진 응답으로 보고 저장하지 않는다.
    실패하면 STALE_LIMIT_HOURS 안의 예전 파일이라도 쓴다."""
    path = _cache_path(name)
    # GitHub 자동 실행: 코드를 고쳐 올릴 때마다 기관에 다시 요청하면 사용 한도(429 오류)에 걸림
    #  → CACHE_MIN_AGE_HOURS 시간 안에 받은 원본은 그대로 재사용
    with contextlib.suppress(ValueError):
        max_age_hours = max(max_age_hours, float(os.environ.get("CACHE_MIN_AGE_HOURS") or 0))
    if FORCE:
        max_age_hours = min(max_age_hours, FORCE_MAX_AGE_HOURS)
    now = time.time()
    if os.path.exists(path):
        age = now - os.path.getmtime(path)
        if 0 <= age < max_age_hours * 3600:     # 파일 시각이 미래(시계 어긋남)면 믿지 않고 새로 받음
            with open(path, "rb") as f:
                USED[name] = os.path.getmtime(path)
                return f.read()
    h = {"User-Agent": UA}
    h.update(headers or {})
    last_err: Exception = OSError(f"{name}: 받기를 시도하지 않음")
    n = max(1, int(attempts))
    for attempt in range(n):
        try:
            data = _download(url, h, timeout)
            if validate:
                validate(data)
            _write_atomic(path, data)
            USED[name] = time.time()
            return data
        except urllib.error.HTTPError as e:
            last_err = e
            if 400 <= e.code < 500 and e.code != 429:
                break                            # 주소·키 문제는 다시 해도 같음
            wait = 2 * (attempt + 1)
            if e.code == 429:
                with contextlib.suppress(TypeError, ValueError):
                    wait = min(30, max(wait, int(e.headers.get("Retry-After") or 0)))
            if attempt < n - 1:
                time.sleep(wait)
        except Exception as e:  # noqa: BLE001 — 네트워크·형식 오류는 몇 번 다시 시도
            last_err = e
            if attempt < n - 1:
                time.sleep(2 * (attempt + 1))
    if os.path.exists(path):
        age_h = (now - os.path.getmtime(path)) / 3600
        if 0 <= age_h <= STALE_LIMIT_HOURS:
            log(f"  ! {name} 새로 받기 실패 → {age_h:.0f}시간 전에 받아 둔 파일 사용 ({last_err})")
            with open(path, "rb") as f:
                USED[name] = os.path.getmtime(path)
                return f.read()
        log(f"  ! {name} 새로 받기 실패, 받아 둔 파일도 {age_h / 24:.1f}일 지나 쓰지 않음")
    raise last_err


def updated_of(*names):
    """쓴 원본들 중 가장 오래된 것의 날짜 (저장본을 썼다면 그 날짜)"""
    ts = [USED[n] for n in names if n in USED]
    return time.strftime("%Y-%m-%d", time.localtime(min(ts))) if ts else time.strftime("%Y-%m-%d")


def _num(v):
    """숫자로 바꾸기 — 비었거나·숫자가 아니거나·무한대·NaN 이면 None"""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        x = float(v)
    elif isinstance(v, str):
        t = v.strip().replace("%", "").replace("$", "").strip()
        if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", t):     # 1,234.5 → 천 단위 쉼표만 지움
            t = t.replace(",", "")
        try:
            x = float(t)
        except ValueError:
            return None
    else:
        return None
    return x if math.isfinite(x) else None


def _excluded(raw, words):
    r = (raw or "").lower()
    return any(w in r for w in words)


def _dict(x) -> dict:
    """사전(dict)이면 그대로, 아니면 빈 사전 — 기관 응답의 형식이 바뀌어도 .get 이 깨지지 않게"""
    return x if isinstance(x, dict) else {}


def _check_zip(data):
    zipfile.ZipFile(io.BytesIO(data)).testzip()


def _check_json(data):
    json.loads(data)


# ───────────────────────── Epoch AI ─────────────────────────
# 그룹 이름으로 합쳐도 되는 '덧붙은 말' (날짜 코드·미리보기·배포 형식 등) — pro·mini 같은 다른 모델 표시는 합치지 않음
_SAFE_EXTRA = re.compile(r"^(\d{2}|\d{4}|\d{6}|preview|exp|experimental|instruct|it|fp8|chat|reasoner|latest|v\d)$")


def _group_base(version_base, group):
    """Epoch 가 같은 모델로 묶어 둔 그룹 이름 → 통일 후보 기본이름 (안전하지 않으면 None)
    · 그룹 이름에 괄호(날짜 구분 등)가 있으면 서로 다른 판을 구분하는 이름이라 합치지 않음
    · 버전 이름에 더 붙은 말이 날짜 코드·미리보기 같은 '덧붙은 말'일 때만 (pro·mini 처럼 다른 모델 표시는 합치지 않음)
    실제로 합칠지는 다른 기관 이름까지 본 뒤 collect 가 정한다 (group_alias)"""
    if not group or "/" in group or "_" in group or "(" in group:
        return None
    gb, _ = split_name(group)
    if not gb or gb == version_base:
        return None
    extra = set(version_base.split("-")) - set(gb.split("-"))
    if extra and all(_SAFE_EXTRA.match(t) for t in extra):
        return gb
    return None


def load_epoch(exclude_words):
    """Epoch AI 벤치마크 모음.
    반환: obs[(기본이름,등급)] = {벤치마크: 정규화점수}, 벤치마크 난이도표, 모델 정보, 비용 기록"""
    data = fetch("https://epoch.ai/data/benchmark_data.zip", "epoch_benchmark_data.zip", validate=_check_zip)
    z = zipfile.ZipFile(io.BytesIO(data))
    names = {os.path.basename(n): n for n in z.namelist()}
    skipped = {"rows": 0}

    def read_csv(fname, need=()):
        if fname not in names:
            if need:
                raise RuntimeError(f"Epoch 원본에 {fname} 파일이 없어요 (형식이 바뀌었을 수 있음)")
            return []
        with z.open(names[fname]) as f:
            rows = list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))
        rows = [{(k or "").strip(): v for k, v in r.items()} for r in rows]
        if need and rows:
            miss = [c for c in need if c not in rows[0]]
            if miss:
                raise RuntimeError(f"Epoch {fname} 에 필요한 열이 없어요: {', '.join(miss)}")
        return rows

    edi = {}
    for r in read_csv("edi_scores.csv", need=("benchmark_name", "edi", "estimated_slope_scaled")):
        d, s = _num(r.get("edi")), _num(r.get("estimated_slope_scaled"))
        if r.get("benchmark_name") and d is not None and s is not None and s > 0:
            edi[r["benchmark_name"]] = (d, s)
        else:
            skipped["rows"] += 1
    bench_meta = read_csv("benchmark_metadata.csv", need=("benchmark", "source_file", "score_column"))
    model_meta = {r["model_version"]: r for r in read_csv("model_metadata.csv") if r.get("model_version")}
    eci = {r["Model"]: r for r in read_csv("eci_scores.csv") if r.get("Model")}

    obs: dict[tuple, dict] = {}          # (base, effort) → {bench: 점수}
    group_alias: dict[str, str] = {}     # 버전 기본이름 → Epoch 그룹 기본이름 (합칠 후보)
    info: dict[str, dict] = {}           # base → {name, company, date}
    for b in bench_meta:
        bname = b.get("benchmark")
        if bname not in edi or not b.get("source_file"):
            continue
        col = b.get("score_column")
        scale = _num(b.get("scale")) or 1.0
        bl = _num(b.get("random_baseline")) or 0.0
        ce = _num(b.get("score_ceiling"))
        ce = 1.0 if ce is None else ce
        if ce - bl <= 0:
            log(f"  ! Epoch {bname}: 만점·찍기 점수 범위가 이상해 건너뜀")
            continue
        for r in read_csv(b["source_file"]):
            ver = r.get("Model version")
            v = _num(r.get(col))
            if not ver or v is None or _excluded(ver, exclude_words):
                continue
            p = min(1.0, max(0.0, (v * scale - bl) / (ce - bl)))
            base, eff = split_name(ver)
            if not base or eff == "unknown":
                continue
            mm = model_meta.get(ver, {})
            gb = _group_base(base, mm.get("model_group"))
            if gb:
                group_alias[base] = gb
            d = obs.setdefault((base, eff), {})
            d[bname] = max(d.get(bname, 0.0), p)   # 같은 벤치마크 여러 번이면 가장 좋은 것 (Epoch 방식)
            inf = info.setdefault(base, {})
            if mm.get("model_group") and not inf.get("group"):
                inf["group"] = mm["model_group"]
            if mm.get("organization") and not inf.get("company"):
                inf["company"] = mm["organization"]
            dt = mm.get("date") or r.get("Release date")
            if dt and not inf.get("date") and re.match(r"^\d{4}-\d{2}-\d{2}", str(dt)):
                inf["date"] = str(dt)[:10]

    # 모델(그룹) 단위 공식 ECI 점수
    for inf in info.values():
        g = inf.get("group")
        if g and g in eci:
            e = _num(eci[g].get("eci"))
            if e is not None:
                inf["eci"] = e
            inf["name"] = eci[g].get("Display name") or g
            dt = eci[g].get("date")
            if not inf.get("date") and dt and re.match(r"^\d{4}-\d{2}-\d{2}", str(dt)):
                inf["date"] = str(dt)[:10]
        elif g and "/" not in g and "_" not in g and split_name(g)[0] != g.lower():
            inf["name"] = g     # 그룹 이름이 사람이 붙인 이름일 때만 (버전 문자열 그대로면 다른 기관 이름을 씀)

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
        rows = read_csv(fname)
        if rows and col not in rows[0]:
            log(f"  ! Epoch {fname}: 비용 열 '{col}' 이 없어 이 비용 출처는 빠짐 (형식이 바뀌었을 수 있음)")
            continue
        logs: dict[tuple, list] = {}
        for r in rows:
            ver = r.get("Model version")
            c = _num(r.get(col))
            if not ver or not c or c <= 0 or _excluded(ver, exclude_words):
                continue
            base, eff = split_name(ver)
            if not base or eff == "unknown":
                continue
            logs.setdefault((base, eff), []).append(math.log(c))
        # 한 점에 여러 실행(예: 생각 한도 1K~64K)이 합쳐지면 가장 싼 것만 고르지 않고 로그 평균 (점수는 여러 실행 중 최고라 비용만 싼 쪽을 고르면 가성비가 부풀려짐)
        d = {k: math.exp(sum(v) / len(v)) for k, v in logs.items()}
        if d:
            costs[label] = d
    if skipped["rows"]:
        log(f"  ! Epoch 원본에서 형식이 이상한 줄 {skipped['rows']}개 건너뜀")
    try:
        y, mo, d = max(zi.date_time for zi in z.infolist())[:3]
        updated = f"{y:04d}-{mo:02d}-{d:02d}"
    except ValueError:
        updated = None
    return {"obs": obs, "edi": edi, "info": info, "costs": costs, "updated": updated, "group_alias": group_alias}


# ───────────────────────── LiveBench ─────────────────────────
def _livebench_dates(js):
    """사이트 코드에서 '문제 세트 공개일 목록'(날짜가 3개 이상 든 배열)을 찾음 → 최신순"""
    best: list[str] = []
    for m in re.finditer(r"\[\s*(\"20\d{2}-\d{2}-\d{2}\"(?:\s*,\s*\"20\d{2}-\d{2}-\d{2}\")+)\s*\]", js):
        ds = re.findall(r"20\d{2}-\d{2}-\d{2}", m.group(1))
        if len(ds) >= 3 and len(ds) > len(best):
            best = ds
    if not best:
        best = re.findall(r'"(20\d{2}-\d{2}-\d{2})"', js)
    return sorted(set(best), reverse=True)


def load_livebench(exclude_words):
    """LiveBench: 매달 새 문제로 채점. 종합 = 분야별 평균의 평균 (사이트와 같은 방식). 이 화면에서는 '비용 기준'으로만 씀"""
    dates: list[str] = []
    try:
        html = fetch("https://livebench.ai/", "livebench_index.html").decode("utf-8", "ignore")
        m = re.search(r'src="\.?(/static/js/main\.[^"]+\.js)"', html)
        if m:
            js = fetch("https://livebench.ai" + m.group(1), "livebench_main.js").decode("utf-8", "ignore")
            dates = _livebench_dates(js)
        else:
            log("  ! LiveBench 첫 화면 구조가 바뀌어 최신 날짜를 못 찾음 → 알려진 날짜로 시도")
    except Exception as e:  # noqa: BLE001 — 날짜 확인이 실패해도 알려진 날짜로 시도
        log(f"  ! LiveBench 최신 날짜 확인 실패: {e}")
    # 사이트 코드에 적힌 날짜 중 가장 최근 문제 세트부터 차례로 시도 (파일이 있는 첫 번째 것을 씀)
    candidates = [d for d in dates if d >= "2026-01-01"][:6]
    if "2026-06-25" not in candidates:
        candidates.append("2026-06-25")
    release = table = cats = cost = None
    for rel in candidates:
        tag = rel.replace("-", "_")
        try:
            t = fetch(f"https://livebench.ai/table_{tag}.csv", f"livebench_table_{tag}.csv", attempts=1).decode("utf-8-sig")
            c = json.loads(fetch(f"https://livebench.ai/categories_{tag}.json", f"livebench_cat_{tag}.json", attempts=1, validate=_check_json))
            if not isinstance(c, dict) or not c:
                raise ValueError("분야 목록 형식이 다름")
            try:
                k = fetch(f"https://livebench.ai/cost_{tag}.csv", f"livebench_cost_{tag}.csv", attempts=1).decode("utf-8-sig")
            except Exception:  # noqa: BLE001 — 비용 파일은 없을 수도 있음
                k = None
            release, table, cats, cost = rel, t, c, k
            break
        except Exception as e:  # noqa: BLE001
            log(f"  ! LiveBench {rel} 받기 실패: {e}")
    if release is None or table is None or cats is None:
        raise RuntimeError("LiveBench 데이터를 받지 못함")

    scores, costs = {}, {}
    for r in csv.DictReader(io.StringIO(table)):
        raw = (r.get("model") or "").strip()
        if not raw or _excluded(raw, exclude_words):
            continue
        cat_means = []
        for tasks in cats.values():
            vals = [_num(r.get(t)) for t in (tasks if isinstance(tasks, list) else [])]
            vals2 = [v for v in vals if v is not None]
            if vals2:
                cat_means.append(sum(vals2) / len(vals2))
        if len(cat_means) < max(3, len(cats) - 1):
            continue
        key = split_name(raw)
        if key[0] and key not in scores:
            scores[key] = {"raw": raw, "score": sum(cat_means) / len(cat_means)}
    if cost:
        logs: dict[tuple, list] = {}
        for r in csv.DictReader(io.StringIO(cost)):
            c = _num(r.get("cost_per_question"))
            raw = (r.get("model") or "").strip()
            if c and c > 0 and raw and not _excluded(raw, exclude_words):
                key = split_name(raw)
                if key[0]:
                    logs.setdefault(key, []).append(math.log(c))
        costs = {k: math.exp(sum(v) / len(v)) for k, v in logs.items()}
    return {"scores": scores, "costs": costs, "updated": release}


# ───────────────────────── Artificial Analysis (키 필요) ─────────────────────────
def aa_key():
    k = os.environ.get("AA_API_KEY")
    if k and k.strip():
        return k.strip()
    p = os.path.join(os.path.dirname(CACHE_DIR), "aa_api_key.txt")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            t = f.read().strip()
            if t:
                return t
    return None


def _display_name(raw):
    """AA 이름에서 괄호(등급 표현)를 뺀 사람이 읽는 이름: 'Qwen3 0.6B (Reasoning)' → 'Qwen3 0.6B'"""
    return re.sub(r"\s*\([^)]*\)", "", raw).strip()


def load_aa(exclude_words):
    key = aa_key()
    if not key:
        raise RuntimeError("API 키 없음 (설명서의 'Artificial Analysis 키 넣기' 참고)")
    items, page = [], 1
    version = None
    used_pages = []
    while page <= 20:
        name = f"aa_page{page}.json"
        d = json.loads(fetch(f"https://artificialanalysis.ai/api/v2/language/models/free?page={page}",
                             name, headers={"x-api-key": key}, max_age_hours=3, validate=_check_json))
        used_pages.append(name)
        if not isinstance(d, dict):
            raise RuntimeError("AA 응답 형식이 다름")
        version = d.get("intelligence_index_version", version)
        got = [x for x in (d.get("data") or []) if isinstance(x, dict)]
        items += got
        pg = _dict(d.get("pagination"))
        if not got or not pg.get("has_more"):
            break
        page += 1
    else:
        log("  ! AA 응답이 20쪽을 넘어 나머지는 받지 않음")
    scores: dict[tuple, dict] = {}
    costs: dict[tuple, float] = {}
    speed: dict[tuple, float] = {}
    info: dict[str, dict] = {}
    dates: dict[tuple, str] = {}
    bad = 0
    for m in items:
        raw = m.get("name") or m.get("slug")
        if not isinstance(raw, str) or not raw.strip() or _excluded(raw, exclude_words):
            continue
        key2 = split_name(raw)
        if not key2[0]:
            bad += 1
            continue
        ev = _dict(m.get("evaluations"))
        s = _num(ev.get("artificial_analysis_intelligence_index"))
        if s is None:
            continue
        rel = str(m.get("release_date") or "")
        # 같은 이름(예: 날짜만 다른 판)이 여러 개면 가장 최근에 나온 것 하나를 통째로 씀 (점수·비용·속도가 서로 다른 판에서 섞이지 않게)
        if key2 in dates and rel <= dates[key2]:
            continue
        dates[key2] = rel
        scores[key2] = {"raw": raw, "score": s}
        cost = _dict(m.get("artificial_analysis_intelligence_index_cost"))
        cpt = _num((_dict(cost.get("cost_per_task"))).get("total_cost"))
        costs.pop(key2, None)
        speed.pop(key2, None)
        if cpt and cpt > 0:
            costs[key2] = cpt
        perf = _dict(m.get("performance"))
        sp = _num(perf.get("median_output_tokens_per_second"))
        if sp and sp > 0:
            speed[key2] = sp
        creator = _dict(m.get("model_creator"))
        prev = info.get(key2[0])
        if prev is None or rel >= (prev.get("date") or ""):
            info[key2[0]] = {"company": creator.get("name"), "date": rel[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", rel) else None,
                             "name": _display_name(raw)}
    if bad:
        log(f"  ! AA 이름을 해석하지 못한 항목 {bad}개 건너뜀")
    if not scores:
        raise RuntimeError("AA 응답에 점수가 없음")
    return {"scores": scores, "costs": costs, "speed": speed, "info": info, "updated": updated_of(*used_pages),
            "version": version}


# ───────────────────────── OpenRouter 가격표 ─────────────────────────
def load_openrouter():
    url, name = "https://openrouter.ai/api/v1/models", "openrouter_models.json"
    used = []
    models = []
    for _ in range(5):
        d = json.loads(fetch(url, name, validate=_check_json))
        used.append(name)
        if not isinstance(d, dict):
            raise RuntimeError("OpenRouter 응답 형식이 다름")
        models += [m for m in (d.get("data") or []) if isinstance(m, dict)]
        nxt = _dict(d.get("links")).get("next")
        if not nxt or not isinstance(nxt, str) or not nxt.startswith("https://openrouter.ai/"):
            break
        url, name = nxt, f"openrouter_models_{len(used) + 1}.json"
    out: dict[str, dict] = {}
    for m in models:
        mid = m.get("id")
        if not isinstance(mid, str) or not mid or mid.startswith(("~", "openrouter/")) or ":" in mid:
            continue
        pr = _dict(m.get("pricing"))
        pin, pout = _num(pr.get("prompt")), _num(pr.get("completion"))
        if pin is None or pout is None or pin < 0 or pout < 0 or (pin == 0 and pout == 0):
            continue
        base, eff = split_name(mid)
        if not base or eff not in ("default", "thinking"):
            # 이름에 등급이 붙은 특수 상품은 건너뜀
            continue
        rs = _dict(m.get("reasoning"))
        created = _num(m.get("created"))
        efforts = rs.get("supported_efforts")
        rec = {"id": mid, "in": pin * 1e6, "out": pout * 1e6, "name": m.get("name") if isinstance(m.get("name"), str) else None,
               "created": time.strftime("%Y-%m-%d", time.gmtime(created)) if created and created > 0 else None,
               "efforts": [str(e) for e in efforts if isinstance(e, str)] if isinstance(efforts, list) else [],
               "default_effort": rs.get("default_effort") if isinstance(rs.get("default_effort"), str) else None,
               "reasoning_mandatory": rs.get("mandatory") if isinstance(rs.get("mandatory"), bool) else None}
        # 같은 기본이름이 여러 개면 원래 id가 더 짧은(정식) 것을 쓴다
        if base not in out or len(mid) < len(out[base]["id"]):
            out[base] = rec
    if not out:
        raise RuntimeError("OpenRouter 가격표가 비어 있음")
    return {"prices": out, "updated": updated_of(*used)}
