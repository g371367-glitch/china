// Общий помощник для HTTP API сервера (app/server.py).
// Используют все экраны: заметки, поиск, калькулятор, тарифы, список товаров.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function handle(res) {
  const type = res.headers.get('Content-Type') || '';
  const body = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = body && typeof body === 'object' && body.error ? body.error : `Ошибка сервера (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body;
}

async function send(path, options) {
  try {
    return await fetch('/api/' + path.replace(/^\/+/, ''), { cache: 'no-store', ...options });
  } catch {
    throw new ApiError('Нет связи с сайтом — запущен ли «Запустить.bat»?', 0);
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
    const next = await fn(current);
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (etag) headers['If-Match'] = etag;
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
};

export default api;
