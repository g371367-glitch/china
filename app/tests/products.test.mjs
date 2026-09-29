// Список товаров: чистые функции экрана — выгрузка CSV для русского Excel и обновление записи без дубля.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, upsertProduct } from '../web/js/views/products.js';

const row = (o = {}) => ({
  name: 'Органайзер', link1688: 'https://detail.1688.com/offer/1.html', note: '', scheme: 'A',
  price: 100, cost: 61.2, profit: 38.8, margin: 0.388, roi: 1.1, incomplete: [], updatedAt: '2026-09-29', ...o,
});

test('CSV: BOM, «;», десятичная запятая, русские заголовки, CRLF', () => {
  const csv = toCsv([row()], { rate: 12.5 });
  assert.equal(csv.charCodeAt(0), 0xfeff, 'первый символ — BOM');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'Название;Ссылка на 1688;Заметка;Схема;Цена, ¥;Цена, ₽;Расходы, ¥;Прибыль, ¥;Прибыль, ₽;Маржа, %;ROI, %;Расчёт;Обновлено');
  assert.equal(lines[1], 'Органайзер;https://detail.1688.com/offer/1.html;;A;100,00;1250,00;61,20;38,80;485,00;38,8;110,0;полный;2026-09-29');
});

test('CSV: «;», кавычки и перенос строки в ссылке/заметке экранируются', () => {
  const csv = toCsv([row({ name: 'Коврик "Дом"', link1688: 'https://x.cn/?a=1;b=2', note: 'строка 1\nстрока 2' })], { rate: 12.5 });
  const body = csv.slice(1).split('\r\n').slice(1).join('\r\n');
  assert.ok(body.startsWith('"Коврик ""Дом""";"https://x.cn/?a=1;b=2";"строка 1\nстрока 2";A;'), body);
});

test('CSV: неполный расчёт помечен, без курса рублёвые колонки пустые', () => {
  const csv = toCsv([row({ incomplete: ['logistics'] })], { rate: 0 });
  const cells = csv.slice(1).split('\r\n')[1].split(';');
  assert.equal(cells[5], '', 'Цена, ₽');
  assert.equal(cells[8], '', 'Прибыль, ₽');
  assert.equal(cells[11], 'неполный: нет данных по логистике');
});

test('upsertProduct: новый — добавляется, с тем же id — обновляется на месте, createdAt сохраняется', () => {
  const a = { id: 'p1', name: 'A', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z' };
  const b = { id: 'p2', name: 'B', createdAt: '2026-09-02T10:00:00Z', updatedAt: '2026-09-02T10:00:00Z' };
  const list = upsertProduct([a, b], { id: 'p1', name: 'A2', createdAt: 'не важно' }, '2026-09-29T12:00:00Z');
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { id: 'p1', name: 'A2', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-29T12:00:00Z' });
  const added = upsertProduct(list, { name: 'C' }, '2026-09-29T13:00:00Z');
  assert.equal(added.length, 3);
  assert.ok(added[2].id && !['p1', 'p2'].includes(added[2].id), 'новый id');
  assert.equal(added[2].createdAt, '2026-09-29T13:00:00Z');
  assert.equal(added[2].updatedAt, '2026-09-29T13:00:00Z');
});
