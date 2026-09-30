# 인터넷 사이트(GitHub Pages)용 파일 묶기
# GitHub 서버에서 collect.py 다음에 실행된다.
#   python 소스코드/build_site.py _site
#
# 결과:
#   _site/index.html        ← "비공개 페이지" 안내만 (주소 앞부분만 아는 사람은 여기서 막힘)
#   _site/robots.txt        ← 검색 사이트에 올리지 말라는 표시
#   _site/<무작위폴더>/      ← 실제 화면 (링크를 아는 사람만 들어올 수 있음)
#
# 무작위 폴더 이름은 Artificial Analysis 키에서 만든다 → 저장소 코드에 주소가 드러나지 않는다.
import sys
sys.dont_write_bytecode = True

import hashlib
import os
import shutil
import time

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "웹")


def site_folder(key):
    return "ai-" + hashlib.sha256(("site:" + key).encode("utf-8")).hexdigest()[:20]


def main(out):
    key = (os.environ.get("AA_API_KEY") or "").strip()
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    with open(os.path.join(out, "robots.txt"), "w", encoding="utf-8") as f:
        f.write("User-agent: *\nDisallow: /\n")
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
                '<meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">'
                '<title>비공개 페이지</title></head><body style="font-family:sans-serif;padding:40px;color:#555">'
                '비공개 페이지입니다.</body></html>')
    if not key:
        print("AA_API_KEY 가 없어 화면은 올리지 않았습니다 (GitHub 설정 → Secrets 에 키를 넣어주세요)")
        return 0
    dest = os.path.join(out, site_folder(key))
    skip = {"data.json"}
    shutil.copytree(WEB, dest, ignore=lambda d, names: [n for n in names if n in skip or n == "__pycache__"])
    if not os.path.exists(os.path.join(dest, "data.js")):
        print("data.js 가 없습니다 — collect.py 가 먼저 실행돼야 합니다")
        return 1
    # 브라우저가 예전 파일을 기억해 두고 보여주지 않도록, 파일 이름 뒤에 이번 버전 번호를 붙인다
    stamp = time.strftime("%Y%m%d%H%M")
    ip = os.path.join(dest, "index.html")
    with open(ip, encoding="utf-8") as f:
        html = f.read()
    for name in ("style.css", "app.js", "effort_guide.js", "data.js", "lib/echarts.min.js", "manifest.webmanifest"):
        html = html.replace(f'"{name}"', f'"{name}?v={stamp}"')
    with open(ip, "w", encoding="utf-8") as f:
        f.write(html)
    print("사이트 준비 완료:", site_folder(key)[:6] + "…")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "_site"))
