// Экран «Калькулятор»: товар → четыре схемы рядом, цена под целевую маржу, курс ЦБ, запас на конвертацию, налог.
// Расчёт — только через calc.js. Настройки (курс, запас, налог) хранятся в data/settings.json.
//
// Для таска 05 (список товаров):
//   getCalcState() → null (ввод неверен / экран не открыт) |
//     {input, priceCurrency, scheme, incomplete:boolean, comparable:boolean, results:{A,B,C,D,best,incomplete,comparable}, settings, tariffsChecked}
//   incomplete:true — scheme выбрана при неизвестных тарифах, это не готовый вывод.
//   setCalcInput(input) — подставить товар при следующем открытии #/calc (или сразу, если экран открыт).
//   editProduct(product) — то же для товара из списка; «Сохранить в список» обновит эту запись (тот же id).

import { api } from '../api.js';
import { escapeHtml } from '../app.js';
import { compareSchemes, priceForMargin, breakeven, defaultLogistics } from '../calc.js';
import { loadTariffs, leafTip, isStale, today } from './tariffs.js';
import { SCHEMES, SCHEME_NAMES, LINE_ORDER, incompleteList, incompleteText, withSettingsDefaults, saveSettingsPatch, parseNum } from '../shared.js';
import { upsertProduct } from './products.js';

let S = null;          // {tariffs, tariffsChecked, settings, el}
let form = {           // значения полей как ввёл пользователь (строки) — переживают уход с экрана
  purchase: '', weight: '', l: '', w: '', h: '', category: '', logistics: '', price: '', noAds: false, target: '30',
};
let priceCurrency = 'CNY';
let lastState = null;
let saveForm = { id: null, name: '', link1688: '', note: '' };   // «Сохранить в список»; id — правим товар из списка

// ---------- публичное для таска 05 ----------

export function getCalcState() {
  return lastState;
}

export function setCalcInput(input) {
  const s = (x) => (x == null || x === '' ? '' : String(x).replace('.', ','));
  form = { ...form, purchase: s(input.purchase), weight: s(input.weight), l: s(input.dims?.l), w: s(input.dims?.w), h: s(input.dims?.h),
    category: input.category || '', logistics: input.logistics || '', price: s(input.price), noAds: !!input.noAds };
  priceCurrency = 'CNY';
  saveForm = { id: null, name: '', link1688: '', note: '' };
  if (S && S.el && S.el.isConnected) draw();
}

export function editProduct(product) {
  setCalcInput(product.input || {});
  saveForm = { id: product.id, name: product.name || '', link1688: product.link1688 || '', note: product.note || '' };
  if (S && S.el && S.el.isConnected) draw();
}

// ---------- форматирование ----------

const fmt = (x) => (Number.isFinite(x) ? x.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const fmtPct = (x) => (Number.isFinite(x) ? (x * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%' : '—');
const rub = (cny) => (S.settings.rate > 0 ? fmt(cny * S.settings.rate) + ' ₽' : '— ₽');

// ---------- загрузка ----------

export async function render(el) {
  el.innerHTML = '<h1>Калькулятор</h1><p class="muted">Загрузка тарифов…</p>';
  const [{ tariffs }, settings] = await Promise.all([loadTariffs(), api.data('settings')]);
  S = { el, tariffs, tariffsChecked: tariffs.edited || tariffs.checked || '', settings: withSettingsDefaults(settings) };
  draw();
  if (!(S.settings.rate > 0)) refreshRate(true);
}

async function saveSettings(patch) {
  Object.assign(S.settings, patch);
  try {
    const saved = await saveSettingsPatch(patch);
    Object.assign(S.settings, withSettingsDefaults(saved), patch); // свежие поля коллег + своё
    return true;
  } catch (e) {
    setRateMsg(`<span class="error">Настройки не сохранились: ${escapeHtml(e.message)}</span>`);
    return false;
  }
}

function setRateMsg(html) {
  const m = S.el.querySelector('#rate-msg');
  if (m) m.innerHTML = html;
}

async function refreshRate(auto = false) {
  setRateMsg('Запрашиваю курс ЦБ…');
  try {
    const r = await api.rate();
    await saveSettings({ rate: r.rate, rateDate: r.date, rateSource: 'cbr', ...(r.eurRate > 0 ? { eurRate: r.eurRate } : {}) });
    S.el.querySelector('#f-rate').value = String(r.rate).replace('.', ',');
    if (r.eurRate > 0) S.el.querySelector('#f-eur').value = String(r.eurRate).replace('.', ',');
    S.el.querySelector('#rate-date').textContent = `ЦБ, ${r.date}`;
    recalc();
    setRateMsg(`Курс ЦБ на ${escapeHtml(r.date)} сохранён.`);
  } catch {
    setRateMsg(S.settings.rate > 0
      ? `<span class="error">Нет связи с ЦБ, используется курс от ${escapeHtml(S.settings.rateDate || 'неизвестной даты')}</span>`
      : `<span class="error">Нет связи с ЦБ и сохранённого курса нет — впишите курс вручную</span>`);
  }
}

// ---------- разметка ----------

function field(id, label, value, extra = '') {
  return `<label class="fld" for="f-${id}"><span>${label}</span>
    <input id="f-${id}" name="${id}" value="${escapeHtml(value)}" inputmode="decimal" autocomplete="off" ${extra}>
    <small class="field-error" id="e-${id}" hidden></small></label>`;
}

function draw() {
  const t = S.tariffs;
  const st = S.settings;
  const cats = t.categories || [];
  if (!cats.some((c) => c.id === form.category)) form.category = cats[0]?.id || '';
  const rateDate = st.rateDate ? `${st.rateSource === 'manual' ? 'вручную' : 'ЦБ'}, ${st.rateDate}` : 'курс не задан';
  S.el.innerHTML = `
    <h1>Калькулятор юнит-экономики</h1>
    <p class="muted">Ozon Global и дропшиппинг из Иу. Все суммы — на 1 заказ, в ¥ и ₽. Тарифы от ${escapeHtml(S.tariffsChecked || '—')} — <a href="#/tariffs">посмотреть и поправить</a>.</p>

    <section class="calc-box">
      <h2>Курс и настройки</h2>
      <div class="calc-form">
        ${field('rate', 'Курс, ₽ за 1 ¥', st.rate > 0 ? String(st.rate).replace('.', ',') : '')}
        ${field('eur', 'Курс, ₽ за 1 € (для беспошлинного лимита)', st.eurRate > 0 ? String(st.eurRate).replace('.', ',') : '')}
        <div class="fld"><span>&nbsp;</span><button type="button" id="rate-btn">Обновить по ЦБ</button><small class="muted" id="rate-date">${escapeHtml(rateDate)}</small></div>
        ${field('reserve', 'Запас на конвертацию, %', String((st.conversionReserve || 0) * 100).replace('.', ','))}
        <label class="fld" for="f-tax"><span>Налоговый режим</span>
          <select id="f-tax">
            <option value="simplified"${st.taxMode === 'simplified' ? ' selected' : ''}>Упрощёнка Иу (4% выручки × 5%)</option>
            <option value="regular"${st.taxMode === 'regular' ? ' selected' : ''}>Обычный (5% от прибыли)</option>
            <option value="custom"${st.taxMode === 'custom' ? ' selected' : ''}>Свой % от выручки</option>
          </select><small class="muted">сверить с бухгалтером</small></label>
        ${field('taxc', 'Свой налог, % от выручки', st.taxCustomRate != null ? String(st.taxCustomRate * 100).replace('.', ',') : '', st.taxMode === 'custom' ? '' : 'disabled')}
      </div>
      <p id="rate-msg" class="small" aria-live="polite"></p>
    </section>

    <section class="calc-box">
      <h2>Товар</h2>
      <div class="calc-form">
        ${field('purchase', 'Закупка, ¥', form.purchase)}
        ${field('weight', 'Вес, г', form.weight)}
        <fieldset class="fld dims"><legend>Габариты, см (по желанию)</legend>
          <input id="f-l" name="l" value="${escapeHtml(form.l)}" inputmode="decimal" placeholder="Д" aria-label="Длина, см">
          <input id="f-w" name="w" value="${escapeHtml(form.w)}" inputmode="decimal" placeholder="Ш" aria-label="Ширина, см">
          <input id="f-h" name="h" value="${escapeHtml(form.h)}" inputmode="decimal" placeholder="В" aria-label="Высота, см">
          <small class="field-error" id="e-dims" hidden></small></fieldset>
        <label class="fld" for="f-category"><span>Категория</span>
          <select id="f-category">${cats.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === form.category ? ' selected' : ''}>${escapeHtml(c.name)}${c.custom ? ' (своя)' : ''}</option>`).join('')}</select></label>
        <label class="fld" for="f-logistics"><span>Тариф логистики</span>
          <select id="f-logistics"><option value="">Авто — самый дешёвый по весу</option>
            ${(t.logistics || []).map((l) => `<option value="${escapeHtml(l.id)}"${l.id === form.logistics ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select>
          <small class="muted" id="logi-auto"></small></label>
        <div class="fld price">
          <label for="f-price"><span>Цена продажи</span></label>
          <div class="price-row">
            <input id="f-price" name="price" value="${escapeHtml(form.price)}" inputmode="decimal" autocomplete="off">
            <span class="seg" role="radiogroup" aria-label="Валюта цены">
              <button type="button" data-cur="CNY" aria-pressed="${priceCurrency === 'CNY'}">¥</button><button type="button" data-cur="RUB" aria-pressed="${priceCurrency === 'RUB'}">₽</button>
            </span>
          </div>
          <small class="muted" id="price-other"></small>
          <small class="field-error" id="e-price" hidden></small></div>
        <label class="fld check"><input type="checkbox" id="f-noads"${form.noAds ? ' checked' : ''}> Без рекламы</label>
      </div>
    </section>

    <section class="calc-box">
      <h2>Сравнение схем</h2>
      <div id="calc-out"></div>
    </section>

    <section class="calc-box">
      <h2>Цена под целевую маржу</h2>
      <div class="calc-form">${field('target', 'Целевая маржа, %', form.target)}</div>
      <div id="target-out"></div>
    </section>

    <section class="calc-box" id="save-box">
      <h2>${saveForm.id ? 'Правка товара из списка' : 'Сохранить в список'}</h2>
      ${saveForm.id ? `<p class="small muted">Сохранение обновит товар «${escapeHtml(saveForm.name)}» в <a href="#/products">«Моих товарах»</a>. <button type="button" id="save-new" class="linkish">Сохранить как новый вместо этого</button></p>` : ''}
      <div class="calc-form">
        <label class="fld" for="f-pname"><span>Название</span>
          <input id="f-pname" value="${escapeHtml(saveForm.name)}" autocomplete="off"><small class="field-error" id="e-pname" hidden></small></label>
        <label class="fld" for="f-plink"><span>Ссылка на 1688</span>
          <input id="f-plink" value="${escapeHtml(saveForm.link1688)}" inputmode="url" autocomplete="off" placeholder="https://detail.1688.com/…"></label>
        <label class="fld wide" for="f-pnote"><span>Заметка</span>
          <textarea id="f-pnote" rows="2">${escapeHtml(saveForm.note)}</textarea></label>
        <div class="fld"><span>&nbsp;</span><button type="button" id="save-btn">${saveForm.id ? 'Сохранить изменения' : 'Сохранить в список'}</button></div>
      </div>
      <p id="save-msg" class="small" aria-live="polite"></p>
    </section>`;
  bind();
  recalc();
}

// ---------- чтение и проверка ввода ----------

function showErr(id, msg) {
  const e = S.el.querySelector('#e-' + id);
  const inputs = id === 'dims' ? ['l', 'w', 'h'] : [id];
  inputs.forEach((x) => {
    const i = S.el.querySelector('#f-' + x);
    if (!i) return;
    i.classList.toggle('invalid', !!msg);
    if (msg) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid');
  });
  if (e) { e.textContent = msg || ''; e.hidden = !msg; }
}

/** Положительное число из поля; ошибки — по-русски у поля. */
function positive(id, { optional = false, allowZero = false, max } = {}) {
  const p = parseNum(S.el.querySelector('#f-' + id)?.value ?? form[id]);
  let msg = '';
  if (p.empty) msg = optional ? '' : 'Заполните поле';
  else if (p.bad) msg = 'Введите число, например 12,5';
  else if (allowZero ? p.n < 0 : p.n <= 0) msg = allowZero ? 'Введите число не меньше 0' : 'Введите число больше 0';
  else if (max != null && p.n >= max) msg = `Введите число меньше ${max}`;
  showErr(id, msg);
  return msg ? { error: msg } : { n: p.empty ? null : p.n };
}

function readInput() {
  let ok = true;
  const req = (id, o) => { const r = positive(id, o); if (r.error) ok = false; return r.n; };
  const purchase = req('purchase');
  const weight = req('weight');
  const dimsRaw = ['l', 'w', 'h'].map((k) => parseNum(form[k]));
  let dims;
  if (dimsRaw.every((d) => d.empty)) showErr('dims', '');
  else if (dimsRaw.some((d) => d.empty || d.bad || !(d.n > 0))) { showErr('dims', 'Введите все три габарита числами больше 0 или оставьте пустыми'); ok = false; }
  else { showErr('dims', ''); dims = { l: dimsRaw[0].n, w: dimsRaw[1].n, h: dimsRaw[2].n }; }
  const priceVal = req('price');
  const rate = S.settings.rate;
  let price = priceVal;
  if (priceVal != null && priceCurrency === 'RUB') {
    if (rate > 0) price = priceVal / rate;
    else { showErr('price', 'Для цены в ₽ нужен курс — обновите по ЦБ или впишите'); ok = false; }
  }
  if (!ok) return null;
  const input = { purchase, weight, category: form.category, logistics: form.logistics, price, noAds: form.noAds };
  if (dims) input.dims = dims;
  return input;
}

// ---------- расчёт ----------

function recalc() {
  // настройки: курс/запас/налог проверяются, но хранятся отдельно (сохранение — по change)
  const rateOk = !positive('rate', { optional: true }).error;
  const eurOk = !positive('eur', { optional: true }).error;
  const resOk = !positive('reserve', { optional: true, allowZero: true, max: 100 }).error;
  const taxcOk = S.settings.taxMode !== 'custom' || !positive('taxc', { allowZero: true, max: 100 }).error;
  const out = S.el.querySelector('#calc-out');
  const tout = S.el.querySelector('#target-out');
  const input = readInput();
  const po = S.el.querySelector('#price-other');
  if (po) {
    const p = parseNum(form.price);
    po.textContent = p.n > 0 && S.settings.rate > 0
      ? (priceCurrency === 'CNY' ? `≈ ${fmt(p.n * S.settings.rate)} ₽` : `≈ ${fmt(p.n / S.settings.rate)} ¥`) : '';
  }
  if (!input || !rateOk || !eurOk || !resOk || !taxcOk) {
    lastState = null;
    out.innerHTML = '<p class="muted">Исправьте подсвеченные поля — тогда появится расчёт.</p>';
    tout.innerHTML = '';
    return;
  }
  const autoEl = S.el.querySelector('#logi-auto');
  if (!input.logistics) {
    const pick = defaultLogistics(input, S.tariffs, S.settings);
    input.logistics = pick ? pick.id : '';
    autoEl.textContent = pick && pick.known ? `сейчас: ${pick.name}` : 'нет данных ни по одному тарифу — впишите на странице «Тарифы»';
  } else autoEl.textContent = '';

  const res = compareSchemes(input, S.tariffs, S.settings);
  lastState = { input: { ...input }, priceCurrency, scheme: res.best, incomplete: res.incomplete.length > 0, comparable: res.comparable, results: res, settings: { ...S.settings }, tariffsChecked: S.tariffsChecked };
  out.innerHTML = resultsHtml(res);
  tout.innerHTML = targetHtml(input);
}

function tipIcon(line) {
  if (!line || (!line.source && !line.checked && !line.note)) return '';
  const stale = isStale(line.checked);
  return ` <span class="src-tip${stale ? ' stale' : ''}" title="${escapeHtml(leafTip(line))}" tabindex="0" aria-label="${escapeHtml(leafTip(line))}">${stale ? '⚠' : 'ⓘ'}</span>`;
}

const incText = (keys) => escapeHtml(incompleteText(keys));

/** Справочная строка о беспошлинном лимите: без курса EUR проверка не выполняется; с курсом — лимит в ¥. */
function dutyFreeRef(warn) {
  const leaf = (S.tariffs.fees || {}).dutyFreeLimit;
  const v = leaf && typeof leaf === 'object' ? leaf.value : leaf;
  if (v == null || warn) return '';
  const cur = { RUB: '₽', CNY: '¥', EUR: '€' }[leaf?.unit] || '€';
  const limit = `${escapeHtml(String(v).replace('.', ','))} ${cur}`;
  if (!(S.settings.eurRate > 0)) return `<p class="muted small">Беспошлинный лимит посылки: ${limit} (проверка не выполняется — нет курса EUR; впишите его в «Курс и настройки»)</p>`;
  const cny = S.settings.rate > 0 && cur === '€' ? ` ≈ ${fmt((v * S.settings.eurRate) / S.settings.rate)} ¥` : '';
  return `<p class="muted small">Беспошлинный лимит посылки: ${limit}${cny} — цена в пределах лимита.</p>`;
}

function resultsHtml(res) {
  const keys = [];
  const labels = {};
  for (const s of SCHEMES) for (const l of res[s].lines) { if (!keys.includes(l.key)) keys.push(l.key); labels[l.key] ??= l.label; }
  keys.sort((a, b) => (LINE_ORDER.indexOf(a) + 1 || 99) - (LINE_ORDER.indexOf(b) + 1 || 99));
  const cell = (s, key) => {
    const l = res[s].lines.find((x) => x.key === key);
    if (!l) return '<td class="num muted">—</td>';
    const miss = res[s].incomplete.includes(key);
    if (miss) return `<td class="num miss"><span class="nodata">нет данных</span>${tipIcon(l)}</td>`;
    const hint = l.hint ? `<div class="small muted">${escapeHtml(l.hint)}</div>` : '';
    return `<td class="num">${fmt(l.cny)} ¥${tipIcon(l)}<div class="rub">${rub(l.cny)}</div>${hint}</td>`;
  };
  const total = (label, f, cls = '') => `<tr class="total ${cls}"><th scope="row">${label}</th>${SCHEMES.map((s) => `<td class="num${s === res.best ? ' best' : ''}">${f(res[s])}</td>`).join('')}</tr>`;
  const money = (x) => `${fmt(x)} ¥<div class="rub">${rub(x)}</div>`;
  const incomplete = [...new Set(SCHEMES.flatMap((s) => res[s].incomplete))];
  const warn = SCHEMES.some((s) => res[s].warnings.includes('dutyFree'));
  return `
    ${incomplete.length ? `<p class="notice incomplete">Расчёт неполный: нет данных по ${escapeHtml(incompleteList(incomplete))}. Впишите цифры на странице <a href="#/tariffs">«Тарифы»</a> — пока они считаются как 0.</p>` : ''}
    ${warn ? '<p class="notice">Цена выше беспошлинного лимита посылки — с покупателя возьмут пошлину: сейчас 15%, с 01.01.2027 после ратификации — 5%, не менее 1 € за кг (по данным ЕЭК). Такой товар продаётся хуже.</p>' : ''}
    ${dutyFreeRef(warn)}
    <div class="table-wrap"><table class="calc-table">
      <thead><tr><th></th>${SCHEMES.map((s) => `<th scope="col" class="${s === res.best ? 'best' : ''}">${escapeHtml(SCHEME_NAMES[s])}${s === res.best ? `<div class="best-mark">лучшая по прибыли</div>${res.incomplete.length ? `<div class="small nodata">${incText(res.incomplete)}${res.comparable ? '' : ' — сравнение условно'}</div>` : ''}` : ''}</th>`).join('')}</tr></thead>
      <tbody>
        ${keys.map((k) => `<tr><th scope="row">${escapeHtml(labels[k])}</th>${SCHEMES.map((s) => cell(s, k).replace('<td class="num', `<td class="num${s === res.best ? ' best' : ''}`)).join('')}</tr>`).join('')}
        ${total('Расходы', (r) => money(r.cost))}
        ${total('Выручка', (r) => money(r.revenue))}
        ${total('Прибыль', (r) => `<strong class="${r.profit < 0 ? 'loss' : ''}">${fmt(r.profit)} ¥</strong><div class="rub">${rub(r.profit)}</div>${r.incomplete.length ? `<div class="small nodata">${incText(r.incomplete)}</div>` : ''}`, 'profit')}
        ${total('Маржа', (r) => fmtPct(r.margin))}
        ${total('ROI', (r) => fmtPct(r.roi))}
      </tbody>
    </table></div>
    <p class="muted small">Маржа — прибыль от цены продажи; ROI — прибыль от вложенного (закупка, доставка по Китаю, агент/склад, логистика). ⓘ — источник и дата цифры, ⚠ — пора перепроверить. Ступень логистики (Extra Small, Budget, Small, Big, Premium) выбирается по цене в ¥ и весу; габариты влияют на ступень и объёмный вес — впишите их, если упаковка крупная.</p>`;
}

function targetHtml(input) {
  const p = parseNum(form.target);
  let target = null;
  let msg = '';
  if (p.empty) msg = '';
  else if (p.bad) msg = 'Введите число, например 30';
  else if (p.n >= 100) msg = 'Маржа должна быть меньше 100%';
  else if (p.n <= -100) msg = 'Введите число больше −100';
  else target = p.n / 100;
  showErr('target', msg);
  const row = (label, f) => `<tr><th scope="row">${label}</th>${SCHEMES.map((s) => `<td class="num">${f(s)}</td>`).join('')}</tr>`;
  const inc = (r) => (r.incomplete && r.incomplete.length ? `<div class="small nodata">${incText(r.incomplete)}</div>` : '');
  const price = (r) => (r.unreachable ? `<span class="error small">${escapeHtml(r.reason)}</span>${inc(r)}` : `${fmt(r.price)} ¥<div class="rub">${rub(r.price)}</div>${inc(r)}`);
  return `<div class="table-wrap"><table class="calc-table">
    <thead><tr><th></th>${SCHEMES.map((s) => `<th scope="col">${escapeHtml(SCHEME_NAMES[s])}</th>`).join('')}</tr></thead>
    <tbody>
      ${target != null ? row(`Цена под маржу ${fmtPct(target)}`, (s) => price(priceForMargin(target, input, s, S.tariffs, S.settings))) : ''}
      ${row('Цена безубыточности', (s) => price(breakeven(input, s, S.tariffs, S.settings)))}
    </tbody></table></div>`;
}

// ---------- события ----------

function bind() {
  const el = S.el;
  const onField = (id, key) => el.querySelector('#f-' + id).addEventListener('input', (e) => { form[key] = e.target.value; recalc(); });
  ['purchase', 'weight', 'l', 'w', 'h', 'price', 'target'].forEach((id) => onField(id, id));
  el.querySelector('#f-category').addEventListener('change', (e) => { form.category = e.target.value; recalc(); });
  el.querySelector('#f-logistics').addEventListener('change', (e) => { form.logistics = e.target.value; recalc(); });
  el.querySelector('#f-noads').addEventListener('change', (e) => { form.noAds = e.target.checked; recalc(); });

  el.querySelectorAll('[data-cur]').forEach((b) => b.addEventListener('click', () => {
    const cur = b.dataset.cur;
    if (cur === priceCurrency) return;
    const p = parseNum(form.price);
    const rate = S.settings.rate;
    if (p.n > 0) {
      if (!(rate > 0)) { showErr('price', 'Чтобы переключить валюту, нужен курс'); return; }
      const v = cur === 'RUB' ? p.n * rate : p.n / rate;
      form.price = String(Math.round(v * 100) / 100).replace('.', ',');
      el.querySelector('#f-price').value = form.price;
    }
    priceCurrency = cur;
    el.querySelectorAll('[data-cur]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cur === cur)));
    recalc();
  }));

  // настройки: пересчёт на лету, сохранение по change
  const rateIn = el.querySelector('#f-rate');
  rateIn.addEventListener('input', () => {
    const p = parseNum(rateIn.value);
    form.rate = rateIn.value;
    if (p.n > 0) S.settings.rate = p.n;
    recalc();
  });
  rateIn.addEventListener('change', async () => {
    const p = parseNum(rateIn.value);
    if (!(p.n > 0)) return;
    if (await saveSettings({ rate: p.n, rateDate: today(), rateSource: 'manual' })) {
      el.querySelector('#rate-date').textContent = `вручную, ${today()}`;
      setRateMsg('Курс сохранён.');
    }
  });
  el.querySelector('#rate-btn').addEventListener('click', () => refreshRate());

  const eurIn = el.querySelector('#f-eur');
  eurIn.addEventListener('input', () => {
    const p = parseNum(eurIn.value);
    if (p.n > 0) S.settings.eurRate = p.n; else if (p.empty) delete S.settings.eurRate;
    recalc();
  });
  eurIn.addEventListener('change', async () => {
    const p = parseNum(eurIn.value);
    if (p.empty) { if (await saveSettings({ eurRate: undefined })) setRateMsg('Курс евро убран — беспошлинный лимит не проверяется.'); return; }
    if (!(p.n > 0)) return;
    if (await saveSettings({ eurRate: p.n })) setRateMsg('Курс евро сохранён.');
  });

  const resIn = el.querySelector('#f-reserve');
  resIn.addEventListener('input', () => { form.reserve = resIn.value; const p = parseNum(resIn.value); if (p.n >= 0 && p.n < 100) S.settings.conversionReserve = p.n / 100; else if (p.empty) S.settings.conversionReserve = 0; recalc(); });
  resIn.addEventListener('change', () => { if (!positive('reserve', { optional: true, allowZero: true, max: 100 }).error) saveSettings({ conversionReserve: S.settings.conversionReserve }); });

  const taxSel = el.querySelector('#f-tax');
  const taxc = el.querySelector('#f-taxc');
  taxSel.addEventListener('change', () => {
    taxc.disabled = taxSel.value !== 'custom';
    S.settings.taxMode = taxSel.value;
    saveSettings({ taxMode: taxSel.value });
    recalc();
  });
  taxc.addEventListener('input', () => { form.taxc = taxc.value; const p = parseNum(taxc.value); S.settings.taxCustomRate = p.n >= 0 && p.n < 100 ? p.n / 100 : null; recalc(); });
  taxc.addEventListener('change', () => { if (S.settings.taxCustomRate != null) saveSettings({ taxCustomRate: S.settings.taxCustomRate }); });

  el.querySelector('#f-pname').addEventListener('input', (e) => { saveForm.name = e.target.value; });
  el.querySelector('#f-plink').addEventListener('input', (e) => { saveForm.link1688 = e.target.value; });
  el.querySelector('#f-pnote').addEventListener('input', (e) => { saveForm.note = e.target.value; });
  el.querySelector('#save-btn').addEventListener('click', saveProduct);
  el.querySelector('#save-new')?.addEventListener('click', () => { saveForm.id = null; draw(); });
}

async function saveProduct() {
  const msg = (html) => { const m = S.el.querySelector('#save-msg'); if (m) m.innerHTML = html; };
  const name = saveForm.name.trim();
  const nameErr = S.el.querySelector('#e-pname');
  S.el.querySelector('#f-pname').classList.toggle('invalid', !name);
  nameErr.textContent = name ? '' : 'Впишите название';
  nameErr.hidden = !!name;
  if (!name) return;
  const st = getCalcState();
  if (!st) { msg('<span class="error">Сначала заполните товар без ошибок — сохраняется посчитанный товар.</span>'); return; }
  try {
    let updating = false;
    // Операция над свежим списком: чужие товары, добавленные или удалённые в это время, не затираются.
    await api.update('products', (list) => {
      const product = { name, link1688: saveForm.link1688.trim(), note: saveForm.note.trim(), input: st.input, scheme: st.scheme };
      updating = !!(saveForm.id && (list || []).some((p) => p.id === saveForm.id));
      if (updating) product.id = saveForm.id;
      return upsertProduct(list, product);
    });
    saveForm = { id: null, name: '', link1688: '', note: '' };
    draw();
    S.el.querySelector('#save-msg').innerHTML = `${updating ? 'Товар обновлён' : 'Сохранено'} — <a href="#/products">открыть «Мои товары»</a>.${st.incomplete ? ' <span class="nodata">Расчёт неполный: в списке он будет помечен.</span>' : ''}`;
  } catch (e) {
    msg(`<span class="error">Не сохранилось: ${escapeHtml(e.message)}</span>`);
  }
}
