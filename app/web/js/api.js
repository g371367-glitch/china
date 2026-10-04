// Общий помощник для HTTP API сервера (app/server.py).
// Используют все экраны: заметки, поиск, калькулятор, тарифы, список товаров.
import { createStaticBackend } from './static.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const LOGIN_PATH = '/login';
export const NO_VERSION_MESSAGE = 'Сервер не сообщил версию данных — обновите страницу и попробуйте ещё раз';

/** Сайт для коллег: вход истёк или не выполнен → на страницу входа. */
function toLogin() {
  if (typeof location !== 'undefined' && location.pathname !== LOGIN_PATH) location.assign(LOGIN_PATH);
}

async function handle(res) {
  const type = res.headers.get('Content-Type') || '';
  const body = type.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401) toLogin();
  if (!res.ok) {
    const message = body && typeof body === 'object' && body.error ? body.error : `Ошибка сервера (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body;
}

// Открытая копия на GitHub Pages (app/build_site.py ставит флаг в index.html): вместо сервера — static.js.
const staticBackend = globalThis.TRADE_KB_STATIC === true ? createStaticBackend() : null;

async function send(path, options) {
  const p = path.replace(/^\/+/, '');
  try {
    if (staticBackend) return await staticBackend(p, options);
    return await fetch('/api/' + p, { cache: 'no-store', ...options });
  } catch {
    throw new ApiError(staticBackend ? 'Не удалось загрузить данные сайта — проверьте интернет' : 'Нет связи с сайтом — запущен ли «Запустить.bat»?', 0);
  }
}

async function request(path, options) {
  return handle(await send(path, options));
}

export const CONFLICT_MESSAGE = 'Данные одновременно меняет кто-то ещё — попробуйте ещё раз';

/**
 * Правка поверх свежих данных: GET с версией (ETag) → fn(текущее) → PUT с If-Match.
 * На 409 (кто-то записал между чтением и записью) — заново, до retries попыток,
 * затем ApiError 409 CONFLICT_MESSAGE. fn может быть async; получает null, если файла нет.
 * → записанное значение.
 */
export async function update(name, fn, { retries = 3 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await send('data/' + name);
    const current = await handle(res);
    const etag = res.headers.get('ETag');
    // Без версии запись затёрла бы чужие правки молча — лучше честная ошибка.
    if (!etag) throw new ApiError(NO_VERSION_MESSAGE, res.status);
    const next = await fn(current);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'If-Match': etag };
    try {
      await request('data/' + name, { method: 'PUT', headers, body: JSON.stringify(next) });
      return next;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
    }
  }
  throw new ApiError(CONFLICT_MESSAGE, 409);
}

/** GET /api/<path> → JSON (или текст для text/markdown). Бросает ApiError. */
export function get(path) {
  return request(path);
}

/** PUT /api/<path> с JSON-телом → ответ сервера ({ok:true}). Бросает ApiError. */
export function put(path, data) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(data),
  });
}

export const api = {
  get,
  put,
  ping: () => get('ping'),
  docs: () => get('docs'),
  doc: (path) => get('doc?path=' + encodeURIComponent(path)),
  search: (q) => get('search?q=' + encodeURIComponent(q)),
  /** name ∈ products, tariffs, tariffs.default, settings, calendar; нет файла → null */
  data: (name) => get('data/' + name),
  /** name ∈ products, tariffs, settings. Перезапись целиком — экраны пишут через update. */
  saveData: (name, value) => put('data/' + name, value),
  /** name ∈ products, tariffs, settings; fn(текущее) → новое; → Promise<записанное>. Повтор на 409. */
  update,
  /** {rate, date, source:'cbr'}; при ошибке — ApiError со status 502 */
  rate: () => get('rate'),
  /** Локальный сайт: {active:true, url} | {active:false}; на сайте для коллег — ApiError 404. */
  team: () => get('team'),
  /** Сайт для коллег: выйти (cookie стирается) и перейти на страницу входа. */
  logout: async () => {
    await request('logout', { method: 'POST' });
    if (typeof location !== 'undefined') location.assign(LOGIN_PATH);
  },
};

export default api;
