// Общие данные без взаимного затирания: api.update (чтение с версией → правка → запись с If-Match, повтор на 409)
// и операции экранов над свежими данными — товары, настройки, тарифы (истории 16–18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../web/js/api.js';

/** Подставной сервер: хранит данные и версию, отвечает как app/server.py. */
function fakeServer(initial, { conflicts = 0 } = {}) {
  const srv = { value: initial, version: 1, puts: [], conflictsLeft: conflicts };
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
  srv.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (method === 'GET') return json(srv.value, 200, { ETag: `"v${srv.version}"` });
    const ifMatch = opts.headers?.['If-Match'];
    srv.puts.push({ ifMatch, body: JSON.parse(opts.body) });
    if (srv.conflictsLeft > 0) { // кто-то записал между нашим чтением и записью
      srv.conflictsLeft -= 1;
      srv.version += 1;
      if (srv.onConflict) srv.value = srv.onConflict(srv.value);
    }
    if (ifMatch !== undefined && ifMatch !== `"v${srv.version}"`) return json({ error: 'Данные изменились — обновите' }, 409);
    srv.value = JSON.parse(opts.body);
    srv.version += 1;
    return json({ ok: true });
  };
  return srv;
}

function withFetch(srv, fn) {
  const old = globalThis.fetch;
  globalThis.fetch = srv.fetch;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = old; });
}

test('api.update: читает с версией, пишет результат fn с If-Match и возвращает новое значение', () => {
  const srv = fakeServer([{ id: 'a' }]);
  return withFetch(srv, async () => {
    const seen = [];
    const out = await api.update('products', (cur) => { seen.push(cur); return [...cur, { id: 'b' }]; });
    assert.deepEqual(out, [{ id: 'a' }, { id: 'b' }]);
    assert.deepEqual(seen, [[{ id: 'a' }]]);
    assert.equal(srv.puts.length, 1);
    assert.equal(srv.puts[0].ifMatch, '"v1"');
    assert.deepEqual(srv.value, [{ id: 'a' }, { id: 'b' }]);
  });
});

test('api.update: на 409 перечитывает свежие данные и применяет fn заново — чужое не затирается', () => {
  const srv = fakeServer([{ id: 'a' }], { conflicts: 1 });
  srv.onConflict = (v) => [...v, { id: 'чужой' }];
  return withFetch(srv, async () => {
    const out = await api.update('products', (cur) => [...cur, { id: 'мой' }]);
    assert.deepEqual(out, [{ id: 'a' }, { id: 'чужой' }, { id: 'мой' }]);
    assert.deepEqual(srv.value, out);
    assert.equal(srv.puts.length, 2);
  });
});

test('api.update: после 3 конфликтов подряд — ApiError 409 с понятным текстом, данные не тронуты нами', () => {
  const srv = fakeServer({ rate: 1 }, { conflicts: 99 });
  return withFetch(srv, async () => {
    await assert.rejects(api.update('settings', (cur) => ({ ...cur, rate: 2 })), (e) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 409);
      assert.equal(e.message, 'Данные одновременно меняет кто-то ещё — попробуйте ещё раз');
      return true;
    });
    assert.equal(srv.puts.length, 3);
    assert.deepEqual(srv.value, { rate: 1 });
  });
});

test('api.update: другая ошибка сервера не повторяется и пробрасывается как есть', () => {
  const srv = fakeServer(null);
  const base = srv.fetch;
  srv.fetch = async (url, opts = {}) => (opts.method === 'PUT'
    ? new Response(JSON.stringify({ error: 'Данные заняты — попробуйте ещё раз' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    : base(url, opts));
  return withFetch(srv, async () => {
    await assert.rejects(api.update('settings', () => ({})), (e) => e.status === 503 && /заняты/.test(e.message));
  });
});

// ---------- операции экранов над свежими данными ----------
import { upsertProduct, deleteProduct } from '../web/js/views/products.js';
import { applySettingsPatch, saveSettingsPatch, setTariffLeaf, resetTariffLeaf, addTariffCategory, removeTariffCategory } from '../web/js/shared.js';

test('товары: удаление моего не трогает добавленный в это время чужой; правка одной записи не трогает другие', () => {
  const fresh = [{ id: 'x', name: 'X' }, { id: 'чужой', name: 'добавил коллега' }];
  assert.deepEqual(deleteProduct(fresh, 'x'), [{ id: 'чужой', name: 'добавил коллега' }]);
  assert.deepEqual(fresh.length, 2, 'исходный список не меняется');
  assert.deepEqual(deleteProduct(null, 'x'), []);
  const edited = upsertProduct([{ id: 'x', name: 'X', createdAt: 't0' }, { id: 'y', name: 'Y' }], { id: 'x', name: 'X2' }, 't1');
  assert.deepEqual(edited, [{ id: 'x', name: 'X2', createdAt: 't0', updatedAt: 't1' }, { id: 'y', name: 'Y' }]);
});

test('настройки: патч сливается со свежими полями, undefined удаляет поле', () => {
  const fresh = { rate: 12, registrationDate: '2026-05-01', defaultScheme: 'B' };
  assert.deepEqual(applySettingsPatch(fresh, { defaultScheme: 'C', registrationDate: undefined }), { rate: 12, defaultScheme: 'C' });
  assert.deepEqual(fresh.defaultScheme, 'B', 'исходный объект не меняется');
  assert.deepEqual(applySettingsPatch(null, { rate: 13 }), { rate: 13 });
});

test('saveSettingsPatch пишет через api.update поверх чужого поля и возвращает записанное', () => {
  const srv = fakeServer({ rate: 12 }, { conflicts: 1 });
  srv.onConflict = (v) => ({ ...v, registrationDate: '2026-05-01' });
  return withFetch(srv, async () => {
    const out = await saveSettingsPatch({ taxMode: 'regular' });
    assert.deepEqual(out, { rate: 12, registrationDate: '2026-05-01', taxMode: 'regular' });
    assert.deepEqual(srv.value, out);
    assert.ok(srv.puts.every((p) => p.ifMatch), 'запись только с If-Match');
  });
});

test('тарифы: установка и сброс листа по пути не трогают чужие правки; edited — дата правки', () => {
  const fresh = { edited: '2026-09-01', fees: { acquiring: { value: 0.02, own: true } }, categories: [{ id: 'home', rfbs: { value: 0.1 } }] };
  const leaf = { value: 0.15, source: 'моя правка (из кабинета)', checked: '2026-10-02' };
  const set = setTariffLeaf(fresh, ['categories', { id: 'home' }, 'fbp'], leaf, '2026-10-02');
  assert.deepEqual(set, { edited: '2026-10-02', fees: { acquiring: { value: 0.02, own: true } }, categories: [{ id: 'home', rfbs: { value: 0.1 }, fbp: leaf }] });
  assert.equal(fresh.categories[0].fbp, undefined, 'исходный объект не меняется');
  const added = setTariffLeaf({}, ['logistics', { id: 'air' }, 'fixed'], { value: 3 }, '2026-10-02');
  assert.deepEqual(added, { edited: '2026-10-02', logistics: [{ id: 'air', fixed: { value: 3 } }] });
  const reset = resetTariffLeaf(set, ['categories', { id: 'home' }, 'rfbs'], '2026-10-03');
  assert.deepEqual(reset.categories, [{ id: 'home', fbp: leaf }]);
  assert.deepEqual(reset.fees, fresh.fees);
  const resetAll = resetTariffLeaf(reset, ['categories', { id: 'home' }, 'fbp'], '2026-10-03');
  assert.equal(resetAll.categories, undefined, 'пустые контейнеры убираются');
  assert.equal(resetAll.edited, '2026-10-03');
});

test('тарифы: своя категория добавляется и удаляется по id, остальные категории целы', () => {
  const fresh = { categories: [{ id: 'home', rfbs: { value: 0.1 } }, { id: 'my-a', name: 'Чужая', custom: true }] };
  const added = addTariffCategory(fresh, { id: 'my-b', name: 'Моя', custom: true }, '2026-10-02');
  assert.deepEqual(added.categories.map((c) => c.id), ['home', 'my-a', 'my-b']);
  assert.equal(added.edited, '2026-10-02');
  const removed = removeTariffCategory(added, 'my-a', '2026-10-03');
  assert.deepEqual(removed.categories.map((c) => c.id), ['home', 'my-b']);
  assert.deepEqual(removeTariffCategory({ categories: [{ id: 'my-a' }] }, 'my-a', 'd'), { edited: 'd' });
  assert.deepEqual(addTariffCategory(null, { id: 'my-c' }, 'd'), { edited: 'd', categories: [{ id: 'my-c' }] });
});
