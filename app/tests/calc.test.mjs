// Тесты движка калькулятора — только через публичные функции calc.js.
// Ожидаемые числа посчитаны вручную по фикстуре (calc.fixture.mjs), курс 12,5 ₽/¥.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../web/js/calc.js';
import { fixture, settings, input } from './calc.fixture.mjs';

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ожидалось ${b}, получено ${a}`);
const line = (r, key) => r.lines.find((l) => l.key === key);
const sum = (r) => r.lines.reduce((s, l) => s + l.cny, 0);

test('схема A: разбивка сходится с ручным счётом, итоги по формулам', () => {
  // закупка 20 + Китай 3 + агент 3 + логистика 3+0,05×200=13 + комиссия 10 + реклама max(5; 5₽/12,5=0,4)=5
  // + эквайринг (2%+1% запас)×100=3 + возвраты 4 + налог 0,04×0,05×100=0,2 = 61,2
  const r = calc.computeUnit(input(), 'A', fixture(), settings());
  near(r.revenue, 100);
  near(r.cost, 61.2);
  near(sum(r), r.cost, 1e-9, 'сумма строк = cost:');
  near(r.profit, 38.8);
  near(r.margin, 0.388);
  near(r.roi, 38.8 / 39, 1e-9, 'ROI = прибыль / (закупка+Китай+агент+логистика):');
  near(line(r, 'logistics').cny, 13);
  near(line(r, 'commission').cny, 10);
  near(line(r, 'ads').cny, 5);
  near(line(r, 'acquiring').cny, 3);
  near(line(r, 'returns').cny, 4);
  near(line(r, 'tax').cny, 0.2);
  assert.deepEqual(r.incomplete, []);
});

test('расчётный вес = max(факт, объёмный) при заданных габаритах', () => {
  const dims = { l: 30, w: 20, h: 10 }; // 6000 см³ / 6000 = 1 кг
  assert.equal(calc.chargeableWeight({ weight: 500, dims }, 6000), 1000);
  assert.equal(calc.chargeableWeight({ weight: 1500, dims }, 6000), 1500);
  assert.equal(calc.chargeableWeight({ weight: 500 }, 6000), 500);
  assert.equal(calc.chargeableWeight({ weight: 500, dims: { l: 30, w: null, h: 10 } }, 6000), 500);
  // в computeUnit логистика считается от расчётного веса: 1000 г → ступень 2: 5 + 0,03×1000
  const r = calc.computeUnit(input({ weight: 300, dims, logistics: 'banded' }), 'A', fixture(), settings());
  near(line(r, 'logistics').cny, 35);
});

test('ступени логистики выбираются правильно на границах веса и цены', () => {
  const lg = (extra) => line(calc.computeUnit(input({ logistics: 'banded', ...extra }), 'A', fixture(), settings()), 'logistics').cny;
  near(lg({ weight: 500 }), 22);      // ≤500 → 2 + 0,04×500
  near(lg({ weight: 501 }), 20.03);   // >500 → 5 + 0,03×501
  near(lg({ weight: 2000 }), 65);
  const out = calc.computeUnit(input({ logistics: 'banded', weight: 2001 }), 'A', fixture(), settings());
  assert.ok(out.incomplete.includes('logistics'), 'вес вне ступеней → расчёт неполный');
  const byPrice = (price) => line(calc.computeUnit(input({ logistics: 'pricebanded', price }), 'A', fixture(), settings()), 'logistics').cny;
  near(byPrice(50), 3);      // ≤50 ¥ → 1 + 0,01×200
  near(byPrice(50.01), 6);   // >50 ¥ → 4 + 0,01×200
  // в фикстуре у ступенчатого тарифа fixed/perGram = null — при наличии ступеней это не «нет данных»
  assert.deepEqual(calc.computeUnit(input({ logistics: 'banded' }), 'A', fixture(), settings()).incomplete, []);
});

test('D01: комиссия по ценовым ступеням, граница включительно; одиночное value тоже работает', () => {
  const cm = (extra, scheme = 'A') => line(calc.computeUnit(input(extra), scheme, fixture(), settings()), 'commission').cny;
  // kitchen: ступени в ₽; 1500 ₽ = 120 ¥, 5000 ₽ = 400 ¥ при курсе 12,5
  near(cm({ category: 'kitchen', price: 120 }), 14.4);            // 12%
  near(cm({ category: 'kitchen', price: 120.01 }), 18.0015, 1e-9); // 15%
  near(cm({ category: 'kitchen', price: 400 }), 60);               // 15%
  near(cm({ category: 'kitchen', price: 400.01 }), 72.0018, 1e-9); // 18%, верх без границы
  // toys: ступени без unit → ¥
  near(cm({ category: 'toys', price: 100 }), 8);
  near(cm({ category: 'toys', price: 100.01 }), 10.001, 1e-9);
  // одиночное value, rFBS и FBP
  near(cm({ category: 'home' }), 10);
  near(cm({ category: 'home' }, 'D'), 9);
});

test('D: FBP неизвестна → оценка rFBS − 1 п.п. с пометкой; обе неизвестны → неполный', () => {
  const r = calc.computeUnit(input({ category: 'toys' }), 'D', fixture(), settings());
  near(line(r, 'commission').cny, 7); // 8% − 1 п.п. при цене 100
  assert.match(line(r, 'commission').note, /оценка по заметкам/);
  assert.ok(!r.incomplete.includes('commission'));
  const n = calc.computeUnit(input({ category: 'nodata' }), 'D', fixture(), settings());
  assert.ok(n.incomplete.includes('commission'));
});

test('unit: RUB у денежных листьев переводится в ¥ по курсу; минимум рекламы в ₽', () => {
  const r = calc.computeUnit(input({ logistics: 'rub' }), 'A', fixture(), settings());
  near(line(r, 'logistics').cny, 12.8); // 60 ₽ + 0,5 ₽×200 = 160 ₽ / 12,5
  const cheap = calc.computeUnit(input({ price: 5 }), 'A', fixture(), settings());
  near(line(cheap, 'ads').cny, 0.4); // max(5%×5 = 0,25; 5 ₽/12,5 = 0,4)
});

test('реклама: «без рекламы» обнуляет строку', () => {
  const r = calc.computeUnit(input({ noAds: true }), 'A', fixture(), settings());
  assert.equal(line(r, 'ads').cny, 0);
  near(r.cost, 56.2);
});

test('налог: упрощёнка, обычный (5% положительной прибыли, при убытке 0), свой %', () => {
  const tax = (st, extra) => line(calc.computeUnit(input(extra), 'A', fixture(), settings(st)), 'tax').cny;
  near(tax({ taxMode: 'simplified' }), 0.2);                   // 0,04×0,05×100
  near(tax({ taxMode: 'regular' }), 1.95);                     // 5% × (100 − 61)
  assert.equal(tax({ taxMode: 'regular' }, { price: 30 }), 0);  // до налога убыток: 45,6 > 30
  near(tax({ taxMode: 'custom', taxCustomRate: 0.01 }), 1);    // свой % — от выручки
});

const allFinite = (r) => [r.revenue, r.cost, r.profit, r.margin, r.roi, ...r.lines.map((l) => l.cny)].every(Number.isFinite);

test('null-тариф → ключ в incomplete, в итогах нет NaN/Infinity', () => {
  const t = fixture();
  t.schemes.D.fbpHandling.value = null;
  t.tax.simplified.base.value = null;
  const r = calc.computeUnit(input({ category: 'nodata', logistics: 'nodata' }), 'D', t, settings());
  for (const k of ['commission', 'logistics', 'fbpHandling', 'tax']) assert.ok(r.incomplete.includes(k), k);
  assert.ok(allFinite(r));
  // нет курса → рублёвые листья не переводятся, пометка rate; тоже без мусора
  const nr = calc.computeUnit(input({ logistics: 'rub' }), 'A', fixture(), settings({ rate: null }));
  assert.ok(nr.incomplete.includes('rate'));
  assert.ok(allFinite(nr));
  // вырожденный ввод и пустые тарифы
  for (const [inp, tt] of [[input({ price: 0, weight: 0, purchase: 0 }), fixture()], [input({ price: NaN }), {}]]) {
    const x = calc.computeUnit(inp, 'B', tt, settings());
    assert.ok(allFinite(x), JSON.stringify(inp));
  }
});

test('«без рекламы» при неизвестной ставке рекламы не делает расчёт неполным', () => {
  const t = fixture();
  t.fees.adsPerOrder.value = null;
  assert.ok(calc.computeUnit(input(), 'A', t, settings()).incomplete.includes('ads'));
  assert.deepEqual(calc.computeUnit(input({ noAds: true }), 'A', t, settings()).incomplete, []);
});

test('priceForMargin: ручной пример для A (39 / (1 − 22,2% − 30%) ≈ 81,59 ¥)', () => {
  const r = calc.priceForMargin(0.3, input(), 'A', fixture(), settings());
  near(r.price, 39 / 0.478, 0.011);
});

test('priceForMargin → computeUnit даёт цель ±0,1 п.п. для всех 4 схем и режимов', () => {
  for (const scheme of ['A', 'B', 'C', 'D']) {
    for (const [inp, st] of [[input(), settings()], [input({ category: 'kitchen', logistics: 'banded' }), settings({ taxMode: 'regular' })], [input({ noAds: true, price: 1 }), settings()]]) {
      for (const target of [0, 0.15, 0.4]) {
        const r = calc.priceForMargin(target, inp, scheme, fixture(), st);
        assert.ok(Number.isFinite(r.price), `${scheme} ${target}: ${JSON.stringify(r)}`);
        const m = calc.computeUnit({ ...inp, price: r.price }, scheme, fixture(), st).margin;
        assert.ok(Math.abs(m - target) <= 0.001, `${scheme} цель ${target}, получено ${m}`);
      }
    }
  }
});

test('недостижимая маржа → {unreachable, reason} с суммой процентных удержаний', () => {
  // A/home: комиссия 10 + реклама 5 + эквайринг 2 + запас 1 + возвраты 4 + налог 0,2 = 22,2%
  const r = calc.priceForMargin(0.8, input(), 'A', fixture(), settings());
  assert.equal(r.unreachable, true);
  assert.match(r.reason, /Такая маржа недостижима: процентные удержания уже 22,2\s?%/);
  assert.equal(r.price, undefined);
});

test('breakeven: цена, при которой прибыль ≈ 0', () => {
  const r = calc.breakeven(input(), 'A', fixture(), settings());
  near(r.price, 39 / 0.778, 0.011);
  near(calc.computeUnit(input({ price: r.price }), 'A', fixture(), settings()).profit, 0, 0.01);
});

test('compareSchemes: четыре схемы, лучшая по прибыли (C со скидкой партии 10%)', () => {
  const r = calc.compareSchemes(input(), fixture(), settings());
  // A 38,8; B 100−58,2 = 41,8; C: закупка 18 +1 +0,5 +2 +13 +10 +5 +3 +3 +0,2 = 55,7 → 44,3; D: 20+1+2+13+9+5+3+3+0,2 = 56,2 → 43,8
  near(r.A.profit, 38.8); near(r.B.profit, 41.8); near(r.C.profit, 44.3); near(r.D.profit, 43.8);
  near(line(r.C, 'purchase').cny, 18);
  assert.equal(r.best, 'C');
});

test('mergeTariffs: правки накладываются по листьям и id, исходные не меняются, своя категория добавляется', () => {
  const def = fixture();
  const snapshot = JSON.stringify(def);
  const over = {
    edited: '2026-09-28',
    categories: [
      { id: 'home', rfbs: { value: 0.2, source: 'моя правка', checked: '2026-09-28' } },
      { id: 'kitchen', rfbs: { value: 0.13, source: 'моя правка', checked: '2026-09-28' } },
      { id: 'my-1', name: 'Своя', custom: true, rfbs: { value: 0.07 }, fbp: { value: null } },
    ],
    logistics: [{ id: 'flat', fixed: { value: 4 } }],
    fees: { acquiring: { value: 0.03 } },
    tax: { regular: { rate: { value: 0.1 } } },
  };
  const m = calc.mergeTariffs(def, over);
  assert.equal(JSON.stringify(def), snapshot, 'исходные не мутируются');
  const cat = (id) => m.categories.find((c) => c.id === id);
  assert.equal(cat('home').rfbs.value, 0.2);
  assert.equal(cat('home').rfbs.own, true);
  assert.equal(cat('home').fbp.value, 0.09);
  assert.equal(cat('home').name, 'Дом и сад');
  assert.equal(cat('kitchen').rfbs.bands, undefined, 'правка одним числом заменяет ступени');
  assert.equal(cat('my-1').name, 'Своя');
  assert.equal(m.categories.length, 5);
  const flat = m.logistics.find((l) => l.id === 'flat');
  assert.equal(flat.fixed.value, 4); assert.equal(flat.perGram.value, 0.05);
  assert.equal(m.fees.acquiring.value, 0.03); assert.equal(m.fees.adsPerOrder.value, 0.05);
  assert.equal(m.tax.regular.rate.value, 0.1); assert.equal(m.tax.simplified.base.value, 0.04);
  assert.equal(m.edited, '2026-09-28');
  near(line(calc.computeUnit(input(), 'A', m, settings()), 'commission').cny, 20);
  assert.deepEqual(calc.mergeTariffs(def, null), def);
});

test('беспошлинный лимит (EUR): предупреждение только при известном курсе евро', () => {
  const w = (price, st) => calc.computeUnit(input({ price }), 'A', fixture(), settings(st)).warnings;
  // 2000 ¥ × 12,5 = 25 000 ₽ / 100 = 250 € > 200 €
  assert.ok(w(2000, { eurRate: 100 }).includes('dutyFree'));
  assert.ok(!w(1600, { eurRate: 100 }).includes('dutyFree')); // ровно 200 € — не выше
  assert.deepEqual(w(2000, {}), []);
});

test('вся логистика null (как в реальном файле): incomplete везде, сравнение помечено несопоставимым', () => {
  const t = fixture();
  for (const l of t.logistics) { l.fixed = { value: null }; l.perGram = { value: null }; l.bands = []; }
  t.schemes.D.fbpHandling.value = null;
  const pm = calc.priceForMargin(0.3, input(), 'A', t, settings());
  assert.ok(pm.incomplete.includes('logistics'), 'priceForMargin');
  assert.ok(calc.breakeven(input(), 'A', t, settings()).incomplete.includes('logistics'), 'breakeven');
  const un = calc.priceForMargin(0.95, input(), 'A', t, settings());
  assert.equal(un.unreachable, true);
  assert.ok(un.incomplete.includes('logistics'), 'недостижимая тоже несёт incomplete');
  const cmp = calc.compareSchemes(input(), t, settings());
  assert.deepEqual([...cmp.incomplete].sort(), ['fbpHandling', 'logistics']);
  assert.equal(cmp.comparable, false, 'у D есть неизвестная строка, которой нет у A–C');
  // одинаковый набор неизвестных — сравнение честное
  const t2 = fixture();
  for (const l of t2.logistics) { l.fixed = { value: null }; l.perGram = { value: null }; l.bands = []; }
  const c2 = calc.compareSchemes(input(), t2, settings());
  assert.deepEqual(c2.incomplete, ['logistics']);
  assert.equal(c2.comparable, true);
  assert.equal(calc.compareSchemes(input(), fixture(), settings()).comparable, true);
});

test('логистика вписана частично: только фикс или только за грамм — считается, второе поле = 0 с подсказкой', () => {
  const t = fixture();
  t.logistics.push(
    { id: 'fixonly', name: 'Только фикс', fixed: { value: 50, unit: 'RUB' }, perGram: { value: null }, bands: [] },
    { id: 'gramonly', name: 'Только грамм', fixed: { value: null }, perGram: { value: 0.02 }, bands: [] },
  );
  const fx = calc.computeUnit(input({ logistics: 'fixonly' }), 'A', t, settings());
  near(line(fx, 'logistics').cny, 4); // 50 ₽ / 12,5
  assert.ok(!fx.incomplete.includes('logistics'), 'фикс задан — логистика не «нет данных»');
  assert.match(line(fx, 'logistics').hint, /цена за грамм не указана — считается 0/);
  const gr = calc.computeUnit(input({ logistics: 'gramonly' }), 'A', t, settings());
  near(line(gr, 'logistics').cny, 4); // 0,02 × 200 г
  assert.ok(!gr.incomplete.includes('logistics'));
  assert.match(line(gr, 'logistics').hint, /фикс не указан — считается 0/);
  const none = calc.computeUnit(input({ logistics: 'nodata' }), 'A', t, settings());
  assert.ok(none.incomplete.includes('logistics'), 'оба поля пусты — как раньше');
  near(line(none, 'logistics').cny, 0);
  assert.equal(line(calc.computeUnit(input(), 'A', t, settings()), 'logistics').hint, undefined, 'оба заданы — без подсказки');
});
