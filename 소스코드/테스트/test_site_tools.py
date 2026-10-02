# 사이트 묶기(build_site.py) · 자동 점검(auto_check.py) · 올리기(publish_site.py) · 아이콘(make_icons.py) 시험
import json
import os
import re
import shutil
import tempfile
import unittest
from unittest import mock

import testutil
import auto_check
import build_site
import publish_site


class BuildSite(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="build_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.out = os.path.join(self.dir, "_site")

    def build(self, key="시험키", data=True):
        # 웹 폴더를 임시로 복사하고, data.js 는 고정 시험 데이터로 만들어 넣음 (실제 데이터·GitHub 환경과 무관하게)
        web = os.path.join(self.dir, "웹")
        shutil.rmtree(web, ignore_errors=True)
        shutil.copytree(testutil.WEB, web, ignore=shutil.ignore_patterns("data.js", "data.json"))
        if data:
            with open(os.path.join(testutil.HERE, "시험_데이터.json"), encoding="utf-8") as f:
                txt = f.read()
            with open(os.path.join(web, "data.js"), "w", encoding="utf-8") as f:
                f.write("window.MODEL_DATA=" + txt + ";\n")
            with open(os.path.join(web, "data.json"), "w", encoding="utf-8") as f:
                f.write(txt)
        env = {"AA_API_KEY": key} if key else {}
        with mock.patch.object(build_site, "WEB", web), mock.patch.dict(os.environ, env, clear=False), mock.patch("builtins.print"):
            if not key:
                os.environ.pop("AA_API_KEY", None)
            return build_site.main(self.out)

    def test_folder_and_stamps(self):
        self.assertEqual(self.build(), 0)
        folder = build_site.site_folder("시험키")
        self.assertRegex(folder, r"^ai-[0-9a-f]{20}$")
        dest = os.path.join(self.out, folder)
        self.assertTrue(os.path.exists(os.path.join(dest, "data.js")))
        self.assertFalse(os.path.exists(os.path.join(dest, "data.json")))   # 큰 원본은 올리지 않음
        with open(os.path.join(dest, "index.html"), encoding="utf-8") as f:
            html = f.read()
        # index.html 이 부르는 모든 자기 파일에 버전 번호가 붙어야 함 (예전 파일이 남아 보이는 문제 방지)
        local = re.findall(r'(?:src|href)="(?!https?:|#|data:)([^"]+)"', html)
        self.assertTrue(local)
        for ref in local:
            with self.subTest(ref=ref):
                self.assertIn("?v=", ref)
                self.assertTrue(os.path.exists(os.path.join(dest, ref.split("?")[0])), ref)
        with open(os.path.join(self.out, "robots.txt"), encoding="utf-8") as f:
            self.assertIn("Disallow: /", f.read())
        with open(os.path.join(self.out, "index.html"), encoding="utf-8") as f:
            front = f.read()
        self.assertNotIn(folder, front)      # 비밀 폴더 이름이 앞 화면에 드러나지 않음
        self.assertIn("noindex", front)

    def test_no_key_fails_instead_of_empty_site(self):
        # 키가 없으면 빈 안내 페이지로 사이트를 덮지 않고 실패로 끝내야 함 (직전 배포 유지)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SITE_SECRET", None)
            self.assertEqual(self.build(key=None), 1)
        self.assertFalse(os.path.exists(self.out))

    def test_missing_data_fails(self):
        self.assertEqual(self.build(data=False), 1)

    def test_same_key_same_folder(self):
        self.assertEqual(build_site.site_folder("a"), build_site.site_folder("a"))
        self.assertNotEqual(build_site.site_folder("a"), build_site.site_folder("b"))

    def test_site_secret_wins(self):
        with mock.patch.dict(os.environ, {"SITE_SECRET": "주소용", "AA_API_KEY": "키"}):
            self.assertEqual(build_site.site_secret(), "주소용")
        with mock.patch.dict(os.environ, {"AA_API_KEY": "키"}):
            os.environ.pop("SITE_SECRET", None)
            self.assertEqual(build_site.site_secret(), "키")

    def test_refuses_dangerous_output_folder(self):
        with mock.patch("builtins.print"):
            self.assertEqual(build_site.main(testutil.WEB), 1)
        self.assertTrue(os.path.isdir(testutil.WEB))

    def test_share_preview_gets_absolute_address(self):
        with mock.patch.dict(os.environ, {"SITE_BASE_URL": "https://x.github.io/repo"}):
            self.assertEqual(self.build(), 0)
        with open(os.path.join(self.out, build_site.site_folder("시험키"), "index.html"), encoding="utf-8") as f:
            html = f.read()
        for m in re.findall(r'<meta property="og:(?:image|url)" content="([^"]+)"', html):
            self.assertTrue(m.startswith("https://x.github.io/repo/ai-"), m)

    def test_unchanged_file_keeps_same_version(self):
        # 내용이 같은 파일은 다시 묶어도 같은 버전 지문 → 방문자가 1MB 그래프 도구를 매번 다시 받지 않음
        self.assertEqual(self.build(), 0)
        with open(os.path.join(self.out, build_site.site_folder("시험키"), "index.html"), encoding="utf-8") as f:
            a = re.findall(r'lib/echarts\.min\.js\?v=([0-9a-f]+)', f.read())
        self.assertEqual(self.build(), 0)
        with open(os.path.join(self.out, build_site.site_folder("시험키"), "index.html"), encoding="utf-8") as f:
            b = re.findall(r'lib/echarts\.min\.js\?v=([0-9a-f]+)', f.read())
        self.assertTrue(a)
        self.assertEqual(a, b)


class AutoCheck(unittest.TestCase):
    def problems(self, data, outcome=None, now_kst="2026-10-03 12:00"):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        p = os.path.join(d, "data.json")
        if data is not None:
            with open(p, "w", encoding="utf-8") as f:
                f.write(data if isinstance(data, str) else json.dumps(data))
        env = {"COLLECT_OUTCOME": outcome} if outcome else {}
        with mock.patch.object(auto_check, "DATA", p), mock.patch.dict(os.environ, env, clear=False), \
                mock.patch.object(auto_check, "now_kst", return_value=auto_check.parse_kst(now_kst)):
            if not outcome:
                os.environ.pop("COLLECT_OUTCOME", None)
            return auto_check.find_problems()

    def test_all_fine(self):
        self.assertEqual(self.problems({"generated": "2026-10-03 09:00", "health": {"failed": []}}), [])

    def test_collect_step_failed(self):
        self.assertTrue(self.problems({"generated": "2026-10-03 09:00"}, outcome="failure"))

    def test_stale_previous(self):
        old = {"generated": "2026-10-01 09:00", "health": {"using_previous": True, "failed": ["Artificial Analysis"]}}
        out = self.problems(old)
        self.assertEqual(len(out), 1)
        self.assertIn("Artificial Analysis", out[0])

    def test_fresh_previous_is_fine(self):
        self.assertEqual(self.problems({"generated": "2026-10-03 06:00", "health": {"using_previous": True, "failed": ["x"]}}), [])

    def test_missing_or_broken_file(self):
        self.assertTrue(self.problems(None))
        self.assertTrue(self.problems("{망가짐"))
        self.assertTrue(self.problems("[1,2,3]"))

    def test_hours_since_bad_input(self):
        for s in (None, "", "어제", "2026-13-40 99:99", 5):
            self.assertIsNone(auto_check.hours_since(s))

    def test_no_gh_command_does_not_crash(self):
        env = {"GITHUB_REPOSITORY": "a/b", "GH_TOKEN": "t"}
        with mock.patch.dict(os.environ, env), mock.patch.object(auto_check, "find_problems", return_value=["문제"]), \
                mock.patch("subprocess.run", side_effect=FileNotFoundError("gh 없음")), mock.patch("builtins.print"), \
                mock.patch("sys.argv", ["auto_check.py"]):
            self.assertEqual(auto_check.main(), 0)


class Publish(unittest.TestCase):
    def test_every_listed_file_exists(self):
        files = publish_site.files_to_publish()
        self.assertTrue(files)
        for src, dst in files:
            with self.subTest(src=src):
                self.assertTrue(os.path.isfile(os.path.join(testutil.SRC, *src.split("/"))), src)
                self.assertFalse(dst.startswith("/") or ".." in dst.split("/"))

    def test_web_files_are_all_published(self):
        # 웹 폴더의 화면 파일(index.html 이 부르는 것)이 빠짐없이 올라가야 함 — 새 파일을 만들고 목록에 안 넣는 실수 방지
        dsts = {d for _, d in publish_site.files_to_publish()}
        with open(os.path.join(testutil.WEB, "index.html"), encoding="utf-8") as f:
            html = f.read()
        for ref in re.findall(r'(?:src|href)="(?!https?:|#|data:)([^"?]+)', html):
            if ref == "data.js":      # 수집기가 GitHub 에서 만드는 파일
                continue
            with self.subTest(ref=ref):
                self.assertIn("소스코드/웹/" + ref, dsts)

    def test_tests_and_checks_are_published(self):
        dsts = {d for _, d in publish_site.files_to_publish()}
        self.assertTrue(any(d.startswith("소스코드/테스트/") for d in dsts))
        self.assertTrue(any(d.startswith("소스코드/검사/") for d in dsts))
        self.assertFalse(any("__pycache__" in d or d.endswith(".pyc") for d in dsts))

    def test_pushes_current_branch(self):
        calls = []

        def fake_git(*args, check=True):
            calls.append(args)
            if args[:2] == ("rev-parse", "--abbrev-ref"):
                return "feature/x"
            if args[:1] == ("status",):
                return " M 파일"
            if args[:1] == ("remote",):
                return "origin"
            return ""
        with mock.patch.object(publish_site, "git", fake_git), mock.patch.object(publish_site, "copy_files"), \
                mock.patch.object(publish_site, "run_checks", return_value=True), mock.patch("builtins.print"), \
                mock.patch("sys.argv", ["publish_site.py", "메시지"]):
            self.assertEqual(publish_site.main(), 0)
        self.assertIn(("push", "origin", "feature/x"), calls)

    def test_failed_checks_block_publish(self):
        with mock.patch.object(publish_site, "run_checks", return_value=False), mock.patch.object(publish_site, "git") as g, \
                mock.patch.object(publish_site, "copy_files"), mock.patch("builtins.print"), mock.patch("sys.argv", ["publish_site.py", "메시지"]):
            self.assertEqual(publish_site.main(), 1)
        self.assertFalse(any(c.args[:1] == ("push",) for c in g.call_args_list))


class Icons(unittest.TestCase):
    def test_make_icons(self):
        try:
            import make_icons
        except ImportError:
            self.skipTest("Pillow 없음")
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        with mock.patch("builtins.print"):
            make_icons.main(d)
        from PIL import Image
        sizes = {"icon-192.png": 192, "icon-512.png": 512, "icon-maskable-512.png": 512, "apple-touch-icon.png": 180, "favicon-64.png": 64}
        for name, size in sizes.items():
            with self.subTest(name=name):
                im = Image.open(os.path.join(d, name)).convert("RGBA")
                self.assertEqual(im.size, (size, size))
                px = [im.getpixel((x, y)) for x in range(0, size, max(1, size // 32)) for y in range(0, size, max(1, size // 32))]
                self.assertTrue(any(p[0] > 240 and p[1] > 240 and p[2] > 240 and p[3] > 200 for p in px), "흰 바탕")
                self.assertTrue(any(p[0] < 30 and p[1] < 30 and p[2] < 30 and p[3] > 200 for p in px), "검은 계단")
                self.assertTrue(any(abs(p[0] - 0x7C) < 30 and abs(p[1] - 0x6C) < 30 and abs(p[2] - 0xF2) < 30 for p in px), "보라 핀")

    def test_real_icons_match_current_design(self):
        from PIL import Image
        im = Image.open(os.path.join(testutil.WEB, "icons", "icon-512.png")).convert("RGBA")
        self.assertGreater(im.getpixel((256, 30))[0], 200)     # 위쪽 가운데 = 흰 바탕 (예전 어두운 아이콘이면 실패)


class Workflows(unittest.TestCase):
    def test_yaml_files_exist_and_name_scripts(self):
        d = os.path.join(testutil.SRC, "사이트_설정")
        with open(os.path.join(d, "update.yml"), encoding="utf-8") as f:
            up = f.read()
        for s in ("collect.py", "build_site.py", "auto_check.py"):
            self.assertIn(s, up)
        with open(os.path.join(d, "check.yml"), encoding="utf-8") as f:
            ck = f.read()
        self.assertIn("검사.py", ck)


if __name__ == "__main__":
    unittest.main()
