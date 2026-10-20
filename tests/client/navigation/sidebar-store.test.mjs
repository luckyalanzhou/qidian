import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createViteTestServer as createServer } from '../../support/vite-test-server.mjs';
import { fileURLToPath } from 'node:url';

const note = (overrides = {}) => ({ id: 'note', title: '笔记', type: 'note', category: '网络', tags: [], body: '<p>内容</p>', source: '', created: 1, updated: 1, pinned: false, ...overrides });

test('sidebar facets derive counts and note types directly from the active vault', async t => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  t.after(() => server.close());

  const [{ useVaultStore }, { useNavigationStore }, { useSidebarStore }] = await Promise.all([
    server.ssrLoadModule('/src/features/vault/store.ts'),
    server.ssrLoadModule('/src/features/navigation/store.ts'),
    server.ssrLoadModule('/src/features/navigation/sidebar-store.ts')
  ]);
  const pinia = createPinia();
  const vault = useVaultStore(pinia);
  const navigation = useNavigationStore(pinia);
  const sidebar = useSidebarStore(pinia);
  vault.replace({
    categories: ['网络', '服务'],
    noteTypes: [{ id: 'note', name: '普通笔记' }, { id: 'command', name: '命令速查' }],
    notes: [
      note({ id: 'router', title: '路由器配置', pinned: true, updated: 10 }),
      note({ id: 'compose', title: '容器配置', type: 'command', category: '服务', updated: 20 }),
      note({ id: 'draft', title: '待发布草稿', status: 'draft' }),
      note({ id: 'empty', title: '', body: '', status: 'draft' })
    ],
    bookmarks: [
      { id: 'folder', kind: 'folder', title: '工具', children: [{ id: 'one', kind: 'link', title: '一个', url: 'https://one.test' }, { id: 'nested', kind: 'folder', title: '嵌套', children: [{ id: 'two', kind: 'link', title: '两个', url: 'https://two.test' }] }] },
      { id: 'three', kind: 'link', title: '三个', url: 'https://three.test' }
    ],
    trash: [{ id: 'deleted', kind: 'note' }],
    noteTypesExpanded: false
  });
  sidebar.configure({
    isDraft: item => item.status === 'draft',
    needsPublish: item => item.status === 'draft' || !!item.publishedSnapshot,
    hasDraftContent: item => !!(item.title.trim() || item.body.trim()),
    displayTypeName: type => type.name === '网页收藏' ? '网页摘录' : type.name
  });

  assert.deepEqual(sidebar.snapshot.counts, { all: 2, recent: 2, pinned: 1, drafts: 1, bookmarks: 3, trash: 1 });
  assert.deepEqual(sidebar.snapshot.noteTypes, [
    { id: 'note', name: '普通笔记', count: 1 },
    { id: 'command', name: '命令速查', count: 1 }
  ]);
  assert.equal(Object.hasOwn(sidebar.snapshot, 'categories'), false, 'note categories are not projected into the sidebar UI');
  assert.equal(sidebar.snapshot.typesExpanded, false);

  navigation.page = 'home';
  navigation.active = 'pinned';
  assert.equal(sidebar.snapshot.counts.all, 2, 'route changes do not own sidebar counts');
  vault.mutate(value => {
    value.notes.push(note({ id: 'new', title: '新增笔记', type: 'command', category: '网络', updated: 30 }));
    value.noteTypesExpanded = true;
  });
  assert.equal(sidebar.snapshot.counts.all, 3);
  assert.equal(sidebar.snapshot.noteTypes[1].count, 2);
  assert.equal(sidebar.snapshot.typesExpanded, true);
});
