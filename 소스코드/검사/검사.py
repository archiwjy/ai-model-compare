# 전체 검사 — 버튼 하나로 모든 검사를 돌리고 결과를 한국어로 보여 준다.
#
#   python 검사.py              → 전부 (필요한 검사 도구가 없으면 처음 한 번 자동 설치, 1~2분)
#   python 검사.py --빠르게      → 크롬 화면 시험만 빼고 (10초 안팎)
#   python 검사.py --사진        → 화면 시험 때 주요 화면을 사진으로도 저장
#   python 검사.py --단계 파이썬  → 이름에 '파이썬'이 들어간 단계만
#
# 검사 도구(ruff·mypy·ESLint·TypeScript)는 구글 드라이브 밖에 설치한다 (파일 수천 개 동기화 방지):
#   윈도우: C:\개발_임시작업\2026-09_AI모델_성능비교판\도구   그 밖: ~/.cache/ai_compare_tools
#   다른 곳에 두려면 환경 변수 AI_COMPARE_TOOLS 에 폴더를 적는다.
import sys

sys.dont_write_bytecode = True

import contextlib
import glob
import json
import os
import shutil
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
TEST = os.path.join(SRC, "테스트")
WEB = os.path.join(SRC, "웹")
WIN = os.name == "nt"
TOOLS = os.environ.get("AI_COMPARE_TOOLS") or (
    r"C:\개발_임시작업\2026-09_AI모델_성능비교판\도구" if WIN else os.path.join(os.path.expanduser("~"), ".cache", "ai_compare_tools"))
PY_TOOLS = {"ruff": "0.16.10", "mypy": "2.4.0"}

with contextlib.suppress(AttributeError, ValueError):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]


def say(msg=""):
    print(msg, flush=True)


def venv_bin(name):
    return os.path.join(TOOLS, "venv", "Scripts" if WIN else "bin", name + (".exe" if WIN else ""))


def node_js(*parts):
    return os.path.join(TOOLS, "node_modules", *parts)


def run(cmd, cwd=SRC, env=None, stream=False):
    """명령 실행 → (성공여부, 출력)"""
    e = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8", PYTHONUTF8="1", NO_COLOR="1")
    e.pop("FORCE_COLOR", None)
    e.update(env or {})
    try:
        if stream:   # 오래 걸리는 단계는 진행 상황을 바로바로 보여 줌
            p = subprocess.Popen(cmd, cwd=cwd, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            lines = []
            assert p.stdout is not None
            for line in p.stdout:
                lines.append(line)
                print("      " + line.rstrip(), flush=True)
            return p.wait() == 0, "".join(lines)
        r = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
        return r.returncode == 0, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError as ex:
        return False, f"실행 파일을 찾지 못했어요: {ex}"


# ───────── 도구 준비 (처음 한 번)
def ensure_tools():
    """검사 도구 설치 확인 → 문제가 있으면 한국어 안내 문장, 없으면 None"""
    os.makedirs(TOOLS, exist_ok=True)
    stamp_path = os.path.join(TOOLS, "설치_기록.json")
    try:
        with open(stamp_path, encoding="utf-8") as f:
            stamp = json.load(f)
    except (OSError, ValueError):
        stamp = {}
    with open(os.path.join(HERE, "package.json"), encoding="utf-8") as f:
        pkg = f.read()
    want = {"py": PY_TOOLS, "pkg": pkg}

    if stamp.get("py") != PY_TOOLS or not os.path.exists(venv_bin("ruff")) or not os.path.exists(venv_bin("mypy")):
        say("    · 파이썬 검사 도구 설치 중 (처음 한 번)…")
        if not os.path.exists(venv_bin("python")):
            ok, out = run([sys.executable, "-m", "venv", os.path.join(TOOLS, "venv")])
            if not ok:
                return "가상 환경을 만들지 못했어요:\n" + out[-800:]
        ok, out = run([venv_bin("python"), "-m", "pip", "install", "-q", "--disable-pip-version-check", *[f"{k}=={v}" for k, v in PY_TOOLS.items()]])
        if not ok:
            return "ruff·mypy 설치 실패 (인터넷 연결 확인):\n" + out[-800:]

    npm = shutil.which("npm")
    if not shutil.which("node") or not npm:
        return "Node.js 가 없어요 → https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
    ok, ver = run(["node", "--version"])
    major = int(ver.strip().lstrip("v").split(".")[0]) if ok and ver.strip().lstrip("v").split(".")[0].isdigit() else 0
    if major < 22:      # 화면 시험이 쓰는 WebSocket 은 Node.js 22 부터 기본으로 들어 있음
        return f"Node.js 22 이상이 필요해요 (지금 {ver.strip() or '알 수 없음'}) → https://nodejs.org 에서 LTS 버전을 설치해 주세요."
    if stamp.get("pkg") != pkg or not os.path.exists(node_js("eslint", "bin", "eslint.js")) or not os.path.exists(node_js("typescript", "bin", "tsc")):
        say("    · 화면 코드 검사 도구 설치 중 (처음 한 번)…")
        shutil.copy(os.path.join(HERE, "package.json"), os.path.join(TOOLS, "package.json"))
        ok, out = run([npm, "install", "--no-audit", "--no-fund", "--loglevel=error"], cwd=TOOLS)
        if not ok:
            return "ESLint·TypeScript 설치 실패 (인터넷 연결 확인):\n" + out[-800:]
    shutil.copy(os.path.join(HERE, "eslint.config.mjs"), os.path.join(TOOLS, "eslint.config.mjs"))
    with open(stamp_path, "w", encoding="utf-8") as f:
        json.dump(want, f, ensure_ascii=False)
    return None


# ───────── 검사 단계
def py_files():
    out = sorted(glob.glob(os.path.join(SRC, "*.py")))
    out += sorted(glob.glob(os.path.join(TEST, "*.py")))
    out += sorted(glob.glob(os.path.join(HERE, "*.py")))
    return out


def step_ruff():
    return run([venv_bin("ruff"), "check", "--no-cache", "--output-format", "concise", "--config", os.path.join(HERE, "ruff.toml"), *py_files()])


def step_mypy():
    # 윈도우·리눅스 두 번 확인 — GitHub 자동 검사는 리눅스에서 돌아서, 윈도우 전용 코드가 거기서만 오류날 수 있음
    outs = []
    for plat in ("win32", "linux"):
        ok, out = run([venv_bin("mypy"), "--config-file", os.path.join(HERE, "mypy.ini"), "--platform", plat,
                       "--cache-dir", os.path.join(TOOLS, ".mypy_cache", plat), *py_files()],
                      env={"MYPYPATH": os.pathsep.join([SRC, TEST])})
        outs.append(f"[{plat}] {out.strip()}")
        if not ok:
            return False, "\n".join(outs)
    return True, "\n".join(outs)


def step_unittest():
    return run([sys.executable, "-B", "-m", "unittest", "discover", "-s", TEST, "-t", TEST, "-p", "test_*.py"], cwd=TEST)


def js_files():
    return ["웹/app.js", "웹/core.js", "웹/sw.js", "웹/effort_guide.js", "테스트", "검사"]


def step_eslint():
    return run(["node", node_js("eslint", "bin", "eslint.js"), "-c", os.path.join(TOOLS, "eslint.config.mjs"), "--max-warnings", "0", *js_files()])


def step_tsc():
    tsc = ["node", node_js("typescript", "bin", "tsc"), "--noEmit", "--allowJs", "--checkJs", "--skipLibCheck", "--target", "es2022", "--pretty", "false"]
    types = os.path.join("검사", "types.d.ts")
    runs = [
        # 계산 모듈은 가장 엄격하게
        [*tsc, "--strict", "--lib", "es2022,dom", os.path.join("웹", "core.js"), types],
        # 화면 코드
        [*tsc, "--strict", "false", "--lib", "es2022,dom,dom.iterable", os.path.join("웹", "app.js"), os.path.join("웹", "effort_guide.js"), types],
        # 서비스 워커
        [*tsc, "--strict", "--lib", "es2022,webworker", os.path.join("웹", "sw.js")],
    ]
    ok_all, outs = True, []
    for cmd in runs:
        ok, out = run(cmd)
        ok_all = ok_all and ok
        if out.strip():
            outs.append(out)
    return ok_all, "\n".join(outs)


def step_node_tests():
    files = sorted(glob.glob(os.path.join(TEST, "*.test.mjs")))
    return run(["node", "--test", "--test-reporter=spec", *files])


def step_browser(shots=False):
    cmd = ["node", os.path.join(TEST, "화면_시험.mjs")]
    if shots:
        cmd.append("--shots")
    return run(cmd, cwd=TEST, env={"SHOT_DIR": os.path.join(TOOLS, "시험_사진")}, stream=True)


HINTS = {
    "ruff": "파이썬 코드의 버그 모양·안 쓰는 변수 등이에요. 위 줄의 파일:줄 번호를 고치면 됩니다.",
    "mypy": "파이썬 값의 종류(타입)가 맞지 않는 곳이에요.",
    "unittest": "파이썬 시험이 실패했어요. FAIL/ERROR 아래에 어떤 기대가 어긋났는지 나와 있어요.",
    "eslint": "화면 코드의 버그 모양이에요. 파일 이름 아래 줄:칸 번호를 보세요.",
    "tsc": "화면 코드 값의 종류(타입)가 맞지 않는 곳이에요.",
    "node": "화면 계산(core.js)이나 저장 도우미(sw.js) 시험이 실패했어요.",
    "browser": "실제 화면 시험이 실패했어요. ✗ 표시된 줄이 문제예요. 크롬이 없다면 크롬을 설치해 주세요.",
}


def main(argv):
    quick = "--빠르게" in argv or "--quick" in argv
    shots = "--사진" in argv or "--shots" in argv
    only = argv[argv.index("--단계") + 1] if "--단계" in argv and argv.index("--단계") + 1 < len(argv) else None
    steps = ALL_STEPS = [
        ("파이썬 버그·문법 검사 (ruff)", "ruff", step_ruff),
        ("파이썬 타입 검사 (mypy)", "mypy", step_mypy),
        ("파이썬 시험 (수집·계산·도우미·사이트)", "unittest", step_unittest),
        ("화면 코드 버그·문법 검사 (ESLint)", "eslint", step_eslint),
        ("화면 코드 타입 검사 (TypeScript)", "tsc", step_tsc),
        ("화면 계산·저장 시험 (core.js · sw.js)", "node", step_node_tests),
        ("화면 자동 시험 (크롬으로 실제 화면)", "browser", lambda: step_browser(shots)),
    ]
    if quick:
        steps = [s for s in steps if s[1] != "browser"]
    if only:
        steps = [s for s in steps if only in s[0] or only == s[1]]
    if not steps:
        # 단계 이름을 잘못 치면 아무것도 검사하지 않았는데 '통과'로 보이면 안 됨
        say(f"  ✗ '{only or ''}' 에 맞는 검사 단계가 없어요. 쓸 수 있는 이름: " + ", ".join(k for _, k, _ in ALL_STEPS)
            + " (또는 제목 일부: 파이썬, 화면, 크롬 …)" + (" · --빠르게 를 함께 주면 화면 자동 시험은 빠져요" if quick else ""))
        return 2
    say("━━━━━━━━ AI 모델 성능비교판 전체 검사 ━━━━━━━━")
    t0 = time.time()
    say("[준비] 검사 도구 확인")
    problem = ensure_tools()
    if problem:
        say("  ✗ " + problem)
        return 2
    results = []
    for i, (title, key, fn) in enumerate(steps, 1):
        say(f"[{i}/{len(steps)}] {title} …")
        t = time.time()
        ok, out = fn()
        dt = time.time() - t
        results.append((title, ok, dt))
        if ok:
            say(f"  ✓ 통과 ({dt:.1f}초)")
        else:
            say(f"  ✗ 실패 ({dt:.1f}초) — {HINTS[key]}")
            if key != "browser":   # 화면 시험은 이미 줄마다 보여 줌
                tail = out.strip().splitlines()[-60:]
                for line in tail:
                    say("      " + line)
    say("━━━━━━━━ 결과 ━━━━━━━━")
    for title, ok, dt in results:
        say(f"  {'✓' if ok else '✗'} {title}  ({dt:.1f}초)")
    n_ok = sum(1 for _, ok, _ in results if ok)
    say(f"  → {n_ok}/{len(results)} 통과 · 전체 {time.time() - t0:.0f}초")
    if n_ok == len(results):
        say("  모든 검사를 통과했어요.")
        return 0
    say("  실패한 단계가 있어요. 위의 ✗ 안내를 보고 고친 뒤 다시 실행해 주세요.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
