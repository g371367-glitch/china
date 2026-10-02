"""Общий пароль для сайта коллег: хранение (PBKDF2), входы (подписанные токены), защита от перебора.

Только стандартная библиотека. Пароль открытым текстом нигде не хранится и не печатается.
data/access.json через /api/data не читается и не пишется.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import threading
import time
from collections import deque
from datetime import datetime, timezone

MIN_PASSWORD = 8
SESSION_DAYS = 30
SESSION_SECONDS = SESSION_DAYS * 86400
ITERATIONS = 200_000
SALT_BYTES = 16
SECRET_BYTES = 32
FUTURE_SKEW = 300  # секунд: токен «из будущего» допускаем на случай сдвига часов

MAX_FAILS_PER_IP = 5
MAX_FAILS_ALL = 30
BLOCK_SECONDS = 15 * 60
WINDOW_SECONDS = 15 * 60


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _hash(pw, salt, iterations):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iterations)


class Access:
    """Пароль и входы. Файл читается при каждой проверке — смена пароля другим процессом действует сразу."""

    def __init__(self, root, clock=time.time):
        self.path = os.path.join(os.path.abspath(root), "data", "access.json")
        self.clock = clock

    def _load(self):
        try:
            with open(self.path, encoding="utf-8-sig") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict) or not all(k in data for k in ("salt", "hash", "iterations", "secret")):
            return None
        return data

    def configured(self):
        return self._load() is not None

    def set_password(self, pw):
        if not isinstance(pw, str) or len(pw) < MIN_PASSWORD:
            raise ValueError(f"Пароль должен быть не короче {MIN_PASSWORD} символов")
        old = self._load() or {}
        salt = secrets.token_bytes(SALT_BYTES)
        data = {
            "version": 1,
            "salt": salt.hex(),
            "hash": _hash(pw, salt, ITERATIONS).hex(),
            "iterations": ITERATIONS,
            "epoch": int(old.get("epoch", 0)) + 1,
            "secret": secrets.token_bytes(SECRET_BYTES).hex(),  # новый секрет гасит все прежние входы
            "changedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        folder = os.path.dirname(self.path)
        os.makedirs(folder, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".access.", suffix=".tmp", dir=folder)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, indent=2)
                f.write("\n")
            _replace(tmp, self.path)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    def check_password(self, pw):
        data = self._load()
        if data is None or not isinstance(pw, str):
            return False
        try:
            want = bytes.fromhex(data["hash"])
            got = _hash(pw, bytes.fromhex(data["salt"]), int(data["iterations"]))
        except (ValueError, TypeError):
            return False
        return hmac.compare_digest(want, got)

    def _sign(self, secret_hex, issued):
        return _b64(hmac.new(bytes.fromhex(secret_hex), issued.encode("ascii"), hashlib.sha256).digest())

    def issue(self):
        """Токен входа «<выдан, unix-время>.<HMAC-SHA256(secret, выдан) base64url>»."""
        data = self._load()
        if data is None:
            raise ValueError("Пароль ещё не задан")
        issued = str(int(self.clock()))
        return issued + "." + self._sign(data["secret"], issued)

    def verify(self, token):
        if not isinstance(token, str) or token.count(".") != 1:
            return False
        issued, sig = token.split(".")
        if not issued.isdigit() or not sig:
            return False
        data = self._load()
        if data is None:
            return False
        try:
            want = self._sign(data["secret"], issued)
        except (ValueError, TypeError):
            return False
        if not hmac.compare_digest(want.encode("ascii"), sig.encode("ascii", "replace")):
            return False
        age = self.clock() - int(issued)
        return -FUTURE_SKEW <= age <= SESSION_SECONDS


def _replace(src, dst, timeout=5):
    """os.replace с короткими повторами: на Windows файл может быть открыт на чтение другим процессом."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return os.replace(src, dst)
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


class LoginLimiter:
    """Защита от перебора (в памяти процесса).

    С одного адреса MAX_FAILS_PER_IP неудач за окно → адрес закрыт на BLOCK_SECONDS;
    со всех адресов MAX_FAILS_ALL неудач за скользящее окно → вход закрыт для всех на BLOCK_SECONDS.
    Успешный вход сбрасывает счётчик адреса.
    """

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self._lock = threading.Lock()
        self._fails = {}      # ip → deque времён неудач
        self._blocked = {}    # ip → до какого времени закрыт
        self._all = deque()   # времена всех неудач
        self._all_blocked = 0.0

    def _prune(self, now):
        while self._all and now - self._all[0] >= WINDOW_SECONDS:
            self._all.popleft()
        if len(self._fails) + len(self._blocked) > 1000:  # адреса из заголовка можно подделывать — не копим
            self._fails = {ip: q for ip, q in self._fails.items() if q and now - q[-1] < WINDOW_SECONDS}
            self._blocked = {ip: t for ip, t in self._blocked.items() if t > now}

    def check(self, ip):
        """(можно_пробовать, через_сколько_секунд)."""
        with self._lock:
            now = self.clock()
            until = max(self._all_blocked, self._blocked.get(ip, 0.0))
            if until > now:
                return False, int(until - now + 0.999)
            return True, 0

    def failure(self, ip):
        with self._lock:
            now = self.clock()
            self._prune(now)
            q = self._fails.setdefault(ip, deque())
            while q and now - q[0] >= WINDOW_SECONDS:
                q.popleft()
            q.append(now)
            if len(q) >= MAX_FAILS_PER_IP:
                self._blocked[ip] = now + BLOCK_SECONDS
                q.clear()
            self._all.append(now)
            if len(self._all) >= MAX_FAILS_ALL:
                self._all_blocked = now + BLOCK_SECONDS
                self._all.clear()

    def success(self, ip):
        with self._lock:
            self._fails.pop(ip, None)
            self._blocked.pop(ip, None)
