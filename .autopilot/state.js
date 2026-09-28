window.STATE =
{
  "slug": "trade-kb-calculator",
  "dir": "2026-09-28-trade-kb-calculator--wip",
  "title": "База знаний по торговле + калькулятор юнит-экономики Ozon Global / Иу",
  "mode": "interview",
  "depth": "normal",
  "polish": null,
  "tier": "T2",
  "briefFile": "2026-09-28-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "C:/Users/P famly/.claude/skills/autopilot",
  "startedAt": "2026-09-28T19:36:47+03:00",
  "updatedAt": "2026-09-28T20:34:03+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-09-28T19:36:47+03:00",
      "finishedAt": "2026-09-28T19:40:10+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-09-28T19:40:10+03:00",
      "finishedAt": "2026-09-28T19:39:02+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-09-28T19:39:02+03:00",
      "finishedAt": "2026-09-28T19:54:59+03:00",
      "note": "11 вопросов"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-09-28T19:50:55+03:00",
      "finishedAt": "2026-09-28T19:54:59+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-09-28T19:54:59+03:00",
      "note": "5 тасков, ярус T2, 3 волны",
      "finishedAt": "2026-09-28T19:58:32+03:00"
    },
    {
      "id": "build",
      "status": "active",
      "startedAt": "2026-09-28T19:58:32+03:00",
      "note": "3 из 5 тасков готовы"
    },
    {
      "id": "review",
      "status": "active",
      "startedAt": "2026-09-28T20:08:05+03:00",
      "note": "проверено 3 из 5; 03 в ремонте"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 11,
    "done": 0,
    "inTicket": 8,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 3,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Каркас сайта: запуск, меню, чтение, поиск",
      "requirements": [
        "R01",
        "R09i",
        "R11i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "app/server.py",
        "app/web/ (каркас)",
        "Запустить.bat"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "startedAt": "2026-09-28T19:58:32+03:00",
      "finishedAt": "2026-09-28T20:16:15+03:00",
      "tests": {
        "passed": 24,
        "failed": 0
      },
      "commit": "d5c45b3",
      "files": [
        "app/server.py",
        "app/web/",
        "Запустить.bat"
      ]
    },
    {
      "id": "02",
      "title": "Исследование: тарифы Ozon Global",
      "requirements": [
        "R02",
        "R10i",
        "R04"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "Азия/Китай/05_*",
        "data/tariffs.default.json"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 2,
      "handoffs": 0,
      "startedAt": "2026-09-28T19:58:32+03:00",
      "repairFindings": [
        "R02: комиссии и логистика все null — нужен действующий источник 2025-12+/2026 или явный отказ",
        "D01: нет unit у листьев (RUB/EUR/share), нет bands в заметке",
        "OGL 2,79+0,0242 с сомнительной валютой → null; perGram unit CNY/RUB без /g"
      ],
      "finishedAt": "2026-09-28T20:22:44+03:00",
      "commit": "7507df5",
      "tests": {
        "passed": 1,
        "failed": 0
      },
      "files": [
        "data/tariffs.default.json",
        "Азия/Китай/05_Тарифы_Ozon_Global.md"
      ]
    },
    {
      "id": "03",
      "title": "Калькулятор: расчёт, схемы, тарифы, курс",
      "requirements": [
        "D01",
        "R03",
        "R04",
        "R10i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "app/web/js/calc.js",
        "views/calc, views/tariffs"
      ],
      "status": "repair",
      "retries": 0,
      "repairs": 1,
      "handoffs": 0,
      "startedAt": "2026-09-28T20:16:15+03:00",
      "repairFindings": [
        "решение 11: «лучшая» и цены под маржу без пометки «неполный» — D выигрывает за счёт null=0"
      ]
    },
    {
      "id": "04",
      "title": "Проверка заметок и журнал изменений",
      "requirements": [
        "R02"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 2,
      "zone": [
        "существующие .md",
        "README.md",
        "Журнал_изменений.md"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 1,
      "handoffs": 0,
      "startedAt": "2026-09-28T20:22:44+03:00",
      "repairFindings": [
        "Бразилия: вычет $20/$30 сверить с процитированной страницей Receita, расхождение упомянуть"
      ],
      "finishedAt": "2026-09-28T20:34:03+03:00",
      "commit": "422f419",
      "tests": {
        "passed": 1,
        "failed": 0
      },
      "files": [
        "заметки (9 файлов)",
        "README.md",
        "Журнал_изменений.md"
      ]
    },
    {
      "id": "05",
      "title": "Главная со сроками и список товаров",
      "requirements": [
        "R01",
        "R03",
        "R11i"
      ],
      "blockedBy": [
        "03",
        "04"
      ],
      "wave": 3,
      "zone": [
        "calendar.js",
        "views/home, views/products",
        "data/calendar.json"
      ],
      "status": "pending",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0
    }
  ],
  "singlePass": null,
  "tests": {
    "passed": 41,
    "failed": 0
  },
  "debt": {
    "placeholders": [
      "Дата регистрации компании — впишете на главной",
      "Тарифы без открытых данных — впишете из кабинета Ozon",
      "Ставки своего агента и склада FBP — ориентиры из заметок",
      "Логистика OGL/CEL/GBS/China Post — действующих тарифов в открытых источниках нет, впишете из кабинета"
    ],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "findings": 9,
    "actions": [
      "ответы брифинга не попали в бриф → дописаны в «Дополнения» (закрывает 15 пунктов «есть в spec, нет в брифе» и «дополни её»)",
      "категории не названы → решение 16",
      "партнёры логистики и выбор тарифа → решение 17, ист. 11",
      "минимум рекламы в ₽ → решение 9",
      "параметры схем B/C/D → решение 18",
      "допустимые источники → решение 19"
    ]
  },
  "concerns": [
    "T01 test_server.py:243 — тест курса лезет во внутренность обработчика вместо make_server(rate_url=)",
    "T01 docs.js/search.js — norm и подсветка продублированы, папка из пути в двух местах",
    "T01 docs.js:160 — HTML из marked вставляется без очистки (заметки свои — решить осознанно)",
    "T01 server.py:284 — проверка порта без SO_EXCLUSIVEADDRUSE на Windows",
    "T01 поиск — во фрагментах сырой markdown",
    "T01 375px — не проверено в браузере, body overflow-x:hidden может прятать переполнение",
    "T02 комиссии — сторонний источник (China Consult, 07.2026), не официальная справка Ozon",
    "T02 сопоставление категорий Ozon сделано без доступа к официальному справочнику",
    "T03 views/calc.js:323 — цена под маржу при null-логистике без пометки «неполный» в ячейке",
    "T03 views/calc.js:289 — null-тариф показан как «0,00 ¥», у «лучшей» нет пометки неполного расчёта",
    "T03 calc.test.mjs — нет теста incomplete у priceForMargin/breakeven/compareSchemes при всей логистике null",
    "T03 calc.js:243 — percentShare дублирует удержания computeUnit",
    "T03 подписи налоговых режимов захардкожены",
    "T03 eurRate нигде не задаётся — предупреждение dutyFree не срабатывает",
    "T03 три словаря названий строк + ORDER; схемы A–D объявлены дважды; два разборщика чисел",
    "T03 style.css .small продублирован",
    "T03 tariffs.js — «моя правка (из кабинета)» утверждает происхождение",
    "T03 tests/index.js — import без await/catch",
    "T04 Бразилия: вычет $20/$30 — официальная страница недоступна, расхождение записано с вопросом",
    "T04 апостиль подтверждён hcch.net (вне списка решения 19, но официальный)",
    "T04 вопросы адресованы также консультанту/менеджерам площадок, не только бухгалтеру/агенту/Ozon"
  ],
  "reviewers": {
    "manifestSpec": "rev-ms",
    "craft": "rev-craft",
    "manifestSpec2": "rev-ms2"
  },
  "blind": null
}
