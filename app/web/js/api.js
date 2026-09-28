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

async function request(path, options) {
  let res;
  try {
    res = await fetch('/api/' + path.replace(/^\/+/, ''), { cache: 'no-store', ...options });
  } catch {
    throw new ApiError('Нет связи с сайтом — запущен ли «Запустить.bat»?', 0);
  }
  return handle(res);
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
  /** name ∈ products, tariffs, settings */
  saveData: (name, value) => put('data/' + name, value),
  /** {rate, date, source:'cbr'}; при ошибке — ApiError со status 502 */
  rate: () => get('rate'),
};

export default api;
