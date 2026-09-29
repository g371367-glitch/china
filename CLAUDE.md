<!-- autopilot:start -->
# Международная торговля: база знаний и инструменты

База знаний по торговле через Китай (Иу, Ozon Global), налогам КНР и РФ, маркетплейсам Южной Америки и торговому дому — плюс калькулятор юнит-экономики. Для владельца бизнеса, не для разработчика.

## Команды

Из корня проекта (путь с пробелом и кириллицей — всегда в кавычках):

```bash
cd "C:/Users/P famly/Desktop/claude/china"
python app/server.py                                   # сайт на http://127.0.0.1:8765 (для владельца — двойной клик по Запустить.bat)
TRADE_KB_NO_BROWSER=1 python app/server.py             # то же без открытия браузера
node --test app/tests/                                 # все JS-тесты (calc, calendar, products)
python -m unittest discover -s app/tests               # все тесты сервера
```

Только стандартная библиотека Python и ванильный JS: без pip, без npm, без сборки.

## Структура

```
Азия/Китай/, СНГ/Россия/,
Южная_Америка/, Торговый_дом/   заметки .md — сайт находит их сам, реестра нет
README.md                       оглавление + сводный календарь сроков (с ним сверяется data/calendar.json)
Журнал_изменений.md             «было → стало» по заметкам; есть файл — есть пункт меню «Что изменилось»
Запустить.bat                   ищет Python 3 и запускает app/server.py
app/server.py                   HTTP-сервер: статика app/web/ + /api/*
app/web/index.html              оболочка, подключает vendor/marked-12.0.2.min.js (window.marked)
app/web/js/                     api.js, app.js (роутер), calc.js, calendar.js — логика без DOM
app/web/js/views/               экраны: home, docs, search, calc, products, tariffs
app/tests/                      *.test.mjs (node) + test_server.py (unittest)
data/                           tariffs.default.json, calendar.json; данные пользователя создаются при работе
```

## Ключевые файлы

- `app/server.py` — `make_server(root, host, port, rate_url)`, `choose_port(start) → (port, already_running)`, `list_docs`, `resolve_doc`, `search`, `read_data`, `write_data`, `fetch_rate`.
- `app/web/js/api.js` — единственный клиент API, свой `fetch` не писать: `api.{ping, docs, doc(path), search(q), data(name), saveData(name, value), rate()}`, ошибки — `ApiError{message, status}`.
- `app/web/js/app.js` — `ROUTES [{path, menu?, title, view: () => Promise<render(el, ctx)>, alias?}]`; `'doc/*'` → `ctx.params.rest`; `ctx = {params, query, docs, navigate}`; хелперы `escapeHtml`, `docHash`, `folderLabel`, `groupDocs`, `navigate`.
- `app/web/js/calc.js` — `computeUnit(input, scheme, tariffs, settings) → {lines:[{key,label,cny,source?,checked?,note?,own?}], revenue, cost, profit, margin, roi, incomplete:[keys], warnings:['dutyFree']}`; `priceForMargin` / `breakeven → {price, margin, incomplete} | {unreachable:true, reason}`; `compareSchemes → {A,B,C,D, best, incomplete, comparable}`; `mergeTariffs(defaults, overrides)`; `chargeableWeight(input, divisor)`.
- `app/web/js/calendar.js` — `upcoming(events, today, settings, count=8) → [{date|null, country, what, who, when?, important?, soon, needsRegistrationDate}]`, `SOON_DAYS=30`; заглушка «впишите дату регистрации» идёт первой и вне `count`.
- `app/web/js/views/calc.js` — `getCalcState()`, `setCalcInput(input)`, `editProduct(product)` (следующее «Сохранить в список» обновляет ту же запись).
- `app/web/js/views/products.js` — без DOM на уровне импорта: `upsertProduct`, `computeRow`, `toCsv(rows, {rate})`, `incompleteText(keys)`.
- `app/web/js/views/tariffs.js` — `loadTariffs() → {defaults, overrides, tariffs}`, `isStale(checked)` (`STALE_DAYS=90`), `sourceHtml`, `leafTip`, `SCHEME_NAMES`.
- `data/tariffs.default.json` — тарифы из исследования; человекочитаемая копия — `Азия/Китай/05_Тарифы_Ozon_Global.md` (ключ строки = путь листа: `cat.home.rfbs`, `fees.dutyFreeLimit`).

## Архитектура

- Браузер → `api.js` → `server.py` → диск (`*.md`, `data/*.json`) или ЦБ (`https://www.cbr-xml-daily.ru/daily_json.js`); сервер слушает только 127.0.0.1.
- API: `GET /api/ping → {app:"trade-kb", version}`, `/api/docs`, `/api/doc?path=` (text/markdown, 404 вне папок знаний), `/api/search?q=` (без регистра, ё=е, ≥2 символа), `/api/rate → {rate, date, source:"cbr"}` или 502.
- `GET /api/data/<name>`: products, tariffs, tariffs.default, settings, calendar; нет файла → `null`. `PUT` — только products, tariffs, settings → `{ok:true}`; запись атомарная (временный файл → `os.replace`).
- Заметки = все `.md` в корне и папках; пропускаются скрытые папки, `node_modules`, в корне — `app`, `data`, `.autopilot`, `.claude` и файлы `CLAUDE.md`/`AGENTS.md`.
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

- Один JS-файл: `node --test app/tests/calc.test.mjs` (или `calendar.test.mjs`, `products.test.mjs`).
- Один Python-файл: `python -m unittest discover -s app/tests -p test_server.py` (~17 с: поднимает сервер на свободном порту с временным корнем).
- Новый JS-тест — просто `*.test.mjs` в `app/tests/`, `index.js` подхватит его сам.
- `calc.fixture.mjs` — свои числа для ручного счёта, с `data/tariffs.default.json` не связаны.
- `calendar.test.mjs` сверяет `data/calendar.json` с таблицей сводного календаря в `README.md`: правишь одно — правь другое.

## Подводные камни

- `node --test app/tests/` работает через `app/tests/index.js`: Node 22+ считает каталог модулем и ищет в нём index.js.
- `app/web/js/calc.js`, `app/web/js/views/calc.js` и `Запустить.bat` — с переводами строк CRLF, остальные файлы LF; `core.autocrlf=false`, `.gitattributes` нет — формат при правке сохраняй.
- `settings.json` пишется только слиянием с текущим файлом (`{...cur, ...patch}`), иначе затрутся чужие поля, например `registrationDate`.
- Все `logistics[].fixed/perGram` в `data/tariffs.default.json` сейчас `null` → любой расчёт помечен «неполный», пока пользователь не впишет свои тарифы; при `comparable:false` лучшая схема — не вывод.
- `data/settings.json`, `products.json`, `tariffs.json` — личные данные владельца и не в `.gitignore`; не добавлять их в коммит без спроса.
- Python в Git Bash печатает в cp1251: вывод с `¥`/кириллицей падает `UnicodeEncodeError` — запускай с `PYTHONUTF8=1`.
- Порт 8765 занят нашим же сервером → второй запуск только открывает браузер; занят чужим → берётся следующий свободный.
- В git не задан user.name/email; коммиты делаются через `git -c user.name="P famly" -c user.email=g371367@gmail.com commit …`.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Правило: требование из `manifest.md`
может снять только пользователь.

Если работа продолжается — скажи «продолжи автопилот»: состояние поднимется
из `.autopilot/state.js`, переспрашивать ничего не нужно.
<!-- autopilot:end -->
