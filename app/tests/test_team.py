"""Тесты запуска «Доступ для коллег» (шов `app/team.py`).

Реальный cloudflared не запускается: туннель подменяется маленьким скриптом на Python.
"""
import os
import pathlib
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import team  # noqa: E402

URL = "https://brave-quiet-river-lamp.trycloudflare.com"


class ParseTunnelUrlTest(unittest.TestCase):
    def test_url_inside_box(self):
        line = f"2026-10-02T10:00:00Z INF |  {URL}                                  |"
        self.assertEqual(team.parse_tunnel_url(line), URL)

    def test_plain_line_with_url(self):
        self.assertEqual(team.parse_tunnel_url(f"Visit it at {URL}\n"), URL)

    def test_other_lines(self):
        for line in [
            "2026-10-02T10:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
            "2026-10-02T10:00:00Z INF +----------------------------------------+",
            "2026-10-02T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at:  |",
            'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp',
            "https://example.com/",
            "",
        ]:
            with self.subTest(line=line):
                self.assertIsNone(team.parse_tunnel_url(line))


class TempRootMixin:
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="team-test-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)


class FindCloudflaredTest(TempRootMixin, unittest.TestCase):
    def test_tools_folder_first(self):
        exe = os.path.join(self.root, "tools", "cloudflared.exe")
        os.makedirs(os.path.dirname(exe))
        open(exe, "wb").close()
        with mock.patch("shutil.which", return_value=r"C:\other\cloudflared.exe"):
            self.assertEqual(os.path.normcase(team.find_cloudflared(self.root)), os.path.normcase(exe))

    def test_then_path(self):
        with mock.patch("shutil.which", return_value=r"C:\bin\cloudflared.exe"):
            self.assertEqual(team.find_cloudflared(self.root), r"C:\bin\cloudflared.exe")

    def test_nothing(self):
        with mock.patch("shutil.which", return_value=None):
            self.assertIsNone(team.find_cloudflared(self.root))


class DownloadCloudflaredTest(TempRootMixin, unittest.TestCase):
    def test_downloads_into_tools_with_progress(self):
        src = os.path.join(self.root, "source.bin")
        payload = b"MZ" + b"x" * 200_000
        with open(src, "wb") as f:
            f.write(payload)
        calls = []
        path = team.download_cloudflared(self.root, lambda done, total: calls.append((done, total)),
                                         url=pathlib.Path(src).as_uri())
        self.assertEqual(os.path.normcase(path), os.path.normcase(os.path.join(self.root, "tools", "cloudflared.exe")))
        with open(path, "rb") as f:
            self.assertEqual(f.read(), payload)
        self.assertTrue(calls)
        self.assertEqual(calls[-1][0], len(payload))
        # Временных файлов не осталось.
        self.assertEqual(os.listdir(os.path.join(self.root, "tools")), ["cloudflared.exe"])

    def test_network_error_gives_russian_text_with_manual_link(self):
        missing = pathlib.Path(os.path.join(self.root, "нет-такого.bin")).as_uri()
        with self.assertRaises(team.TeamError) as cm:
            team.download_cloudflared(self.root, None, url=missing)
        text = str(cm.exception)
        self.assertIn("Не удалось скачать", text)
        self.assertIn("https://github.com/cloudflare/cloudflared/releases", text)
        self.assertNotIn("Traceback", text)
        tools = os.path.join(self.root, "tools")
        self.assertFalse(os.path.exists(os.path.join(tools, "cloudflared.exe")))
        self.assertEqual(os.listdir(tools) if os.path.isdir(tools) else [], [])


def fake_tunnel(port, script):
    """Туннель с подставной командой вместо cloudflared."""
    return team.Tunnel("cloudflared.exe", port, command=[sys.executable, "-u", "-c", script])


BOX = f"""
import sys, time
print("INF Requesting new quick Tunnel on trycloudflare.com...", file=sys.stderr, flush=True)
print("INF |  {URL}   |", file=sys.stderr, flush=True)
"""


class TunnelTest(unittest.TestCase):
    def test_command_is_quick_tunnel_to_local_port(self):
        t = team.Tunnel(r"C:\tools\cloudflared.exe", 8766)
        self.assertEqual(t.command, [r"C:\tools\cloudflared.exe", "tunnel", "--no-autoupdate",
                                     "--url", "http://127.0.0.1:8766"])

    def test_start_returns_url_and_stop_kills(self):
        t = fake_tunnel(8766, BOX + "time.sleep(60)")
        self.addCleanup(t.stop)
        self.assertEqual(t.start(timeout=20), URL)
        self.assertTrue(t.alive())
        t.stop()
        self.assertFalse(t.alive())

    def test_exit_without_url_is_russian_error(self):
        t = fake_tunnel(8766, "import sys; print('ERR failed', file=sys.stderr); sys.exit(1)")
        self.addCleanup(t.stop)
        with self.assertRaises(team.TeamError) as cm:
            t.start(timeout=20)
        self.assertIn("Туннель не запустился", str(cm.exception))

    def test_timeout_is_russian_error_and_process_stopped(self):
        t = fake_tunnel(8766, "import time; time.sleep(60)")
        self.addCleanup(t.stop)
        started = time.monotonic()
        with self.assertRaises(team.TeamError) as cm:
            t.start(timeout=1)
        self.assertLess(time.monotonic() - started, 10)
        self.assertIn("Туннель не запустился", str(cm.exception))
        self.assertFalse(t.alive())

    def test_alive_false_when_tunnel_falls(self):
        t = fake_tunnel(8766, BOX + "time.sleep(0.5)")
        self.addCleanup(t.stop)
        self.assertEqual(t.start(timeout=20), URL)
        deadline = time.monotonic() + 10
        while t.alive() and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertFalse(t.alive())


class AskPasswordTest(unittest.TestCase):
    def run_ask(self, answers):
        said = []
        prompts = []
        it = iter(answers)

        def fake_getpass(prompt):
            prompts.append(prompt)
            return next(it)

        pw = team.ask_password(getpass_fn=fake_getpass, say=said.append)
        return pw, said, prompts

    def test_asks_twice(self):
        pw, said, prompts = self.run_ask(["секретный1", "секретный1"])
        self.assertEqual(pw, "секретный1")
        self.assertEqual(len(prompts), 2)

    def test_repeats_on_short_and_mismatch(self):
        pw, said, prompts = self.run_ask(["short", "short", "длинный-пароль", "другой-пароль",
                                          "длинный-пароль", "длинный-пароль"])
        self.assertEqual(pw, "длинный-пароль")
        self.assertEqual(len(prompts), 6)
        text = " | ".join(said)
        self.assertIn("не короче 8", text)
        self.assertIn("не совпадают", text)
        # Пароль никогда не печатается.
        for secret in ("short", "длинный-пароль", "другой-пароль"):
            self.assertNotIn(secret, text)


class FakeAccess:
    """Подставной auth.Access (таск 02 делается отдельно)."""
    instances = []

    def __init__(self, root, configured=True):
        self.root = root
        self.passwords = []
        self._configured = configured
        FakeAccess.instances.append(self)

    def configured(self):
        return self._configured

    def set_password(self, pw):
        self.passwords.append(pw)
        self._configured = True


class MainTest(TempRootMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        FakeAccess.instances = []
        fake_auth = type(sys)("auth")
        fake_auth.Access = FakeAccess
        fake_auth.MIN_PASSWORD = 8
        patcher = mock.patch.dict(sys.modules, {"auth": fake_auth})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.said = []
        self.asked = []

    def run_main(self, argv, passwords=(), answers=()):
        pw, ans = iter(passwords), iter(answers)
        with mock.patch("getpass.getpass", lambda prompt="": next(pw)), \
                mock.patch("shutil.which", return_value=None):
            return team.main(argv, root=self.root, say=self.said.append, ask=lambda prompt="": self.asked.append(prompt) or next(ans))

    def test_set_password_only_changes_and_exits(self):
        code = self.run_main(["--set-password"], passwords=["новый-пароль", "новый-пароль"])
        self.assertEqual(code, 0)
        self.assertEqual(FakeAccess.instances[0].passwords, ["новый-пароль"])
        text = " | ".join(self.said)
        self.assertIn("Пароль изменён", text)
        self.assertNotIn("новый-пароль", text)
        self.assertNotIn("cloudflared", text)

    def test_declined_download_explains_where_to_get_it(self):
        code = self.run_main([], answers=["н"])
        self.assertEqual(code, 1)
        text = " | ".join(self.said)
        self.assertEqual(len(self.asked), 1)
        self.assertIn("Скачать", self.asked[0])
        self.assertIn("[Д/Н]", self.asked[0])
        self.assertIn("https://github.com/cloudflare/cloudflared/releases", text)
        self.assertNotIn("Traceback", text)
        self.assertFalse(os.path.exists(os.path.join(self.root, "tools", "cloudflared.exe")))


# ---------- сквозной запуск: настоящие server и auth, подменён только туннель ----------

import http.client  # noqa: E402
import json  # noqa: E402
import socket  # noqa: E402
import threading  # noqa: E402

import auth  # noqa: E402
import server  # noqa: E402

TEAM_PW = "пароль-коллег-1"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def hget(port, path, method="GET", body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        c.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers=headers or {})
        r = c.getresponse()
        return r.status, r.read().decode("utf-8", "replace"), r
    finally:
        c.close()


class EndToEndTest(TempRootMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        os.makedirs(os.path.join(self.root, "tools"))
        pathlib.Path(self.root, "tools", "cloudflared.exe").write_bytes(b"x")  # «найден», но не запускается
        self.local_port, self.team_port = free_port(), free_port()
        self.tunnels, self.cleanups, self.said = [], [], []
        root, tunnels = self.root, self.tunnels

        class FakeTunnel(team.Tunnel):
            def __init__(self, exe, port, command=None):
                super().__init__(exe, port, command=[sys.executable, "-u", "-c", BOX + "time.sleep(60)"])
                self.password_was_set = None
                tunnels.append(self)

            def start(self, timeout=40):
                self.password_was_set = auth.Access(root).configured()
                return super().start(timeout)

        for target, value in (("team.Tunnel", FakeTunnel), ("team.TEAM_PORT", self.team_port),
                              ("server.DEFAULT_PORT", self.local_port),
                              ("team.copy_to_clipboard", lambda text: True),
                              ("team.on_close", self.cleanups.append)):
            p = mock.patch(target, value)
            p.start()
            self.addCleanup(p.stop)

    def start_main(self, passwords=()):
        pw = iter(passwords)
        result = {}
        with mock.patch("getpass.getpass", lambda prompt="": next(pw)):
            t = threading.Thread(target=lambda: result.setdefault("code", team.main(
                [], root=self.root, say=self.said.append, ask=lambda prompt="": "н")), daemon=True)
            t.start()
            deadline = time.monotonic() + 30
            while not any("Доступ для коллег включён" in s for s in self.said) and t.is_alive() \
                    and time.monotonic() < deadline:
                time.sleep(0.05)
        self.assertTrue(t.is_alive(), " | ".join(self.said))
        return t, result

    def close_window(self, t, result):
        self.cleanups[0]()  # то, что делает закрытие окна консоли
        t.join(15)
        self.assertFalse(t.is_alive())
        self.assertFalse(self.tunnels[0].alive())
        with self.assertRaises(OSError):
            hget(self.team_port, "/login")
        return result.get("code")

    def login_works(self):
        self.assertEqual(hget(self.team_port, "/")[0], 303)
        status, body, r = hget(self.team_port, "/api/login", "POST", {"password": TEAM_PW},
                               {"Content-Type": "application/json"})
        self.assertEqual(status, 200, body)
        cookie = r.getheader("Set-Cookie").split(";")[0]
        status, body, _ = hget(self.team_port, "/api/ping", headers={"Cookie": cookie})
        self.assertEqual(status, 200)
        self.assertIs(json.loads(body)["team"], True)

    def test_first_run_asks_password_before_tunnel_then_login_works_and_close_stops_all(self):
        t, result = self.start_main(passwords=[TEAM_PW, TEAM_PW])
        self.assertIs(self.tunnels[0].password_was_set, True)
        self.assertTrue(auth.Access(self.root).check_password(TEAM_PW))
        self.login_works()
        # локальный сайт — без пароля и со ссылкой на главной
        self.assertEqual(json.loads(hget(self.local_port, "/api/team")[1]), {"active": True, "url": URL})
        self.assertEqual(hget(self.local_port, "/")[0], 200)
        self.close_window(t, result)
        with self.assertRaises(OSError):
            hget(self.local_port, "/api/ping")
        text = " | ".join(self.said)
        self.assertNotIn(TEAM_PW, text)
        self.assertIn(URL, text)

    def test_local_site_already_running_only_team_part_starts(self):
        auth.Access(self.root).set_password(TEAM_PW)
        mine = server.make_server(self.root, port=self.local_port)
        threading.Thread(target=mine.serve_forever, daemon=True).start()
        self.addCleanup(mine.server_close)
        self.addCleanup(mine.shutdown)
        t, result = self.start_main()
        self.login_works()
        self.assertIn("уже открыт обычным запуском", " | ".join(self.said))
        self.assertEqual(json.loads(hget(self.local_port, "/api/team")[1]), {"active": False})
        self.close_window(t, result)
        self.assertEqual(hget(self.local_port, "/api/ping")[0], 200)  # чужой (обычный) сайт не тронут

    def test_ctrl_c_while_waiting_for_link_says_access_closed(self):
        auth.Access(self.root).set_password(TEAM_PW)

        def interrupted(self_, timeout=40):
            raise KeyboardInterrupt

        with mock.patch.object(team.Tunnel, "start", interrupted):
            code = team.main([], root=self.root, say=self.said.append, ask=lambda prompt="": "н")
        text = " | ".join(self.said)
        self.assertEqual(code, 0)
        self.assertIn("Доступ для коллег закрыт", text)
        self.assertNotIn("Туннель не запустился", text)


class TunnelCtrlCTest(unittest.TestCase):
    def test_ctrl_c_during_wait_stops_process_and_propagates(self):
        t = fake_tunnel(8766, "import time; time.sleep(60)")
        self.addCleanup(t.stop)
        threading.Timer(0.5, lambda: t._found.set()).start()  # будим ожидание
        calls = []
        real_wait = t._found.wait

        def wait(step):
            calls.append(step)
            if len(calls) == 2:
                raise KeyboardInterrupt
            return real_wait(step)

        t._found.wait = wait
        with self.assertRaises(KeyboardInterrupt):
            t.start(timeout=30)
        self.assertLessEqual(max(calls), 1)  # ждём короткими шагами
        self.assertFalse(t.alive())


if __name__ == "__main__":
    unittest.main()
