"""Тесты сборки открытой копии для GitHub Pages (app/build_site.py)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import build_site  # noqa: E402


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class BuildSiteTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        _write(os.path.join(self.root, "README.md"), "# Оглавление\n")
        _write(os.path.join(self.root, "Азия", "Китай", "01.md"), "# Иу\nтекст")
        _write(os.path.join(self.root, "CLAUDE.md"), "# служебное")
        _write(os.path.join(self.root, "data", "calendar.json"), '{"version":1,"events":[]}')
        _write(os.path.join(self.root, "data", "settings.json"), '{"rate":11}')
        _write(os.path.join(self.root, "data", "access.json"), '{"hash":"секрет"}')
        self.out = os.path.join(self.root, "site")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_notes_and_public_data(self):
        result = build_site.build(self.root, self.out)
        self.assertEqual(result["docs"], 2)
        with open(os.path.join(self.out, "static", "notes.json"), encoding="utf-8") as f:
            notes = json.load(f)
        self.assertEqual([d["path"] for d in notes["docs"]], ["README.md", "Азия/Китай/01.md"])
        self.assertEqual(notes["texts"]["Азия/Китай/01.md"], "# Иу\nтекст")
        self.assertEqual(sorted(os.listdir(os.path.join(self.out, "static", "data"))), ["calendar.json"])
        self.assertTrue(os.path.isfile(os.path.join(self.out, ".nojekyll")))
        self.assertTrue(os.path.isfile(os.path.join(self.out, "js", "static.js")))
        self.assertFalse(os.path.exists(os.path.join(self.out, "login.html")))

    def test_no_private_data_leaks(self):
        build_site.build(self.root, self.out)
        for dirpath, _, files in os.walk(self.out):
            for name in files:
                with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as f:
                    text = f.read()
                self.assertNotIn("секрет", text, name)
                self.assertNotIn('"rate":11', text, name)

    def test_index_relative_paths_and_flag(self):
        build_site.build(self.root, self.out)
        with open(os.path.join(self.out, "index.html"), encoding="utf-8") as f:
            html = f.read()
        self.assertNotRegex(html, r'(href|src)="/[^/]')
        self.assertIn('href="css/style.css"', html)
        self.assertLess(html.index(build_site.STATIC_FLAG), html.index('src="js/app.js"'))

    def test_rebuild_replaces_old_output(self):
        _write(os.path.join(self.out, "old.txt"), "x")
        build_site.build(self.root, self.out)
        self.assertFalse(os.path.exists(os.path.join(self.out, "old.txt")))

    def test_refuses_project_root(self):
        with self.assertRaises(ValueError):
            build_site.build(self.root, self.root)


if __name__ == "__main__":
    unittest.main()
