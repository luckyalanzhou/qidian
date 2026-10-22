import { validateBookmarks, bookmarkURL, MAX_BOOKMARK_DEPTH, MAX_BOOKMARK_ITEMS } from '../../../shared/bookmarks.js';
let bookmarkSequence = 0;
export function bookmarkId(random = globalThis.crypto) {
  if (typeof random?.randomUUID === 'function') return 'b' + random.randomUUID().replaceAll('-', '');
  if (typeof random?.getRandomValues === 'function') {
    const bytes = random.getRandomValues(new Uint8Array(16));
    return 'b' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  // Content IDs are not authentication secrets; the counter prevents same-page collisions.
  return 'b' + Date.now().toString(36) + '_' + (++bookmarkSequence).toString(36) + '_' + Math.random().toString(36).slice(2, 14);
}
export function parseBookmarks(html, Parser = DOMParser, createId = bookmarkId) {
  const doc = new Parser().parseFromString(html, 'text/html');
  const root = doc.querySelector('dl');
  if (!root) throw Error('请选择浏览器导出的书签 HTML 文件');
  let skipped = 0, itemCount = 0;
  function allocateEntry() {
    if (++itemCount > MAX_BOOKMARK_ITEMS) throw Error(`书签和分组总数不能超过 ${MAX_BOOKMARK_ITEMS}`);
    return createId();
  }
  function walk(dl, depth = 0) {
    if (depth > MAX_BOOKMARK_DEPTH) throw Error(`书签分组超过 ${MAX_BOOKMARK_DEPTH} 层`);
    const result = [];
    // Netscape exports often omit closing DT tags. Locate entries by their nearest DL.
    const entries = [...dl.querySelectorAll('h3, a')].filter(el => el.closest('dl') === dl);
    for (const el of entries) {
      const title = (el.textContent || '').trim();
      if (el.tagName === 'H3') {
        const id = allocateEntry();
        const dt = el.closest('dt');
        const nested = dt?.querySelector('dl') || dt?.nextElementSibling;
        result.push({ id, kind: 'folder', title: title || '未命名分组', children: nested?.tagName === 'DL' ? walk(nested, depth + 1) : [] });
      } else {
        let url;
        try { url = bookmarkURL(el.getAttribute('href')); }
        catch { skipped++; continue; }
        result.push({ id: allocateEntry(), kind: 'link', title: title || new URL(url).hostname, url, ...(el.getAttribute('data-qidian-pinned') === 'true' ? { pinned: true } : {}) });
      }
    }
    return result;
  }
  return { items: validateBookmarks(walk(root)), skipped };
}
export function mergeBookmarks(current, imported) {
  const items = structuredClone(current); let added = 0, duplicates = 0;
  function merge(target, source) {
    for (const entry of source) {
      if (entry.kind === 'folder') {
        let folder = target.find(x => x.kind === 'folder' && x.title === entry.title);
        if (!folder) { folder = { ...entry, children: [] }; target.push(folder); }
        merge(folder.children, entry.children);
      } else if (target.some(x => x.kind === 'link' && x.url === entry.url)) duplicates++;
      else { target.push(structuredClone(entry)); added++; }
    }
  }
  merge(items, imported);
  return { items: validateBookmarks(items), added, duplicates };
}
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function bookmarksHTML(items) {
  function walk(entries) { return entries.map(x => x.kind === 'folder' ? `<DT><H3>${esc(x.title)}</H3>\n<DL><p>\n${walk(x.children)}</DL><p>\n` : `<DT><A HREF="${esc(x.url)}"${x.pinned ? ' data-qidian-pinned="true"' : ''}>${esc(x.title)}</A>\n`).join(''); }
  return '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>栖点书签</TITLE>\n<H1>栖点书签</H1>\n<DL><p>\n' + walk(validateBookmarks(items)) + '</DL><p>';
}
