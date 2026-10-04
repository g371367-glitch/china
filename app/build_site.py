"""Сборка открытой копии сайта для GitHub Pages: python app/build_site.py [папка] (по умолчанию site/).

Сервера там нет: заметки складываются в static/notes.json, исходные тарифы и календарь — в static/data/,
а index.html получает флаг TRADE_KB_STATIC — тогда api.js отвечает сам (app/web/js/static.js).
Личные данные (data/settings.json, products.json, tariffs.json, access.json) в копию не попадают.
"""
import json
import os
import re
import shutil
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)
import server  # noqa: E402

DEFAULT_OUT = "site"
PUBLIC_DATA = ("tariffs.default", "calendar")
STATIC_FLAG = "<script>window.TRADE_KB_STATIC = true;</script>"


def _read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def _write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def static_index(html):
    """index.html сервера → для Pages: пути относительные (сайт живёт в /<репозиторий>/), флаг до app.js."""
    html = re.sub(r'(href|src)="/(?!/)', r'\1="', html)
    return html.replace('<script type="module"', STATIC_FLAG + '\n  <script type="module"', 1)


def build(root=server.DEFAULT_ROOT, out=None):
    """Собрать сайт в out (старое содержимое стирается) → {"docs": число заметок, "out": путь}."""
    out = os.path.abspath(out or os.path.join(root, DEFAULT_OUT))
    if os.path.realpath(out) in (os.path.realpath(root), os.path.realpath(server.WEB_DIR)):
        raise ValueError("Папка сборки не может совпадать с проектом")
    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(server.WEB_DIR, out, ignore=shutil.ignore_patterns("login.html"))
    _write(os.path.join(out, "index.html"), static_index(_read(os.path.join(server.WEB_DIR, "index.html"))))
    _write(os.path.join(out, ".nojekyll"), "")  # Pages не пропускает файлы через Jekyll

    docs = server.list_docs(root)
    texts = {d["path"]: _read(os.path.join(root, *d["path"].split("/"))) for d in docs}
    _write(os.path.join(out, "static", "notes.json"),
           json.dumps({"docs": docs, "texts": texts}, ensure_ascii=False, separators=(",", ":")))
    os.makedirs(os.path.join(out, "static", "data"))
    for name in PUBLIC_DATA:
        src = os.path.join(root, "data", name + ".json")
        if os.path.isfile(src):
            shutil.copyfile(src, os.path.join(out, "static", "data", name + ".json"))
    return {"docs": len(docs), "out": out}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    result = build(out=argv[0] if argv else None)
    print(f"Готово: {result['docs']} заметок → {result['out']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
