"""Доступ для коллег: сайт с паролем + быстрый туннель Cloudflare.

Запуск: «Доступ для коллег.bat» (python app/team.py); «Сменить пароль.bat» (--set-password).
"""
import atexit
import getpass
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(APP_DIR)

DOWNLOAD_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
MANUAL_URL = "https://github.com/cloudflare/cloudflared/releases/latest"
EXE_NAME = "cloudflared.exe"
HOST = "127.0.0.1"
TEAM_PORT = 8766  # сайт для коллег — первый свободный порт начиная с этого
MIN_PASSWORD = 8  # то же, что auth.MIN_PASSWORD

TUNNEL_FAILED = ("Туннель не запустился — проверьте интернет (коллегам и вам в Китае нужен VPN) "
                 "и запустите «Доступ для коллег.bat» ещё раз.")
TUNNEL_STOPPED = "Туннель остановился — доступ для коллег закрыт."


class TeamError(Exception):
    """Ошибка с готовым русским текстом для окна."""

# Адрес быстрого туннеля; служебный api.trycloudflare.com — не он.
_URL_RE = re.compile(r"https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com\b", re.IGNORECASE)


def parse_tunnel_url(line):
    """Ссылка https://<x>.trycloudflare.com из строки вывода cloudflared или None."""
    m = _URL_RE.search(line or "")
    return m.group(0) if m else None


# ---------- cloudflared: поиск и скачивание ----------

def _tools_exe(root):
    return os.path.join(os.path.abspath(root), "tools", EXE_NAME)


def find_cloudflared(root):
    """Путь к cloudflared: сначала tools/cloudflared.exe, затем PATH; нет — None."""
    exe = _tools_exe(root)
    if os.path.isfile(exe):
        return exe
    return shutil.which("cloudflared")


def manual_hint(root):
    return (f"Скачайте вручную файл cloudflared-windows-amd64.exe со страницы {MANUAL_URL}, "
            f"переименуйте в {EXE_NAME} и положите в папку {os.path.dirname(_tools_exe(root))}")


def download_cloudflared(root, progress=None, url=DOWNLOAD_URL, timeout=30):
    """Скачивает cloudflared в tools/cloudflared.exe (через временный файл). progress(done, total|None)."""
    exe = _tools_exe(root)
    folder = os.path.dirname(exe)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".cloudflared-", suffix=".part", dir=folder)
    try:
        opener = urllib.request.build_opener()
        with os.fdopen(fd, "wb") as out, opener.open(url, timeout=timeout) as resp:
            total = resp.headers.get("Content-Length")
            total = int(total) if total and total.isdigit() else None
            done = 0
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
        if done == 0:
            raise OSError("пустой ответ")
        os.replace(tmp, exe)
        return exe
    except Exception as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise TeamError(f"Не удалось скачать cloudflared ({_short(e)}). {manual_hint(root)}") from None


def _short(e):
    reason = getattr(e, "reason", None)
    return str(reason or e) or e.__class__.__name__


# ---------- туннель ----------

class Tunnel:
    """Быстрый туннель Cloudflare к http://127.0.0.1:<port> (дочерний процесс cloudflared)."""

    def __init__(self, exe, port, command=None):
        self.exe = exe
        self.port = port
        # command — только для тестов: подставная программа вместо cloudflared.
        self.command = command or [exe, "tunnel", "--no-autoupdate", "--url", f"http://{HOST}:{port}"]
        self.url = None
        self._proc = None
        self._found = threading.Event()

    def start(self, timeout=40):
        """Запускает туннель и ждёт ссылку; не дождался — TeamError с русским текстом."""
        # Своего окна у cloudflared нет: он делит консоль с нами и закрывается вместе с ней.
        try:
            self._proc = subprocess.Popen(
                self.command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT)
        except OSError as e:
            raise TeamError(f"Не удалось запустить cloudflared ({_short(e)}). {TUNNEL_FAILED}") from None
        threading.Thread(target=self._read, args=(self._proc,), daemon=True).start()
        self._found.wait(timeout)
        if self.url is None:
            self.stop()
            raise TeamError(TUNNEL_FAILED)
        return self.url

    def _read(self, proc):
        # Вывод читаем до конца, иначе cloudflared упрётся в переполненный канал.
        for raw in proc.stdout:
            if self.url is None:
                url = parse_tunnel_url(raw.decode("utf-8", "replace"))
                if url:
                    self.url = url
                    self._found.set()
        self._found.set()  # процесс завершился — ждать больше нечего

    def alive(self):
        return self._proc is not None and self._proc.poll() is None

    def stop(self):
        proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(5)
        except Exception:
            try:
                proc.kill()
                proc.wait(5)
            except Exception:
                pass


# ---------- окно: пароль, буфер обмена, закрытие ----------

def ask_password(getpass_fn=None, say=print, min_len=MIN_PASSWORD):
    """Скрытый ввод пароля дважды; короткий или несовпадающий — повтор с пояснением."""
    getpass_fn = getpass_fn or getpass.getpass
    while True:
        pw = getpass_fn(f"Придумайте пароль для коллег (не короче {min_len} символов, ввод не виден): ")
        if len(pw) < min_len:
            say(f"Пароль должен быть не короче {min_len} символов — попробуйте ещё раз.")
            continue
        if getpass_fn("Повторите пароль: ") != pw:
            say("Пароли не совпадают — попробуйте ещё раз.")
            continue
        return pw


def copy_to_clipboard(text):
    """Кладёт текст в буфер обмена Windows через clip; не получилось — молча False."""
    if os.name != "nt":
        return False
    try:
        r = subprocess.run(["clip"], input=text.encode("ascii", "replace"),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


_close_handler = None  # ссылка держит обработчик консоли живым


def on_close(cleanup):
    """cleanup при выходе из Python и при закрытии окна консоли (SetConsoleCtrlHandler, где доступно)."""
    global _close_handler
    atexit.register(cleanup)
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes

        def handler(event):
            if event in (2, 5, 6):  # закрытие окна, выход из системы, выключение
                cleanup()
            return False  # Ctrl+C отдаём Python — он поднимет KeyboardInterrupt

        _close_handler = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)(handler)
        ctypes.windll.kernel32.SetConsoleCtrlHandler(_close_handler, True)
    except Exception:
        pass


def _offer_download(root, say, ask):
    say("Для доступа нужна бесплатная программа cloudflared от Cloudflare (около 60 МБ).")
    answer = ask("Скачать её сейчас? [Д/Н]: ").strip().lower()
    if answer not in ("д", "да", "y", "yes", "l"):  # «l» — «д» в английской раскладке
        raise TeamError("Без cloudflared доступ для коллег не включить. " + manual_hint(root))
    say("Скачиваю cloudflared…")

    def progress(done, total):
        mb = done / 1_048_576
        if total:
            print(f"\r  Скачано {mb:.1f} из {total / 1_048_576:.1f} МБ ({done * 100 // total}%)",
                  end="", flush=True)
        else:
            print(f"\r  Скачано {mb:.1f} МБ", end="", flush=True)

    try:
        return download_cloudflared(root, progress)
    finally:
        print(flush=True)


def _bind_team_server(server, root, access, skip):
    for port in range(TEAM_PORT, TEAM_PORT + 50):
        if port == skip:
            continue
        try:
            return server.make_server(root, HOST, port, access=access), port
        except OSError:
            continue
    raise TeamError(f"Нет свободного порта для сайта коллег ({TEAM_PORT}–{TEAM_PORT + 49}).")


def _serve(httpd):
    threading.Thread(target=httpd.serve_forever, daemon=True).start()


# ---------- точка входа ----------

def _main(args, root, say, ask):
    import auth  # таск 02: пароль и входы

    access = auth.Access(root)
    min_len = getattr(auth, "MIN_PASSWORD", MIN_PASSWORD)
    if "--set-password" in args:
        say("Смена пароля для коллег.")
        access.set_password(ask_password(say=say, min_len=min_len))
        say("Пароль изменён. Все, кто входил по старому паролю, должны войти заново.")
        return 0
    if not access.configured():
        say("Первый запуск: придумайте общий пароль — его вы сообщите коллегам.")
        access.set_password(ask_password(say=say, min_len=min_len))
        say("Пароль сохранён.")

    exe = find_cloudflared(root) or _offer_download(root, say, ask)

    import server

    team_info = types.SimpleNamespace(url=None)
    serving = []
    tunnel = None
    lock = threading.Lock()

    def cleanup():
        with lock:
            team_info.url = None
            if tunnel is not None:
                tunnel.stop()
            while serving:
                httpd = serving.pop()
                httpd.shutdown()
                httpd.server_close()

    on_close(cleanup)
    try:
        local_port, running = server.choose_port(server.DEFAULT_PORT)
        if not running:
            local = server.make_server(root, HOST, local_port, team_info=team_info)
            _serve(local)
            serving.append(local)
        team_httpd, team_port = _bind_team_server(server, root, access, skip=local_port)
        _serve(team_httpd)
        serving.append(team_httpd)

        say("Запускаю туннель Cloudflare (до 40 секунд)…")
        tunnel = Tunnel(exe, team_port)
        url = tunnel.start(timeout=40)
        team_info.url = url
        copied = copy_to_clipboard(url)

        say("")
        say("Доступ для коллег включён. Отправьте коллегам эту ссылку:")
        say(f"    {url}")
        if copied:
            say("Ссылка уже в буфере обмена — вставьте её в сообщение (Ctrl+V).")
        say("Ссылка меняется при каждом запуске — после перезапуска отправьте коллегам новую.")
        say("Коллеги входят по общему паролю. Сменить пароль — «Сменить пароль.bat».")
        if running:
            say("Сайт у вас уже открыт обычным запуском, поэтому на его главной ссылки не будет — "
                "берите её из этого окна.")
        else:
            say(f"Ваш сайт без пароля: http://{HOST}:{local_port}/ — на главной там тоже видна эта ссылка.")
        say("Закройте окно, чтобы закрыть доступ (или нажмите Ctrl+C).")
        say("")

        while tunnel.alive():
            time.sleep(1)
        say(TUNNEL_STOPPED)
        return 1
    finally:
        cleanup()


def main(argv=None, root=DEFAULT_ROOT, say=print, ask=input):
    """Запуск «Доступ для коллег»; --set-password — только сменить пароль. Возвращает код выхода."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    args = sys.argv[1:] if argv is None else list(argv)
    try:
        return _main(args, os.path.abspath(root), say, ask)
    except KeyboardInterrupt:
        say("")
        say("Доступ для коллег закрыт.")
        return 0
    except EOFError:
        say("")
        say("Ввод прерван — ничего не изменено.")
        return 1
    except TeamError as e:
        say(str(e))
        return 1
    except Exception as e:  # без трассировок: одна понятная строка
        say(f"Ошибка: {_short(e)}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
