// Экран «Мои товары»: сохранённые из калькулятора товары, пересчёт по текущим тарифам и курсу.
// data/products.json — массив {id, name, link1688, note, input, scheme, createdAt, updatedAt};
// input — как у calc.computeUnit (цена в ¥), scheme — лучшая схема на момент сохранения.
// Выбранная на экране схема хранится в settings.defaultScheme (запись слиянием).
// Удаление — операцией над свежим products.json (api.update): добавленное коллегой в это время не пропадёт.
//
// Чистые функции (без DOM, тестируются в app/tests/products.test.mjs):
//   upsertProduct(list, product, nowIso) → новый список (тот же id — обновление на месте, иначе добавление)
//   deleteProduct(list, id) → новый список без записи id
//   computeRow(product, scheme, tariffs, settings) → {…product, scheme, price, cost, profit, margin, roi, incomplete}
//     (логистика не выбрана → calc.defaultLogistics, как «Авто» в калькуляторе)
//   toCsv(rows, {rate}) → строка CSV для русского Excel (BOM, «;», десятичная запятая, CRLF)
// Модули с DOM (app.js, экраны) подгружаются только внутри render — чтобы файл импортировался в node.

import { computeUnit, defaultLogistics } from '../calc.js';
import { SCHEMES, SCHEME_NAMES, incompleteText, incompleteList, withSettingsDefaults, saveSettingsPatch } from '../shared.js';

export { incompleteText };

// ---------- чистые функции ----------

function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function upsertProduct(list, product, nowIso = new Date().toISOString()) {
  const items = Array.isArray(list) ? list : [];
  const i = product.id ? items.findIndex((p) => p.id === product.id) : -1;
  if (i >= 0) {
    const out = items.slice();
    out[i] = { ...items[i], ...product, id: items[i].id, createdAt: items[i].createdAt, updatedAt: nowIso };
    return out;
  }
  return [...items, { ...product, id: newId(), createdAt: nowIso, updatedAt: nowIso }];
}

export function deleteProduct(list, id) {
  return (Array.isArray(list) ? list : []).filter((p) => p.id !== id);
}

export function computeRow(product, scheme, tariffs, settings) {
  const input = { ...(product.input || {}) };
  if (!input.logistics) input.logistics = defaultLogistics(input, tariffs, settings)?.id || '';
  const r = computeUnit(input, scheme, tariffs, settings);
  return { ...product, scheme, price: r.revenue, cost: r.cost, profit: r.profit, margin: r.margin, roi: r.roi, incomplete: r.incomplete || [] };
}

const num = (x, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits).replace('.', ',') : '');

function csvCell(v) {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows, { rate } = {}) {
  const r = rate > 0 ? rate : null;
  const rub = (x) => (r ? num(x * r) : '');
  const head = ['Название', 'Ссылка на 1688', 'Заметка', 'Схема', 'Цена, ¥', 'Цена, ₽', 'Расходы, ¥', 'Прибыль, ¥', 'Прибыль, ₽', 'Маржа, %', 'ROI, %', 'Расчёт', 'Обновлено'];
  const lines = rows.map((p) => [
    p.name, p.link1688, p.note, p.scheme,
    num(p.price), rub(p.price), num(p.cost), num(p.profit), rub(p.profit),
    num(p.margin * 100, 1), num(p.roi * 100, 1),
    p.incomplete && p.incomplete.length ? incompleteText(p.incomplete) : 'полный',
    String(p.updatedAt || '').slice(0, 10),
  ].map(csvCell).join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}

// ---------- экран ----------

let sortKey = 'updatedAt';
let sortDir = -1;

export async function render(el, ctx) {
  const [{ api }, { escapeHtml }, { loadTariffs }, calcView] = await Promise.all([
    import('../api.js'), import('../app.js'), import('./tariffs.js'), import('./calc.js'),
  ]);
  el.innerHTML = '<h1>Мои товары</h1><p class="muted">Загрузка…</p>';
  const [{ tariffs }, settingsRaw, productsRaw] = await Promise.all([loadTariffs(), api.data('settings'), api.data('products')]);
  const settings = withSettingsDefaults(settingsRaw);
  let products = Array.isArray(productsRaw) ? productsRaw : [];
  let scheme = SCHEMES.includes(settings.defaultScheme) ? settings.defaultScheme : 'A';

  const fmt = (x) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const pct = (x) => (Number.isFinite(x) ? (x * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%' : '—');
  const rub = (x) => (settings.rate > 0 && Number.isFinite(x) ? fmt(x * settings.rate) + ' ₽' : '— ₽');
  const tariffsDate = tariffs.edited || tariffs.checked || '—';
  const rateText = settings.rate > 0
    ? `${String(settings.rate).replace('.', ',')} ₽/¥ (${settings.rateSource === 'manual' ? 'вручную' : 'ЦБ'}${settings.rateDate ? ', ' + settings.rateDate : ''})`
    : 'не задан — задайте в калькуляторе';

  const rows = () => {
    const list = products.map((p) => computeRow(p, scheme, tariffs, settings));
    const val = (p) => (sortKey === 'name' ? String(p.name || '').toLowerCase() : sortKey === 'updatedAt' ? String(p.updatedAt || '') : p[sortKey]);
    return list.sort((a, b) => {
      const x = val(a); const y = val(b);
      if (typeof x === 'string') return x.localeCompare(y, 'ru') * sortDir;
      return ((Number.isFinite(x) ? x : -Infinity) - (Number.isFinite(y) ? y : -Infinity)) * sortDir;
    });
  };

  async function saveScheme(s) {
    try {
      Object.assign(settings, withSettingsDefaults(await saveSettingsPatch({ defaultScheme: s })), { defaultScheme: scheme });
    } catch { /* выбор схемы не критичен */ }
  }

  function draw() {
    if (!products.length) {
      el.innerHTML = `<h1>Мои товары</h1>
        <p class="notice">Пока нет сохранённых товаров — посчитайте товар в калькуляторе и нажмите «Сохранить в список».</p>
        <p><a class="btn" href="#/calc">Открыть калькулятор</a></p>`;
      return;
    }
    const list = rows();
    const anyInc = [...new Set(list.flatMap((p) => p.incomplete))];
    const sortBtn = (key, label) => {
      const on = sortKey === key;
      return `<button type="button" class="sort" data-sort="${key}" aria-label="Сортировать: ${label}">${label}${on ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</button>`;
    };
    const inc = (p) => (p.incomplete.length ? `<div class="small nodata" title="${escapeHtml(incompleteText(p.incomplete))}">неполный</div>` : '');
    el.innerHTML = `
      <h1>Мои товары</h1>
      <p class="muted">Посчитано по тарифам от ${escapeHtml(tariffsDate)}, курс ${escapeHtml(rateText)}.</p>
      <div class="products-bar">
        <span class="seg" role="radiogroup" aria-label="Схема">
          ${SCHEMES.map((s) => `<button type="button" data-scheme="${s}" aria-pressed="${s === scheme}" title="${escapeHtml(SCHEME_NAMES[s])}">${s}</button>`).join('')}
        </span>
        <span class="small muted">${escapeHtml(SCHEME_NAMES[scheme])}</span>
        <button type="button" id="csv-btn">Выгрузить в CSV (Excel)</button>
      </div>
      ${anyInc.length ? `<p class="notice incomplete">Расчёт неполный: нет данных по ${escapeHtml(incompleteList(anyInc))} — такие цифры помечены «неполный» и считают недостающее как 0. Впишите цифры на странице <a href="#/tariffs">«Тарифы»</a>.</p>` : ''}
      <div class="table-wrap"><table class="calc-table products-table">
        <thead><tr>
          <th scope="col">${sortBtn('name', 'Название')}</th>
          <th scope="col">Цена</th>
          <th scope="col">Расходы</th>
          <th scope="col">${sortBtn('profit', 'Прибыль')}</th>
          <th scope="col">${sortBtn('margin', 'Маржа')}</th>
          <th scope="col">ROI</th>
          <th scope="col"></th>
        </tr></thead>
        <tbody>
          ${list.map((p) => `<tr>
            <th scope="row" class="pname"><strong>${escapeHtml(p.name || 'без названия')}</strong>
              ${p.link1688 && /^https?:\/\//i.test(p.link1688) ? `<div class="small"><a href="${escapeHtml(p.link1688)}" target="_blank" rel="noopener noreferrer">ссылка на 1688</a></div>` : p.link1688 ? `<div class="small muted">${escapeHtml(p.link1688)}</div>` : ''}
              ${p.note ? `<div class="small muted">${escapeHtml(p.note)}</div>` : ''}</th>
            <td class="num">${fmt(p.price)} ¥<div class="rub">${rub(p.price)}</div></td>
            <td class="num">${fmt(p.cost)} ¥<div class="rub">${rub(p.cost)}</div>${inc(p)}</td>
            <td class="num"><strong class="${p.profit < 0 ? 'loss' : ''}">${fmt(p.profit)} ¥</strong><div class="rub">${rub(p.profit)}</div>${inc(p)}</td>
            <td class="num">${pct(p.margin)}${inc(p)}</td>
            <td class="num">${pct(p.roi)}${inc(p)}</td>
            <td class="actions">
              <button type="button" data-edit="${escapeHtml(p.id)}">Открыть в калькуляторе</button>
              <button type="button" data-del="${escapeHtml(p.id)}">Удалить</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p id="products-msg" class="small" aria-live="polite"></p>`;
    bind(list);
  }

  function bind(list) {
    el.querySelectorAll('[data-scheme]').forEach((b) => b.addEventListener('click', () => {
      scheme = b.dataset.scheme;
      saveScheme(scheme);
      draw();
    }));
    el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
      draw();
    }));
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const p = products.find((x) => x.id === b.dataset.edit);
      if (!p) return;
      calcView.editProduct(p);
      ctx.navigate('#/calc');
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = products.find((x) => x.id === b.dataset.del);
      if (!p || !window.confirm(`Удалить товар «${p.name || 'без названия'}» из списка?`)) return;
      try {
        products = await api.update('products', (cur) => deleteProduct(cur, p.id));
        draw();
      } catch (e) {
        el.querySelector('#products-msg').innerHTML = `<span class="error">Не удалилось: ${escapeHtml(e.message)}</span>`;
      }
    }));
    el.querySelector('#csv-btn').addEventListener('click', () => {
      const blob = new Blob([toCsv(list, { rate: settings.rate })], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `товары-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  draw();
}
