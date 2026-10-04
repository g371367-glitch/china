// Открытая копия сайта (GitHub Pages): сервера нет, поэтому те же запросы /api/*, что обслуживает
// app/server.py, отвечаются здесь. Заметки — из static/notes.json (собирает app/build_site.py),
// товары/тарифы/настройки — в хранилище браузера, курс ЦБ — напрямую (сервис разрешает CORS).
// Без DOM: в тестах подставляются fetch и storage.

export const STATIC_DIR = 'static/';
export const RATE_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
export const STORAGE_PREFIX = 'trade-kb:';
const APP_NAME = 'trade-kb';
const LOCAL_DATA = new Set(['products', 'tariffs', 'settings']);
const FILE_DATA = new Set(['tariffs.default', 'calendar']);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Хранилище браузера; недоступно (приватный режим, запрет) → память вкладки. */
export function browserStorage() {
  const memory = new Map();
  let ls = null;
  try { ls = globalThis.localStorage; ls.getItem('x'); } catch { ls = null; }
  return {
    getItem(k) {
      try { if (ls) return ls.getItem(k); } catch { /* в память */ }
      return memory.has(k) ? memory.get(k) : null;
    },
    setItem(k, v) {
      try { if (ls) { ls.setItem(k, v); return; } } catch { /* в память */ }
      memory.set(k, v);
    },
  };
}

/** Версия сохранённого текста, как ETag сервера: нет данных → "none". */
export function etagOf(raw) {
  if (raw == null) return '"none"';
  let h = 0x811c9dc5;  // FNV-1a 32 бита
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 0x01000193);
  return `"${(h >>> 0).toString(16).padStart(8, '0')}${raw.length.toString(16).padStart(8, '0')}"`;
}

const norm = (s) => s.toLowerCase().replaceAll('ё', 'е');

/** Как server.search: [{path, title, hits:[{line, snippet}]}], без регистра, ё=е, от 2 символов. */
export function searchNotes(notes, query, maxHits = 3, width = 160) {
  const needle = norm(query.trim());
  if (needle.length < 2) return [];
  const results = [];
  for (const doc of notes.docs) {
    const lines = (notes.texts[doc.path] || '').split(/\r\n|\r|\n/);
    const hits = [];
    for (let no = 0; no < lines.length && hits.length < maxHits; no++) {
      const line = lines[no];
      const pos = norm(line).indexOf(needle);
      if (pos < 0) continue;
      let start = Math.max(0, pos - Math.floor(width / 2));
      const end = Math.min(line.length, start + width);
      start = Math.max(0, end - width);
      hits.push({ line: no + 1, snippet: (start ? '…' : '') + line.slice(start, end).trim() + (end < line.length ? '…' : '') });
    }
    if (hits.length) results.push({ path: doc.path, title: doc.title, hits });
  }
  return results;
}

/** Ответ ЦБ → {rate, eurRate?, date, source:'cbr'} (как server.fetch_rate). */
export function parseRate(data) {
  const cny = data.Valute.CNY;
  const out = { rate: Math.round((cny.Value / cny.Nominal) * 1e4) / 1e4, date: String(data.Date || '').slice(0, 10), source: 'cbr' };
  const eur = data.Valute.EUR;
  if (eur && eur.Value > 0 && eur.Nominal > 0) out.eurRate = Math.round((eur.Value / eur.Nominal) * 1e4) / 1e4;
  return out;
}

/**
 * → async (path, options) => Response — подмена fetch('/api/' + path).
 * fetch берётся в момент запроса (тесты подменяют globalThis.fetch).
 */
export function createStaticBackend({ fetch: fetchFn, storage = browserStorage(), dir = STATIC_DIR, rateUrl = RATE_URL } = {}) {
  const get = (url) => (fetchFn || globalThis.fetch)(url, { cache: 'no-cache' });
  let notesPromise = null;
  const notes = () => {
    if (!notesPromise) {
      notesPromise = get(dir + 'notes.json').then((r) => {
        if (!r.ok) throw new Error(`notes.json: ${r.status}`);
        return r.json();
      });
      notesPromise.catch(() => { notesPromise = null; });  // повторить при следующем запросе
    }
    return notesPromise;
  };

  return async function backend(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const url = new URL(path, 'http://static/');
    const route = url.pathname.slice(1);
    const q = url.searchParams;

    if (method === 'GET') {
      if (route === 'ping') return json({ app: APP_NAME, version: 'static', team: false, static: true });
      if (route === 'docs') return json((await notes()).docs);
      if (route === 'doc') {
        const text = (await notes()).texts[q.get('path') || ''];
        if (text == null) return json({ error: 'Заметка не найдена' }, 404);
        return new Response(text, { status: 200, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
      }
      if (route === 'search') return json(searchNotes(await notes(), q.get('q') || ''));
      if (route === 'rate') {
        try {
          const r = await get(rateUrl);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return json(parseRate(await r.json()));
        } catch (e) {
          return json({ error: `Нет связи с ЦБ: ${e.message}` }, 502);
        }
      }
    }

    if (route.startsWith('data/')) {
      const name = route.slice(5);
      if (method === 'GET' && FILE_DATA.has(name)) {
        const r = await get(`${dir}data/${name}.json`);
        if (r.status === 404) return json(null, 200, { ETag: '"none"' });
        if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
        return json(await r.json(), 200, { ETag: '"static"' });
      }
      if (!LOCAL_DATA.has(name)) return json({ error: method === 'GET' ? 'Нет таких данных' : 'Запись сюда запрещена' }, 404);
      const key = STORAGE_PREFIX + name;
      const raw = storage.getItem(key);
      if (method === 'GET') {
        let value = null;
        try { value = raw == null ? null : JSON.parse(raw); } catch {
          return json({ error: `Данные «${name}» в браузере повреждены` }, 500);
        }
        return json(value, 200, { ETag: etagOf(raw) });
      }
      if (method === 'PUT') {
        const ifMatch = options.headers?.['If-Match'];
        if (ifMatch !== undefined && ifMatch !== etagOf(raw)) return json({ error: 'Данные изменились — обновите' }, 409);
        try { JSON.parse(options.body); } catch { return json({ error: 'Тело запроса — не JSON' }, 400); }
        storage.setItem(key, options.body);
        return json({ ok: true });
      }
    }

    return json({ error: 'Не найдено' }, 404);  // в т.ч. /api/team: блока «Доступ для коллег» здесь нет
  };
}
