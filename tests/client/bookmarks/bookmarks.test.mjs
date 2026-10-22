import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { validateVault } from '../../../server/validation.js';
import { validateBookmarks } from '../../../server/bookmarks.js';
import { bookmarkId, parseBookmarks, mergeBookmarks, bookmarksHTML } from '../../../src/features/bookmarks/data.js';
import { MAX_BOOKMARK_ITEMS } from '../../../shared/bookmarks.js';
const Parser = new JSDOM('').window.DOMParser;
test('bookmark IDs work on HTTP without randomUUID and retain valid unique identifiers', () => {
  let sequence = 0;
  const httpCrypto = { getRandomValues(bytes) { bytes[0]=++sequence; return bytes; } };
  const ids = Array.from({length:100},()=>bookmarkId(httpCrypto));
  assert.equal(new Set(ids).size,100);
  assert.ok(ids.every(id=>/^b[0-9a-f]{32}$/.test(id)));
  assert.equal(bookmarkId({randomUUID:()=> '12345678-1234-4321-8765-123456789012'}),'b12345678123443218765123456789012');
  const fallback = Array.from({length:100},()=>bookmarkId(null));
  assert.equal(new Set(fallback).size,100);
  assert.doesNotThrow(()=>validateBookmarks([...ids,...fallback].map(id=>({id,kind:'link',title:'书签',url:'http://example.com/'}))));
});
const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
<DT><H3>开发 &amp; 工具</H3><DL><p>
<DT><H3>文档</H3><DL><p><DT><A HREF="https://example.com/docs?q=1">文档 ✅</A></DL><p>
<DT><A HREF="https://example.com/?q=2">工具</A>
</DL><p><DT><H3>空分组</H3><DL><p></DL><p>
<DT><A HREF="javascript:alert(1)">危险</A>
</DL><p>`;
test('browser HTML keeps nested folders, empty groups, order, titles and query strings', () => {
  const parsed = parseBookmarks(html, Parser);
  assert.equal(parsed.skipped, 1);
  assert.deepEqual(parsed.items.map(x => x.title), ['开发 & 工具', '空分组']);
  assert.deepEqual(parsed.items[0].children.map(x => x.title), ['文档', '工具']);
  assert.equal(parsed.items[0].children[0].children[0].url, 'https://example.com/docs?q=1');
  assert.deepEqual(parseBookmarks(bookmarksHTML(parsed.items), Parser).items.map(stripIds), parsed.items.map(stripIds));
});

test('bookmark HTML parsing stops allocating IDs as soon as the item limit is exceeded', () => {
  const root = { querySelectorAll: () => entries };
  const entries = Array.from({ length: MAX_BOOKMARK_ITEMS + 1 }, () => ({
    tagName: 'A',
    textContent: '项目',
    closest: () => root,
    getAttribute: name => name === 'href' ? 'https://example.com/' : null
  }));
  let allocatedIds = 0;
  class ParserFixture {
    parseFromString() { return { querySelector: () => root }; }
  }

  assert.throws(() => parseBookmarks('', ParserFixture, () => `b${++allocatedIds}`), /不能超过 10000/);
  assert.equal(allocatedIds, MAX_BOOKMARK_ITEMS);
});
function stripIds({ id, children, ...item }) { return children ? { ...item, children: children.map(stripIds) } : item; }
test('merge deduplicates within the same path and retains distinct resource parameters', () => {
  const first = parseBookmarks(html, Parser).items;
  const again = parseBookmarks(html, Parser).items;
  again[0].children.push({ id:'newlink', title:'另一页面', kind:'link', url:'https://example.com/?q=3' });
  const merged = mergeBookmarks(first, again);
  assert.equal(merged.added, 1); assert.equal(merged.duplicates, 2);
  assert.equal(merged.items.length, 2);
  assert.equal(first[0].children.length, 2);
});
test('vault compatibility and validation preserve bookmarks but reject unsafe URLs and duplicate IDs', () => {
  const legacy = { categories:[], notes:[] };
  const defaults=validateVault(legacy);
  assert.deepEqual(defaults.bookmarks, []);
  assert.equal(defaults.noteTypesExpanded, true);
  assert.equal(defaults.dashboardBookmarkLayout, 'single');
  assert.deepEqual(defaults.dashboardBookmarkFolders, {});
  assert.equal(defaults.bookmarkDirectoryOpen, null);
  assert.deepEqual(defaults.bookmarkFolderStates, {});
  const preferences=validateVault({ ...legacy, noteTypesExpanded:false, dashboardBookmarkLayout:'double', dashboardBookmarkFolders:{group:false}, bookmarkDirectoryOpen:true, bookmarkFolderStates:{group:false,nested:true} });
  assert.equal(preferences.noteTypesExpanded, false);
  assert.equal(preferences.dashboardBookmarkLayout, 'double');
  assert.deepEqual(preferences.dashboardBookmarkFolders, {group:false});
  assert.equal(preferences.bookmarkDirectoryOpen, true);
  assert.deepEqual(preferences.bookmarkFolderStates, {group:false,nested:true});
  assert.throws(()=>validateVault({ ...legacy, dashboardBookmarkFolders:{'bad/id':true} }));
  assert.throws(()=>validateVault({ ...legacy, bookmarkFolderStates:{'bad/id':false} }));
  const items = parseBookmarks(html, Parser).items;
  assert.deepEqual(validateVault({ ...legacy, bookmarks:items }).bookmarks, items);
  assert.throws(() => validateBookmarks([{ id:'x', kind:'link', title:'bad', url:'data:text/html,bad' }]));
  assert.throws(() => validateBookmarks([{ id:'x', kind:'link', title:'bad', url:'https://user:pass@example.com' }]));
  assert.throws(() => validateBookmarks([items[0], items[0]]));
  let deep = []; for (let i = 0; i < 35; i++) deep = [{ id:'d'+i, title:'folder', kind:'folder', children:deep }];
  assert.throws(() => validateBookmarks(deep));
});

test('pinned bookmark metadata survives vault validation and HTML round-trip', () => {
  const items = [{ id:'pinned', kind:'link', title:'常用', url:'https://example.com/', pinned:true }];
  assert.equal(validateVault({ categories:[], notes:[], bookmarks:items }).bookmarks[0].pinned, true);
  assert.equal(parseBookmarks(bookmarksHTML(items), Parser).items[0].pinned, true);
  assert.equal(validateBookmarks([{ ...items[0], pinned:false }])[0].pinned, undefined);
});

test('legacy notes remain published while private drafts and pending published edits validate', () => {
  const legacy = { categories:[], notes:[{ id:'old', title:'旧笔记', type:'note', category:'未分类', tags:[], body:'<p>兼容</p>', source:'', created:1, updated:2, pinned:false }] };
  assert.equal(validateVault(legacy).notes[0].status, undefined, 'legacy data is interpreted as published without rewriting its record');
  const draft = validateVault({ ...legacy, notes:[{ ...legacy.notes[0], id:'draft', status:'draft', publishedAt:null }] }).notes[0];
  assert.equal(draft.status, 'draft');
  assert.equal(draft.publishedAt, null);
  const pending = validateVault({ ...legacy, notes:[{ ...legacy.notes[0], status:'published', publishedAt:2,
    title:'工作标题', publishedSnapshot:{ title:'已发布标题', type:'note', category:'未分类', tags:[], body:'<p>已发布正文</p>', source:'', updated:2 } }] }).notes[0];
  assert.equal(pending.publishedSnapshot.title, '已发布标题');
  assert.equal(pending.title, '工作标题');
});
