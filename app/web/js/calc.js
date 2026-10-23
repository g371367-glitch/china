// Движок юнит-экономики Ozon Global / Иу. Чистые функции, без DOM.
// Базовая валюта — ¥ (CNY). Рубли и евро переводятся по курсам из settings:
//   settings.rate      — ₽ за 1 ¥ (ЦБ или ручной);
//   settings.eurRate   — ₽ за 1 € (необязательно; нужен только для листьев в EUR и проверки беспошлинного лимита);
//   settings.conversionReserve — запас на конвертацию, доля (0.01 = 1%);
//   settings.taxMode   — 'simplified' | 'regular' | 'custom'; settings.taxCustomRate — доля от выручки для 'custom'.
// input: { purchase ¥, weight г, dims?: {l,w,h} см, category id, logistics id, price ¥, noAds? }
// Логистика: {fixed, perGram} или bands. tiered:true — ступени Ozon (pickTier): цена × фактический вес, габариты, объёмный вес только у ступеней volumetric.
// Тарифный лист: {value, source, checked, note?, unit?, bands?}; value:null — нет данных → ключ в incomplete, в сумму идёт 0.

import { SCHEMES, LINE_LABELS as LABELS } from './shared.js';

const CURRENCIES = new Set(['CNY', 'RUB', 'EUR']);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Значение листа (или голого числа). null — нет данных. */
function val(leaf) {
  if (isNum(leaf)) return leaf;
  if (leaf && typeof leaf === 'object' && isNum(leaf.value)) return leaf.value;
  return null;
}

/** Контекст одного расчёта: копит incomplete и переводит валюты. */
function makeCtx(settings) {
  const s = settings || {};
  const rate = isNum(s.rate) && s.rate > 0 ? s.rate : null;
  const eurRate = isNum(s.eurRate) && s.eurRate > 0 ? s.eurRate : null;
  const incomplete = [];
  const miss = (key) => { if (!incomplete.includes(key)) incomplete.push(key); };
  /** Сумма в ¥ из суммы в валюте unit; нет курса → null и пометка. */
  const toCny = (amount, unit, key) => {
    const u = CURRENCIES.has(unit) ? unit : 'CNY';
    if (u === 'CNY') return amount;
    if (!rate) { miss('rate'); return null; }
    if (u === 'RUB') return amount / rate;
    if (!eurRate) { miss('eurRate'); return null; }
    return (amount * eurRate) / rate;
  };
  /** Денежный лист → ¥. defUnit — валюта по умолчанию для листа без unit. */
  const money = (leaf, key, defUnit = 'CNY') => {
    const v = val(leaf);
    if (v === null) { miss(key); return 0; }
    const unit = leaf && typeof leaf === 'object' && leaf.unit ? leaf.unit : defUnit;
    const c = toCny(v, unit, key);
    return c === null ? 0 : c;
  };
  /** Долевой лист → число 0..1. */
  const share = (leaf, key) => {
    const v = val(leaf);
    if (v === null) { miss(key); return 0; }
    return v;
  };
  return { s, rate, eurRate, incomplete, miss, toCny, money, share };
}

function srcOf(leaf) {
  if (!leaf || typeof leaf !== 'object') return {};
  const o = {};
  if (leaf.source) o.source = leaf.source;
  if (leaf.checked) o.checked = leaf.checked;
  if (leaf.note) o.note = leaf.note;
  if (leaf.own) o.own = true;
  return o;
}

// Строки, которые входят в «вложенное» для ROI (решение 9).
const INVESTED = new Set(['purchase', 'cnDelivery', 'agentFee', 'supplierPackFee', 'inbound', 'storage', 'fbpHandling', 'logistics']);

function findCategory(tariffs, id) {
  return (tariffs.categories || []).find((c) => c.id === id) || null;
}
function findLogistics(tariffs, id) {
  return (tariffs.logistics || []).find((l) => l.id === id) || null;
}

/** Валюта листа или ступени: unit, если это валюта, иначе CNY. */
function currencyOf(...objs) {
  for (const o of objs) if (o && typeof o === 'object' && CURRENCIES.has(o.unit)) return o.unit;
  return 'CNY';
}

/** Первая ступень, у которой все заданные границы не меньше значений (граница включительно). */
function pickBand(bands, checks) {
  const sorted = bands.slice().sort((a, b) => {
    for (const [k] of checks) {
      const x = isNum(a[k]) ? a[k] : Infinity, y = isNum(b[k]) ? b[k] : Infinity;
      if (x !== y) return x - y;
    }
    return 0;
  });
  return sorted.find((b) => checks.every(([k, v]) => !isNum(b[k]) || v <= b[k])) || null;
}

/**
 * Ступени Ozon по таблице партнёрской доставки (tiered:true): ступень выбирается по цене и ФАКТИЧЕСКОМУ весу
 * в порядке списка; не проходит по габаритам (maxSide — длинная сторона, maxSum — сумма сторон, см) — следующая.
 * Объёмный вес — только у ступеней с volumetric:true (Big, Premium Big). → {band, w} | null
 */
function pickTier(t, input, price, divisor) {
  const w = isNum(input.weight) ? input.weight : 0;
  const d = input.dims;
  const sides = d && [d.l, d.w, d.h].every((x) => isNum(x) && x > 0) ? [d.l, d.w, d.h] : null;
  const band = t.bands.find((b) => (!isNum(b.maxPrice) || price <= b.maxPrice)
    && (!isNum(b.maxWeight) || w <= b.maxWeight)
    && (!sides || !isNum(b.maxSide) || Math.max(...sides) <= b.maxSide)
    && (!sides || !isNum(b.maxSum) || sides[0] + sides[1] + sides[2] <= b.maxSum));
  if (!band) return null;
  return { band, w: band.volumetric ? chargeableWeight(input, divisor) : w };
}

function logisticsCost(input, tariffs, price, cx) {
  const t = findLogistics(tariffs, input.logistics);
  if (!t) { cx.miss('logistics'); return { cny: 0, src: {} }; }
  const divisor = val((tariffs.fees || {}).volumetricDivisor);
  const w = chargeableWeight(input, divisor);
  const src = { source: t.source ?? t.fixed?.source, checked: t.checked ?? t.fixed?.checked, note: t.note ?? t.fixed?.note };
  // Свой фикс или ставка (правка со страницы «Тарифы») важнее исходных ступеней.
  const ownSimple = !!(t.fixed?.own || t.perGram?.own);
  if (t.tiered && Array.isArray(t.bands) && t.bands.length && !ownSimple) {
    const pc = cx.toCny(1, currencyOf(t), 'logistics'); // ¥ за 1 единицу валюты ступеней
    if (pc === null) return { cny: 0, src };
    const pick = pickTier(t, input, price / pc, divisor);
    const b = pick && pick.band;
    if (!b) { cx.miss('logistics'); return { cny: 0, src, hint: 'вес, цена или габариты вне ступеней тарифа' }; }
    const hint = `ступень ${b.tier || '?'}${b.volumetric && pick.w > (input.weight || 0) ? ', по объёмному весу' : ''}`;
    if (val(b.fixed) === null || val(b.perGram) === null) { cx.miss('logistics'); return { cny: 0, src, hint: `${hint}: перевозчик её не предлагает или нет данных` }; }
    return { cny: (val(b.fixed) + val(b.perGram) * pick.w) * pc, src, hint };
  }
  if (Array.isArray(t.bands) && t.bands.length && !ownSimple) {
    const cur = currencyOf(t, t.fixed);
    const pc = cx.toCny(1, cur, 'logistics'); // ¥ за 1 единицу валюты ступеней
    if (pc === null) return { cny: 0, src };
    const b = pickBand(t.bands, [['maxWeight', w], ['maxPrice', price / pc]]);
    const bc = b && currencyOf(b, t, t.fixed);
    if (!b || val(b.fixed) === null || val(b.perGram) === null) { cx.miss('logistics'); return { cny: 0, src }; }
    const k = cx.toCny(1, bc, 'logistics');
    return { cny: k === null ? 0 : (val(b.fixed) + val(b.perGram) * w) * k, src };
  }
  // Достаточно одного из полей: пустое второе считается 0 и показывается подсказкой (hint).
  const hasFixed = val(t.fixed) !== null;
  const hasGram = val(t.perGram) !== null;
  if (!hasFixed && !hasGram) { cx.miss('logistics'); return { cny: 0, src }; }
  const cny = (hasFixed ? cx.money(t.fixed, 'logistics') : 0) + (hasGram ? cx.money(t.perGram, 'logistics') * w : 0);
  const hint = !hasGram ? 'цена за грамм не указана — считается 0' : !hasFixed ? 'фикс не указан — считается 0' : undefined;
  return { cny, src, hint };
}

/** Ставка комиссии из листа: одиночное value или ступени bands по цене (D01). null — нет данных. */
function commissionFromLeaf(leaf, price, cx) {
  if (!leaf || typeof leaf !== 'object') return null;
  if (Array.isArray(leaf.bands) && leaf.bands.length) {
    const k = cx.toCny(1, currencyOf(leaf), 'commission'); // ¥ за 1 единицу валюты границ
    if (k === null) return null;
    const b = pickBand(leaf.bands, [['maxPrice', price / k]]);
    return b ? val(b.value) : null;
  }
  return val(leaf);
}

function commissionRate(input, scheme, tariffs, price, cx) {
  const cat = findCategory(tariffs, input.category);
  if (!cat) { cx.miss('commission'); return { rate: 0, src: {} }; }
  if (scheme === 'D') {
    const fbp = commissionFromLeaf(cat.fbp, price, cx);
    if (fbp !== null) return { rate: fbp, src: srcOf(cat.fbp) };
    const rfbs = commissionFromLeaf(cat.rfbs, price, cx);
    if (rfbs !== null) {
      const src = srcOf(cat.rfbs);
      return { rate: Math.max(0, rfbs - 0.01), src: { ...src, note: 'FBP неизвестна — оценка по заметкам: rFBS − 1 п.п.' } };
    }
    cx.miss('commission');
    return { rate: 0, src: srcOf(cat.fbp) };
  }
  const r = commissionFromLeaf(cat.rfbs, price, cx);
  if (r === null) { cx.miss('commission'); return { rate: 0, src: srcOf(cat.rfbs) }; }
  return { rate: r, src: srcOf(cat.rfbs) };
}

const TAX_LABEL = { simplified: 'Налог (упрощёнка Иу)', regular: 'Налог (обычный, 5% прибыли)', custom: 'Налог (свой %)' };

/** Налог по режиму: simplified = база×ставка×выручка; regular = ставка×max(0, прибыль до налога); custom = доля×выручка. */
function taxAmount(revenue, profitBeforeTax, tariffs, cx) {
  const t = tariffs.tax || {};
  const mode = TAX_LABEL[cx.s.taxMode] ? cx.s.taxMode : 'simplified';
  const label = TAX_LABEL[mode];
  if (mode === 'regular') {
    const rate = cx.share(t.regular?.rate, 'tax');
    return { cny: rate * Math.max(0, profitBeforeTax), label, src: srcOf(t.regular?.rate) };
  }
  if (mode === 'custom') {
    const r = cx.s.taxCustomRate;
    if (!isNum(r)) { cx.miss('tax'); return { cny: 0, label, src: {} }; }
    return { cny: r * revenue, label, src: { note: 'свой % от выручки' } };
  }
  const base = cx.share(t.simplified?.base, 'tax');
  const rate = cx.share(t.simplified?.rate, 'tax');
  return { cny: base * rate * revenue, label, src: srcOf(t.simplified?.rate) };
}

/**
 * Юнит-экономика одного заказа по схеме A/B/C/D.
 * → {lines:[{key,label,cny,source?,checked?,note?}], revenue, cost, profit, margin, roi, incomplete:[keys], warnings:[]}
 */
export function computeUnit(input, scheme, tariffs, settings) {
  input = input || {};
  tariffs = tariffs || {};
  const cx = makeCtx(settings);
  const sch = (tariffs.schemes || {})[scheme] || {};
  const fees = tariffs.fees || {};
  const price = isNum(input.price) ? input.price : 0;
  const lines = [];
  const add = (key, cny, extra = {}) => lines.push({ key, label: LABELS[key], cny, ...extra });

  const purchase = isNum(input.purchase) ? input.purchase : 0;
  if ('batchDiscount' in sch) add('purchase', purchase * (1 - cx.share(sch.batchDiscount, 'batchDiscount')), srcOf(sch.batchDiscount));
  else add('purchase', purchase);
  if ('cnDelivery' in sch) add('cnDelivery', cx.money(sch.cnDelivery, 'cnDelivery'), srcOf(sch.cnDelivery));
  if ('agentFee' in sch) add('agentFee', cx.money(sch.agentFee, 'agentFee'), srcOf(sch.agentFee));
  if ('supplierPackFee' in sch) add('supplierPackFee', cx.money(sch.supplierPackFee, 'supplierPackFee'), srcOf(sch.supplierPackFee));
  if ('inboundPerUnit' in sch) add('inbound', cx.money(sch.inboundPerUnit, 'inbound'), srcOf(sch.inboundPerUnit));
  if ('storagePerUnit' in sch) add('storage', cx.money(sch.storagePerUnit, 'storage'), srcOf(sch.storagePerUnit));
  if ('fbpHandling' in sch) add('fbpHandling', cx.money(sch.fbpHandling, 'fbpHandling'), srcOf(sch.fbpHandling));

  const lg = logisticsCost(input, tariffs, price, cx);
  add('logistics', lg.cny, lg.hint ? { ...lg.src, hint: lg.hint } : lg.src);

  const cm = commissionRate(input, scheme, tariffs, price, cx);
  add('commission', cm.rate * price, cm.src);

  // Электронный сбор Ozon: доля от цены за отправление, с минимумом и максимумом в ₽ (если они заданы).
  if ('serviceFee' in fees) {
    let fee = cx.share(fees.serviceFee, 'serviceFee') * price;
    if (val(fees.serviceFeeMinRub) !== null) fee = Math.max(fee, cx.money(fees.serviceFeeMinRub, 'serviceFee', 'RUB'));
    if (val(fees.serviceFeeMaxRub) !== null && cx.rate) fee = Math.min(fee, cx.money(fees.serviceFeeMaxRub, 'serviceFee', 'RUB'));
    add('serviceFee', fee, srcOf(fees.serviceFee));
  }

  if (input.noAds) add('ads', 0, { note: 'без рекламы' });
  else add('ads', Math.max(cx.share(fees.adsPerOrder, 'ads') * price, cx.money(fees.adsMinRub, 'ads', 'RUB')), srcOf(fees.adsPerOrder));

  const reserve = isNum(cx.s.conversionReserve) ? cx.s.conversionReserve : 0;
  add('acquiring', (cx.share(fees.acquiring, 'acquiring') + reserve) * price, srcOf(fees.acquiring));

  const retLeaf = 'returnsReserve' in sch ? sch.returnsReserve : fees.returnsReserve;
  add('returns', cx.share(retLeaf, 'returns') * price, srcOf(retLeaf));

  const before = lines.reduce((s, l) => s + l.cny, 0);
  const tx = taxAmount(price, price - before, tariffs, cx);
  add('tax', tx.cny, { ...tx.src, label: tx.label });

  const cost = lines.reduce((s, l) => s + l.cny, 0);
  const revenue = price;
  const profit = revenue - cost;
  const warnings = [];
  const limit = val(fees.dutyFreeLimit);
  if (limit !== null && cx.rate && cx.eurRate) {
    const limitCny = (limit * cx.eurRate) / cx.rate; // лимит хранится в EUR (unit), иначе считаем тоже EUR
    if (price > limitCny + 1e-9) warnings.push('dutyFree');
  }
  const invested = lines.filter((l) => INVESTED.has(l.key)).reduce((s, l) => s + l.cny, 0);
  return {
    lines, revenue, cost, profit,
    margin: revenue > 0 ? profit / revenue : 0,
    roi: invested > 0 ? profit / invested : 0,
    incomplete: cx.incomplete,
    warnings,
  };
}

/** Доля процентных удержаний при цене p (комиссия, реклама %, эквайринг+запас, возвраты, налог). Для обычного налога — эффективная. */
function percentShare(input, scheme, tariffs, settings, p) {
  const cx = makeCtx(settings);
  const fees = tariffs.fees || {};
  const sch = (tariffs.schemes || {})[scheme] || {};
  let pct = commissionRate(input, scheme, tariffs, p, cx).rate;
  if (!input.noAds) pct += cx.share(fees.adsPerOrder, 'ads');
  pct += cx.share(fees.acquiring, 'acquiring') + (isNum(cx.s.conversionReserve) ? cx.s.conversionReserve : 0);
  pct += cx.share('returnsReserve' in sch ? sch.returnsReserve : fees.returnsReserve, 'returns');
  const t = tariffs.tax || {};
  if (cx.s.taxMode === 'regular') return 1 - (1 - pct) * (1 - cx.share(t.regular?.rate, 'tax'));
  if (cx.s.taxMode === 'custom') return pct + (isNum(cx.s.taxCustomRate) ? cx.s.taxCustomRate : 0);
  return pct + cx.share(t.simplified?.base, 'tax') * cx.share(t.simplified?.rate, 'tax');
}

const pctText = (x) => (Math.round(x * 1000) / 10).toString().replace('.', ',') + '%';

/**
 * Цена продажи (¥), при которой маржа = targetMargin (доля). Бисекция по цене с точностью 0,01 ¥.
 * → {price, margin, incomplete} | {unreachable:true, reason}
 */
export function priceForMargin(targetMargin, input, scheme, tariffs, settings) {
  input = input || {};
  tariffs = tariffs || {};
  if (!isNum(targetMargin)) return { unreachable: true, reason: 'Введите целевую маржу числом' };
  const at = (p) => computeUnit({ ...input, price: p }, scheme, tariffs, settings);
  const floor = Math.max(at(0).cost, 1);
  let lo = 0.01;
  let hi = floor * 100;
  const pct = percentShare(input, scheme, tariffs, settings, hi);
  const inc = at(hi).incomplete;
  if (targetMargin >= 1 - pct) {
    return { unreachable: true, reason: `Такая маржа недостижима: процентные удержания уже ${pctText(pct)}`, incomplete: inc };
  }
  if (at(lo).margin >= targetMargin) { const r = at(lo); return { price: lo, margin: r.margin, incomplete: r.incomplete }; }
  if (at(hi).margin < targetMargin) {
    return { unreachable: true, reason: `Такая маржа недостижима в разумной цене: процентные удержания уже ${pctText(pct)}, нужна цена выше 100× себестоимости`, incomplete: inc };
  }
  for (let i = 0; i < 200 && hi - lo > 0.005; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).margin >= targetMargin) hi = mid; else lo = mid;
  }
  const r = at(hi);
  return { price: hi, margin: r.margin, incomplete: r.incomplete };
}

/**
 * Логистика по умолчанию («Авто»): самый дешёвый тариф с известными данными для этого товара, иначе первый.
 * Один выбор для калькулятора и списка товаров. → {id, name, cny|null, known:boolean} | null (тарифов нет).
 */
export function defaultLogistics(input, tariffs, settings) {
  const list = (tariffs && tariffs.logistics) || [];
  let best = null;
  for (const l of list) {
    const r = computeUnit({ ...input, logistics: l.id }, 'A', tariffs, settings);
    if (r.incomplete.includes('logistics')) continue;
    const c = r.lines.find((x) => x.key === 'logistics').cny;
    if (!best || c < best.cny) best = { id: l.id, name: l.name, cny: c, known: true };
  }
  if (best) return best;
  return list[0] ? { id: list[0].id, name: list[0].name, cny: null, known: false } : null;
}

/** Цена безубыточности (маржа 0). → как priceForMargin. */
export function breakeven(input, scheme, tariffs, settings) {
  return priceForMargin(0, input, scheme, tariffs, settings);
}
/**
 * Один товар по четырём схемам. → {A,B,C,D (как computeUnit), best: ключ схемы с наибольшей прибылью,
 *   incomplete: объединение неизвестных ключей, comparable: у всех схем одинаковый набор неизвестных}
 * comparable:false — best не годится как вывод без оговорки «неполный».
 */
export function compareSchemes(input, tariffs, settings) {
  const out = {};
  let best = null;
  for (const k of SCHEMES) {
    out[k] = computeUnit(input, k, tariffs, settings);
    if (best === null || out[k].profit > out[best].profit) best = k;
  }
  out.best = best;
  const sets = SCHEMES.map((k) => [...out[k].incomplete].sort().join('|'));
  out.incomplete = [...new Set(SCHEMES.flatMap((k) => out[k].incomplete))];
  out.comparable = sets.every((x) => x === sets[0]);
  return out;
}

const isLeaf = (x) => x && typeof x === 'object' && !Array.isArray(x) && ('value' in x || 'bands' in x);

function mergeNode(def, over) {
  if (over === undefined) return structuredClone(def);
  if (isLeaf(over)) return { ...structuredClone(over), own: true };
  if (Array.isArray(def) || Array.isArray(over)) {
    const base = Array.isArray(def) ? structuredClone(def) : [];
    if (!Array.isArray(over)) return base;
    for (const item of over) {
      const i = item && item.id != null ? base.findIndex((x) => x && x.id === item.id) : -1;
      if (i >= 0) base[i] = mergeNode(base[i], item);
      else base.push(mergeNode(undefined, item));
    }
    return base;
  }
  if (over && typeof over === 'object') {
    const res = def && typeof def === 'object' ? structuredClone(def) : {};
    for (const [k, v] of Object.entries(over)) res[k] = mergeNode(res[k], v);
    return res;
  }
  return over;
}

/**
 * Накладывает правки пользователя (data/tariffs.json: только изменённые листья, массивы — по id, плюс edited)
 * на исходные тарифы. Переопределённый лист целиком заменяет исходный и получает own:true. Входы не мутируются.
 */
export function mergeTariffs(defaults, overrides) {
  const d = defaults && typeof defaults === 'object' ? defaults : {};
  if (!overrides || typeof overrides !== 'object') return structuredClone(d);
  return mergeNode(d, overrides);
}

/** Расчётный вес, г: max(факт, Д×Ш×В/делитель×1000), если заданы все три габарита (см) и делитель (см³/кг). */
export function chargeableWeight(input, divisor) {
  const w = isNum(input.weight) ? input.weight : 0;
  const d = input.dims;
  if (!d || !isNum(divisor) || divisor <= 0 || ![d.l, d.w, d.h].every((x) => isNum(x) && x > 0)) return w;
  return Math.max(w, ((d.l * d.w * d.h) / divisor) * 1000);
}
