// Открытая копия на GitHub Pages: static.js отвечает на запросы /api/* без сервера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaticBackend, searchNotes, parseRate, etagOf, STORAGE_PREFIX } from '../web/js/static.js';

const NOTES = {
  docs: [
    { path: 'README.md', title: 'Оглавление', folder: '' },
    { path: 'Азия/Китай/02_Налоги.md', title: 'Налоги', folder: 'Азия/Китай' },
  ],
  texts: {
    'README.md': '# Оглавление\nСм. налоги.',
    'Азия/Китай/02_Налоги.md': '# Налоги\nНДС в Китае\nЁлка и ещё ЕЛКА',
  },
};
const CBR = { Date: '2026-10-03T11:30:00+03:00', Valute: { CNY: { Nominal: 1, Value: 11.1234 }, EUR: { Nominal: 1, Value: 95.5 } } };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

function setup({ rateFails = false, files = {} } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === 'static/notes.json') return Response.json(NOTES);
    if (url.startsWith('https://www.cbr-xml-daily.ru/')) {
      if (rateFails) throw new Error('offline');
      return Response.json(CBR);
    }
    if (url in files) return Response.json(files[url]);
    return new Response('нет', { status: 404 });
  };
  const storage = memoryStorage();
  return { backend: createStaticBackend({ fetch, storage }), storage, calls };
}

test('ping сообщает об открытой копии, team — 404', async () => {
  const { backend } = setup();
  assert.deepEqual(await (await backend('ping')).json(), { app: 'trade-kb', version: 'static', team: false, static: true });
  assert.equal((await backend('team')).status, 404);
});

test('docs и doc берутся из notes.json, он грузится один раз', async () => {
  const { backend, calls } = setup();
  assert.deepEqual(await (await backend('docs')).json(), NOTES.docs);
  const r = await backend('doc?path=' + encodeURIComponent('Азия/Китай/02_Налоги.md'));
  assert.equal(r.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  assert.match(await r.text(), /НДС в Китае/);
  assert.equal((await backend('doc?path=' + encodeURIComponent('нет.md'))).status, 404);
  assert.equal(calls.filter((u) => u === 'static/notes.json').length, 1);
});

test('поиск как на сервере: без регистра, ё=е, номер строки, от 2 символов', async () => {
  assert.deepEqual(searchNotes(NOTES, 'елка'), [
    { path: 'Азия/Китай/02_Налоги.md', title: 'Налоги', hits: [{ line: 3, snippet: 'Ёлка и ещё ЕЛКА' }] },
  ]);
  assert.deepEqual(searchNotes(NOTES, 'н'), []);
  const { backend } = setup();
  const found = await (await backend('search?q=' + encodeURIComponent('налог'))).json();
  assert.deepEqual(found.map((r) => r.path), ['README.md', 'Азия/Китай/02_Налоги.md']);
});

test('длинная строка обрезается вокруг совпадения с многоточиями', () => {
  const line = 'а'.repeat(300) + 'цель' + 'б'.repeat(300);
  const [{ hits: [h] }] = searchNotes({ docs: [{ path: 'x.md', title: 'x' }], texts: { 'x.md': line } }, 'цель');
  assert.ok(h.snippet.startsWith('…') && h.snippet.endsWith('…') && h.snippet.includes('цель'));
  assert.equal(h.snippet.length, 162);
});

test('данные пользователя: нет → null и "none", запись с версией, 409 на устаревшей', async () => {
  const { backend, storage } = setup();
  const r0 = await backend('data/settings');
  assert.equal(await r0.json(), null);
  assert.equal(r0.headers.get('ETag'), '"none"');

  const put = (body, etag) => backend('data/settings', { method: 'PUT', headers: { 'If-Match': etag }, body: JSON.stringify(body) });
  assert.equal((await put({ rate: 11 }, '"none"')).status, 200);
  assert.equal(storage.map.get(STORAGE_PREFIX + 'settings'), '{"rate":11}');

  const r1 = await backend('data/settings');
  assert.deepEqual(await r1.json(), { rate: 11 });
  assert.equal(r1.headers.get('ETag'), etagOf('{"rate":11}'));
  assert.equal((await put({ rate: 12 }, '"none"')).status, 409);
  assert.equal((await put({ rate: 12 }, r1.headers.get('ETag'))).status, 200);
});

test('исходные тарифы и календарь — из static/data, писать туда нельзя', async () => {
  const { backend } = setup({ files: { 'static/data/calendar.json': { version: 1, events: [] } } });
  assert.deepEqual(await (await backend('data/calendar')).json(), { version: 1, events: [] });
  assert.equal(await (await backend('data/tariffs.default')).json(), null);
  assert.equal((await backend('data/calendar', { method: 'PUT', body: '{}' })).status, 404);
  assert.equal((await backend('data/access')).status, 404);
});

test('курс ЦБ напрямую; нет связи → 502 с понятной ошибкой', async () => {
  assert.deepEqual(parseRate(CBR), { rate: 11.1234, eurRate: 95.5, date: '2026-10-03', source: 'cbr' });
  assert.deepEqual(await (await setup().backend('rate')).json(), parseRate(CBR));
  const r = await setup({ rateFails: true }).backend('rate');
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /^Нет связи с ЦБ/);
});

test('etagOf различает содержимое', () => {
  assert.equal(etagOf(null), '"none"');
  assert.notEqual(etagOf('{"a":1}'), etagOf('{"a":2}'));
  assert.match(etagOf('[]'), /^"[0-9a-f]{16}"$/);
});
