// Оболочка сайта: реестр маршрутов, меню, роутер по hash.
//
// Новый раздел = одна запись в ROUTES ниже + модуль экрана в js/views/.
// Модуль экрана экспортирует функцию render(el, ctx):
//   el  — контейнер <main>, экран заполняет его сам;
//   ctx — { params: {...из шаблона}, query: URLSearchParams, docs: [{path,title,folder}], navigate(hash) }.
// Пункты с `menu` попадают в верхнюю часть бокового меню в порядке записи.

import { api } from './api.js';

const stub = (title) => () => (el) => {
  el.innerHTML = `<h1>${escapeHtml(title)}</h1><p class="muted">Раздел в разработке.</p>`;
};

export const ROUTES = [
  { path: '',          menu: 'Главная',     title: 'База знаний',   view: () => import('./views/home.js').then((m) => m.render) },
  { path: 'doc/*',                          title: 'Заметка',       view: () => import('./views/docs.js').then((m) => m.renderDoc) },
  { path: 'search',                         title: 'Поиск',         view: () => import('./views/search.js').then((m) => m.renderSearch) },
  { path: 'calc',      menu: 'Калькулятор', title: 'Калькулятор',   view: () => import('./views/calc.js').then((m) => m.render) },
  { path: 'products',  menu: 'Мои товары',  title: 'Мои товары',    view: () => import('./views/products.js').then((m) => m.render) },
  { path: 'tariffs',   menu: 'Тарифы',      title: 'Тарифы',        view: () => import('./views/tariffs.js').then((m) => m.render) },
  // alias — только пункт меню, ведущий на другой маршрут; для заметки показывается, если она есть.
  { path: 'doc/Журнал_изменений.md', menu: 'Что изменилось', alias: true },
];

// ---------- утилиты, общие для экранов ----------

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Хэш для заметки: #/doc/<путь> (каждый сегмент кодируется, «/» сохраняется). */
export function docHash(path, query) {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  return '#/doc/' + enc + qs;
}

export function folderLabel(folder) {
  return folder ? folder.replace(/_/g, ' ').replace(/\//g, ' / ') : 'Общее';
}

/** Группировка заметок по папкам: [{folder, docs}] — корень первым. */
export function groupDocs(docs) {
  const map = new Map();
  for (const d of docs) {
    if (!map.has(d.folder)) map.set(d.folder, []);
    map.get(d.folder).push(d);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'ru')))
    .map(([folder, list]) => ({ folder, docs: list }));
}

// ---------- роутер ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const qi = raw.indexOf('?');
  const pathPart = qi < 0 ? raw : raw.slice(0, qi);
  const query = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1));
  let path;
  try { path = decodeURIComponent(pathPart); } catch { path = pathPart; }
  return { path, query };
}

function match(path) {
  for (const r of ROUTES) {
    if (r.alias) continue;
    if (r.path.endsWith('/*')) {
      const prefix = r.path.slice(0, -1);
      if (path.startsWith(prefix)) return { route: r, params: { rest: path.slice(prefix.length) } };
    } else if (r.path === path) {
      return { route: r, params: {} };
    }
  }
  return null;
}

let docsCache = null;
async function loadDocs() {
  if (!docsCache) docsCache = api.docs().catch((e) => { docsCache = null; throw e; });
  return docsCache;
}

const main = () => document.getElementById('main');

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

async function render() {
  const { path, query } = parseHash();
  const el = main();
  closeMenu();
  markActive();
  const found = match(path);
  if (!found) {
    el.innerHTML = '<h1>Страница не найдена</h1><p><a href="#/">На главную</a></p>';
    document.title = 'Не найдено — База знаний';
    return;
  }
  document.title = `${found.route.title} — База знаний`;
  el.innerHTML = '<p class="muted">Загрузка…</p>';
  try {
    const [view, docs] = await Promise.all([found.route.view(), loadDocs()]);
    el.innerHTML = '';
    await view(el, { params: found.params, query, docs, navigate });
    if (!query.get('q') && !query.get('a')) window.scrollTo(0, 0);
  } catch (e) {
    el.innerHTML = `<h1>Не получилось открыть</h1><p class="error">${escapeHtml(e.message)}</p>`;
  }
}

// ---------- меню ----------

function buildMenu(docs) {
  const nav = document.getElementById('nav-sections');
  const hasDoc = (p) => docs.some((d) => 'doc/' + d.path === p);
  nav.innerHTML = ROUTES.filter((r) => r.menu && !(r.alias && r.path.startsWith('doc/') && !hasDoc(r.path)))
    .map((r) => `<a href="#/${r.path.split('/').map(encodeURIComponent).join('/')}" data-route="${escapeHtml(r.path)}">${escapeHtml(r.menu)}</a>`)
    .join('');

  const tree = document.getElementById('nav-docs');
  tree.innerHTML = groupDocs(docs)
    .map(({ folder, docs: list }) => `
      <details open>
        <summary>${escapeHtml(folderLabel(folder))}</summary>
        ${list.map((d) => `<a href="${docHash(d.path)}" data-doc="${escapeHtml(d.path)}">${escapeHtml(d.title)}</a>`).join('')}
      </details>`)
    .join('');
  markActive();
}

function markActive() {
  const { path } = parseHash();
  document.querySelectorAll('#sidebar a').forEach((a) => {
    const on = a.dataset.doc ? path === 'doc/' + a.dataset.doc : a.dataset.route === path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function closeMenu() {
  document.body.classList.remove('menu-open');
  document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
}

function initShell() {
  const toggle = document.getElementById('menu-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('scrim').addEventListener('click', closeMenu);

  const form = document.getElementById('search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = form.q.value.trim();
    navigate('#/search?' + new URLSearchParams({ q }).toString());
  });
  window.addEventListener('hashchange', render);
}

async function start() {
  initShell();
  loadDocs().then(buildMenu).catch((e) => {
    document.getElementById('nav-docs').innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  });
  const { path, query } = parseHash();
  if (path === 'search') document.getElementById('search-form').q.value = query.get('q') || '';
  render();
}

start();
