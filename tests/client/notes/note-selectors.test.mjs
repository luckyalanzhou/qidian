import test from 'node:test';
import assert from 'node:assert/strict';
import { isDraftNote, needsPublish, publishedNoteView, selectNotes } from '../../../src/features/notes/selectors.ts';

function note(id, overrides = {}) {
  return {
    id, title: id, type: 'note', category: '开发', tags: [], body: '', source: '', created: 1, updated: 1,
    pinned: false, status: 'published', ...overrides
  };
}

const hasDraftContent = item => !!(item.title.trim() || item.body.trim());
const bodyText = body => body.replace(/<[^>]*>/g, ' ');

test('publication helpers distinguish drafts and unpublished changes', () => {
  const draft = note('draft', { status: 'draft' });
  const pending = note('pending', { publishedSnapshot: { title: 'Published', type: 'note', category: '开发', tags: [], body: '', source: '', updated: 1 } });
  assert.equal(isDraftNote(draft), true);
  assert.equal(isDraftNote(pending), false);
  assert.equal(needsPublish(draft), true);
  assert.equal(needsPublish(pending), true);
  assert.equal(needsPublish(note('published')), false);
});

test('reader view overlays the published snapshot without mutating the stored note', () => {
  const stored = note('n1', {
    title: '草稿标题', body: '<p>草稿正文</p>',
    publishedSnapshot: { title: '已发布标题', type: 'note', category: '已发布分类', tags: ['旧'], body: '<p>已发布正文</p>', source: '', updated: 2 }
  });
  const view = publishedNoteView(stored);
  assert.equal(view.title, '已发布标题');
  assert.equal(view.body, '<p>已发布正文</p>');
  assert.equal(view._hasUnpublished, true);
  assert.equal(stored.title, '草稿标题');
});

test('all notes exclude drafts and display published snapshots, while search matches displayed text', () => {
  const notes = [
    note('later', { updated: 2 }),
    note('draft', { status: 'draft', title: '只在草稿' }),
    note('pending', { title: '工作副本', body: '<p>草稿关键词</p>', publishedSnapshot: { title: '公开标题', type: 'note', category: '开发', tags: [], body: '<p>公开正文</p>', source: '', updated: 3 } }),
    note('pinned', { pinned: true, updated: 1 })
  ];
  const result = selectNotes(notes, { active: 'all', typeFilter: 'all', query: '公开正文', hasDraftContent, bodyText });
  assert.deepEqual(result.map(item => item.id), ['pending']);
  assert.equal(result[0].title, '公开标题');
  assert.deepEqual(notes.map(item => item.id), ['later', 'draft', 'pending', 'pinned']);
});

test('draft view keeps authored drafts and pending published edits, excluding empty drafts', () => {
  const notes = [
    note('recent-draft', { status: 'draft', title: '新草稿', updated: 5 }),
    note('empty-draft', { status: 'draft', title: '', body: '', updated: 9 }),
    note('pending', { title: '已发布', body: '<p>未发布修改</p>', publishedSnapshot: { title: '已发布', type: 'note', category: '开发', tags: [], body: '', source: '', updated: 3 }, updated: 3 }),
    note('published')
  ];
  const result = selectNotes(notes, { active: 'drafts', typeFilter: 'all', hasDraftContent, bodyText });
  assert.deepEqual(result.map(item => item.id), ['recent-draft', 'pending']);
});

test('type, pinned, recent and query filters compose without consulting legacy categories', () => {
  const notes = [
    note('a', { category: '开发', type: 'command', title: 'Alpha', pinned: true, updated: 1 }),
    note('b', { category: '阅读', type: 'note', title: 'Beta', pinned: true, updated: 4 }),
    note('c', { category: '开发', type: 'note', title: 'Gamma', updated: 8 })
  ];
  const common = { hasDraftContent, bodyText };
  assert.deepEqual(selectNotes(notes, { ...common, active: 'all', typeFilter: 'command' }).map(item => item.id), ['a']);
  assert.deepEqual(selectNotes(notes, { ...common, active: 'pinned', typeFilter: 'all' }).map(item => item.id), ['b', 'a']);
  assert.deepEqual(selectNotes(notes, { ...common, active: 'recent', typeFilter: 'all' }).map(item => item.id), ['c', 'b', 'a']);
  assert.deepEqual(selectNotes(notes, { ...common, active: 'all', typeFilter: 'all', query: ' BETA ' }).map(item => item.id), ['b']);
  assert.deepEqual(selectNotes(notes, { ...common, active: 'all', typeFilter: 'all', query: '开发' }).map(item => item.id), [], 'hidden legacy category values are not searchable');
});
