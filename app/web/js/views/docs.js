// Экраны базы знаний: главная (пока — список разделов) и чтение заметки.
// marked подключён в index.html обычным <script> из vendor/ и доступен как window.marked.

import { api } from '../api.js';
import { escapeHtml, docHash, folderLabel, groupDocs } from '../app.js';

// ---------- главная ----------

export function renderHome(el, { docs }) {
  el.innerHTML = `
    <h1>База знаний по торговле</h1>
    <p class="muted">Заметки из папок проекта. Новая .md-заметка появится здесь после обновления страницы (F5).</p>
    <div class="cards">
      ${groupDocs(docs).map(({ folder, docs: list }) => `
        <section class="card">
          <h2>${escapeHtml(folderLabel(folder))}</h2>
          <ul>${list.map((d) => `<li><a href="${docHash(d.path)}">${escapeHtml(d.title)}</a></li>`).join('')}</ul>
        </section>`).join('')}
    </div>`;
}

// ---------- заметка ----------

/** Слаг заголовка в духе GitHub: строчные, буквы/цифры/пробел/дефис, пробел → «-». */
export function slugify(text) {
  return String(text).toLowerCase().trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Разрешает относительный путь ссылки от папки текущей заметки. null — вышли за корень. */
export function resolvePath(fromFolder, href) {
  const out = fromFolder ? fromFolder.split('/') : [];
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function renderMarkdown(text) {
  const md = window.marked;
  if (!md) return `<pre>${escapeHtml(text)}</pre>`;
  const seen = new Map();
  const renderer = new md.Renderer();
  renderer.heading = (html, level, raw) => {
    let id = slugify(raw);
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    if (n) id += '-' + n;
    return `<h${level} id="${escapeHtml(id)}">${html}</h${level}>\n`;
  };
  return md.parse(text, { gfm: true, renderer });
}

function scrollToAnchor(root, anchor) {
  const id = safeDecode(anchor);
  const target = root.querySelector(`[id="${CSS.escape(id)}"]`) || root.querySelector(`[id="${CSS.escape(slugify(id))}"]`);
  if (target) target.scrollIntoView({ block: 'start' });
  return !!target;
}

function fixLinks(root, docPath) {
  const folder = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {  // внешние: http, mailto…
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return;
    }
    if (href.startsWith('#')) {  // якорь внутри заметки — без смены маршрута
      a.addEventListener('click', (e) => {
        e.preventDefault();
        scrollToAnchor(root, href.slice(1));
      });
      return;
    }
    const hashAt = href.indexOf('#');
    const file = safeDecode(hashAt < 0 ? href : href.slice(0, hashAt));
    const anchor = hashAt < 0 ? '' : href.slice(hashAt + 1);
    const target = resolvePath(folder, file.split('?')[0]);
    if (target && target.toLowerCase().endsWith('.md')) {
      a.setAttribute('href', docHash(target, anchor ? { a: safeDecode(anchor) } : null));
    } else {
      a.classList.add('dead-link');
      a.title = 'Этот файл сайт не показывает';
      a.addEventListener('click', (e) => e.preventDefault());
    }
  });
}

function wrapTables(root) {
  root.querySelectorAll('table').forEach((t) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.replaceWith(wrap);
    wrap.appendChild(t);
  });
}

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

/** Подсвечивает все вхождения q в тексте заметки; возвращает первый <mark>. */
export function markMatches(root, q) {
  const needle = norm(q.trim());
  if (needle.length < 2) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let first = null;
  for (const node of nodes) {
    const text = node.nodeValue;
    const low = norm(text);  // та же длина: toLowerCase/ё→е не меняют длину для кириллицы и латиницы
    let idx = low.indexOf(needle);
    if (idx < 0) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    while (idx >= 0) {
      frag.append(text.slice(pos, idx));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.append(mark);
      first ??= mark;
      pos = idx + needle.length;
      idx = low.indexOf(needle, pos);
    }
    frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
  return first;
}

export async function renderDoc(el, { params, query, docs }) {
  const path = params.rest;
  let text;
  try {
    text = await api.doc(path);
  } catch (e) {
    if (e.status === 404) {
      el.innerHTML = `<h1>Заметка не найдена</h1><p class="muted">${escapeHtml(path)}</p><p><a href="#/">На главную</a></p>`;
      return;
    }
    throw e;
  }
  const meta = docs.find((d) => d.path === path);
  if (meta) document.title = `${meta.title} — База знаний`;
  const folder = meta ? meta.folder : path.split('/').slice(0, -1).join('/');

  el.innerHTML = `
    <nav class="crumbs"><a href="#/">Главная</a> › ${escapeHtml(folderLabel(folder))}</nav>
    <article class="markdown">${renderMarkdown(text)}</article>`;
  const article = el.querySelector('article');
  wrapTables(article);
  fixLinks(article, path);

  const q = query.get('q');
  const anchor = query.get('a');
  if (q) {
    const first = markMatches(article, q);
    if (first) first.scrollIntoView({ block: 'center' });
  } else if (anchor) {
    scrollToAnchor(article, anchor);
  }
}
