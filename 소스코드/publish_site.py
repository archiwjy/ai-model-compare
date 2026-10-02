# 인터넷 사이트 코드 올리기
# 이 폴더(구글 드라이브)의 코드를 GitHub 저장소로 복사해서 올린다.
# 저장소 작업 폴더는 구글 드라이브 밖(C:\개발_임시작업\...\저장소)에 둔다.
#   python publish_site.py "메시지"              → 전체 검사를 통과하면 바뀐 코드를 지금 브랜치로 올림
#   python publish_site.py "메시지" --검사생략     → 검사 없이 올림 (급할 때만)
# main 브랜치에 올리면 GitHub 가 사이트를 다시 만든다. 다른 브랜치는 검사만 돈다.
import sys

sys.dont_write_bytecode = True

import contextlib
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("AI_COMPARE_REPO") or r"C:\개발_임시작업\2026-09_AI모델_성능비교판\저장소"
SKIP_NAMES = {"__pycache__", "data.js", "data.json", ".mypy_cache", ".ruff_cache", "node_modules", "desktop.ini"}
SKIP_ENDS = (".pyc", ".tmp")

GITIGNORE = "__pycache__/\n*.pyc\n*.tmp\nnode_modules/\n소스코드/웹/data.js\n소스코드/웹/data.json\n_site/\n"


def files_to_publish():
    """저장소에 올릴 파일 목록 [(원본 상대경로, 저장소 안 위치)] — 웹·테스트·검사 폴더는 통째로 (새 파일을 목록에 안 넣는 실수 방지)"""
    out = []
    for name in sorted(os.listdir(HERE)):
        if name.endswith(".py") and os.path.isfile(os.path.join(HERE, name)):
            out.append((name, f"소스코드/{name}"))
    out.append(("이름_보정표.json", "소스코드/이름_보정표.json"))
    for folder in ("웹", "테스트", "검사"):
        for root, dirs, files in os.walk(os.path.join(HERE, folder)):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_NAMES)
            for f in sorted(files):
                if f in SKIP_NAMES or f.endswith(SKIP_ENDS):
                    continue
                rel = os.path.relpath(os.path.join(root, f), HERE).replace(os.sep, "/")
                out.append((rel, "소스코드/" + rel))
    conf = os.path.join(HERE, "사이트_설정")      # GitHub 저장소 안에는 이 폴더가 없음 (.github/workflows 로 들어가 있음)
    for f in sorted(os.listdir(conf)) if os.path.isdir(conf) else ():
        if f.endswith(".yml"):
            out.append((f"사이트_설정/{f}", f".github/workflows/{f}"))
    return out


def git(*args, check=True):
    r = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 실패: {r.stderr.strip()}")
    return r.stdout.strip()


def copy_files(files):
    """목록의 파일을 저장소로 복사하고, 목록에서 빠진 옛 파일은 저장소에서 지움 (사이트에 옛 파일이 계속 올라가지 않게)"""
    os.makedirs(REPO, exist_ok=True)
    keep = set()
    for src, dst in files:
        d = os.path.join(REPO, *dst.split("/"))
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(os.path.join(HERE, *src.split("/")), d)
        keep.add(dst)
    with open(os.path.join(HERE, "저장소_안내.md"), encoding="utf-8") as f:
        readme = f.read()
    with open(os.path.join(REPO, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)
    with open(os.path.join(REPO, ".gitignore"), "w", encoding="utf-8") as f:
        f.write(GITIGNORE)
    if os.path.exists(os.path.join(REPO, ".git")):
        tracked = git("ls-files", "-z", "--", "소스코드", ".github/workflows", check=False).split("\0")
        stale = [p for p in tracked if p and p not in keep]
        for p in stale:
            git("rm", "-q", "--cached", "--", p, check=False)
            with contextlib.suppress(OSError):
                os.remove(os.path.join(REPO, *p.split("/")))
        if stale:
            print(f"목록에서 빠진 옛 파일 {len(stale)}개를 저장소에서 지웠어요: {', '.join(stale[:5])}{' …' if len(stale) > 5 else ''}")


def _rebase_in_progress():
    return any(os.path.exists(os.path.join(REPO, ".git", d)) for d in ("rebase-merge", "rebase-apply"))


def current_branch():
    """지금 브랜치 이름 — 커밋이 하나도 없는 새 저장소에서도 동작 (rev-parse 는 새 저장소에서 오류)"""
    name = git("symbolic-ref", "--short", "-q", "HEAD", check=False)
    if not name:
        raise RuntimeError("저장소가 특정 브랜치에 있지 않아요 (중간에 멈춘 작업이 남아 있음). "
                           f"'{REPO}' 에서 git status 로 상태를 확인해 주세요.")
    return name


def pull_rebase(branch):
    """GitHub 쪽 새 기록을 먼저 받아 내 기록을 그 위에 얹음. 합칠 수 없으면 원래대로 되돌리고 알림"""
    try:
        git("pull", "--rebase", "origin", branch)
    except RuntimeError:
        git("rebase", "--abort", check=False)      # 반쯤 합쳐진 상태로 남지 않게 (내 기록은 그대로 보존)
        raise RuntimeError("GitHub 쪽에서도 같은 파일이 바뀌어 자동으로 합칠 수 없어요 (예: GitHub 웹에서 README 를 고침). "
                           f"원래 상태로 되돌려 놓았어요. '{REPO}' 에서 git pull 로 직접 합친 뒤 다시 실행해 주세요.") from None


def run_checks():
    """전체 검사 실행 → 통과하면 True"""
    print("전체 검사를 먼저 돌립니다 (통과해야 올림)…\n", flush=True)
    r = subprocess.run([sys.executable, "-B", os.path.join(HERE, "검사", "검사.py")], cwd=HERE, check=False)
    return r.returncode == 0


def main():
    args = sys.argv[1:]
    skip = "--검사생략" in args
    msg = next((a for a in args if not a.startswith("--")), "코드 갱신")
    if not skip and not run_checks():
        print("\n검사를 통과하지 못해 올리지 않았어요. 위의 ✗ 안내를 고친 뒤 다시 실행해 주세요.")
        return 1
    try:
        if not os.path.exists(os.path.join(REPO, ".git")):
            os.makedirs(REPO, exist_ok=True)
            git("init", "-b", "main")
        if _rebase_in_progress():               # 예전 실행이 합치기 도중에 멈춘 흔적 → 먼저 되돌림
            git("rebase", "--abort", check=False)
            print("지난번에 멈춘 합치기 작업을 원래대로 되돌렸어요.")
        branch = current_branch()
        copy_files(files_to_publish())
        remote = git("remote", check=False)
        remote_has = False
        if remote:
            git("fetch", "origin", check=False)
            remote_has = bool(git("ls-remote", "--heads", "origin", branch, check=False))
            if remote_has:
                # GitHub 쪽에 새 기록(자동 유지 커밋 등)이 있으면 먼저 맞춤 → 올리기가 거절되지 않게
                git("add", "-A")
                if git("status", "--porcelain"):
                    git("commit", "-m", msg)
                pull_rebase(branch)
        git("add", "-A")
        if git("status", "--porcelain"):
            git("commit", "-m", msg)
        if not remote:
            print("저장소 연결 전이라 기록만 남겼습니다.")
            return 0
        ahead = git("rev-list", "--count", f"origin/{branch}..HEAD", check=False) if remote_has else "1"
        if ahead in ("", "0"):
            print("바뀐 코드가 없습니다.")
            return 0
        git("push", "origin", branch)
        if branch == "main":
            print("올렸습니다. GitHub 가 몇 분 안에 사이트를 다시 만듭니다.")
        else:
            print(f"'{branch}' 브랜치로 올렸습니다. (사이트는 main 에 합쳐야 바뀝니다 · GitHub 에서 검사가 자동으로 돕니다)")
    except RuntimeError as e:
        print(f"\n올리기 실패: {e}\n인터넷 연결·GitHub 로그인(gh auth status)을 확인한 뒤 다시 실행하면 이어서 올립니다.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
