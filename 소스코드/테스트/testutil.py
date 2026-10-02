# 시험 공통 준비
#  · 소스코드 폴더를 불러올 수 있게 경로에 넣음
#  · 받아 둔 원본(캐시)·키 파일은 시험용 임시 폴더를 쓰게 함 → 실제 캐시·구글 드라이브를 건드리지 않음
#  · 인터넷에 실제로 접속하지 않음 (각 시험이 sources.fetch 를 가짜로 바꿔 끼움)
import os
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

TMP = tempfile.mkdtemp(prefix="ai_compare_test_")
os.environ["CACHE_DIR"] = os.path.join(TMP, "cache")
os.environ.pop("AA_API_KEY", None)
os.environ.pop("SITE_BASE_URL", None)
os.environ.pop("CACHE_MIN_AGE_HOURS", None)

WEB = os.path.join(SRC, "웹")
REAL_DATA = os.path.join(WEB, "data.json")
