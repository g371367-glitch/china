"""Локальный сервер базы знаний по торговле.

Только стандартная библиотека. Слушает 127.0.0.1. Запуск: python app/server.py
"""
import contextlib
import hashlib
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "trade-kb"
VERSION = "0.1.0"
HOST = "127.0.0.1"
DEFAULT_PORT = 8765

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(APP_DIR)
WEB_DIR = os.path.join(APP_DIR, "web")
RATE_URL = "https://www.cbr-xml-daily.ru/daily_json.js"
RATE_TIMEOUT = 5

DATA_READ = {"products", "tariffs", "tariffs.default", "settings", "calendar"}
DATA_WRITE = {"products", "tariffs", "settings"}

# Служебные папки корня (в любом регистре) и служебные файлы корня.
SERVICE_DIRS = {".autopilot", ".git", "app", "data", ".claude", "node_modules"}
SERVICE_FILES = {"claude.md", "agents.md"}


# ---------- заметки ----------

def _skip_dir(name, at_root):
    """Скрытые папки и node_modules пропускаем везде, служебные — в корне."""
    low = name.lower()
    return name.startswith(".") or low == "node_modules" or (at_root and low in SERVICE_DIRS)


def list_docs(root):
    """Все .md из папок знаний и корня: [{path, title, folder}]."""
    result = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
        dirnames[:] = sorted(d for d in dirnames if not _skip_dir(d, rel_dir == ""))
        for name in sorted(filenames):
            if not name.lower().endswith(".md"):
                continue
            if rel_dir == "" and name.lower() in SERVICE_FILES:
                continue
            rel = f"{rel_dir}/{name}" if rel_dir else name
            result.append({"path": rel, "title": _title(os.path.join(dirpath, name), name), "folder": rel_dir})
    return result


def resolve_doc(root, rel):
    """Путь заметки из запроса → абсолютный путь или None (если небезопасен/служебный/нет файла)."""
    if not rel or not rel.lower().endswith(".md") or "\\" in rel or ":" in rel or "\x00" in rel:
        return None
    parts = rel.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    if any(_skip_dir(p, i == 0) for i, p in enumerate(parts[:-1])):
        return None
    if len(parts) == 1 and parts[0].lower() in SERVICE_FILES:
        return None
    root_real = os.path.realpath(root)
    full = os.path.realpath(os.path.join(root_real, *parts))
    if os.path.commonpath([root_real, full]) != root_real or not os.path.isfile(full):
        return None
    return full


def _read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def _norm(text):
    return text.lower().replace("ё", "е")


def search(root, query, max_hits=3, width=160):
    """[{path, title, hits:[{line, snippet}]}] — без учёта регистра, ё=е."""
    needle = _norm(query.strip())
    if len(needle) < 2:
        return []
    results = []
    for doc in list_docs(root):
        try:
            lines = _read(os.path.join(root, *doc["path"].split("/"))).splitlines()
        except OSError:
            continue
        hits = []
        for no, line in enumerate(lines, 1):
            pos = _norm(line).find(needle)
            if pos < 0:
                continue
            start = max(0, pos - width // 2)
            end = min(len(line), start + width)
            start = max(0, end - width)
            snippet = ("…" if start else "") + line[start:end].strip() + ("…" if end < len(line) else "")
            hits.append({"line": no, "snippet": snippet})
            if len(hits) >= max_hits:
                break
        if hits:
            results.append({"path": doc["path"], "title": doc["title"], "hits": hits})
    return results


def _title(path, name):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("# "):
                    return line[2:].strip()
    except OSError:
        pass
    return os.path.splitext(name)[0].replace("_", " ")


# ---------- данные пользователя ----------

def data_path(root, name):
    return os.path.join(root, "data", name + ".json")


LOCK_TIMEOUT = 5  # секунд ждать замок записи, затем DataBusy
NO_FILE_ETAG = '"none"'


class DataConflict(Exception):
    """If-Match не совпал с текущей версией файла."""


class DataBusy(Exception):
    """Замок записи не взят за LOCK_TIMEOUT."""


def _etag(raw):
    return '"' + hashlib.sha256(raw).hexdigest()[:16] + '"'


def _read_raw(root, name):
    """Байты data/<name>.json или None, если файла нет."""
    try:
        with open(data_path(root, name), "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def _decode(raw):
    return json.loads(raw.decode("utf-8-sig"))


def read_data(root, name):
    """JSON из data/<name>.json или None, если файла нет."""
    raw = _read_raw(root, name)
    return None if raw is None else _decode(raw)


def etag_of(root, name):
    """Версия файла: '"<16 hex sha256 содержимого>"', нет файла → '"none"'."""
    raw = _read_raw(root, name)
    return NO_FILE_ETAG if raw is None else _etag(raw)


def read_data_versioned(root, name):
    """(значение | None, etag) — из одного чтения файла."""
    raw = _read_raw(root, name)
    if raw is None:
        return None, NO_FILE_ETAG
    return _decode(raw), _etag(raw)


@contextlib.contextmanager
def _data_lock(root, name, timeout=None):
    """Межпроцессный замок записи на файл data/.<name>.lock; не взят за timeout → DataBusy."""
    timeout = LOCK_TIMEOUT if timeout is None else timeout
    folder = os.path.dirname(data_path(root, name))
    os.makedirs(folder, exist_ok=True)
    f = open(os.path.join(folder, f".{name}.lock"), "a+b")
    try:
        deadline = time.monotonic() + timeout
        while True:
            try:
                _lock_file(f)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise DataBusy(name) from None
                time.sleep(0.05)
        try:
            yield
        finally:
            _unlock_file(f)
    finally:
        f.close()


if os.name == "nt":
    import msvcrt

    def _lock_file(f):
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)

    def _unlock_file(f):
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _lock_file(f):
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock_file(f):
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def write_data(root, name, value, if_match=None):
    """Атомарная запись под замком: временный файл рядом → os.replace.

    if_match задан и не равен текущей версии → DataConflict, файл не тронут.
    Замок не взят за LOCK_TIMEOUT → DataBusy.
    """
    with _data_lock(root, name):
        if if_match is not None and if_match != etag_of(root, name):
            raise DataConflict(name)
        _write_atomic(data_path(root, name), value, name)


def _write_atomic(path, value, name):
    fd, tmp = tempfile.mkstemp(prefix=f".{name}.", suffix=".tmp", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# ---------- курс ЦБ ----------

def fetch_rate(url=RATE_URL, timeout=RATE_TIMEOUT):
    """{rate, eurRate?, date, source:"cbr"} — рублей за 1 ¥ и за 1 € (Value/Nominal); eurRate — если EUR есть в ответе."""
    req = urllib.request.Request(url, headers={"User-Agent": f"{APP_NAME}/{VERSION}"})
    local = urllib.parse.urlsplit(url).hostname in ("127.0.0.1", "localhost")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if local else urllib.request.build_opener()
    with opener.open(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
    cny = data["Valute"]["CNY"]
    out = {"rate": round(cny["Value"] / cny["Nominal"], 4), "date": str(data.get("Date", ""))[:10], "source": "cbr"}
    eur = data["Valute"].get("EUR")
    try:
        if eur and eur["Value"] > 0 and eur["Nominal"] > 0:
            out["eurRate"] = round(eur["Value"] / eur["Nominal"], 4)
    except (KeyError, TypeError):
        pass  # без евро — только проверка беспошлинного лимита не выполнится
    return out


# ---------- HTTP ----------

class Handler(SimpleHTTPRequestHandler):
    root = DEFAULT_ROOT
    rate_url = RATE_URL
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, fmt, *args):  # тихая консоль
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, ctype, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path)
        query = urllib.parse.parse_qs(url.query)
        if path == "/api/ping":
            return self.send_json({"app": APP_NAME, "version": VERSION})
        if path == "/api/docs":
            return self.send_json(list_docs(self.root))
        if path == "/api/doc":
            full = resolve_doc(self.root, query.get("path", [""])[0])
            if not full:
                return self.send_json({"error": "Заметка не найдена"}, 404)
            return self.send_text(_read(full), "text/markdown; charset=utf-8")
        if path == "/api/search":
            return self.send_json(search(self.root, query.get("q", [""])[0]))
        if path == "/api/rate":
            try:
                return self.send_json(fetch_rate(self.rate_url))
            except Exception as e:  # сеть, таймаут, формат ответа
                return self.send_json({"error": f"Нет связи с ЦБ: {e}"}, 502)
        if path.startswith("/api/data/"):
            name = path[len("/api/data/"):]
            if name not in DATA_READ:
                return self.send_json({"error": "Нет таких данных"}, 404)
            try:
                value, etag = read_data_versioned(self.root, name)
            except ValueError:
                return self.send_json({"error": f"Файл data/{name}.json повреждён"}, 500)
            return self.send_json(value, headers={"ETag": etag})
        if path.startswith("/api/"):
            return self.send_json({"error": "Не найдено"}, 404)
        return super().do_GET()

    def do_PUT(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b""  # читаем тело всегда, иначе клиент получит обрыв
        name = path[len("/api/data/"):] if path.startswith("/api/data/") else None
        if name not in DATA_WRITE:
            return self.send_json({"error": "Запись сюда запрещена"}, 404)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self.send_json({"error": "Тело запроса — не JSON"}, 400)
        if_match = self.headers.get("If-Match")
        try:
            write_data(self.root, name, value, if_match=if_match.strip() if if_match else None)
        except DataConflict:
            return self.send_json({"error": "Данные изменились — обновите"}, 409)
        except DataBusy:
            return self.send_json({"error": "Данные заняты — попробуйте ещё раз"}, 503)
        return self.send_json({"ok": True})


class _Server(ThreadingHTTPServer):
    # На Windows SO_REUSEADDR позволяет занять чужой порт — отключаем.
    allow_reuse_address = os.name != "nt"
    daemon_threads = True


def make_server(root=DEFAULT_ROOT, host=HOST, port=DEFAULT_PORT, rate_url=RATE_URL):
    handler = type("BoundHandler", (Handler,), {"root": os.path.abspath(root), "rate_url": rate_url})
    return _Server((host, port), handler)


def is_our_server(port, host=HOST):
    """На порту отвечает наш сервер (/api/ping → app == trade-kb)?"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://{host}:{port}/api/ping", timeout=1.5) as r:
            return json.loads(r.read().decode("utf-8")).get("app") == APP_NAME
    except Exception:
        return False


def _port_free(port, host=HOST):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def choose_port(start=DEFAULT_PORT, host=HOST, attempts=50):
    """(порт, уже_запущен): наш сервер на start → (start, True); иначе первый свободный от start."""
    for port in range(start, start + attempts):
        if _port_free(port, host):
            return port, False
        if port == start and is_our_server(port, host):
            return port, True
    raise OSError(f"Нет свободного порта в диапазоне {start}–{start + attempts - 1}")


def _open_browser(url):
    if os.environ.get("TRADE_KB_NO_BROWSER") != "1":  # для проверок без браузера
        webbrowser.open(url)


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    port, running = choose_port()
    url = f"http://{HOST}:{port}/"
    if running:
        print(f"Сайт уже работает: {url} — открываю браузер.", flush=True)
        _open_browser(url)
        return
    httpd = make_server(DEFAULT_ROOT, HOST, port)
    print(f"Сайт работает: {url}, закройте это окно, чтобы остановить (или Ctrl+C).", flush=True)
    threading.Timer(0.5, _open_browser, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("Остановлено.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
