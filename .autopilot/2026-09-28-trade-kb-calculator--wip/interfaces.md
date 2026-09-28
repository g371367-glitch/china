# Интерфейсы

## Правила проекта

- Корень проекта: `C:/Users/P famly/Desktop/claude/china` (Windows 10, Git Bash доступен). Путь содержит пробел и кириллицу — всегда в кавычках.
- Python 3.14 (`python`), Node (`node`) — есть. **Только стандартная библиотека Python, без pip; без npm-зависимостей.** Единственная сторонняя вещь — marked, положенный файлом в `app/web/vendor/` (скачать один раз с cdn.jsdelivr.net/npm/marked, зафиксировать версию в имени/комментарии).
- Тесты: `python -m unittest discover -s app/tests` и `node --test app/tests/` (из корня проекта).
- Запуск: `Запустить.bat` → `python app/server.py` → http://127.0.0.1:8765.
- Кодировка всех файлов — UTF-8 без BOM (кроме CSV-выгрузки). Интерфейс и сообщения — по-русски.
- Не трогать: `.autopilot/` (кроме того, что разрешает оркестратор), `CLAUDE.md`, `.gitignore`, `.git/`.
- Не хватает зависимости или доступа → вернуть `BLOCKED` с причиной, ничего не устанавливать.
- Факты о пользователе (его цены, бухгалтер, агент, дата регистрации) не выдумываются — заглушка с видимой пометкой.

## Границы, решённые в спецификации


| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `server` (`app/server.py`) | доступ к диску и сети, безопасность путей | HTTP API: `GET /api/ping → {app:"trade-kb", version}`; `GET /api/docs → [{path, title, folder}]`; `GET /api/doc?path= → text/markdown` (404 если не .md или вне папок знаний); `GET /api/search?q= → [{path, title, hits:[{line, snippet}]}]`; `GET /api/data/<name> → JSON` (name ∈ products, tariffs, tariffs.default, settings, calendar; отсутствующий файл → `null`); `PUT /api/data/<name>` (только products, tariffs, settings) → `{ok:true}`; `GET /api/rate → {rate, date, source:"cbr"}` или 502 `{error}` | обход папок, фильтр служебных, защиту от `..`, атомарную запись, запрос к ЦБ |
| `calc` (`app/web/js/calc.js`, ES-модуль, без DOM) | формулы юнит-экономики | `computeUnit(input, scheme, tariffs, settings) → {lines:[{key,label,cny}], revenue, cost, profit, margin, roi, incomplete:[keys]}`; `priceForMargin(targetMargin, input, scheme, tariffs, settings) → {price} \| {unreachable, reason}`; `breakeven(...)`; `compareSchemes(input, tariffs, settings) → {A,B,C,D, best}`; `mergeTariffs(default, overrides) → tariffs`; `chargeableWeight(input, divisor)` | ступени логистики, бисекцию, налоговые режимы |
| `calendar` (`app/web/js/calendar.js`, без DOM) | разворот правил в даты | `upcoming(events, today, settings, count) → [{date, country, what, who, soon:boolean, needsRegistrationDate:boolean}]` | арифметику дат |
| `ui` (`app/web/`) | экраны и маршруты | — (конечный потребитель) | всё остальное |
| данные `data/*.json` | формат хранения | схема `tariffs.default.json` (ниже) — общий контракт исследования и калькулятора | — |

Схема тарифов (контракт между таском исследования и калькулятором):

```json
{
  "version": 1, "checked": "2026-09-28",
  "categories": [{"id":"home","name":"Дом и сад","rfbs":{"value":0.12,"source":"url","checked":"2026-09-28"},"fbp":{"value":null,"source":null,"checked":null,"note":"нет данных — впишите из кабинета"}}],
  "logistics": [{"id":"ogl-standard","name":"OGL Стандарт","fixed":{"value":…},"perGram":{"value":…},"bands":[{"maxWeight":…,"maxPrice":…,"fixed":…,"perGram":…}],"days":"10–15","source":…,"checked":…}],
  "fees": {"acquiring":{…}, "adsPerOrder":{…}, "adsMinRub":{…}, "returnsReserve":{…}, "volumetricDivisor":{…}, "dutyFreeLimit":{…}},
  "schemes": {"A":{"cnDelivery":{…},"agentFee":{…},"returnsReserve":{…}}, "B":{"cnDelivery","supplierPackFee","returnsReserve"}, "C":{"batchDiscount","inboundPerUnit","storagePerUnit","agentFee","returnsReserve"}, "D":{"batchDiscount","inboundPerUnit","fbpHandling","returnsReserve"}},   // поля — по решению 18
  "tax": {"simplified":{"base":0.04,"rate":0.05}, "regular":{"rate":0.05}}
}
```

Каждое число-листа — объект `{value, source, checked, note?}`; `value: null` = нет данных. `data/tariffs.json` (правки) — та же форма, только изменённые листья, плюс `"edited": "дата"`; `mergeTariffs` накладывает правки на исходные.

**Швы для тестов:** `calc` и `calendar` (чистые функции, тесты на `node --test`), `server` HTTP API (тесты на `python -m unittest`, поднимают сервер на свободном порту с временным корнем). UI проверяется прогоном в браузере на финальной приёмке.


## Что построили таски

_(дополняется по мере сдачи тасков)_

### Из таска 01 — каркас

- `app/server.py`: `make_server(root, host, port, rate_url) -> ThreadingHTTPServer`; `choose_port(start) -> (port, already_running)`; `list_docs(root)`, `resolve_doc(root, rel)`, `search(root, q)`, `read_data(root, name)`, `write_data(root, name, value)`, `fetch_rate(url)`. Все эндпоинты — как в «Границах». env `TRADE_KB_NO_BROWSER=1` — не открывать браузер (для тестов/запуска из агентов).
- `app/web/js/api.js` — **единственный клиент API, не пиши свой**: `get(path)`, `put(path, data)`, `class ApiError{message,status}`; объект `api {get, put, ping, docs, doc(path), search(q), data(name), saveData(name, value), rate()}`.
- `app/web/js/app.js` — реестр маршрутов `ROUTES [{path, menu?, title, view: () => Promise<render(el, ctx)>, alias?}]`; шаблон `'doc/*'` → `ctx.params.rest`; `ctx = {params, query: URLSearchParams, docs, navigate}`. Хелперы: `escapeHtml`, `docHash(path, query?)`, `folderLabel`, `groupDocs`, `navigate(hash)`. Новый экран = новая запись в `ROUTES` + модуль в `views/`.
- Маршруты: `#/` (сейчас `renderHome` из `views/docs.js`; таск 05 заменяет запись в ROUTES), `#/doc/<путь>[?q=|?a=якорь]`, `#/search?q=`, заглушки `#/calc`, `#/tariffs`, `#/products`. Пункт меню «Что изменилось» появляется сам, когда существует `Журнал_изменений.md`.
- Стили — `app/web/css/style.css`; широкие таблицы оборачиваются в `.table-wrap`.
- Тесты сервера: `python -m unittest discover -s app/tests` (24 теста).
