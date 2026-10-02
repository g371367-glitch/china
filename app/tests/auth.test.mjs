// Клиент для сайта коллег: 401 → страница входа, выход, /api/team; update без ETag — ошибка, а не запись вслепую.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../web/js/api.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

/** Подменяет fetch и location на время теста; calls — [{url, method}], went — куда переходили. */
function withBrowser(handler, fn) {
  const old = { fetch: globalThis.fetch, location: globalThis.location };
  const calls = [];
  const went = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    return handler(url, opts);
  };
  globalThis.location = { pathname: '/', assign: (u) => went.push(u), replace: (u) => went.push(u) };
  return Promise.resolve().then(() => fn(calls, went)).finally(() => {
    globalThis.fetch = old.fetch;
    if (old.location === undefined) delete globalThis.location; else globalThis.location = old.location;
  });
}

test('любой 401 от API → переход на /login и ApiError 401', () => withBrowser(
  () => json({ error: 'Нужно войти' }, 401),
  async (calls, went) => {
    await assert.rejects(api.docs(), (e) => e instanceof ApiError && e.status === 401);
    await assert.rejects(api.saveData('settings', {}), (e) => e instanceof ApiError && e.status === 401);
    assert.deepEqual(went, ['/login', '/login']);
  },
));

test('другие ошибки на /login не уводят', () => withBrowser(
  () => json({ error: 'Нет таких данных' }, 404),
  async (calls, went) => {
    await assert.rejects(api.data('nope'), (e) => e.status === 404 && e.message === 'Нет таких данных');
    assert.deepEqual(went, []);
  },
));

test('api.logout(): POST /api/logout и переход на страницу входа', () => withBrowser(
  () => json({ ok: true }),
  async (calls, went) => {
    await api.logout();
    assert.deepEqual(calls.map((c) => [c.url, c.method]), [['/api/logout', 'POST']]);
    assert.deepEqual(went, ['/login']);
  },
));

test('api.team(): GET /api/team → {active, url?}', () => withBrowser(
  () => json({ active: true, url: 'https://abc.trycloudflare.com' }),
  async (calls) => {
    assert.deepEqual(await api.team(), { active: true, url: 'https://abc.trycloudflare.com' });
    assert.equal(calls[0].url, '/api/team');
  },
));

test('api.update: ответ без ETag → ApiError по-русски, запись не делается', () => withBrowser(
  (url, opts = {}) => ((opts.method || 'GET') === 'GET' ? json([{ id: 'a' }]) : json({ ok: true })),
  async (calls) => {
    await assert.rejects(
      api.update('products', (cur) => [...cur, { id: 'b' }]),
      (e) => e instanceof ApiError && /верси/i.test(e.message),
    );
    assert.deepEqual(calls.map((c) => c.method), ['GET']);
  },
));
