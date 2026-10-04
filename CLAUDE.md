<!-- autopilot:start -->
# Международная торговля: база знаний и инструменты

База знаний по торговле через Китай (Иу, Ozon Global), налогам КНР и РФ, маркетплейсам Южной Америки и торговому дому — плюс калькулятор юнит-экономики. Для владельца бизнеса, не для разработчика.

## Команды

Из корня проекта (путь с пробелом и кириллицей — всегда в кавычках):

```bash
cd "C:/Users/P famly/Desktop/claude/china"
python app/server.py                                   # сайт на http://127.0.0.1:8765 (для владельца — двойной клик по Запустить.bat)
TRADE_KB_NO_BROWSER=1 python app/server.py             # то же без открытия браузера
python app/team.py                                     # «Доступ для коллег»: пароль + сайт коллег + туннель (интерактивно)
python app/team.py --set-password                      # только сменить общий пароль (пишет data/access.json)
python app/build_site.py [site]                         # открытая копия для GitHub Pages в site/ (CI: .github/workflows/pages.yml)
node --test app/tests/                                 # все JS-тесты (58)
PYTHONUTF8=1 python -m unittest discover -s app/tests  # все Python-тесты (85, ~50 с)
```

Только стандартная библиотека Python и ванильный JS: без pip, без npm, без сборки.

## Структура

```
Азия/Китай/, СНГ/Россия/,
Южная_Америка/, Торговый_дом/   заметки .md — сайт находит их сам, реестра нет
README.md                       оглавление + сводный календарь сроков (с ним сверяется data/calendar.json)
Журнал_изменений.md             «было → стало» по заметкам; есть файл — есть пункт меню «Что изменилось»
Доступ_для_коллег.md            инструкция владельцу по доступу для коллег (сама тоже заметка сайта)
Запустить.bat                   ищет Python 3 и запускает app/server.py
Доступ для коллег.bat           то же → app\team.py; Сменить пароль.bat → app\team.py --set-password
app/server.py                   HTTP-сервер: статика app/web/ + /api/*, данные с ETag и замком, вход для коллег
app/auth.py                     общий пароль (PBKDF2), токены сессии (HMAC), защита от перебора
app/team.py                     «Доступ для коллег»: cloudflared, туннель, второй сервер с паролем
app/build_site.py               сборка открытой копии для GitHub Pages → site/ (в .gitignore)
.github/workflows/pages.yml     на push в main/master: JS-тесты → build_site.py → GitHub Pages
app/web/index.html              оболочка, подключает vendor/marked-12.0.2.min.js (window.marked)
app/web/login.html              страница входа сайта коллег
app/web/js/                     api.js, app.js (роутер), calc.js, calendar.js, shared.js, static.js — логика без DOM
app/web/js/views/               экраны: home, docs, search, calc, products, tariffs
app/tests/                      node: calc, calendar, products, shared, update, auth, static (*.test.mjs); unittest: test_server, test_auth, test_team, test_build_site
data/                           tariffs.default.json, calendar.json; данные пользователя и access.json создаются при работе
tools/                          сюда team.py скачивает cloudflared.exe (в .gitignore, создаётся при работе)
```

## Ключевые файлы

- `app/server.py` — `make_server(root, host, port, rate_url, access=None, team_info=None)`, `choose_port(start) → (port, already_running)`, `DEFAULT_PORT=8765`, `list_docs`, `resolve_doc`, `search`, `fetch_rate`; данные: `read_data(root,name) → value|None`, `read_data_versioned → (value, etag)`, `etag_of → '"<16 hex>"'|'"none"'`, `write_data(root,name,value,if_match=None)` → `DataConflict` | `DataBusy` (`LOCK_TIMEOUT=5` с); `SESSION_COOKIE="kb_session"`, `OPEN_PATHS`.
- `app/auth.py` — `Access(root, clock=time.time)`: `configured()`, `set_password(pw)` (ValueError по-русски), `check_password(pw)`, `issue() → "<unix>.<HMAC base64url>"`, `verify(token)`; `LoginLimiter(clock=time.monotonic)`: `check(ip) → (ok, retry_s)`, `failure(ip)`, `success(ip)` (в памяти процесса; 5 ошибок с IP / 30 всего за 15 мин → блок 15 мин); `MIN_PASSWORD=8`, `SESSION_DAYS=30`.
- `app/team.py` — `main(argv=None, root, say=print, ask=input) → код выхода`; `find_cloudflared(root)` (`tools/cloudflared.exe`, затем PATH), `download_cloudflared(root, progress=None, url, timeout=30)`, `Tunnel(exe, port, command=None)`: `start(timeout=40) → url`, `alive()`, `stop()`; `parse_tunnel_url(line)`; `ask_password`, `copy_to_clipboard`, `on_close`; ошибки — `TeamError`; `TEAM_PORT=8766`.
- `app/web/js/api.js` — единственный клиент API, свой `fetch` не писать: `api.{ping, docs, doc(path), search(q), data(name), update(name, fn, {retries:3}), rate(), team(), logout()}`; `update` = GET с ETag → `fn(текущее)` → PUT с If-Match, повтор только на 409, без ETag → `ApiError(NO_VERSION_MESSAGE)`; любой 401 → переход на `/login`; ошибки — `ApiError{message, status}`. `api.saveData` (перезапись вслепую) экранами не используется.
- `app/web/js/shared.js` — `SCHEMES`, `SCHEME_NAMES`, `LINE_LABELS/ORDER`, `incompleteText`, `withSettingsDefaults`, `applySettingsPatch(cur, patch)`, `saveSettingsPatch(patch)` (через `api.update`), `setTariffLeaf/resetTariffLeaf/addTariffCategory/removeTariffCategory(ov, …, date)` → новый объект с `edited=date`, `parseNum(raw) → {n}|{empty}|{bad}`.
- `app/web/js/app.js` — `ROUTES [{path, menu?, title, view: () => Promise<render(el, ctx)>, alias?}]`; `'doc/*'` → `ctx.params.rest`; `ctx = {params, query, docs, navigate}`; хелперы `escapeHtml`, `docHash`, `folderLabel`, `groupDocs`, `navigate`.
- `app/web/js/calc.js` — `computeUnit(input, scheme, tariffs, settings) → {lines:[{key,label,cny,source?,checked?,note?,own?}], revenue, cost, profit, margin, roi, incomplete:[keys], warnings:['dutyFree']}`; `priceForMargin` / `breakeven → {price, margin, incomplete} | {unreachable:true, reason}`; `compareSchemes → {A,B,C,D, best, incomplete, comparable}`; `mergeTariffs(defaults, overrides)`; `chargeableWeight(input, divisor)`.
- `app/web/js/calendar.js` — `upcoming(events, today, settings, count=8) → [{date|null, country, what, who, when?, important?, soon, needsRegistrationDate}]`, `SOON_DAYS=30`; заглушка «впишите дату регистрации» идёт первой и вне `count`.
- `app/web/js/views/calc.js` — `getCalcState()`, `setCalcInput(input)`, `editProduct(product)` (следующее «Сохранить в список» обновляет ту же запись).
- `app/web/js/views/products.js` — без DOM на уровне импорта: `upsertProduct`, `deleteProduct(list, id)`, `computeRow`, `toCsv(rows, {rate})`, `incompleteText(keys)`.
- `app/web/js/views/tariffs.js` — `loadTariffs() → {defaults, overrides, tariffs}`, `isStale(checked)` (`STALE_DAYS=90`), `sourceHtml`, `leafTip`, `SCHEME_NAMES`.
- `data/tariffs.default.json` — тарифы из исследования; человекочитаемая копия — `Азия/Китай/05_Тарифы_Ozon_Global.md` (ключ строки = путь листа: `cat.home.rfbs`, `fees.dutyFreeLimit`).

## Архитектура

- Браузер → `api.js` → `server.py` → диск (`*.md`, `data/*.json`) или ЦБ (`https://www.cbr-xml-daily.ru/daily_json.js`); сервер слушает только 127.0.0.1.
- Два режима одного `Handler`: локальный (`access=None`, без пароля, порт 8765+) и сайт коллег (`access=auth.Access`, порт 8766+), который `team.py` поднимает рядом и выводит наружу через `cloudflared tunnel --url` → `https://<x>.trycloudflare.com` (меняется при каждом запуске).
- Сайт коллег без cookie: открыты `GET /login`, `GET /css/style.css`, `POST /api/login {password}` (→ `{ok}`+cookie | 401 | 429 + `Retry-After`), `POST /api/logout`; прочие не-API GET → 303 `/login`, `/api/*` → 401 `{"error":"Нужно войти"}`.
- Cookie `kb_session`: HttpOnly, SameSite=Lax, Max-Age 30 дней; Secure, если `X-Forwarded-Proto: https` или `Cf-Visitor` с https. Смена пароля меняет `epoch`/`secret` → все сессии сбрасываются.
- `data/access.json`: `{version, salt, hash, iterations, epoch, secret, changedAt}` (hex), читается при каждой проверке; создаёт только `team.py` (ввод пароля), значения не печатать.
- API: `GET /api/ping → {app:"trade-kb", version, team:bool}` (`team:true` → в меню пункт «Выйти»), `/api/team` (только локальный: `{active:true, url}` | `{active:false}`; у коллег 404), `/api/docs`, `/api/doc?path=` (text/markdown, 404 вне папок знаний), `/api/search?q=` (без регистра, ё=е, ≥2 символа), `/api/rate → {rate, date, source:"cbr"}` или 502.
- `GET /api/data/<name>`: products, tariffs, tariffs.default, settings, calendar; нет файла → `null`; заголовок `ETag: "<16 hex sha256>"` (нет файла → `"none"`). `PUT` — только products, tariffs, settings; с `If-Match` → `{ok:true}` | 409 (версия устарела) | 503 (замок не взят за 5 с); без `If-Match` — запись вслепую. Запись: межпроцессный замок `data/.<name>.lock` (msvcrt/fcntl) → временный файл → `os.replace`.
- Все записи экранов — операцией над свежими данными через `api.update` (`saveSettingsPatch`, `upsertProduct`/`deleteProduct`, `setTariffLeaf`…): правки коллег не затираются.
- Заметки = все `.md` в корне и папках; пропускаются скрытые папки, `node_modules`, в корне — `app`, `data`, `.autopilot`, `.claude` и файлы `CLAUDE.md`/`AGENTS.md`.
- Открытая копия (GitHub Pages, без пароля): `build_site.py` кладёт в `site/` копию `app/web` (без login.html), `static/notes.json` `{docs, texts}` (из `server.list_docs`), `static/data/{tariffs.default,calendar}.json`, `.nojekyll`; в `index.html` пути относительные и `window.TRADE_KB_STATIC = true`. Тогда `api.js` шлёт запросы не на сервер, а в `static.js` `createStaticBackend({fetch, storage})`, который возвращает `Response` как сервер: products/tariffs/settings — `localStorage` с ключом `trade-kb:<name>` (ETag = FNV-хэш, 409 работает), поиск — `searchNotes` (копия `server.search`), курс — напрямую с ЦБ (CORS открыт), `ping → {static:true}` (в меню пометка), `/api/team` → 404.
- Новый экран = запись в `ROUTES` + модуль в `views/` с `render(el, ctx)`.
- Расчёты только через `calc.js`/`calendar.js` (чистые функции); экраны их не дублируют.
- Тарифы: `data/tariffs.default.json` (исходные) + `data/tariffs.json` (только изменённые листья и `"edited"`) → `mergeTariffs`: массивы сливаются по `id`, лист заменяется целиком и получает `own:true`.
- Лист тарифа: `{value, unit, [bands], source, checked, note?}`; `value:null` = нет данных → ключ в `incomplete`, в сумму идёт 0. `unit` ∈ CNY, RUB, EUR, share, cm3/kg.
- Разделы тарифов: `categories[]` (rfbs/fbp, `ozonCategory`), `logistics[]` (fixed/perGram/bands, days), `fees`, `schemes.A–D`, `tax.{simplified, regular}`.
- input калькулятора: `{purchase ¥, weight г, dims?:{l,w,h} см, category, logistics, price ¥, noAds?}`.
- `data/settings.json`: `rate` (₽ за ¥), `rateDate`, `rateSource` ('cbr'|'manual'), `conversionReserve`, `taxMode` ('simplified'|'regular'|'custom'), `taxCustomRate`, `registrationDate`, `defaultScheme`.
- `data/products.json`: `[{id, name, link1688, note, input, scheme, createdAt, updatedAt}]`.
- `data/calendar.json`: `{version, source, checked, events:[{country:'CN'|'RU'|'CN-RU', when, what, who, important?, rule}]}`; `rule.type` ∈ monthly `{day}`, quarterly `{dates:['MM-DD']}`, yearly `{date}`, once `{date}`, afterRegistration `{months}`.

## Соглашения кода

- UTF-8 без BOM; интерфейс, ошибки API и комментарии — по-русски.
- Доли хранятся как share (0.05), не проценты; деньги в расчёте — в юанях (`cny`), рубли только для показа.
- Факты о пользователе (цены, бухгалтер, агент, дата регистрации) не выдумывать — заглушка с видимой пометкой.
- Сторонний код — только `app/web/vendor/marked-12.0.2.min.js`, версия в имени файла; CDN не использовать.

## Окружение

- `TRADE_KB_NO_BROWSER` — `1`: сервер не открывает браузер.
- `PYTHONUTF8`, `PYTHONIOENCODING` — выставляет `Запустить.bat`.

## Тесты

- Один JS-файл: `node --test app/tests/calc.test.mjs` (или `calendar`, `products`, `shared`, `update`, `auth`); `update`/`auth` подменяют `globalThis.fetch`.
- Один Python-файл: `PYTHONUTF8=1 python -m unittest discover -s app/tests -p test_server.py` (~24 с: сервер на свободном порту с временным корнем), `-p test_auth.py` (~11 с), `-p test_team.py` (~12 с: вместо cloudflared — скрипт-заглушка через `Tunnel(command=…)`).
- Время входа и блокировок — через подставные часы (`clock=`), не `sleep`.
- Новый JS-тест — просто `*.test.mjs` в `app/tests/`, `index.js` подхватит его сам.
- `calc.fixture.mjs` — свои числа для ручного счёта, с `data/tariffs.default.json` не связаны.
- `calendar.test.mjs` сверяет `data/calendar.json` с таблицей сводного календаря в `README.md`: правишь одно — правь другое.

## Подводные камни

- `node --test app/tests/` работает через `app/tests/index.js`: Node 22+ считает каталог модулем и ищет в нём index.js.
- `app/web/js/calc.js`, `app/web/js/views/calc.js` и все `*.bat` — с переводами строк CRLF, остальные файлы LF; `core.autocrlf=false`, `.gitattributes` нет — формат при правке сохраняй.
- `settings.json` пишется только через `saveSettingsPatch` (`api.update` + слияние `{...cur, ...patch}`), иначе затрутся чужие поля, например `registrationDate`.
- Все `logistics[].fixed/perGram` в `data/tariffs.default.json` сейчас `null` → любой расчёт помечен «неполный», пока пользователь не впишет свои тарифы; при `comparable:false` лучшая схема — не вывод.
- `data/settings.json`, `products.json`, `tariffs.json`, `access.json`, `data/.*.lock`, `tools/` — в `.gitignore`; личные данные в настоящем корне не трогать (тесты — на временном корне).
- `team.py` без нужды не запускать: скачивает cloudflared (~60 МБ), открывает сайт в интернет, первый запуск спрашивает пароль и пишет `data/access.json`.
- Python в Git Bash печатает в cp1251: вывод с `¥`/кириллицей падает `UnicodeEncodeError` — запускай с `PYTHONUTF8=1`.
- Порт 8765 занят нашим же сервером → второй запуск только открывает браузер; занят чужим → берётся следующий свободный. Локальный сайт запущен до `team.py` → ссылки туннеля на его главной нет (`team_info` только у процесса `team.py`).
- В git не задан user.name/email; коммиты делаются через `git -c user.name="P famly" -c user.email=g371367@gmail.com commit …`.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Правило: требование из `manifest.md`
может снять только пользователь.

Если работа продолжается — скажи «продолжи автопилот»: состояние поднимется
из `.autopilot/state.js`, переспрашивать ничего не нужно.
<!-- autopilot:end -->
