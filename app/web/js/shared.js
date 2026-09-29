// Общее для экранов и движка — в одном месте. Без DOM: импортируется и в браузере, и в `node --test`.
//   SCHEMES, SCHEME_NAMES                — перечень схем A–D и их названия;
//   LINE_LABELS, LINE_ORDER              — названия и порядок строк расчёта (calc.computeUnit);
//   INCOMPLETE_NAMES, incompleteText(keys) — «нет данных по …» для ключей incomplete;
//   SETTINGS_DEFAULTS, withSettingsDefaults(raw), saveSettingsPatch(patch) — settings.json (запись слиянием);
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
};

/** «нет данных по курсу евро, логистике» — без «неполный:». Текст, не HTML. */
export const incompleteList = (keys) => keys.map((k) => INCOMPLETE_NAMES[k] || k).join(', ');
/** «неполный: нет данных по …». Текст, не HTML. */
export const incompleteText = (keys) => 'неполный: нет данных по ' + incompleteList(keys);

export const SETTINGS_DEFAULTS = Object.freeze({ conversionReserve: 0, taxMode: 'simplified' });

/** settings.json с умолчаниями для расчёта; raw — прочитанное (null, если файла нет). */
export const withSettingsDefaults = (raw) => ({ ...SETTINGS_DEFAULTS, ...(raw || {}) });

/**
 * Прочитать settings.json → слить с patch → записать. Поле patch со значением undefined удаляется.
 * → записанный объект (без умолчаний). Ошибка API пробрасывается.
 */
export async function saveSettingsPatch(patch) {
  const next = { ...((await api.data('settings')) || {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  await api.saveData('settings', next);
  return next;
}

/** Число из поля ввода: «1 234,5» → {n:1234.5}; пусто → {empty:true}; не число → {bad:true}. */
export function parseNum(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return { empty: true };
  if (!/^-?\d*\.?\d+$/.test(s)) return { bad: true };
  return { n: Number(s) };
}
