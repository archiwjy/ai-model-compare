# 성능비교판 열기
# 1) 최신 데이터를 확인·계산 (1시간 안에 받은 원본은 재사용해서 빠름)
# 2) 창 없는 도우미(server.py)를 켜고 → 화면을 http://127.0.0.1:8770 으로 연다
#    (도우미가 있어야 화면 안의 '최신 데이터 받기' 버튼이 동작한다)
# 도우미를 못 켜면 예전처럼 파일로 바로 연다.
import sys

sys.dont_write_bytecode = True

import json
import os
import pathlib
import subprocess
import time
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "웹", "index.html")
PORT = 8770
URL = f"http://127.0.0.1:{PORT}/"


def ping(timeout=1.5):
    try:
        with urllib.request.urlopen(URL + "api/ping", timeout=timeout) as r:
            return json.loads(r.read()).get("app") == "ai-compare"
    except Exception:  # noqa: BLE001 — 꺼져 있음·다른 프로그램·응답 형식 오류 모두 '도우미 없음'
        return False


def start_server():
    """도우미를 창 없이 뒤에서 실행 → 켜졌으면 True (최대 약 8초 기다림)"""
    exe = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not os.path.exists(exe):
        exe = sys.executable
    flags = 0
    if sys.platform == "win32":     # (mypy 가 윈도우 전용 상수를 알아보도록 sys.platform 으로 확인)
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    try:
        proc = subprocess.Popen([exe, "-B", os.path.join(HERE, "server.py")], cwd=HERE, creationflags=flags,
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    except OSError as e:
        print("도우미를 실행하지 못했어요:", e)
        return False
    deadline = time.time() + 8
    while time.time() < deadline:
        time.sleep(0.15)
        if ping(timeout=0.3):
            return True
        if proc.poll() is not None:     # 도우미가 바로 끝남 (예: 다른 프로그램이 8770 을 쓰는 중)
            return ping(timeout=0.5)
    return False


def refresh_via_helper():
    """도우미가 이미 켜져 있으면 도우미에게 맡김 (동시에 두 번 계산하지 않게)"""
    try:
        with urllib.request.urlopen(URL + "api/refresh", timeout=240) as r:
            res = json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        print("확인 중 문제가 생겼어요:", e)
        return
    if res.get("busy"):
        print("이미 데이터를 받는 중이에요. 잠시 뒤 화면에서 다시 확인하세요.")
        return
    for line in res.get("log", []):
        print(line)
    if res.get("ok") is False:
        print("\n최신 데이터를 받지 못했어요. 예전 데이터로 화면을 엽니다.")


def open_browser(url):
    try:
        ok = webbrowser.open(url)
    except Exception:  # noqa: BLE001
        ok = False
    if not ok:
        print("\n브라우저를 자동으로 열지 못했어요. 아래 주소를 브라우저 주소창에 붙여 넣으세요:")
        print("  " + url)
        input("\n엔터를 누르면 이 창이 닫힙니다...")


def main():
    running = ping()
    print("최신 데이터를 확인하는 중입니다... (처음엔 10~30초, 그 뒤 1시간 안에는 1~2초)\n")
    if running:
        refresh_via_helper()
    else:
        try:
            import collect
            if collect.main():
                print("\n데이터를 새로 받지 못했어요. 예전 데이터로 화면을 엽니다.")
        except Exception as e:  # noqa: BLE001 — 계산이 실패해도 화면은 예전 데이터로 열어야 함
            print("\n데이터 계산 중 문제가 생겼어요:", e)
        running = start_server()
    if running:
        open_browser(URL)
    else:
        print("도우미를 켜지 못해 파일로 엽니다. ('최신 데이터 받기' 버튼은 이 방식에선 동작하지 않습니다)")
        open_browser(pathlib.Path(PAGE).as_uri())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        print("\n문제가 생겼습니다:", e)
        input("엔터를 누르면 닫힙니다...")
        sys.exit(1)
