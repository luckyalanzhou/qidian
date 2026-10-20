import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createViteTestServer as createServer } from '../../support/vite-test-server.mjs';
import { fileURLToPath } from 'node:url';

const note = (overrides = {}) => ({
  id: 'note', title: '笔记', type: 'note', category: '网络', tags: [], body: '<p>内容</p>',
  source: '', created: 1, updated: 1, pinned: false, ...overrides
});

test('Pinia owns note-list filtering, headings, draft projection, and vault invalidation', async t => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  t.after(() => server.close());

  const [{ useVaultStore }, { useNavigationStore }, { useNoteListStore }] = await Promise.all([
    server.ssrLoadModule('/src/features/vault/store.ts'),
    server.ssrLoadModule('/src/features/navigation/store.ts'),
    server.ssrLoadModule('/src/features/notes/store.ts')
  ]);
  const pinia = createPinia();
  const vault = useVaultStore(pinia);
  const navigation = useNavigationStore(pinia);
  const noteList = useNoteListStore(pinia);
  vault.replace({ noteTypes: [{ id: 'note', name: '普通笔记' }, { id: 'command', name: '命令速查' }], notes: [
    note({ id: 'router', title: '路由器设置', category: '网络', tags: ['WAN'], body: '<p>Network guide</p>', updated: 10, pinned: true }),
    note({ id: 'docker', title: '容器部署', type: 'command', category: '服务', body: '<p>Compose</p>', updated: 30 }),
    note({
      id: 'draft', title: '新的网络草稿', body: '<p>未发布内容</p>', updated: 40, status: 'draft',
      publishedSnapshot: { title: '已发布标题', type: 'note', category: '网络', tags: [], body: '<p>旧内容</p>', source: '', updated: 5 }
    }),
    note({ id: 'empty-draft', title: '', body: '', updated: 50, status: 'draft' })
  ] });

  noteList.configure({
    hasDraftContent: item => !!(item.title.trim() || item.body.trim()),
    bodyText: body => body.replace(/<[^>]*>/g, ' '),
    noteCard: item => ({ id: item.id, title: item.title, type: item.type, typeName: item.type, tags: item.tags, description: item.body, updatedLabel: String(item.updated), pinned: item.pinned }),
    typeName: id => id === 'command' ? '命令速查' : '其他类型',
    displayTypeName: type => type.name
  });

  assert.equal(noteList.snapshot.resultCount, 2, 'published notes exclude drafts');
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['router', 'docker'], 'pinned notes sort ahead of the remaining notes');
  assert.deepEqual(noteList.snapshot.noteTypes, [{ id: 'note', name: '普通笔记' }, { id: 'command', name: '命令速查' }]);

  navigation.noteQuery = 'network guide';
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['router'], 'search includes extracted body text');
  navigation.noteQuery = '';
  navigation.typeFilter = 'command';
  assert.equal(noteList.snapshot.heading, '命令速查');
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['docker']);

  navigation.typeFilter = 'all';
  navigation.active = 'recent';
  assert.equal(noteList.snapshot.heading, '最近编辑');
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['docker', 'router'], 'recent notes sort by latest published update');

  navigation.active = 'drafts';
  assert.equal(noteList.snapshot.heading, '草稿箱');
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['draft'], 'empty draft is excluded and actual draft version is shown');
  assert.equal(noteList.snapshot.notes[0].title, '新的网络草稿');

  navigation.active = '网络';
  assert.equal(noteList.snapshot.heading, '全部笔记', 'a stale category route falls back to all notes');
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['router', 'docker'], 'note categories no longer filter the list');

  navigation.active = 'all';
  vault.mutate(value => value.notes.push(note({ id: 'new', title: '新笔记', type: 'command', updated: 60 })));
  assert.deepEqual(noteList.snapshot.notes.map(item => item.id), ['router', 'new', 'docker'], 'vault generation invalidates the computed list');
  assert.equal(noteList.active, false, 'the list remains inactive outside its route');
  navigation.page = 'home';
  assert.equal(noteList.active, true);
});
