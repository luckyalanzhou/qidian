// Shared by browser imports and authenticated vault validation.
export const MAX_BOOKMARK_ITEMS = 10000;
export const MAX_BOOKMARK_DEPTH = 32;

export function bookmarkURL(value) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('网址过长或无效');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('请输入完整网址（https://…）'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('书签只支持不含登录凭据的 HTTP / HTTPS 网址');
  return url.href;
}

export function validateBookmarks(input = []) {
  const ids = new Set(); let count = 0;
  function walk(items, depth) {
    if (!Array.isArray(items) || depth > MAX_BOOKMARK_DEPTH) throw Error('书签分组结构无效或超过 32 层');
    return items.map(item => {
      if (++count > MAX_BOOKMARK_ITEMS) throw Error(`书签和分组总数不能超过 ${MAX_BOOKMARK_ITEMS}`);
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id)) throw Error('书签编号无效或重复');
      ids.add(item.id);
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500) throw Error('书签名称须为 1–500 个字符');
      const base = { id: item.id, title: item.title.trim(), kind: item.kind };
      if (item.kind === 'folder') return { ...base, children: walk(item.children, depth + 1) };
      if (item.kind === 'link') return { ...base, url: bookmarkURL(item.url), ...(item.pinned === true ? { pinned: true } : {}) };
      throw Error('书签类型无效');
    });
  }
  return walk(input, 0);
}
