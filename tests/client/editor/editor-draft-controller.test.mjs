import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorDraftController } from '../../../src/features/editor/draft-controller.ts';

const note = overrides => ({
  id: 'n1', title: '知识', type: 'note', category: '未分类', tags: [], source: '', body: '<p>正文</p>',
  created: 1, updated: 2, pinned: false, status: 'published', ...overrides
});

function harness(options = {}) {
  let vault = { categories: [], notes: options.notes || [] };
  let draft = options.draft || null;
  let baseline = options.baseline ?? null;
  let transientId = options.transientId || null;
  let fields = options.fields || { title: '修改标题', type: 'note', category: '未分类', tags: [], source: '', body: '<p>已修改</p>' };
  let fieldsReady = options.fieldsReady ?? true;
  const events = [];
  const snapshot = value => JSON.stringify({ title: value.title, type: value.type, category: value.category, tags: value.tags, source: value.source, body: value.body });
  const controller = createEditorDraftController({
    getVault: () => vault,
    getNoteId: () => 'n1',
    getEditingDraft: () => draft,
    setEditingDraft: value => { draft = value; },
    isEditing: () => true,
    isDraft: value => value.status === 'draft',
    hasDraftContent: value => Boolean(value.title.trim() || value.body.replace(/<[^>]+>/g, '').trim() || value.source.trim()),
    getBaseline: () => baseline,
    setBaseline: value => { baseline = value; },
    getTransientNewNoteId: () => transientId,
    clearTransientNewNote: () => { transientId = null; events.push('clear-transient'); },
    createPublishedSnapshot: value => ({ title: value.title, type: value.type, category: value.category, tags: [...value.tags], body: value.body, source: value.source, updated: value.updated }),
    snapshot,
    readEditorFields: () => fieldsReady ? fields : null,
    resetPendingPublish: () => events.push('reset-publish'),
    mutateVault: operation => operation(vault),
    persist: () => { events.push('persist'); return Promise.resolve(true); },
    now: () => 100
  });
  return {
    controller, events,
    get vault() { return vault; },
    get draft() { return draft; },
    get baseline() { return baseline; },
    get transientId() { return transientId; },
    set fields(value) { fields = value; },
    set fieldsReady(value) { fieldsReady = value; }
  };
}

test('opening an editor makes a detached draft and records the published baseline', () => {
  const stored = note();
  const h = harness({ notes: [stored] });
  const draft = h.controller.ensureDraft();

  assert.notEqual(draft, stored);
  assert.deepEqual(draft.publishedSnapshot, {
    title: stored.title, type: stored.type, category: stored.category, tags: [], body: stored.body, source: '', updated: 2
  });
  assert.equal(h.baseline, JSON.stringify({ title: stored.title, type: stored.type, category: stored.category, tags: [], source: '', body: stored.body }));
  assert.equal(h.vault.notes[0], stored, 'opening an editor does not mutate the stored note');
});

test('editor fields update the detached note and reset pending publication state', () => {
  const h = harness({ draft: note({ status: 'draft' }) });
  h.controller.updateFromEditor();

  assert.equal(h.draft.title, '修改标题');
  assert.equal(h.draft.body, '<p>已修改</p>');
  assert.equal(h.draft.updated, 100);
  assert.deepEqual(h.events, ['reset-publish']);
});

test('change detection syncs the editor before comparing against the saved baseline', () => {
  const current = note({ status: 'draft' });
  const h = harness({ draft: current, baseline: JSON.stringify({ title: current.title, type: current.type, category: current.category, tags: [], source: '', body: current.body }) });
  assert.equal(h.controller.hasChanges(), true);
  assert.equal(h.draft.title, '修改标题');
});

test('saving an unchanged published note does not create a pending draft', async () => {
  const stored = note();
  const h = harness({
    notes: [stored],
    fields: { title: stored.title, type: stored.type, category: stored.category, tags: [], source: stored.source, body: stored.body }
  });
  h.controller.ensureDraft();

  assert.equal(await h.controller.saveDraft(true), true);
  assert.deepEqual(h.vault.notes, [stored]);
  assert.equal(Object.hasOwn(h.vault.notes[0], 'publishedSnapshot'), false);
  assert.deepEqual(h.events, ['reset-publish']);
});

test('saving changed content for a published note retains the published baseline', async () => {
  const stored = note();
  const h = harness({ notes: [stored] });
  h.controller.ensureDraft();

  assert.equal(await h.controller.saveDraft(true), true);
  assert.equal(h.vault.notes[0].title, '修改标题');
  assert.equal(h.vault.notes[0].body, '<p>已修改</p>');
  assert.deepEqual(h.vault.notes[0].publishedSnapshot, {
    title: stored.title, type: stored.type, category: stored.category, tags: [], body: stored.body,
    source: stored.source, updated: stored.updated
  });
  assert.deepEqual(h.events, ['reset-publish', 'persist']);
});

test('saving an untouched transient note discards it without persisting an empty draft', async () => {
  const draft = note({ title: '', body: '<p></p>', status: 'draft' });
  const snapshot = JSON.stringify({ title: draft.title, type: draft.type, category: draft.category, tags: [], source: '', body: draft.body });
  const h = harness({ draft, transientId: 'n1', baseline: snapshot, fields: { title: '', type: 'note', category: '未分类', tags: [], source: '', body: '<p></p>' } });
  assert.equal(await h.controller.saveDraft(true), true);
  assert.deepEqual(h.vault.notes, []);
  assert.equal(h.transientId, null);
  assert.equal(h.events.includes('persist'), false);
});

test('saving a cleared existing draft removes it and persists that removal', async () => {
  const draft = note({ title: '', body: '<p></p>', status: 'draft' });
  const h = harness({ notes: [draft], draft: structuredClone(draft), fields: { title: '', type: 'note', category: '未分类', tags: [], source: '', body: '<p></p>' } });
  assert.equal(await h.controller.saveDraft(), true);
  assert.deepEqual(h.vault.notes, []);
  assert.deepEqual(h.events, ['reset-publish', 'persist']);
});
