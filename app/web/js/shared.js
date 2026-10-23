// Общее для экранов и движка — в одном месте. Без DOM: импортируется и в браузере, и в `node --test`.
//   SCHEMES, SCHEME_NAMES                — перечень схем A–D и их названия;
//   LINE_LABELS, LINE_ORDER              — названия и порядок строк расчёта (calc.computeUnit);
//   INCOMPLETE_NAMES, incompleteText(keys) — «нет данных по …» для ключей incomplete;
//   SETTINGS_DEFAULTS, withSettingsDefaults(raw), applySettingsPatch(cur, patch), saveSettingsPatch(patch) — settings.json (запись слиянием);
//   setTariffLeaf / resetTariffLeaf / addTariffCategory / removeTariffCategory — правки tariffs.json операцией над свежими данными;
//   parseNum(raw)                        — число из поля ввода: запятая, пробелы → {n} | {empty} | {bad}.
// Выбор логистики по умолчанию — calc.defaultLogistics (ему нужен расчёт).

import { api } from './api.js';

export const SCHEMES = ['A', 'B', 'C', 'D'];

export const SCHEME_NAMES = {
  A: 'A — агент в Иу (rFBS)',
  B: 'B — поставщик сам (rFBS)',
  C: 'C — мини-запас у агента (rFBS)',
  D: 'D — FBP',
};

export const LINE_LABELS = {
  purchase: 'Закупка',
  cnDelivery: 'Доставка по Китаю',
  agentFee: 'Работа агента',
  supplierPackFee: 'Упаковка поставщиком',
  inbound: 'Доставка партии, на единицу',
  storage: 'Хранение, на единицу',
  fbpHandling: 'Сборка/хранение FBP',
  logistics: 'Международная логистика',
  commission: 'Комиссия Ozon',
  serviceFee: 'Электронный сбор Ozon',
  ads: 'Реклама «оплата за заказ»',
  acquiring: 'Эквайринг и конвертация',
  returns: 'Резерв на возвраты/брак',
  tax: 'Налог',
};

export const LINE_ORDER = Object.keys(LINE_LABELS);

export const INCOMPLETE_NAMES = {
  commission: 'комиссии категории', logistics: 'логистике', ads: 'рекламе', acquiring: 'эквайрингу', returns: 'возвратам',
  tax: 'налогу', rate: 'курсу ₽/¥', eurRate: 'курсу евро', cnDelivery: 'доставке по Китаю', agentFee: 'работе агента',
  supplierPackFee: 'упаковке поставщиком', inbound: 'доставке партии', storage: 'хранению', fbpHandling: 'сборке FBP', batchDiscount: 'скидке за партию',
  serviceFee: 'электронному сбору Ozon',
};

/** «нет данных по курсу евро, логистике» — без «неполный:». Текст, не HTML. */
export const incompleteList = (keys) => keys.map((k) => INCOMPLETE_NAMES[k] || k).join(', ');
/** «неполный: нет данных по …». Текст, не HTML. */
export const incompleteText = (keys) => 'неполный: нет данных по ' + incompleteList(keys);

export const SETTINGS_DEFAULTS = Object.freeze({ conversionReserve: 0, taxMode: 'simplified' });

/** settings.json с умолчаниями для расчёта; raw — прочитанное (null, если файла нет). */
export const withSettingsDefaults = (raw) => ({ ...SETTINGS_DEFAULTS, ...(raw || {}) });

/** Слить patch с текущими настройками; поле patch со значением undefined удаляется. Новый объект. */
export function applySettingsPatch(cur, patch) {
  const next = { ...(cur || {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  return next;
}

/**
 * Слить patch со свежим settings.json и записать (api.update — чужие поля не затираются).
 * → записанный объект (без умолчаний). Ошибка API пробрасывается.
 */
export function saveSettingsPatch(patch) {
  return api.update('settings', (cur) => applySettingsPatch(cur, patch));
}

// ---------- правки тарифов (data/tariffs.json) ----------
// path — массив шагов: строка = ключ объекта, {id} = элемент массива по id.
// Все операции возвращают новый объект правок с edited = date; исходный не меняется.

const clone = (o) => (o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : {});

function getAt(root, path) {
  let cur = root;
  for (const step of path) {
    if (cur == null) return undefined;
    cur = typeof step === 'string' ? cur[step] : (Array.isArray(cur) ? cur.find((x) => x && x.id === step.id) : undefined);
  }
  return cur;
}

function setAt(root, path, leaf) {
  let cur = root;
  path.forEach((step, i) => {
    const last = i === path.length - 1;
    const nextIsArr = !last && typeof path[i + 1] !== 'string';
    if (typeof step === 'string') {
      if (last) cur[step] = leaf;
      else cur = cur[step] ??= nextIsArr ? [] : {};
    } else {
      let item = cur.find((x) => x && x.id === step.id);
      if (!item) { item = { id: step.id }; cur.push(item); }
      cur = item;
    }
  });
}

function removeAt(root, path) {
  const parent = getAt(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (parent && typeof last === 'string') delete parent[last];
  // подчистить пустые контейнеры снизу вверх
  for (let n = path.length - 1; n > 0; n--) {
    const p = path.slice(0, n);
    const node = getAt(root, p);
    const empty = node && typeof node === 'object' && Object.keys(node).filter((k) => k !== 'id').length === 0;
    if (!empty) break;
    const holder = getAt(root, p.slice(0, -1));
    const step = p[p.length - 1];
    if (typeof step === 'string') delete holder[step];
    else holder.splice(holder.indexOf(node), 1);
  }
  if (Array.isArray(root.categories) && !root.categories.length) delete root.categories;
  if (Array.isArray(root.logistics) && !root.logistics.length) delete root.logistics;
}

/** Поставить свой лист по пути (лист заменяется целиком). */
export function setTariffLeaf(overrides, path, leaf, date) {
  const next = clone(overrides);
  setAt(next, path, leaf);
  next.edited = date;
  return next;
}

/** Убрать свою правку листа по пути — вернуть исходную цифру. */
export function resetTariffLeaf(overrides, path, date) {
  const next = clone(overrides);
  removeAt(next, path);
  next.edited = date;
  return next;
}

/** Добавить свою категорию {id, name, custom:true, rfbs, fbp}. */
export function addTariffCategory(overrides, category, date) {
  const next = clone(overrides);
  (next.categories ??= []).push(category);
  next.edited = date;
  return next;
}

/** Удалить категорию по id. */
export function removeTariffCategory(overrides, id, date) {
  const next = clone(overrides);
  next.categories = (next.categories || []).filter((c) => c.id !== id);
  if (!next.categories.length) delete next.categories;
  next.edited = date;
  return next;
}

/** Число из поля ввода: «1 234,5» → {n:1234.5}; пусто → {empty:true}; не число → {bad:true}. */
export function parseNum(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return { empty: true };
  if (!/^-?\d*\.?\d+$/.test(s)) return { bad: true };
  return { n: Number(s) };
}
