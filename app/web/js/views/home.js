// Главная: ближайшие сроки сводного календаря КНР + РФ (data/calendar.json), дата регистрации компании
// (settings.registrationDate, запись слиянием), ниже — кнопка «Калькулятор» и карточки разделов базы.

import { api } from '../api.js';
import { escapeHtml, docHash, folderLabel, groupDocs } from '../app.js';
import { upcoming, SOON_DAYS } from '../calendar.js';
import { saveSettingsPatch } from '../shared.js';

const SHOW = 8;
const FLAGS = { CN: '🇨🇳', RU: '🇷🇺', 'CN-RU': '🇨🇳→🇷🇺' };
const COUNTRY = { CN: 'Китай', RU: 'Россия', 'CN-RU': 'Китай → Россия' };

function dateText(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
function leftText(n) {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  const mod10 = n % 10; const mod100 = n % 100;
  const w = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней';
  return `через ${n} ${w}`;
}

export async function render(el, { docs }) {
  el.innerHTML = '<h1>База знаний по торговле</h1><p class="muted">Загрузка…</p>';
  const [calendar, settingsRaw, team] = await Promise.all([
    api.data('calendar').catch(() => null),
    api.data('settings').catch(() => null),
    api.team().catch(() => null),   // на сайте для коллег /api/team нет (404) — блока нет
  ]);
  let settings = settingsRaw || {};

  /** Локальная главная, пока включён «Доступ для коллег»: ссылка и «Копировать». */
  function teamHtml() {
    if (!team || !team.active || !team.url) return '';
    return `<section class="team-box" aria-label="Доступ для коллег">
      <strong>Доступ для коллег включён:</strong>
      <div class="team-link">
        <input type="text" id="team-url" readonly value="${escapeHtml(team.url)}" aria-label="Ссылка для коллег">
        <button type="button" class="btn" id="team-copy">Копировать</button>
      </div>
      <div class="small muted" id="team-msg">Ссылка меняется при каждом запуске «Доступ для коллег.bat». Коллеги входят по общему паролю.</div>
    </section>`;
  }

  function bindTeam() {
    const btn = el.querySelector('#team-copy');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const input = el.querySelector('#team-url');
      const msg = el.querySelector('#team-msg');
      let ok = false;
      try {
        await navigator.clipboard.writeText(team.url);
        ok = true;
      } catch {
        input.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
      }
      msg.textContent = ok ? 'Ссылка скопирована — вставьте её в сообщение коллегам.' : 'Не получилось скопировать — выделите ссылку и нажмите Ctrl+C.';
    });
  }

  function deadlinesHtml() {
    const events = calendar && Array.isArray(calendar.events) ? calendar.events : null;
    if (!events) return '<p class="error">Не удалось прочитать календарь сроков (data/calendar.json).</p>';
    const list = upcoming(events, new Date(), settings, SHOW);
    return `<ol class="deadlines">${list.map((e) => {
      const flag = `<span class="flag" title="${escapeHtml(COUNTRY[e.country] || e.country)}" aria-label="${escapeHtml(COUNTRY[e.country] || e.country)}">${FLAGS[e.country] || escapeHtml(e.country)}</span>`;
      const body = `<div class="dl-what">${e.important ? '<strong>' : ''}${escapeHtml(e.what)}${e.important ? '</strong>' : ''}</div>
        <div class="small muted">Кто: ${escapeHtml(e.who)}${e.when ? ` · ${escapeHtml(e.when)}` : ''}</div>`;
      if (e.needsRegistrationDate) {
        return `<li class="dl needs"><div class="dl-date"><a href="#reg-date" class="nodata">Впишите дату регистрации компании</a></div>${flag}<div>${body}</div></li>`;
      }
      const n = e.daysLeft;
      return `<li class="dl${e.soon ? ' soon' : ''}"><div class="dl-date"><strong>${escapeHtml(dateText(e.date))}</strong><div class="small${e.soon ? '' : ' muted'}">${leftText(n)}</div></div>${flag}<div>${body}</div></li>`;
    }).join('')}</ol>
    <p class="small muted">Подсвечены сроки в ближайшие ${SOON_DAYS} дней. Полный календарь — в <a href="${docHash('README.md', { a: 'сводный-календарь-на-год-китай--россия' })}">README</a>.</p>`;
  }

  function draw() {
    const reg = settings.registrationDate || '';
    el.innerHTML = `
      <h1>База знаний по торговле</h1>
      ${teamHtml()}
      <section class="calc-box">
        <h2>Ближайшие сроки</h2>
        <div id="deadlines">${deadlinesHtml()}</div>
        <div class="calc-form reg-form">
          <label class="fld" for="reg-date"><span>Дата регистрации компании</span>
            <input type="date" id="reg-date" value="${escapeHtml(reg)}">
            <small class="${reg ? 'muted' : 'nodata'}" id="reg-msg">${reg ? 'от неё считается уведомление об участии (КНД 1120411)' : 'Впишите дату регистрации компании — от неё считается уведомление об участии (КНД 1120411)'}</small></label>
        </div>
      </section>
      <p><a class="btn primary" href="#/calc">Калькулятор юнит-экономики</a> <a class="btn" href="#/products">Мои товары</a></p>
      <h2>Разделы базы</h2>
      <div class="cards">
        ${groupDocs(docs).map(({ folder, docs: list }) => `
          <section class="card">
            <h3>${escapeHtml(folderLabel(folder))}</h3>
            <ul>${list.map((d) => `<li><a href="${docHash(d.path)}">${escapeHtml(d.title)}</a></li>`).join('')}</ul>
          </section>`).join('')}
      </div>`;
    bindTeam();
    el.querySelector('#reg-date').addEventListener('change', async (e) => {
      const v = e.target.value;   // '' — очистили
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const msg = el.querySelector('#reg-msg');
      try {
        settings = await saveSettingsPatch({ registrationDate: v || undefined });
        draw();
        el.querySelector('#reg-msg').textContent = v ? 'Дата сохранена.' : 'Дата убрана.';
      } catch (err) {
        msg.className = 'error';
        msg.textContent = 'Не сохранилось: ' + err.message;
      }
    });
  }

  draw();
}
