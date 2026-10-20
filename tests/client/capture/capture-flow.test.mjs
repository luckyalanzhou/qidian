import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NOTE_TYPES, validateVault } from '../../../shared/vault-validation.js';
import { createCaptureFlow } from '../../../src/features/capture/capture-flow.ts';
import { createVaultMutation } from '../../../src/features/vault/mutation.ts';

function fixture({ saveError = '' } = {}) {
  let vault = validateVault({
    categories: ['工作'],
    noteTypes: DEFAULT_NOTE_TYPES,
    notes: [],
    bookmarks: [],
    trash: []
  });
  const saves = [];
  const mutation = createVaultMutation({
    getVault: () => vault,
    replaceVault: value => { vault = value; return value; },
    save: async () => {
      if (saveError) throw new Error(saveError);
      saves.push(structuredClone(vault));
    }
  });
  const flow = createCaptureFlow({
    getVault: () => vault,
    mutateVault: mutation,
    cleanBody: html => html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ''),
    bodyText: html => html.replace(/<[^>]+>/g, ' '),
    now: () => 1234
  });
  return { flow, getVault: () => vault, saves };
}

test('capture trims fields, sanitizes body and resolves after the Vault write persists', async () => {
  const state = fixture();
  const note = await state.flow.save({
    title: '  路由教程  ', type: 'clip', source: ' https://example.com/ ',
    body: '<p>正文</p><script>alert(1)</script>'
  });

  assert.equal(note.id, 'n1234');
  assert.equal(note.title, '路由教程');
  assert.equal(note.source, 'https://example.com/');
  assert.equal(note.body, '<p>正文</p>');
  assert.equal(note.status, 'draft');
  assert.equal(state.getVault().notes[0].id, note.id);
  assert.equal(state.saves[0].notes[0].body, '<p>正文</p>');
});

test('capture derives a title from content and rejects a completely empty submission', async () => {
  const state = fixture();
  const note = await state.flow.save({ title: '', type: 'clip', source: '', body: '<p>网页正文</p>' });

  assert.equal(note.title, '网页正文');
  assert.equal(note.category, '未分类');
  await assert.rejects(state.flow.save({ title: ' ', type: 'clip', source: '', body: '<p><br></p>' }), /请至少填写标题或内容/);
  assert.equal(state.saves.length, 1);
});

test('a failed capture commit rolls the Vault back before the UI can navigate', async () => {
  const state = fixture({ saveError: 'SQLite 提交失败' });

  await assert.rejects(state.flow.save({ title: '待保存', type: 'clip', source: '', body: '<p>内容</p>' }), /SQLite 提交失败/);
  assert.equal(state.getVault().notes.length, 0);
  assert.equal(state.saves.length, 0);
});
