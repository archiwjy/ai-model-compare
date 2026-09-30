# 자동 점검 — GitHub 자동 실행(6시간마다)의 마지막에 돈다.
# 사이트는 무슨 일이 있어도 마지막 정상 데이터로 계속 돌아간다. 이 점검은 '정보용' 알림만 보낸다:
# 계산 단계 오류, 또는 한 기관 데이터를 24시간 넘게 못 받을 때 GitHub 이슈(알림 메일)를 열고, 해결되면 스스로 닫는다.
#
#   python 소스코드/auto_check.py          → 문제 확인 후 이슈 열기/고치기/닫기 (GH_TOKEN 필요)
#   python 소스코드/auto_check.py --dry    → 이슈는 건드리지 않고 문제만 출력 (시험용)
import sys
sys.dont_write_bytecode = True

import datetime
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "웹", "data.json")
LABEL = "자동점검"
TITLE = "⚠ 성능비교판 자동 점검: 확인이 필요해요"
STALE_HOURS = 24          # 이 시간 넘게 새 데이터를 못 받으면 알림


def hours_since(stamp):
    """'2026-09-30 21:24' (한국 시간) 이 지금부터 몇 시간 전인지"""
    try:
        t = datetime.datetime.strptime(stamp, "%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return None
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=9)
    return (now - t).total_seconds() / 3600


def find_problems():
    out = []
    outcome = os.environ.get("COLLECT_OUTCOME")
    if outcome and outcome != "success":
        out.append("데이터 계산 단계가 오류로 멈췄어요. 사이트는 이전 화면을 그대로 보여 주고 있어요. "
                   "(평가기관 데이터 형식이 바뀌었을 수 있음 → 실행 기록의 오류 메시지 확인 필요)")
    try:
        with open(DATA, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = None
        if not out:
            out.append("계산 결과 파일(data.json)이 없어요.")
    if d:
        h = d.get("health") or {}
        age = hours_since(d.get("generated"))
        if h.get("using_previous") and age is not None and age > STALE_HOURS:
            out.append(f"{', '.join(h.get('failed') or ['일부 기관'])} 데이터를 {age:.0f}시간째 새로 받지 못하고 있어요 "
                       f"(사이트는 {d.get('generated')} 기준 정상 데이터를 보여 주는 중). 키 만료·주소 변경·사용 한도를 확인해 주세요.")
    return out


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
    return r.stdout.strip() if r.returncode == 0 else None


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
    found = gh("issue", "list", "-R", repo, "--label", LABEL, "--state", "open", "--json", "number", "--jq", ".[0].number")
    stamp = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")
    if problems:
        body = ("자동 점검에서 확인이 필요한 일을 찾았어요. (마지막 점검: " + stamp + ", 한국 시간)\n\n" +
                "\n".join(f"- {p}" for p in problems) +
                "\n\n문제가 사라지면 이 알림은 자동으로 닫혀요.")
        if found:
            gh("issue", "edit", found, "-R", repo, "--body", body)
        else:
            gh("issue", "create", "-R", repo, "--title", TITLE, "--label", LABEL, "--body", body)
    elif found:
        gh("issue", "close", found, "-R", repo, "--comment", f"{stamp} 점검에서 문제가 모두 사라져 자동으로 닫아요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
