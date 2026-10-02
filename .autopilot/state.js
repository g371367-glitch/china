window.STATE =
{
  "slug": "team-access",
  "dir": "2026-10-02-team-access",
  "title": "Доступ к сайту для коллег через интернет",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T1",
  "briefFile": "2026-10-02-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "C:/Users/P famly/.claude/skills/autopilot",
  "startedAt": "2026-10-02T16:30:55+03:00",
  "updatedAt": "2026-10-02T17:12:05+03:00",
  "finishedAt": "2026-10-02T17:12:05+03:00",
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-10-02T16:30:55+03:00",
      "finishedAt": "2026-10-02T16:33:09+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-10-02T16:31:40+03:00",
      "finishedAt": "2026-10-02T16:33:09+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-10-02T16:33:09+03:00",
      "finishedAt": "2026-10-02T16:42:35+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-10-02T16:42:35+03:00",
      "finishedAt": "2026-10-02T16:45:44+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-10-02T16:45:44+03:00",
      "note": "3 таска, ярус T1",
      "finishedAt": "2026-10-02T16:46:03+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-10-02T16:46:03+03:00",
      "note": "3 из 3 тасков готовы",
      "finishedAt": "2026-10-02T17:08:09+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-10-02T16:52:57+03:00",
      "note": "проверено 3 из 3",
      "finishedAt": "2026-10-02T17:08:09+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-10-02T17:08:09+03:00",
      "finishedAt": "2026-10-02T17:12:05+03:00",
      "note": "слепая приёмка: расхождений нет; туннель вживую не запускался"
    }
  ],
  "requirements": {
    "total": 13,
    "done": 13,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Общие данные без взаимного затирания",
      "requirements": [
        "R04",
        "R10i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "app/server.py (данные)",
        "app/web/js/"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "startedAt": "2026-10-02T16:46:03+03:00",
      "finishedAt": "2026-10-02T16:55:41+03:00",
      "commit": "36361aa",
      "tests": {
        "passed": 94,
        "failed": 0
      }
    },
    {
      "id": "03",
      "title": "Запуск «Доступ для коллег» и инструкция",
      "requirements": [
        "R01",
        "R02",
        "R05",
        "R06",
        "R07",
        "R08i",
        "R09i",
        "R12i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "app/team.py",
        "*.bat",
        "Доступ_для_коллег.md"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "startedAt": "2026-10-02T16:46:03+03:00",
      "finishedAt": "2026-10-02T16:55:41+03:00",
      "commit": "83fa2a6",
      "tests": {
        "passed": 94,
        "failed": 0
      }
    },
    {
      "id": "02",
      "title": "Вход по общему паролю",
      "requirements": [
        "R03",
        "R09i",
        "R11i",
        "R12i",
        "R13i",
        "R08i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "app/auth.py",
        "app/server.py (HTTP)",
        "app/web/"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "startedAt": "2026-10-02T16:55:41+03:00",
      "finishedAt": "2026-10-02T17:08:09+03:00",
      "commit": "3520710",
      "tests": {
        "passed": 130,
        "failed": 0
      }
    }
  ],
  "singlePass": null,
  "tests": {
    "passed": 130,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [
    "Блок со ссылкой для коллег на локальной главной — ради R08i",
    "Ссылка сразу в буфер обмена — ради R08i"
  ],
  "coverage": {
    "found": 1,
    "fixed": 1,
    "deferred": 0
  },
  "concerns": [
    "app/test_server.py:267 — тест повторяет скрытый протокол замка (допустимо: критерий называет data/.<name>.lock) — в отчёт",
    "app/auth.py:130 — повтор os.replace продублирован с server.py:264 — в отчёт",
    "app/web/login.html:41 — свой fetch в обход api.js — в отчёт",
    "app/tests/test_team.py — сквозной тест Ctrl+C не может покраснеть; TunnelCtrlCTest стоит на приватном _found.wait — в отчёт",
    "app/server.py _https/_client_ip — доверие заголовкам допустимо лишь потому, что сервер слушает только loopback; не записано у кода — в отчёт",
    "выход стирает только cookie: украденный вход живёт до 30 дней или до смены пароля — в заметке не сказано «потерял устройство → смени пароль» — в отчёт",
    "server.py: HEAD /login и /css открыты сверх §6; локальный POST теперь 404 вместо 501; auth: допуск 300 с на токен «из будущего» — в отчёт"
  ],
  "reviewers": {
    "manifestSpec": "rev-ms",
    "craft": "rev-craft"
  },
  "blind": {
    "agreed": 13,
    "drift": 0,
    "notes": [
      "туннель Cloudflare, скачивание cloudflared, буфер обмена и окно Windows проверены только кодом и тестами — запуск с выходом в интернет оставлен владельцу"
    ]
  }
}
