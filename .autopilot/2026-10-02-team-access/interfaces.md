# Интерфейсы

## Правила проекта

- Корень: `C:/Users/P famly/Desktop/claude/china` (пробел и кириллица — путь всегда в кавычках). Память проекта — `CLAUDE.md`, прочитай её первой.
- Только стандартная библиотека Python 3 и ванильный JS (ES-модули). Без pip, npm, сборки, CDN. Новая зависимость нужна → верни `BLOCKED`, не устанавливай.
- Тесты: `node --test app/tests/` и `python -m unittest discover -s app/tests` (в Git Bash — с `PYTHONUTF8=1`). Один файл: `python -m unittest discover -s app/tests -p test_team.py`.
- UTF-8 без BOM; интерфейс, ошибки API, комментарии — по-русски. Окончания строк: `app/web/js/calc.js`, `app/web/js/views/calc.js`, все `*.bat` — CRLF; остальные — LF. Формат при правке сохранять.
- Не трогать: `data/settings.json`, `data/products.json`, `data/tariffs.json`, `data/access.json` (личные данные владельца), `.autopilot/`, `CLAUDE.md`, `.gitignore`.
- Не коммитить — коммиты делает оркестратор.
- Пароль, токены, секреты никогда не печатать в лог, вывод, тестовые сообщения об ошибках.
- `.gitignore` уже содержит `data/.*.lock`, `data/access.json`, `tools/`.

## Границы, решённые в спецификации

| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `app/server.py` (данные) | файлы `data/*.json` | `read_data(root, name) → value \| None` (как было); `read_data_versioned(root, name) → (value, etag)`; `write_data(root, name, value, if_match=None)` — бросает `DataConflict` при несовпадении; `etag_of(root, name) → str` | межпроцессный замок записи (`data/.<name>.lock`), формат ETag |
| `app/server.py` (HTTP) | маршруты, режимы | `make_server(root, host, port, rate_url, access=None, team_info=None)` — `access` (экземпляр `auth.Access`) задан → сервер для коллег с паролем; `team_info` — объект с атрибутом `url` (строка или `None`) для `/api/team` на локальном | проверку cookie, перенаправления |
| `app/auth.py` (новый) | пароль, входы, перебор | `class Access(root)`: `configured() → bool`, `set_password(pw)`, `check_password(pw) → bool`, `issue() → token`, `verify(token) → bool`; `class LoginLimiter(clock=time.monotonic)`: `check(ip) → (ok, retry_after_s)`, `failure(ip)`, `success(ip)`; `MIN_PASSWORD = 8`, `SESSION_DAYS = 30` | формат `access.json`, PBKDF2, HMAC |
| `app/team.py` (новый) | запуск для коллег, туннель | `find_cloudflared(root) → path \| None`; `download_cloudflared(root, progress) → path`; `class Tunnel(exe, port)`: `start(timeout=40) → url`, `alive() → bool`, `stop()`; `parse_tunnel_url(line) → str \| None`; `main(argv)` | разбор вывода cloudflared, ввод пароля, буфер обмена |
| `app/web/js/api.js` | HTTP-клиент | добавляется `api.update(name, fn, {retries:3}) → Promise<новое значение>`; `api.logout()`; `api.team()`; на 401 любого запроса — переход на `/login` | ETag, повторы |
| `app/web/login.html` (новый) | страница входа | — | — |

### HTTP-контракты

- `GET /api/data/<name>` → тело как раньше + заголовок `ETag: "<16 hex sha256 содержимого>"`, нет файла → `ETag: "none"`.
- `PUT /api/data/<name>` + `If-Match: "<etag>"` → `{ok:true}` | `409 {"error":"Данные изменились — обновите"}` | `503 {"error":"Данные заняты — попробуйте ещё раз"}`; без `If-Match` — запись как раньше.
- `GET /api/ping` → `{app:"trade-kb", version, team:bool}`.
- `GET /api/team` (только локальный) → `{active:true, url}` | `{active:false}`; на сервере для коллег → 404.
- Сервер для коллег: без входа открыты только `GET /login`, `GET /css/style.css`, `POST /api/login` (`{password}` → `{ok:true}` + cookie | 401 `{"error":"Неверный пароль"}` | 429 `{"error":"Слишком много попыток, попробуйте через N мин"}`), `POST /api/logout` (→ `{ok:true}`, cookie стёрт). Прочее: не-API GET → 303 `/login`; `/api/*` → 401 `{"error":"Нужно войти"}`.
- Cookie `kb_session`: HttpOnly, SameSite=Lax, Path=/, Max-Age=30 дней; Secure, если `X-Forwarded-Proto: https` или `Cf-Visitor` содержит `https`.

### Швы для тестов

`app/auth.py` (`Access`, `LoginLimiter` с подставными часами); HTTP через `make_server` на временном корне (как в `test_server.py`); `parse_tunnel_url` на строках вывода cloudflared; `api.update` в node с подменённым `globalThis.fetch`. Реальный cloudflared в тестах не запускается.

## Что построили таски

(заполняется по мере готовности)

### Из таска 01 — общие данные

- `server.py`: `read_data(root,name)` (как было); `read_data_versioned(root,name) → (value, etag)`; `etag_of(root,name) → '"<16 hex>"' | '"none"'`; `write_data(root,name,value,if_match=None)` → исключения `DataConflict`, `DataBusy`; `LOCK_TIMEOUT=5`; замок `data/.<name>.lock` берётся при любой записи. `Handler.send_json(data, status=200, headers=None)`.
- HTTP: `GET /api/data/<name>` + `ETag`; `PUT` + `If-Match` → 200 `{ok:true}` | 409 | 503.
- `api.js`: `api.update(name, fn, {retries:3}) → Promise<записанное>` (экспорт и как `update`), `CONFLICT_MESSAGE`; повтор только на 409. `api.logout`, `api.team`, 401 → `/login` — ещё НЕ сделаны (таск 02).
- `shared.js`: `applySettingsPatch(cur, patch)`; `saveSettingsPatch(patch) → Promise<записанное>` (через `api.update`); `setTariffLeaf(ov, path, leaf, date)`, `resetTariffLeaf(ov, path, date)`, `addTariffCategory(ov, cat, date)`, `removeTariffCategory(ov, id, date)` — новый объект, `edited=date`.
- `products.js`: `deleteProduct(list, id)`; запись товаров — `api.update('products', …)` с `upsertProduct`/`deleteProduct`. Своих `fetch`/`saveData` для записи не писать.

### Из таска 03 — запуск для коллег

- `team.parse_tunnel_url(line) → str|None` (`api.trycloudflare.com` исключён); `find_cloudflared(root) → path|None`; `download_cloudflared(root, progress=None, url=DOWNLOAD_URL, timeout=30) → path`, `progress(done, total|None)`, ошибка → `TeamError`.
- `class Tunnel(exe, port, command=None)`: `start(timeout=40) → url | TeamError(TUNNEL_FAILED)`, `alive()`, `stop()` (повторно безопасно); `command` — подмена для тестов.
- `ask_password(getpass_fn=None, say=print, min_len=8) → pw`; `copy_to_clipboard(text) → bool`; `on_close(cleanup)`; `main(argv=None, root=DEFAULT_ROOT, say=print, ask=input) → код выхода`; `TeamError`, `TUNNEL_FAILED`, `TUNNEL_STOPPED`, `TEAM_PORT=8766`.
- Ожидает от таска 02: `auth.Access(root).configured()/set_password(pw)`, `auth.MIN_PASSWORD`; `server.make_server(root, HOST, port, team_info=SimpleNamespace(url))` для локального и `make_server(root, HOST, port, access=access)` для сайта коллег; `server.choose_port(server.DEFAULT_PORT)`.
- Сквозной запуск `main` с настоящими server/auth ещё не проверен — это таск 02.

### Из таска 02 — вход по паролю

- `auth`: `MIN_PASSWORD=8`, `SESSION_DAYS=30`, `SESSION_SECONDS`; `Access(root, clock=time.time)`: `configured()`, `set_password(pw)` (ValueError по-русски), `check_password(pw)`, `issue() → "<unix>.<HMAC base64url>"`, `verify(token)`; `LoginLimiter(clock=time.monotonic)`: `check(ip) → (ok, retry_s)`, `failure(ip)`, `success(ip)`.
- `data/access.json`: `{version, salt, hash, iterations, epoch, secret, changedAt}` (hex), читается при каждой проверке.
- `server`: `make_server(root, host, port, rate_url, access=None, team_info=None)`; `OPEN_PATHS`, `SESSION_COOKIE="kb_session"`; `POST /api/login` → `{ok}`+cookie | 401 | 429+`Retry-After`; `POST /api/logout`; `/api/ping → {app, version, team}`; `/api/team → {active, url?}` (на сайте коллег 404).
- `api.js`: `api.team()`, `api.logout()`, `LOGIN_PATH`, `NO_VERSION_MESSAGE`; любой 401 → `/login`; `update` без ETag → `ApiError(NO_VERSION_MESSAGE)`.
- `team.py`: `ask_password(..., min_len=None → auth.MIN_PASSWORD)`, `WAIT_STEP=0.2`.
