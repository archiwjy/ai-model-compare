# 데이터 비교 — 이름 정리·계산 코드를 고친 뒤, '같은 원본'으로 결과가 어떻게 달라졌는지 확인한다 (인터넷 사용 안 함)
#
#   python 데이터_비교.py 기준     → 지금 코드로 계산한 결과를 '기준'으로 저장
#   python 데이터_비교.py          → 지금 코드로 다시 계산해서 기준과 비교 (모델 추가·삭제·이름·회사·점수·비용 변화)
#
# 원본: 도구 폴더의 '원본_고정' (없으면 지금 받아 둔 캐시를 복사해서 만듦) → 기관 데이터가 바뀌어도 비교가 흔들리지 않음
import sys

sys.dont_write_bytecode = True

import contextlib
import json
import os
import shutil
import tempfile
import time
import urllib.request
from collections import Counter
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
WIN = os.name == "nt"
TOOLS = os.environ.get("AI_COMPARE_TOOLS") or (
    r"C:\개발_임시작업\2026-09_AI모델_성능비교판\도구" if WIN else os.path.join(os.path.expanduser("~"), ".cache", "ai_compare_tools"))
FROZEN = os.path.join(TOOLS, "원본_고정")
LIVE_CACHE = r"C:\개발_임시작업\2026-09_AI모델_성능비교판\cache" if WIN else os.path.join(tempfile.gettempdir(), "ai_compare_cache")
BASE_FILE = os.path.join(TOOLS, "데이터_기준.json")

with contextlib.suppress(AttributeError, ValueError):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]


def compute():
    """고정 원본으로 수집기를 처음부터 끝까지 돌려 결과(dict)를 돌려줌"""
    if not os.path.isdir(FROZEN) or not os.listdir(FROZEN):
        shutil.copytree(LIVE_CACHE, FROZEN, dirs_exist_ok=True)
    os.environ["CACHE_DIR"] = FROZEN
    os.environ["CACHE_MIN_AGE_HOURS"] = "1000000"
    for k in ("AA_API_KEY", "SITE_BASE_URL", "LAST_GOOD_PATH"):
        os.environ.pop(k, None)
    sys.path.insert(0, SRC)
    import collect
    import sources
    out = tempfile.mkdtemp(prefix="data_cmp_")
    try:
        # AA 는 받아 둔 쪽 파일만 쓰므로 실제 키가 필요 없음 (키 확인만 통과시킴)
        with mock.patch.object(sources, "aa_key", return_value="비교용"), \
                mock.patch.object(collect, "OUT_JS", os.path.join(out, "data.js")), \
                mock.patch.object(collect, "OUT_JSON", os.path.join(out, "data.json")), \
                mock.patch.object(collect, "LAST_GOOD", os.path.join(out, "last.json")), \
                mock.patch.object(urllib.request, "urlopen", side_effect=OSError("인터넷 사용 안 함 (비교용)")), \
                mock.patch.object(time, "sleep"), mock.patch("builtins.print"):
            code = collect.main()
        with open(os.path.join(out, "data.json"), encoding="utf-8") as f:
            data = json.load(f)
    finally:
        shutil.rmtree(out, True)
    return code, data


def summary(d):
    pts = {}
    for m in d["models"]:
        for v in m["variants"]:
            s = v["src"]
            num = sum(x["m"] / x["var"] for x in s.values())
            den = sum(1 / x["var"] for x in s.values())
            pts[m["key"] + "|" + v["effort"]] = {"score": round(num / den, 2) if den else None, "cost": v.get("cost"), "kind": v.get("cost_kind")}
    return {
        "models": {m["key"]: {"name": m["name"], "company": m["company"], "date": m.get("date")} for m in d["models"]},
        "points": pts,
        "cost_sources": d.get("cost_sources"),
        "aa_fit": (d.get("sources", {}).get("aa") or {}).get("fit"),
    }


def compare(a, b):
    lines = []
    ma, mb = a["models"], b["models"]
    gone, new = sorted(set(ma) - set(mb)), sorted(set(mb) - set(ma))
    lines.append(f"모델 {len(ma)} → {len(mb)}  (빠짐 {len(gone)}, 새로 생김 {len(new)})")
    for k in gone[:40]:
        lines.append(f"  − {k}  ({ma[k]['name']})")
    for k in new[:40]:
        lines.append(f"  + {k}  ({mb[k]['name']})")
    for what in ("name", "company"):
        ch = [(k, ma[k][what], mb[k][what]) for k in set(ma) & set(mb) if ma[k][what] != mb[k][what]]
        lines.append(f"{'이름' if what == 'name' else '회사'} 바뀜 {len(ch)}개")
        for k, x, y in sorted(ch)[:40]:
            lines.append(f"  {k}: {x} → {y}")
    dup_a = sum(c - 1 for c in Counter(v["name"] for v in ma.values()).values() if c > 1)
    dup_b = sum(c - 1 for c in Counter(v["name"] for v in mb.values()).values() if c > 1)
    lines.append(f"같은 표시 이름 중복 {dup_a} → {dup_b}")
    pa, pb = a["points"], b["points"]
    lines.append(f"점(모델×등급) {len(pa)} → {len(pb)}")
    sc = [(k, pa[k]["score"], pb[k]["score"]) for k in set(pa) & set(pb) if pa[k]["score"] is not None and pb[k]["score"] is not None and abs(pa[k]["score"] - pb[k]["score"]) >= 0.3]
    lines.append(f"점수 0.3점 이상 바뀐 점 {len(sc)}개")
    for k, x, y in sorted(sc, key=lambda t: -abs(t[1] - t[2]))[:25]:
        lines.append(f"  {k}: {x} → {y}")
    cc = [(k, pa[k]["cost"], pb[k]["cost"]) for k in set(pa) & set(pb) if pa[k]["cost"] and pb[k]["cost"] and abs(pb[k]["cost"] / pa[k]["cost"] - 1) >= 0.05]
    cg = [k for k in set(pa) & set(pb) if bool(pa[k]["cost"]) != bool(pb[k]["cost"])]
    lines.append(f"비용 5% 이상 바뀐 점 {len(cc)}개, 비용이 생기거나 없어진 점 {len(cg)}개")
    for k, x, y in sorted(cc, key=lambda t: -abs(t[2] / t[1] - 1))[:25]:
        lines.append(f"  {k}: {x} → {y}  ({y / x:.2f}배)")
    return lines


def main(argv):
    code, d = compute()
    if code != 0:
        print(f"수집기가 실패했어요 (코드 {code})")
        return 1
    s = summary(d)
    if argv[:1] == ["기준"]:
        os.makedirs(TOOLS, exist_ok=True)
        with open(BASE_FILE, "w", encoding="utf-8") as f:
            json.dump(s, f, ensure_ascii=False)
        print(f"기준 저장: 모델 {len(s['models'])}개, 점 {len(s['points'])}개 → {BASE_FILE}")
        return 0
    if not os.path.exists(BASE_FILE):
        print("기준이 없어요. 먼저 'python 데이터_비교.py 기준' 을 실행하세요.")
        return 1
    with open(BASE_FILE, encoding="utf-8") as f:
        base = json.load(f)
    for line in compare(base, s):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
