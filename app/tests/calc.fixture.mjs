// Фикстура тарифов для тестов движка калькулятора (app/web/js/calc.js).
// Собственные числа, подобранные для ручного счёта; с data/tariffs.default.json не связана.
// Каждый вызов fixture() отдаёт свежую копию — тесты могут её менять.

const leaf = (value, extra = {}) => ({ value, source: 'fixture', checked: '2026-09-01', ...extra });
const none = () => ({ value: null, source: null, checked: null, note: 'нет данных — впишите из кабинета' });

const base = {
  version: 1,
  checked: '2026-09-01',
  categories: [
    { id: 'home', name: 'Дом и сад', rfbs: leaf(0.10), fbp: leaf(0.09) },
    // комиссия по ценовым ступеням в рублях (D01)
    { id: 'kitchen', name: 'Посуда', rfbs: { ...leaf(null), unit: 'RUB', bands: [
      { maxPrice: 1500, value: 0.12 }, { maxPrice: 5000, value: 0.15 }, { maxPrice: null, value: 0.18 },
    ] }, fbp: leaf(0.11) },
    // ступени без unit → maxPrice в ¥
    { id: 'toys', name: 'Игрушки', rfbs: { source: 'fixture', checked: '2026-09-01', bands: [
      { maxPrice: 100, value: 0.08 }, { maxPrice: null, value: 0.10 },
    ] }, fbp: none() },
    { id: 'nodata', name: 'Без данных', rfbs: none(), fbp: none() },
  ],
  logistics: [
    { id: 'flat', name: 'Плоский', fixed: leaf(3), perGram: leaf(0.05), bands: [], days: '10' },
    { id: 'rub', name: 'Рублёвый', fixed: leaf(60, { unit: 'RUB' }), perGram: leaf(0.5, { unit: 'RUB' }), bands: [], days: '10' },
    { id: 'banded', name: 'Ступенчатый', fixed: none(), perGram: none(), bands: [
      { maxWeight: 500, maxPrice: null, fixed: 2, perGram: 0.04 },
      { maxWeight: 2000, maxPrice: null, fixed: 5, perGram: 0.03 },
    ], days: '12' },
    { id: 'pricebanded', name: 'По цене', fixed: none(), perGram: none(), bands: [
      { maxWeight: null, maxPrice: 50, fixed: 1, perGram: 0.01 },
      { maxWeight: null, maxPrice: null, fixed: 4, perGram: 0.01 },
    ], days: '12' },
    { id: 'nodata', name: 'Нет данных', fixed: none(), perGram: none(), bands: [], days: '?' },
  ],
  fees: {
    acquiring: leaf(0.02, { unit: 'share' }),
    adsPerOrder: leaf(0.05),
    adsMinRub: leaf(5),
    returnsReserve: leaf(0.04),
    volumetricDivisor: leaf(6000),
    dutyFreeLimit: leaf(200, { unit: 'EUR' }),
  },
  schemes: {
    A: { cnDelivery: leaf(3), agentFee: leaf(3), returnsReserve: leaf(0.04) },
    B: { cnDelivery: leaf(0), supplierPackFee: leaf(1), returnsReserve: leaf(0.06) },
    C: { batchDiscount: leaf(0.1), inboundPerUnit: leaf(1), storagePerUnit: leaf(0.5), agentFee: leaf(2), returnsReserve: leaf(0.03) },
    D: { batchDiscount: leaf(0), inboundPerUnit: leaf(1), fbpHandling: leaf(2), returnsReserve: leaf(0.03) },
  },
  tax: {
    simplified: { base: leaf(0.04), rate: leaf(0.05) },
    regular: { rate: leaf(0.05) },
  },
};

export const fixture = () => structuredClone(base);

export const settings = (extra = {}) => ({ rate: 12.5, rateDate: '2026-09-28', conversionReserve: 0.01, taxMode: 'simplified', ...extra });

export const input = (extra = {}) => ({ purchase: 20, weight: 200, category: 'home', logistics: 'flat', price: 100, ...extra });
