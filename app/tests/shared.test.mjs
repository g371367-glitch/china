// Общее для экранов в одном месте: shared.js (словари, умолчания, разбор чисел) и calc.defaultLogistics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, SCHEMES, withSettingsDefaults } from '../web/js/shared.js';
import { computeRow } from '../web/js/views/products.js';
import { computeUnit, defaultLogistics } from '../web/js/calc.js';
import { fixture, settings, input } from './calc.fixture.mjs';

test('логистика по умолчанию: самая дешёвая из известных, иначе первая — и список товаров берёт её же', () => {
  const t = fixture();
  // flat: 3 + 0,05×200 = 13 ¥; rub: (60 + 0,5×200) ₽ / 12,5 = 12,8 ¥; banded: 2 + 0,04×200 = 10 ¥; pricebanded (цена 100): 4 + 0,01×200 = 6 ¥
  assert.equal(defaultLogistics(input({ logistics: '' }), t, settings()).id, 'pricebanded');
  const row = computeRow({ name: 'x', input: input({ logistics: '' }) }, 'A', t, settings());
  const direct = computeUnit(input({ logistics: 'pricebanded' }), 'A', t, settings());
  assert.equal(row.cost, direct.cost, 'список товаров считает по той же логистике');
  for (const l of t.logistics) { l.fixed = { value: null }; l.perGram = { value: null }; l.bands = []; }
  const none = defaultLogistics(input({ logistics: '' }), t, settings());
  assert.equal(none.id, 'flat', 'нет данных ни по одному — первая');
  assert.equal(none.known, false);
});

test('разбор числа из поля: запятая, пробелы, пусто, мусор', () => {
  assert.deepEqual(parseNum(' 1 234,5 '), { n: 1234.5 });
  assert.deepEqual(parseNum(''), { empty: true });
  assert.deepEqual(parseNum('12a'), { bad: true });
});

test('умолчания settings и перечень схем', () => {
  assert.deepEqual(SCHEMES, ['A', 'B', 'C', 'D']);
  assert.deepEqual(withSettingsDefaults({ rate: 12 }), { conversionReserve: 0, taxMode: 'simplified', rate: 12 });
  assert.deepEqual(withSettingsDefaults(null), { conversionReserve: 0, taxMode: 'simplified' });
});
