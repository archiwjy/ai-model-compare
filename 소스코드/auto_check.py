# 자동 점검 — GitHub 자동 실행(6시간마다)의 마지막에 돈다.
# 사이트는 무슨 일이 있어도 마지막 정상 데이터로 계속 돌아간다. 이 점검은 '정보용' 알림만 보낸다:
#  · 계산·사이트 묶기·올리기 단계가 실패했을 때
#  · 한 기관 데이터를 24시간 넘게 못 받을 때 (점수 기관 · OpenRouter 가격 · LiveBench 비용 기준)
#  · 받을 수 있는 기관만으로 계산 중일 때 (일부 모델이 빠짐)
#  · 처음 보는 추론 등급 이름이 나왔을 때 · 앱 메뉴 이름 안내를 확인한 지 90일이 지났을 때
# 문제가 있으면 GitHub 이슈(알림 메일)를 열고, 해결되면 스스로 닫는다.
#
#   python 소스코드/auto_check.py          → 문제 확인 후 이슈 열기/고치기/닫기 (GH_TOKEN 필요)
#   python 소스코드/auto_check.py --dry    → 이슈는 건드리지 않고 문제만 출력 (시험용)
import sys

sys.dont_write_bytecode = True

import datetime
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "웹", "data.json")
GUIDE = os.path.join(HERE, "웹", "effort_guide.js")
LABEL = "자동점검"
TITLE = "⚠ 성능비교판 자동 점검: 확인이 필요해요"
STALE_HOURS = 24          # 이 시간 넘게 새 데이터를 못 받으면 알림
GUIDE_DAYS = 90           # 앱 메뉴 이름 안내를 다시 확인할 때가 됐는지
KST = datetime.timezone(datetime.timedelta(hours=9))
SCORE_SOURCES = ("Epoch AI", "Artificial Analysis")


def parse_kst(stamp):
    """'2026-09-30 21:24' (한국 시간) → 시각, 해석 못 하면 None"""
    if not isinstance(stamp, str):
        return None
    try:
        return datetime.datetime.strptime(stamp.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=KST)
    except ValueError:
        return None


def now_kst():
    return datetime.datetime.now(KST)


def hours_since(stamp):
    t = parse_kst(stamp)
    return None if t is None else (now_kst() - t).total_seconds() / 3600


def _load_data():
    try:
        with open(DATA, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def _guide_age_days():
    try:
        with open(GUIDE, encoding="utf-8") as f:
            m = re.search(r'EFFORT_GUIDE_DATE\s*=\s*"(\d{4}-\d{2}-\d{2})"', f.read())
    except OSError:
        return None
    if not m:
        return None
    t = datetime.datetime.strptime(m.group(1), "%Y-%m-%d").replace(tzinfo=KST)
    return (now_kst() - t).days


def find_problems():
    out = []
    if os.environ.get("COLLECT_OUTCOME") == "failure":   # 취소(cancelled)·건너뜀(skipped)은 문제가 아님
        out.append("데이터 계산 단계가 오류로 멈췄어요. 사이트는 이전 화면을 그대로 보여 주고 있어요. "
                   "(평가기관 데이터 형식이 바뀌었을 수 있음 → 실행 기록의 오류 메시지 확인 필요)")
    if os.environ.get("BUILD_OUTCOME") == "failure":
        out.append("사이트 파일 묶기가 실패했어요 (비밀 값 SITE_SECRET·AA_API_KEY 확인). 사이트는 이전 화면을 그대로 보여 주고 있어요.")
    if os.environ.get("DEPLOY_RESULT") == "failure":
        out.append("사이트 올리기(GitHub Pages 배포)가 실패했어요. 저장소 설정 → Pages 를 확인해 주세요.")
    d = _load_data()
    if d is None:
        if not out:
            out.append("계산 결과 파일(data.json)이 없거나 형식이 깨졌어요.")
        return out
    hv = d.get("health")
    h = hv if isinstance(hv, dict) else {}
    failed = [x for x in (h.get("failed") or []) if isinstance(x, str)]
    age = hours_since(d.get("generated"))
    mentioned = set()
    if h.get("using_previous") and age is not None and age > STALE_HOURS:
        names = [x for x in failed if x in SCORE_SOURCES] or ["일부 기관"]
        mentioned.update(names)
        out.append(f"{', '.join(names)} 데이터를 {age:.0f}시간째 새로 받지 못하고 있어요 "
                   f"(사이트는 {d.get('generated')} 기준 정상 데이터를 보여 주는 중). 키 만료·주소 변경·사용 한도를 확인해 주세요.")
    partial = [x for x in failed if x in SCORE_SOURCES]
    if partial and not h.get("using_previous"):
        mentioned.update(partial)
        out.append(f"{', '.join(partial)} 데이터를 오래 받지 못해, 받을 수 있는 기관만으로 계산하고 있어요 (일부 모델·등급이 빠짐).")
    sv = h.get("fail_since")
    since = sv if isinstance(sv, dict) else {}
    for name, stamp in since.items():
        hs = hours_since(stamp)
        if name not in mentioned and hs is not None and hs > STALE_HOURS:
            what = {"OpenRouter": "가격표·고를 수 있는 등급", "LiveBench": "비용 기준(문제 1개당)"}.get(name, "데이터")
            out.append(f"{name} {what}를 {hs:.0f}시간째 새로 받지 못하고 있어요 (마지막으로 받은 값을 쓰는 중).")
    new_eff = [x for x in (h.get("new_efforts") or []) if isinstance(x, str)]
    if new_eff:
        out.append(f"처음 보는 추론 등급 이름이 나왔어요: {', '.join(new_eff)} → names.py 의 EFFORT_ORDER·EFFORT_KO 에 한국어 이름을 추가해 주세요.")
    gd = _guide_age_days()
    if gd is not None and gd > GUIDE_DAYS:
        out.append(f"앱 메뉴 이름 안내(웹/effort_guide.js)를 확인한 지 {gd}일이 지났어요. 회사별 앱 메뉴 이름이 바뀌었는지 확인해 주세요.")
    return out


def gh(*args):
    """gh 명령 → (성공여부, 출력). gh 가 없거나 실패해도 예외 없이 False"""
    try:
        r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    except OSError as e:
        return False, str(e)
    return r.returncode == 0, (r.stdout or "").strip() if r.returncode == 0 else (r.stderr or "").strip()


def main():
    problems = find_problems()
    for p in problems:
        print("·", p)
    if not problems:
        print("문제 없음")
    if "--dry" in sys.argv:
        return 0
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo or not os.environ.get("GH_TOKEN"):
        print("GitHub 밖에서 실행 → 알림은 건너뜀")
        return 0
    gh("label", "create", LABEL, "--color", "D93F0B", "--description", "자동 점검 알림", "--force", "-R", repo)
    ok, listed = gh("issue", "list", "-R", repo, "--label", LABEL, "--state", "open", "--json", "number", "--jq", ".[].number")
    if not ok:
        # 목록 확인에 실패했는데 새로 만들면 같은 알림이 계속 쌓임 → 이번에는 건드리지 않음
        print("이슈 목록을 확인하지 못해 이번에는 알림을 건너뜀:", listed[:200])
        return 0
    found = [n for n in listed.split() if n.isdigit()]
    stamp = now_kst().strftime("%Y-%m-%d %H:%M")
    if problems:
        body = ("자동 점검에서 확인이 필요한 일을 찾았어요. (마지막 점검: " + stamp + ", 한국 시간)\n\n" +
                "\n".join(f"- {p}" for p in problems) +
                "\n\n문제가 사라지면 이 알림은 자동으로 닫혀요.")
        if found:
            gh("issue", "edit", found[0], "-R", repo, "--body", body)
        else:
            gh("issue", "create", "-R", repo, "--title", TITLE, "--label", LABEL, "--body", body)
        for n in found[1:]:      # 예전에 중복으로 생긴 알림은 정리
            gh("issue", "close", n, "-R", repo, "--comment", "같은 알림이 하나 더 열려 있어 이것은 닫아요.")
    else:
        for n in found:
            gh("issue", "close", n, "-R", repo, "--comment", f"{stamp} 점검에서 문제가 모두 사라져 자동으로 닫아요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
