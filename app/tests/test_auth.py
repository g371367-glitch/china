"""Тесты пароля, входов и защиты от перебора (шов `auth`: Access, LoginLimiter)."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import auth  # noqa: E402

PW = "общий-пароль-1"


class Clock:
    """Подставные часы: двигаются только по команде."""

    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


class AccessTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="trade-kb-auth-")
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_not_configured_until_password_set(self):
        a = auth.Access(self.root)
        self.assertFalse(a.configured())
        self.assertFalse(a.check_password(PW))
        a.set_password(PW)
        self.assertTrue(a.configured())
        self.assertTrue(auth.Access(self.root).configured())

    def test_file_holds_pbkdf2_not_password(self):
        auth.Access(self.root).set_password(PW)
        path = os.path.join(self.root, "data", "access.json")
        with open(path, encoding="utf-8") as f:
            raw = f.read()
        self.assertNotIn(PW, raw)
        data = json.loads(raw)
        self.assertEqual(data["iterations"], 200_000)
        self.assertEqual(len(bytes.fromhex(data["salt"])), 16)
        for key in ("version", "hash", "epoch", "secret", "changedAt"):
            self.assertIn(key, data)

    def test_check_password(self):
        a = auth.Access(self.root)
        a.set_password(PW)
        self.assertTrue(a.check_password(PW))
        self.assertFalse(a.check_password(PW + "x"))
        self.assertFalse(a.check_password(""))

    def test_short_password_is_russian_value_error(self):
        a = auth.Access(self.root)
        with self.assertRaises(ValueError) as cm:
            a.set_password("x" * (auth.MIN_PASSWORD - 1))
        self.assertIn("не короче 8", str(cm.exception))
        self.assertFalse(a.configured())

    def test_token_verifies_and_expires_after_30_days(self):
        clock = Clock(1_800_000_000)
        a = auth.Access(self.root, clock=clock)
        a.set_password(PW)
        token = a.issue()
        self.assertTrue(a.verify(token))
        clock.t += 29 * 86400
        self.assertTrue(a.verify(token))
        clock.t += 2 * 86400
        self.assertFalse(a.verify(token))

    def test_forged_or_garbage_token_rejected(self):
        a = auth.Access(self.root)
        a.set_password(PW)
        token = a.issue()
        issued, sig = token.split(".")
        self.assertFalse(a.verify(issued + "." + sig[:-2] + ("AA" if sig[-2:] != "AA" else "BB")))
        self.assertFalse(a.verify(str(int(issued) + 1) + "." + sig))
        for bad in ("", ".", "abc", "1.2.3", None):
            self.assertFalse(a.verify(bad))

    def test_password_change_from_other_object_kills_sessions(self):
        site = auth.Access(self.root)
        site.set_password(PW)
        token = site.issue()
        self.assertTrue(site.verify(token))
        auth.Access(self.root).set_password("новый-пароль-2")  # «другой процесс»
        self.assertFalse(site.verify(token))
        self.assertTrue(site.verify(site.issue()))

    def test_no_access_file_no_sessions(self):
        self.assertFalse(auth.Access(self.root).verify("1800000000.AAAA"))


class LoginLimiterTest(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.lim = auth.LoginLimiter(clock=self.clock)

    def test_five_failures_block_address_for_15_min(self):
        for _ in range(4):
            self.lim.failure("1.1.1.1")
        self.assertEqual(self.lim.check("1.1.1.1"), (True, 0))
        self.lim.failure("1.1.1.1")
        ok, retry = self.lim.check("1.1.1.1")
        self.assertFalse(ok)
        self.assertEqual(retry, 900)
        self.assertTrue(self.lim.check("2.2.2.2")[0])
        self.clock.t += 899
        self.assertFalse(self.lim.check("1.1.1.1")[0])
        self.clock.t += 2
        self.assertEqual(self.lim.check("1.1.1.1"), (True, 0))

    def test_success_resets_address(self):
        for _ in range(4):
            self.lim.failure("1.1.1.1")
        self.lim.success("1.1.1.1")
        for _ in range(4):
            self.lim.failure("1.1.1.1")
        self.assertTrue(self.lim.check("1.1.1.1")[0])

    def test_thirty_failures_from_all_block_everyone(self):
        for i in range(30):
            self.lim.failure(f"10.0.0.{i}")
            self.clock.t += 10
        ok, retry = self.lim.check("9.9.9.9")
        self.assertFalse(ok)
        self.assertEqual(retry, 890)  # 30-я неудача была 10 с назад
        self.clock.t += 891
        self.assertTrue(self.lim.check("9.9.9.9")[0])

    def test_global_window_is_sliding_15_min(self):
        for i in range(29):
            self.lim.failure(f"10.0.0.{i}")
        self.clock.t += 901  # прежние 29 вышли из окна
        self.lim.failure("10.0.1.1")
        self.assertTrue(self.lim.check("9.9.9.9")[0])


# ---------- HTTP: сервер для коллег и локальный (make_server на временном корне) ----------

import http.client  # noqa: E402
import threading  # noqa: E402
import types  # noqa: E402

import server  # noqa: E402


class HttpMixin:
    def start(self, **kw):
        httpd = server.make_server(self.root, port=0, **kw)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return httpd.server_address[1]

    def req(self, path, method="GET", body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = json.dumps(body).encode("utf-8") if body is not None else None
            h = dict(headers or {})
            if data is not None:
                h["Content-Type"] = "application/json"
            c.request(method, path, body=data, headers=h)
            r = c.getresponse()
            raw = r.read()
            ctype = r.getheader("Content-Type") or ""
            parsed = json.loads(raw.decode("utf-8")) if "json" in ctype and raw else raw.decode("utf-8", "replace")
            return r.status, parsed, r
        finally:
            c.close()

    def login(self, pw=PW, headers=None):
        return self.req("/api/login", "POST", {"password": pw}, headers)

    @staticmethod
    def cookie_of(r):
        return {"Cookie": (r.getheader("Set-Cookie") or "").split(";")[0]}


def cookie_attrs(r):
    return [a.strip().lower() for a in (r.getheader("Set-Cookie") or "").split(";")[1:]]


class TeamServerTest(HttpMixin, unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="trade-kb-team-")
        self.addCleanup(shutil.rmtree, self.root, True)
        os.makedirs(os.path.join(self.root, "data"))
        with open(os.path.join(self.root, "README.md"), "w", encoding="utf-8") as f:
            f.write("# Сводка\n")
        self.access = auth.Access(self.root)
        self.access.set_password(PW)
        self.port = self.start(access=self.access)

    def test_without_login_pages_redirect_and_api_401(self):
        for path in ("/", "/index.html", "/js/app.js", "/css/../index.html", "/vendor/marked-12.0.2.min.js"):
            status, _, r = self.req(path)
            self.assertEqual(status, 303, path)
            self.assertEqual(r.getheader("Location"), "/login")
        self.assertEqual(self.req("/", "HEAD")[0], 303)
        for path in ("/api/ping", "/api/docs", "/api/data/settings", "/api/doc?path=README.md", "/api/team", "/api/nope"):
            status, body, _ = self.req(path)
            self.assertEqual((status, body), (401, {"error": "Нужно войти"}), path)
        status, body, _ = self.req("/api/data/settings", "PUT", {"a": 1})
        self.assertEqual((status, body), (401, {"error": "Нужно войти"}))
        self.assertFalse(os.path.exists(os.path.join(self.root, "data", "settings.json")))

    def test_login_page_and_styles_open(self):
        status, page, r = self.req("/login")
        self.assertEqual(status, 200)
        self.assertIn("text/html", r.getheader("Content-Type"))
        self.assertIn('type="password"', page)
        self.assertIn("Войти", page)
        status, _, r = self.req("/css/style.css")
        self.assertEqual(status, 200)
        self.assertIn("text/css", r.getheader("Content-Type"))

    def test_wrong_password_401_russian(self):
        status, body, r = self.login("неверный-пароль")
        self.assertEqual((status, body), (401, {"error": "Неверный пароль"}))
        self.assertIsNone(r.getheader("Set-Cookie"))
        self.assertEqual(self.req("/api/login", "POST", {})[0], 401)

    def test_login_sets_cookie_and_opens_site(self):
        status, body, r = self.login()
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertTrue(r.getheader("Set-Cookie").startswith("kb_session="))
        attrs = cookie_attrs(r)
        for a in ("httponly", "samesite=lax", "path=/", f"max-age={30 * 86400}"):
            self.assertIn(a, attrs)
        self.assertNotIn("secure", attrs)
        cookie = self.cookie_of(r)
        status, body, _ = self.req("/api/ping", headers=cookie)
        self.assertEqual(status, 200)
        self.assertIs(body["team"], True)
        self.assertEqual(self.req("/", headers=cookie)[0], 200)
        self.assertEqual(self.req("/api/data/settings", "PUT", {"a": 1}, cookie)[0], 200)
        self.assertEqual(self.req("/api/team", headers=cookie)[0], 404)

    def test_cookie_secure_behind_https_tunnel(self):
        for h in ({"X-Forwarded-Proto": "https"}, {"Cf-Visitor": '{"scheme":"https"}'}):
            _, _, r = self.login(headers=h)
            self.assertIn("secure", cookie_attrs(r))

    def test_logout_clears_cookie(self):
        _, _, r = self.login()
        status, body, r2 = self.req("/api/logout", "POST", {}, self.cookie_of(r))
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertTrue(r2.getheader("Set-Cookie").startswith("kb_session=;"))
        self.assertIn("max-age=0", cookie_attrs(r2))

    def test_bad_cookie_rejected(self):
        for c in ("kb_session=1800000000.AAAA", "kb_session=", 'kb_session="x', "other=1"):
            self.assertEqual(self.req("/api/ping", headers={"Cookie": c})[0], 401, c)

    def test_password_change_elsewhere_logs_everyone_out(self):
        _, _, r = self.login()
        cookie = self.cookie_of(r)
        self.assertEqual(self.req("/api/ping", headers=cookie)[0], 200)
        auth.Access(self.root).set_password("новый-пароль-2")  # «Сменить пароль.bat» из другого процесса
        self.assertEqual(self.req("/api/ping", headers=cookie)[0], 401)
        self.assertEqual(self.login()[0], 401)
        self.assertEqual(self.login("новый-пароль-2")[0], 200)

    def test_bruteforce_blocked_429(self):
        ip = {"Cf-Connecting-IP": "203.0.113.5"}
        for _ in range(5):
            self.assertEqual(self.login("неверный-пароль", ip)[0], 401)
        status, body, r = self.login(PW, ip)  # после блокировки не пускает даже с верным
        self.assertEqual((status, body), (429, {"error": "Слишком много попыток, попробуйте через 15 мин"}))
        self.assertEqual(r.getheader("Retry-After"), "900")
        self.assertEqual(self.login(PW, {"Cf-Connecting-IP": "203.0.113.6"})[0], 200)

    def test_access_json_not_reachable_through_api(self):
        _, _, r = self.login()
        cookie = self.cookie_of(r)
        self.assertEqual(self.req("/api/data/access", headers=cookie)[0], 404)
        self.assertEqual(self.req("/api/data/access", "PUT", {"x": 1}, cookie)[0], 404)


class LocalServerModeTest(HttpMixin, unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="trade-kb-local-")
        self.addCleanup(shutil.rmtree, self.root, True)

    def test_local_open_without_password_ping_team_false(self):
        self.port = self.start()
        status, body, _ = self.req("/api/ping")
        self.assertEqual(status, 200)
        self.assertEqual(body["app"], "trade-kb")
        self.assertIs(body["team"], False)
        self.assertEqual(self.req("/")[0], 200)
        self.assertEqual(self.req("/api/login", "POST", {"password": PW})[0], 404)

    def test_api_team_reports_link(self):
        info = types.SimpleNamespace(url=None)
        self.port = self.start(team_info=info)
        self.assertEqual(self.req("/api/team")[:2], (200, {"active": False}))
        info.url = "https://abc-def.trycloudflare.com"
        self.assertEqual(self.req("/api/team")[:2],
                         (200, {"active": True, "url": "https://abc-def.trycloudflare.com"}))

    def test_api_team_without_team_info_inactive(self):
        self.port = self.start()
        self.assertEqual(self.req("/api/team")[:2], (200, {"active": False}))


if __name__ == "__main__":
    unittest.main()
