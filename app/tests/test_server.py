"""Тесты HTTP API сервера базы знаний (шов `server`).

Каждый тест поднимает сервер на свободном порту с временным корнем.
"""
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import server  # noqa: E402

# Локальные запросы — мимо системного прокси.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def write(root, rel, text):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class ServerCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="trade-kb-")
        write(self.root, "README.md", "# Сводка\n\nКалендарь сроков.\n")
        write(self.root, "CLAUDE.md", "# Служебная\n")
        write(self.root, "Азия/Китай/01_Ozon_Global_Иу.md",
              "# Ozon Global в Иу\n\nКод ОКВЭД 9610.\nПро КИК смотри [тут](../../СНГ/Россия/01_КИК.md).\n")
        write(self.root, "СНГ/Россия/01_КИК.md",
              "# Уведомление о КИК\n\nСрок подачи уведомления — ежегодно.\nПро кик ещё раз.\nКИК третий.\nкик четвёртый.\n")
        write(self.root, "Южная_Америка/02_Shopee_LatAm.md", "Без заголовка, ёлка тут.\n")
        write(self.root, ".autopilot/plan.md", "# План\n")
        write(self.root, "app/notes.md", "# Приложение\n")
        write(self.root, "data/x.md", "# Данные\n")
        write(self.root, "Азия/Китай/notes.txt", "не markdown")
        self.httpd = server.make_server(self.root, port=0)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.root, ignore_errors=True)

    def request(self, path, method="GET", body=None):
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, data=body, method=method)
        try:
            with OPENER.open(req, timeout=10) as r:
                return r.status, r.headers.get("Content-Type", ""), r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            with e:
                return e.code, e.headers.get("Content-Type", ""), e.read().decode("utf-8")

    def get_json(self, path):
        status, _, text = self.request(path)
        self.assertEqual(status, 200, text)
        return json.loads(text)


class PingAndDocs(ServerCase):
    def test_ping_identifies_app(self):
        data = self.get_json("/api/ping")
        self.assertEqual(data["app"], "trade-kb")
        self.assertIn("version", data)

    def test_docs_lists_knowledge_notes_only(self):
        docs = self.get_json("/api/docs")
        paths = sorted(d["path"] for d in docs)
        self.assertEqual(paths, sorted([
            "README.md",
            "Азия/Китай/01_Ozon_Global_Иу.md",
            "СНГ/Россия/01_КИК.md",
            "Южная_Америка/02_Shopee_LatAm.md",
        ]))

    def test_docs_titles_and_folders(self):
        docs = {d["path"]: d for d in self.get_json("/api/docs")}
        self.assertEqual(docs["Азия/Китай/01_Ozon_Global_Иу.md"]["title"], "Ozon Global в Иу")
        self.assertEqual(docs["Азия/Китай/01_Ozon_Global_Иу.md"]["folder"], "Азия/Китай")
        self.assertEqual(docs["README.md"]["folder"], "")
        # нет заголовка "# " — имя файла без расширения, "_" → пробел
        self.assertEqual(docs["Южная_Америка/02_Shopee_LatAm.md"]["title"], "02 Shopee LatAm")

    def test_new_note_visible_without_restart(self):
        write(self.root, "Торговый_дом/01_Новая.md", "# Новая заметка\n")
        paths = [d["path"] for d in self.get_json("/api/docs")]
        self.assertIn("Торговый_дом/01_Новая.md", paths)


def q(value):
    return urllib.parse.quote(value, safe="")


class Doc(ServerCase):
    def test_doc_returns_markdown_text_with_cyrillic_path(self):
        status, ctype, text = self.request("/api/doc?path=" + q("Азия/Китай/01_Ozon_Global_Иу.md"))
        self.assertEqual(status, 200)
        self.assertIn("text/markdown", ctype)
        self.assertIn("Код ОКВЭД 9610.", text)

    def test_doc_rejects_unsafe_or_service_paths(self):
        for bad in ["../secret.md", "Азия/../../secret.md", "Азия/Китай/../../../x.md",
                    os.path.join(self.root, "README.md"), "/README.md", "C:/Windows/win.ini",
                    "Азия/Китай/notes.txt", ".autopilot/plan.md", "app/notes.md", "data/x.md",
                    "CLAUDE.md", "Азия/Китай/нет_такой.md", ""]:
            with self.subTest(bad=bad):
                status, _, _ = self.request("/api/doc?path=" + q(bad))
                self.assertEqual(status, 404)

    def test_doc_outside_root_not_served_even_if_exists(self):
        outside = os.path.join(os.path.dirname(self.root), "secret-trade-kb.md")
        with open(outside, "w", encoding="utf-8") as f:
            f.write("# секрет\n")
        self.addCleanup(os.remove, outside)
        status, _, _ = self.request("/api/doc?path=" + q("../secret-trade-kb.md"))
        self.assertEqual(status, 404)


class Search(ServerCase):
    def search(self, text):
        return self.get_json("/api/search?q=" + q(text))

    def test_case_insensitive_with_snippets_and_lines(self):
        res = {r["path"]: r for r in self.search("кик")}
        self.assertEqual(set(res), {"Азия/Китай/01_Ozon_Global_Иу.md", "СНГ/Россия/01_КИК.md"})
        kik = res["СНГ/Россия/01_КИК.md"]
        self.assertEqual(kik["title"], "Уведомление о КИК")
        self.assertEqual(len(kik["hits"]), 3)  # 5 вхождений в строках, не больше 3 фрагментов
        self.assertEqual(kik["hits"][0]["line"], 1)  # заголовок — строка 1 (нумерация с 1)
        self.assertIn("КИК", kik["hits"][0]["snippet"])

    def test_yo_equals_ye(self):
        self.assertEqual([r["path"] for r in self.search("елка")], ["Южная_Америка/02_Shopee_LatAm.md"])
        self.assertEqual([r["path"] for r in self.search("четвертый")], ["СНГ/Россия/01_КИК.md"])

    def test_numbers(self):
        self.assertEqual([r["path"] for r in self.search("9610")], ["Азия/Китай/01_Ozon_Global_Иу.md"])

    def test_short_or_empty_query_gives_empty_list(self):
        self.assertEqual(self.search(""), [])
        self.assertEqual(self.search("к"), [])
        self.assertEqual(self.search("  "), [])
        self.assertEqual(self.get_json("/api/search"), [])

    def test_service_files_not_searched(self):
        self.assertEqual(self.search("Служебная"), [])
        self.assertEqual(self.search("План"), [])


class Data(ServerCase):
    def put(self, name, body):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        return self.request("/api/data/" + name, "PUT", body)

    def test_missing_file_gives_null(self):
        for name in ["products", "tariffs", "tariffs.default", "settings", "calendar"]:
            with self.subTest(name=name):
                self.assertIsNone(self.get_json("/api/data/" + name))

    def test_get_existing_file(self):
        write(self.root, "data/calendar.json", '[{"what": "Налог КНР"}]')
        self.assertEqual(self.get_json("/api/data/calendar"), [{"what": "Налог КНР"}])

    def test_put_then_get_roundtrip_and_file_on_disk(self):
        payload = [{"name": "Кружка", "price": 12.5}]
        status, _, text = self.put("products", payload)
        self.assertEqual(status, 200, text)
        self.assertEqual(json.loads(text), {"ok": True})
        self.assertEqual(self.get_json("/api/data/products"), payload)
        with open(os.path.join(self.root, "data", "products.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), payload)
        # перезапись, а не дописывание; временных файлов не остаётся
        self.put("products", [])
        self.assertEqual(self.get_json("/api/data/products"), [])
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "data"))), ["products.json", "x.md"])

    def test_put_only_whitelisted(self):
        for name in ["tariffs.default", "calendar", "secrets", "../products", "products.json"]:
            with self.subTest(name=name):
                status, _, _ = self.put(name, {"a": 1})
                self.assertEqual(status, 404)
        self.assertFalse(os.path.exists(os.path.join(self.root, "data", "calendar.json")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "data", "tariffs.default.json")))

    def test_get_only_whitelisted(self):
        write(self.root, "data/secrets.json", "{}")
        for name in ["secrets", "..%2FREADME", "x"]:
            with self.subTest(name=name):
                status, _, _ = self.request("/api/data/" + name)
                self.assertEqual(status, 404)

    def test_put_non_json_is_400_and_keeps_old(self):
        self.put("settings", {"rate": 13.1})
        for body in [b"not json", b"{broken", "кириллица".encode("cp1251"), b""]:
            with self.subTest(body=body):
                status, _, _ = self.put("settings", body)
                self.assertEqual(status, 400)
        self.assertEqual(self.get_json("/api/data/settings"), {"rate": 13.1})

    def test_put_creates_data_dir_if_missing(self):
        shutil.rmtree(os.path.join(self.root, "data"))
        status, _, _ = self.put("tariffs", {"edited": "2026-09-28"})
        self.assertEqual(status, 200)
        self.assertEqual(self.get_json("/api/data/tariffs"), {"edited": "2026-09-28"})


class FakeCbr(server.ThreadingHTTPServer):
    """Подставной cbr-xml-daily: отдаёт заранее заданный JSON."""

    def __init__(self, payload):
        body = json.dumps(payload).encode("utf-8")

        class H(server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        super().__init__(("127.0.0.1", 0), H)
        threading.Thread(target=self.serve_forever, daemon=True).start()


class Rate(ServerCase):
    def use_rate_url(self, url):
        self.httpd.RequestHandlerClass.rate_url = url

    def test_rate_is_value_divided_by_nominal(self):
        fake = FakeCbr({"Date": "2026-09-27T11:30:00+03:00",
                        "Valute": {"USD": {"Nominal": 1, "Value": 80.0},
                                   "CNY": {"Nominal": 10, "Value": 115.5}}})
        self.addCleanup(fake.server_close)
        self.addCleanup(fake.shutdown)
        self.use_rate_url(f"http://127.0.0.1:{fake.server_address[1]}/daily_json.js")
        self.assertEqual(self.get_json("/api/rate"), {"rate": 11.55, "date": "2026-09-27", "source": "cbr"})

    def test_network_error_gives_502_quickly(self):
        with socket.socket() as s:  # порт, на котором никто не слушает
            s.bind(("127.0.0.1", 0))
            dead = s.getsockname()[1]
        self.use_rate_url(f"http://127.0.0.1:{dead}/daily_json.js")
        started = time.monotonic()
        status, _, text = self.request("/api/rate")
        self.assertLessEqual(time.monotonic() - started, 5.5)
        self.assertEqual(status, 502)
        self.assertIn("error", json.loads(text))

    def test_bad_answer_gives_502(self):
        fake = FakeCbr({"Valute": {}})
        self.addCleanup(fake.server_close)
        self.addCleanup(fake.shutdown)
        self.use_rate_url(f"http://127.0.0.1:{fake.server_address[1]}/")
        status, _, _ = self.request("/api/rate")
        self.assertEqual(status, 502)


class PortChoice(ServerCase):
    def test_our_server_on_port_is_reused(self):
        self.assertEqual(server.choose_port(self.port), (self.port, True))

    def test_foreign_listener_skipped_to_next_free(self):
        foreign = socket.socket()
        foreign.bind(("127.0.0.1", 0))
        foreign.listen()
        self.addCleanup(foreign.close)
        busy = foreign.getsockname()[1]
        port, running = server.choose_port(busy)
        self.assertFalse(running)
        self.assertGreater(port, busy)
        with socket.socket() as probe:  # выбранный порт действительно свободен
            probe.bind(("127.0.0.1", port))


if __name__ == "__main__":
    unittest.main()
