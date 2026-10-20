import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createViteTestServer as createServer } from '../../support/vite-test-server.mjs';
import { fileURLToPath } from 'node:url';
import { createTrashEntry } from '../../../src/domain/trash-data.js';

test('trash view follows the active vault and updates after transactional changes', async t => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  t.after(() => server.close());

  const [{ useVaultStore }, { useTrashStore }, { useNavigationStore }] = await Promise.all([
    server.ssrLoadModule('/src/features/vault/store.ts'),
    server.ssrLoadModule('/src/features/trash/store.ts'),
    server.ssrLoadModule('/src/features/navigation/store.ts')
  ]);
  const pinia = createPinia();
  const vault = useVaultStore(pinia);
  const trash = useTrashStore(pinia);
  const navigation = useNavigationStore(pinia);
  const now = Date.now();
  const note = { id: 'note-1', title: '已删除的笔记', type: 'note', category: '网络', tags: ['WAN'], body: '<p>内容</p>', source: '', created: 1, updated: 2, pinned: false };
  const bookmark = { id: 'link-1', kind: 'link', title: '已删除的网址', url: 'https://example.test' };
  const noteEntry = { ...createTrashEntry('note', note, { index: 0 }, {}, now - 3 * 86400000), deletedAt: now - 3 * 86400000 };
  const bookmarkEntry = { ...createTrashEntry('bookmark', bookmark, { index: 0 }, {}, now - 86400000), deletedAt: now - 86400000 };
  vault.replace({ trash: [noteEntry, bookmarkEntry] });

  assert.equal(trash.snapshot.count, 2);
  assert.deepEqual(trash.snapshot.entries.map(entry => entry.id), [bookmarkEntry.id, noteEntry.id], 'entries sort newest first');
  assert.equal(trash.snapshot.entries[0].detail, 'https://example.test');
  assert.equal(trash.snapshot.entries[1].title, '已删除的笔记');
  assert.equal(trash.snapshot.entries[1].detail, '#WAN', 'trash metadata keeps tags without exposing the removed category');
  assert.match(trash.snapshot.entries[1].expiresLabel, /天后清理/);

  const actions = [];
  trash.bindActions({
    restore: async id => { actions.push(['restore', id]); return true; },
    clearAll: async () => { actions.push(['clearAll']); return true; },
    pruneExpired: () => 0
  });
  assert.equal(await trash.restore(noteEntry.id), true);
  assert.equal(await trash.clearAll(), true);
  assert.deepEqual(actions, [['restore', noteEntry.id], ['clearAll']]);
  assert.equal(trash.active, false);
  navigation.page = 'trash';
  assert.equal(trash.active, true);

  vault.mutate(value => { value.trash.splice(0, 1); });
  assert.equal(trash.snapshot.count, 1, 'the computed projection observes the vault generation without a refresh callback');
  assert.deepEqual(trash.snapshot.entries.map(entry => entry.id), [bookmarkEntry.id]);
});
