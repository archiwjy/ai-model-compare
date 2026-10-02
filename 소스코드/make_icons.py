# 앱 아이콘 만들기 (Pillow 필요: pip install pillow)
#   python make_icons.py            →  웹/icons/ 에 PNG 저장
# 모양 (v7 「지면」): 흰 바탕 + 검은 계단(가성비 경계선) + 옅은 보라 띠(오차 범위) + 보라 핀(각주)
#   · favicon(64px)은 작아서 띠를 빼고 선을 굵게
#   · 마스크용(안드로이드)은 가장자리가 잘려도 되도록 안쪽에 작게
import sys

sys.dont_write_bytecode = True

import os
from itertools import pairwise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "웹", "icons")

WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
PURPLE = (0x7C, 0x6C, 0xF2, 255)
BAND = (0xE2, 0xDC, 0xFF, 255)
STEPS = [(92, 404), (180, 404), (180, 318), (268, 318), (268, 232), (356, 232), (356, 146), (420, 146)]

# 종류별: (확대 비율, 모서리 둥글기, 띠 있음, 계단 굵기, 핀 막대 굵기, 핀 크기, 위치 보정)
MODES = {
    "any": {"k": 0.88, "rx": 96, "band": True, "line": 30, "stick": 16, "pin": 34, "fav": False},
    "mask": {"k": 0.68, "rx": 0, "band": True, "line": 30, "stick": 16, "pin": 34, "fav": False},
    "apple": {"k": 0.82, "rx": 0, "band": True, "line": 30, "stick": 16, "pin": 34, "fav": False},
    "fav": {"k": 1.06, "rx": 84, "band": False, "line": 50, "stick": 26, "pin": 50, "fav": True},
}


def _segments(pts, w, caps):
    """꺾은선(가로·세로만) → 굵기 w 의 사각형들. caps=True 면 양 끝도 w/2 늘림(square), 이음매는 늘 채움(miter)"""
    rects = []
    h = w / 2
    for i, ((x0, y0), (x1, y1)) in enumerate(pairwise(pts)):
        ext0 = h if (i > 0 or caps) else 0
        ext1 = h if (i < len(pts) - 2 or caps) else 0
        if y0 == y1:   # 가로
            a, b = (x0, x1) if x0 <= x1 else (x1, x0)
            e_a, e_b = (ext0, ext1) if x0 <= x1 else (ext1, ext0)
            rects.append((a - e_a, y0 - h, b + e_b, y0 + h))
        else:          # 세로
            a, b = (y0, y1) if y0 <= y1 else (y1, y0)
            e_a, e_b = (ext0, ext1) if y0 <= y1 else (ext1, ext0)
            rects.append((x0 - h, a - e_a, x0 + h, b + e_b))
    return rects


def draw_icon(size, mode="any"):
    from PIL import Image, ImageDraw
    m = MODES[mode]
    s = size * 4                                   # 크게 그린 뒤 줄여서 부드럽게
    f = s / 512
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rx = m["rx"] * f
    if rx > 0:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(rx), fill=WHITE)
    else:
        d.rectangle([0, 0, s, s], fill=WHITE)
    k = m["k"]
    if m["fav"]:
        def tr(x, y):   # translate(-20 10) scale(1.06)
            return ((-20 + x * k) * f, (10 + y * k) * f)
    else:
        def tr(x, y):   # 가운데 기준으로 줄임
            return ((256 - 256 * k + x * k) * f, (266 - 256 * k + y * k) * f)

    def poly_rects(pts, width, caps, color):
        for x0, y0, x1, y1 in _segments(pts, width, caps):
            a, b = tr(x0, y0), tr(x1, y1)
            d.rectangle([a[0], a[1], b[0], b[1]], fill=color)

    if m["band"]:
        poly_rects([(x, y + 34) for x, y in STEPS], 58, False, BAND)
    poly_rects(STEPS, m["line"], True, BLACK)
    sw = m["stick"] / 2
    a, b = tr(356 - sw, 74), tr(356 + sw, 131)
    d.rectangle([a[0], a[1], b[0], b[1]], fill=PURPLE)
    cx, cy = tr(356, 62)
    r = m["pin"] * k * f
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PURPLE)
    return img.resize((size, size), Image.LANCZOS)


def main(out=OUT):
    os.makedirs(out, exist_ok=True)
    jobs = [("icon-192.png", 192, "any"), ("icon-512.png", 512, "any"), ("icon-maskable-512.png", 512, "mask"),
            ("apple-touch-icon.png", 180, "apple"), ("favicon-64.png", 64, "fav")]
    for name, size, mode in jobs:
        draw_icon(size, mode).save(os.path.join(out, name))
    print("아이콘 저장:", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else OUT))
