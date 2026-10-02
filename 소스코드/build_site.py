# 인터넷 사이트(GitHub Pages)용 파일 묶기
# GitHub 서버에서 collect.py 다음에 실행된다.
#   python 소스코드/build_site.py _site
#
# 결과:
#   _site/index.html        ← "비공개 페이지" 안내만 (주소 앞부분만 아는 사람은 여기서 막힘)
#   _site/robots.txt        ← 검색 사이트 안내 (프로젝트 주소 아래라 효과는 제한적 — 실제 차단은 각 화면의 noindex)
#   _site/<무작위폴더>/      ← 실제 화면 (링크를 아는 사람만 들어올 수 있음)
#
# 무작위 폴더 이름은 비밀 값에서 만든다 → 저장소 코드·실행 기록에 주소가 드러나지 않는다.
#   · SITE_SECRET (GitHub 비밀 값) 이 있으면 그것으로, 없으면 Artificial Analysis 키로 (예전과 같은 주소)
#   · 주소를 바꾸고 싶으면 GitHub 설정 → Secrets 에 SITE_SECRET 을 새로 넣으면 됨 (키를 바꿔도 주소는 그대로)
import sys

sys.dont_write_bytecode = True

import hashlib
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "웹")
SKIP = {"data.json", "__pycache__"}
# index.html 안의 자기 파일 주소 (http·#·data: 로 시작하지 않는 src/href)
LOCAL_REF = re.compile(r'((?:src|href)=")(?!https?:|#|data:|mailto:)([^"?#]+)(\?v=[^"#]*)?(")')
OG_REF = re.compile(r'(<meta property="og:(?:image|url)" content=")([^"]*)(")')


def site_secret():
    return (os.environ.get("SITE_SECRET") or os.environ.get("AA_API_KEY") or "").strip()


def site_folder(key):
    return "ai-" + hashlib.sha256(("site:" + key).encode("utf-8")).hexdigest()[:20]


def file_hash(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def stamp_refs(html, base_dir):
    """주소마다 파일 내용의 지문을 ?v= 로 붙임 → 바뀐 파일만 새로 받고, 옛 파일이 남아 보이지 않음.
    돌려주는 값: (바뀐 html, 붙인 개수, 없는 파일 목록)"""
    missing = []
    n = 0

    def rep(m):
        nonlocal n
        ref = m.group(2)
        p = os.path.join(base_dir, *ref.split("/"))
        if not os.path.isfile(p):
            missing.append(ref)
            return m.group(0)
        n += 1
        return f"{m.group(1)}{ref}?v={file_hash(p)}{m.group(4)}"
    return LOCAL_REF.sub(rep, html), n, missing


def main(out):
    if not os.path.basename(os.path.abspath(out)).startswith("_site"):
        print(f"출력 폴더 이름은 _site 로 시작해야 해요 (지울 폴더를 잘못 고르는 실수 방지): {out}")
        return 1
    key = site_secret()
    if not key:
        # 빈 안내 페이지만 배포하면 실제 화면이 사라지므로, 실패로 끝내 이번 배포를 건너뜀 (사이트는 직전 배포 유지)
        print("SITE_SECRET·AA_API_KEY 가 없어 사이트를 만들지 않았어요 (GitHub 설정 → Secrets 확인). 사이트는 직전 상태 그대로입니다.")
        return 1
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
    folder = site_folder(key)
    dest = os.path.join(out, folder)
    shutil.copytree(WEB, dest, ignore=lambda d, names: [n for n in names if n in SKIP])
    if not os.path.exists(os.path.join(dest, "data.js")):
        print("data.js 가 없습니다 — collect.py 가 먼저 실행돼야 합니다")
        return 1

    # 앱 설치 정보의 아이콘 주소에도 지문 (index.html 보다 먼저 — 바뀐 설치 정보의 지문이 index.html 에 들어가게)
    mp = os.path.join(dest, "manifest.webmanifest")
    if os.path.exists(mp):
        with open(mp, encoding="utf-8") as f:
            man = f.read()

        def man_rep(m):
            p = os.path.join(dest, *m.group(2).split("/"))
            return f'{m.group(1)}{m.group(2)}?v={file_hash(p)}"' if os.path.isfile(p) else m.group(0)
        man = re.sub(r'("src": ")([^"?]+)(?:\?v=[^"]*)?"', man_rep, man)
        with open(mp, "w", encoding="utf-8") as f:
            f.write(man)
    ip = os.path.join(dest, "index.html")
    with open(ip, encoding="utf-8") as f:
        html = f.read()
    html, n, missing = stamp_refs(html, dest)
    if missing:
        print("index.html 이 부르는 파일이 없어요:", ", ".join(missing))
        return 1
    # 공유 미리보기(카카오톡 등)는 절대 주소가 필요 → 배포 주소를 알면 채움
    base = (os.environ.get("SITE_BASE_URL") or "").rstrip("/")
    if base:
        page = f"{base}/{folder}/"
        html = OG_REF.sub(lambda m: m.group(1) + (page if "og:url" in m.group(0) else page + m.group(2).split("?")[0]) + m.group(3), html)
    with open(ip, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"사이트 준비 완료: {folder[:6]}… (파일 주소 {n}개에 버전 지문)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "_site"))
