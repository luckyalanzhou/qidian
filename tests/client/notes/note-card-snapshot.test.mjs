import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoteCardSnapshot } from '../../../src/features/notes/card-snapshot.ts';

test('note card snapshot projects display fields through note feature adapters', () => {
  const calls = [];
  const snapshot = createNoteCardSnapshot({
    typeName: type => `type:${type}`,
    bodyText: (body, title) => { calls.push({ body, title }); return '正文摘要'; },
    formatDate: timestamp => `date:${timestamp}`
  });
  const tags = ['Linux', 'Docker'];

  assert.deepEqual(snapshot({
    id: 'note-1', title: '容器部署', type: 'command', category: '服务',
    tags, body: '<p>内容</p>', updated: 42, pinned: true
  }), {
    id: 'note-1', title: '容器部署', type: 'command', typeName: 'type:command',
    tags: ['Linux', 'Docker'], description: '正文摘要',
    updatedLabel: 'date:42', pinned: true
  });
  assert.deepEqual(calls, [{ body: '<p>内容</p>', title: '容器部署' }]);
  assert.notEqual(snapshot({ id: 'note-2', type: 'note', updated: 0 }).tags, tags);
});

test('note card snapshot supplies the same empty display defaults as the former app adapter', () => {
  const snapshot = createNoteCardSnapshot({
    typeName: () => '其他类型',
    bodyText: () => '',
    formatDate: () => '10/20'
  });

  assert.deepEqual(snapshot({ id: 'note-1', type: 'missing', updated: 1 }), {
    id: 'note-1', title: '', type: 'missing', typeName: '其他类型',
    tags: [], description: '', updatedLabel: '10/20', pinned: false
  });
});
