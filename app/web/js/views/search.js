// Экран поиска: #/search?q=…  Поиск идёт на сервере (/api/search).

import { api } from '../api.js';
import { escapeHtml, docHash, folderLabel } from '../app.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

/** Фрагмент с подсветкой всех вхождений q (без учёта регистра, ё=е). */
function highlight(snippet, q) {
  const needle = norm(q);
  const low = norm(snippet);
  let out = '';
  let pos = 0;
  let idx = low.indexOf(needle);
  while (idx >= 0) {
    out += escapeHtml(snippet.slice(pos, idx)) + '<mark>' + escapeHtml(snippet.slice(idx, idx + needle.length)) + '</mark>';
    pos = idx + needle.length;
    idx = low.indexOf(needle, pos);
  }
  return out + escapeHtml(snippet.slice(pos));
}

export async function renderSearch(el, { query, docs }) {
  const q = (query.get('q') || '').trim();
  const input = document.getElementById('search-form')?.q;
  if (input && input.value.trim() !== q) input.value = q;

  if (q.length < 2) {
    el.innerHTML = `<h1>Поиск</h1><p class="muted">Введите в поле поиска хотя бы 2 символа — например «КИК» или «9610».</p>`;
    return;
  }
  el.innerHTML = `<h1>Поиск: «${escapeHtml(q)}»</h1><p class="muted">Ищу…</p>`;
  const results = await api.search(q);
  const folderOf = new Map(docs.map((d) => [d.path, d.folder]));

  if (!results.length) {
    el.innerHTML = `<h1>Поиск: «${escapeHtml(q)}»</h1><p>Ничего не нашлось по „${escapeHtml(q)}“.</p>`;
    return;
  }
  el.innerHTML = `
    <h1>Поиск: «${escapeHtml(q)}»</h1>
    <p class="muted">Найдено в заметках: ${results.length}</p>
    <ol class="results">
      ${results.map((r) => `
        <li>
          <a class="result-title" href="${docHash(r.path, { q })}">${escapeHtml(r.title)}</a>
          <span class="muted small">${escapeHtml(folderLabel(folderOf.get(r.path) ?? r.path.split('/').slice(0, -1).join('/')))}</span>
          ${r.hits.map((h) => `<p class="snippet"><span class="line">стр. ${h.line}</span> ${highlight(h.snippet, q)}</p>`).join('')}
        </li>`).join('')}
    </ol>`;
}
