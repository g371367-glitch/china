// Экран «Тарифы»: все цифры калькулятора из data/tariffs.default.json с наложенными правками из data/tariffs.json.
// Правка пишет в tariffs.json только изменённый лист (массивы — по id) и поле edited; «вернуть исходную» удаляет правку.
// Запись — операцией над свежим tariffs.json (api.update), чтобы не затереть правки коллег.
// Хелперы loadTariffs / isStale / sourceHtml / leafTip экспортируются для экрана калькулятора.

import { api } from '../api.js';
import { escapeHtml, docHash } from '../app.js';
import { mergeTariffs } from '../calc.js';
import { SCHEME_NAMES, parseNum, setTariffLeaf, resetTariffLeaf, addTariffCategory, removeTariffCategory } from '../shared.js';

export const STALE_DAYS = 90;
export { SCHEME_NAMES };

const SHARE_KEYS = new Set(['rfbs', 'fbp', 'acquiring', 'serviceFee', 'adsPerOrder', 'returnsReserve', 'batchDiscount', 'base', 'rate']);
const LEAF_NAMES = {
  rfbs: 'Комиссия rFBS', fbp: 'Комиссия FBP',
  fixed: 'Фикс за отправление', perGram: 'Ставка за грамм',
  acquiring: 'Эквайринг и конвертация', adsPerOrder: 'Реклама «оплата за заказ»', adsMinRub: 'Реклама — минимум за заказ',
  returnsReserve: 'Резерв на возвраты/брак', volumetricDivisor: 'Делитель объёмного веса', dutyFreeLimit: 'Беспошлинный лимит посылки',
  cnDelivery: 'Доставка по Китаю', agentFee: 'Работа агента', supplierPackFee: 'Упаковка поставщиком',
  batchDiscount: 'Скидка за партию к закупке', inboundPerUnit: 'Доставка партии, на единицу', storagePerUnit: 'Хранение, на единицу',
  fbpHandling: 'Сборка/хранение FBP',
  serviceFee: 'Электронный сбор Ozon, доля от цены', serviceFeeMinRub: 'Электронный сбор — минимум за отправление', serviceFeeMaxRub: 'Электронный сбор — максимум за отправление',
};
const DEFAULT_UNIT = { adsMinRub: 'RUB', serviceFeeMinRub: 'RUB', serviceFeeMaxRub: 'RUB', volumetricDivisor: 'cm3/kg', dutyFreeLimit: 'EUR' };
const UNIT_SIGN = { CNY: '¥', RUB: '₽', EUR: '€', g: 'г', 'cm3/kg': 'см³/кг' };

export const today = () => new Date().toISOString().slice(0, 10);

/** Загружает исходные тарифы и правки. → {defaults, overrides, tariffs} */
export async function loadTariffs() {
  const [defaults, overrides] = await Promise.all([api.data('tariffs.default'), api.data('tariffs')]);
  return { defaults: defaults || {}, overrides: overrides || {}, tariffs: mergeTariffs(defaults || {}, overrides || {}) };
}

/** Проверено больше 90 дней назад (или дата непонятна — не помечаем). */
export function isStale(checked, now = new Date()) {
  const t = Date.parse(checked);
  if (!checked || Number.isNaN(t)) return false;
  return (now - t) / 86400000 > STALE_DAYS;
}

/** Источник как ссылка: url → внешняя, путь к .md → заметка на сайте. */
export function sourceHtml(src) {
  if (!src) return '<span class="muted">—</span>';
  const s = String(src);
  if (/^https?:\/\//.test(s)) return `<a href="${escapeHtml(s)}" target="_blank" rel="noopener">${escapeHtml(s.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a>`;
  if (/\.md$/i.test(s)) return `<a href="${docHash(s)}">${escapeHtml(s.split('/').pop())}</a>`;
  return escapeHtml(s);
}

/** Текст подсказки «откуда цифра» для строки разбивки. */
export function leafTip(o) {
  const parts = [];
  parts.push('Источник: ' + (o.source || 'нет'));
  parts.push('Проверено: ' + (o.checked || 'нет даты') + (isStale(o.checked) ? ' — пора перепроверить' : ''));
  if (o.own) parts.push('Моя правка');
  if (o.note) parts.push(o.note);
  return parts.join('\n');
}

const pct = (x) => (Math.round(x * 10000) / 100).toString().replace('.', ',') + '%';
const num = (x) => String(x).replace('.', ',');

function unitOf(key, leaf) {
  if (SHARE_KEYS.has(key)) return 'share';
  return (leaf && leaf.unit) || DEFAULT_UNIT[key] || 'CNY';
}

function formatValue(key, leaf) {
  const unit = unitOf(key, leaf);
  const f = (v) => (unit === 'share' ? pct(v) : `${num(v)} ${UNIT_SIGN[unit] || unit}`);
  if (Array.isArray(leaf?.bands) && leaf.bands.length) {
    const cur = UNIT_SIGN[leaf.unit] || '¥';
    return leaf.bands.map((b) => `${b.maxPrice == null ? 'выше' : 'до ' + num(b.maxPrice) + ' ' + cur}: ${b.value == null ? '?' : pct(b.value)}`).join('; ');
  }
  if (leaf?.value == null) return null;
  return f(leaf.value);
}

// ---------- экран ----------

let state = null; // {defaults, overrides, tariffs}

export async function render(el) {
  el.innerHTML = '<h1>Тарифы</h1><p class="muted">Загрузка…</p>';
  state = await loadTariffs();
  draw(el);
}

function rowsFor(t) {
  const groups = [];
  groups.push({ title: 'Комиссии Ozon по категориям', rows: (t.categories || []).flatMap((c) => ['rfbs', 'fbp'].map((k) => ({
    name: `${escapeHtml(c.name)}${c.custom ? ' <span class="badge">своя</span>' : ''}`, sub: LEAF_NAMES[k], key: k, leaf: c[k], path: ['categories', { id: c.id }, k], custom: c.custom, catId: c.id,
  }))) });
  groups.push({ title: 'Международная логистика', rows: (t.logistics || []).flatMap((l) => {
    const byTiers = (k) => (l.tiered && l[k]?.value == null ? 'по ступеням (строка ниже)' : undefined);
    const rows = ['fixed', 'perGram'].map((k) => ({ name: escapeHtml(l.name), sub: LEAF_NAMES[k] + (l.days ? `, срок ${escapeHtml(l.days)} дн.` : ''), key: k, leaf: l[k], text: byTiers(k), path: ['logistics', { id: l.id }, k] }));
    if (Array.isArray(l.bands) && l.bands.length) {
      const cur = UNIT_SIGN[l.unit || l.fixed?.unit] || '¥';
      const fee = (b) => (b.fixed == null || b.perGram == null ? 'не предлагается / нет данных' : `${num(b.fixed)} ${cur} + ${num(b.perGram)} ${cur}/г`);
      const size = (b) => (b.maxSide != null ? `, сторона ≤ ${b.maxSide} см` : '') + (b.maxSum != null ? `, сумма сторон ≤ ${b.maxSum} см` : '');
      const text = l.tiered
        ? l.bands.map((b) => `${b.tier || '?'} (цена ≤ ${b.maxPrice ?? '∞'} ${cur}, вес ≤ ${b.maxWeight ?? '∞'} г${size(b)}${b.volumetric ? ', объёмный вес' : ''}): ${fee(b)}`).join('; ')
        : l.bands.map((b) => `вес ≤ ${b.maxWeight ?? '∞'} г, цена ≤ ${b.maxPrice ?? '∞'}: ${fee(b)}`).join('; ');
      rows.push({ name: escapeHtml(l.name), sub: 'Ступени — считаются они, пока вы не впишете свой фикс или ставку выше', key: 'bands', readonly: true,
        leaf: { source: l.source, checked: l.checked, note: l.note }, text });
    }
    return rows;
  }) });
  groups.push({ title: 'Сборы и реклама', rows: Object.entries(t.fees || {}).map(([k, leaf]) => ({ name: escapeHtml(LEAF_NAMES[k] || k), key: k, leaf, path: ['fees', k] })) });
  groups.push({ title: 'Параметры схем', rows: Object.entries(t.schemes || {}).flatMap(([s, params]) => Object.entries(params).map(([k, leaf]) => ({
    name: escapeHtml(SCHEME_NAMES[s] || s), sub: LEAF_NAMES[k] || k, key: k, leaf, path: ['schemes', s, k] }))) });
  const tax = t.tax || {};
  groups.push({ title: 'Налог (сверить с бухгалтером)', rows: [
    { name: 'Упрощёнка Иу', sub: 'Облагаемая база, доля выручки', key: 'base', leaf: tax.simplified?.base, path: ['tax', 'simplified', 'base'] },
    { name: 'Упрощёнка Иу', sub: 'Ставка', key: 'rate', leaf: tax.simplified?.rate, path: ['tax', 'simplified', 'rate'] },
    { name: 'Обычный режим', sub: 'Ставка от прибыли', key: 'rate', leaf: tax.regular?.rate, path: ['tax', 'regular', 'rate'] },
  ].filter((r) => r.leaf !== undefined) });
  return groups;
}

function rowHtml(r, i) {
  const leaf = r.leaf && typeof r.leaf === 'object' ? r.leaf : { value: r.leaf };
  const shown = r.text ?? formatValue(r.key, leaf);
  const value = shown == null
    ? `<span class="nodata">нет данных — впишите из кабинета</span>`
    : escapeHtml(shown);
  const origin = leaf.own ? `<span class="badge own">моя, ${escapeHtml(leaf.checked || state.overrides.edited || '')}</span>` : '<span class="badge">исходная</span>';
  const stale = isStale(leaf.checked) ? ' <span class="badge stale">пора перепроверить</span>' : '';
  const actions = r.readonly ? '' : `
    <button type="button" data-edit="${i}">Изменить</button>
    ${r.custom ? `<button type="button" data-delcat="${escapeHtml(r.catId)}">Удалить категорию</button>`
      : leaf.own ? `<button type="button" data-reset="${i}">Вернуть исходную</button>` : ''}`;
  return `<tr data-row="${i}">
    <td>${r.name}${r.sub ? `<div class="muted small">${escapeHtml(r.sub)}</div>` : ''}</td>
    <td class="tv">${value}${leaf.note ? `<div class="muted small">${escapeHtml(leaf.note)}</div>` : ''}</td>
    <td>${sourceHtml(leaf.source)}<div class="muted small">${escapeHtml(leaf.checked || 'дата не указана')}</div></td>
    <td>${origin}${stale}</td>
    <td class="actions">${actions}</td>
  </tr>`;
}

let flatRows = [];

function draw(el, message = '') {
  const groups = rowsFor(state.tariffs);
  flatRows = groups.flatMap((g) => g.rows);
  let i = 0;
  el.innerHTML = `
    <h1>Тарифы</h1>
    <p class="muted">Все цифры калькулятора. Исходные — из исследования (data/tariffs.default.json, проверено ${escapeHtml(state.defaults.checked || '—')}); ваши правки хранятся отдельно в data/tariffs.json${state.overrides.edited ? `, последняя ${escapeHtml(state.overrides.edited)}` : ''}. Цифры старше ${STALE_DAYS} дней помечены «пора перепроверить».</p>
    ${message ? `<p class="notice">${message}</p>` : ''}
    ${groups.map((g) => `
      <h2>${escapeHtml(g.title)}</h2>
      <div class="table-wrap"><table class="tariffs">
        <thead><tr><th>Что</th><th>Значение</th><th>Источник, дата</th><th>Чья</th><th></th></tr></thead>
        <tbody>${g.rows.map((r) => rowHtml(r, i++)).join('') || '<tr><td colspan="5" class="muted">нет строк</td></tr>'}</tbody>
      </table></div>`).join('')}
    <h2>Своя категория</h2>
    <form class="calc-form addcat" novalidate>
      <label>Название <input name="name" required></label>
      <label>Комиссия rFBS, % <input name="rfbs" inputmode="decimal"></label>
      <label>Комиссия FBP, % <input name="fbp" inputmode="decimal" placeholder="если не знаете — пусто"></label>
      <button type="submit">Добавить категорию</button>
      <p class="field-error" hidden></p>
    </form>`;
  bind(el);
}

function parsePercentOrNumber(raw, isShare) {
  const p = parseNum(raw);
  if (p.empty) return { value: null };
  const n = p.n;
  if (p.bad || n < 0) return { error: 'Введите число не меньше 0 или оставьте пусто' };
  if (isShare && n >= 100) return { error: 'Процент должен быть меньше 100' };
  return { value: isShare ? n / 100 : n };
}

/**
 * op(свежие правки, дата) → новые правки; пишется через api.update поверх чужих изменений.
 * Ошибка: errEl задан — текст в нём, введённое в форме остаётся; иначе — сообщение над таблицей.
 */
async function save(el, message, op, errEl = null) {
  try {
    state.overrides = (await api.update('tariffs', (cur) => op(cur || {}, today()))) || {};
  } catch (e) {
    const text = `Не сохранилось: ${e.message}`;
    if (errEl) { errEl.textContent = text; errEl.hidden = false; return; }
    draw(el, `<span class="error">${escapeHtml(text)}</span>`);
    return;
  }
  state.tariffs = mergeTariffs(state.defaults, state.overrides);
  draw(el, message);
}

function bind(el) {
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const r = flatRows[+b.dataset.edit];
    const leaf = r.leaf && typeof r.leaf === 'object' ? r.leaf : {};
    const unit = unitOf(r.key, leaf);
    const isShare = unit === 'share';
    const cur = leaf.value == null ? '' : num(isShare ? Math.round(leaf.value * 1e6) / 1e4 : leaf.value);
    const td = el.querySelector(`tr[data-row="${b.dataset.edit}"] .tv`);
    td.innerHTML = `<form class="inline-edit" novalidate>
      <input name="v" value="${escapeHtml(cur)}" inputmode="decimal" aria-label="Новое значение" size="8"> ${isShare ? '%' : escapeHtml(UNIT_SIGN[unit] || unit)}
      <button type="submit">Сохранить</button> <button type="button" data-cancel>Отмена</button>
      ${leaf.bands ? '<div class="muted small">Одно число заменит ступени по цене.</div>' : ''}
      <div class="field-error" hidden></div></form>`;
    const f = td.querySelector('form');
    f.v.focus();
    f.querySelector('[data-cancel]').addEventListener('click', () => draw(el));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = parsePercentOrNumber(f.v.value, isShare);
      if (p.error) { f.v.classList.add('invalid'); const er = f.querySelector('.field-error'); er.textContent = p.error; er.hidden = false; return; }
      const newLeaf = { value: p.value, source: 'моя правка (из кабинета)', checked: today() };
      if (!isShare && leaf.unit) newLeaf.unit = leaf.unit;
      if (isShare && leaf.unit && leaf.bands) newLeaf.unit = leaf.unit;
      save(el, 'Сохранено.', (cur, d) => setTariffLeaf(cur, r.path, newLeaf, d), f.querySelector('.field-error'));
    });
  }));
  el.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => {
    const path = flatRows[+b.dataset.reset].path;
    save(el, 'Вернули исходную цифру.', (cur, d) => resetTariffLeaf(cur, path, d));
  }));
  el.querySelectorAll('[data-delcat]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Удалить свою категорию?')) return;
    const id = b.dataset.delcat;
    save(el, 'Категория удалена.', (cur, d) => removeTariffCategory(cur, id, d));
  }));
  const form = el.querySelector('.addcat');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const er = form.querySelector('.field-error');
    const name = form.name.value.trim();
    const rf = parsePercentOrNumber(form.rfbs.value, true);
    const fb = parsePercentOrNumber(form.fbp.value, true);
    form.querySelectorAll('input').forEach((i) => i.classList.remove('invalid'));
    const bad = !name ? [form.name, 'Введите название'] : rf.error ? [form.rfbs, rf.error] : fb.error ? [form.fbp, fb.error] : null;
    if (bad) { bad[0].classList.add('invalid'); er.textContent = bad[1]; er.hidden = false; return; }
    const leaf = (v) => (v == null ? { value: null, source: null, checked: null, note: 'нет данных — впишите из кабинета' } : { value: v, source: 'моя правка (из кабинета)', checked: today() });
    er.hidden = true;
    const cat = { id: 'my-' + Date.now().toString(36), name, custom: true, rfbs: leaf(rf.value), fbp: leaf(fb.value) };
    save(el, `Категория «${escapeHtml(name)}» добавлена — она есть в калькуляторе.`, (cur, d) => addTariffCategory(cur, cat, d), er);
  });
}
