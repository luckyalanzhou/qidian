import test from 'node:test';
import assert from 'node:assert/strict';
import { createViteTestServer as createServer } from '../../support/vite-test-server.mjs';
import vue from '@vitejs/plugin-vue';
import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import { renderToString } from 'vue/server-renderer';

test('Vue breadcrumb derives its title from the active workspace feature stores', async t => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [vue()],
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  });
  t.after(() => server.close());

  const { default: WorkspaceBreadcrumb } = await server.ssrLoadModule('/src/features/navigation/WorkspaceBreadcrumb.vue');
  const [{ useNavigationStore }, { useEditorStore }, { useNoteListStore }, { useVaultStore }] = await Promise.all([
    server.ssrLoadModule('/src/features/navigation/store.ts'),
    server.ssrLoadModule('/src/features/editor/store.ts'),
    server.ssrLoadModule('/src/features/notes/store.ts'),
    server.ssrLoadModule('/src/features/vault/store.ts')
  ]);
  const pinia = createPinia();
  const navigation = useNavigationStore(pinia);
  const editor = useEditorStore(pinia);
  const noteList = useNoteListStore(pinia);
  const vault = useVaultStore(pinia);
  vault.replace({ notes: [], noteTypes: [], categories: [], bookmarks: [], trash: [] });
  navigation.page = 'bookmarks';
  const context = {};

  await renderToString(createSSRApp(WorkspaceBreadcrumb).use(pinia), context);

  assert.match(context.teleports['#breadcrumbTitleIsland'], /<span class="breadcrumb-root">我的空间<\/span>/);
  assert.match(context.teleports['#breadcrumbTitleIsland'], /<span class="breadcrumb-separator" aria-hidden="true"> \/ <\/span>/);
  assert.match(context.teleports['#breadcrumbTitleIsland'], /<strong id="breadcrumbTitle">书签导航<\/strong>/);

  navigation.page = 'dashboard';
  const homeContext = {};
  await renderToString(createSSRApp(WorkspaceBreadcrumb).use(pinia), homeContext);
  assert.match(homeContext.teleports['#breadcrumbTitleIsland'], /class="breadcrumb-root" hidden/);
  assert.match(homeContext.teleports['#breadcrumbTitleIsland'], /class="breadcrumb-separator" aria-hidden="true" hidden/);
  assert.match(homeContext.teleports['#breadcrumbTitleIsland'], /<strong id="breadcrumbTitle">首页<\/strong>/);

  noteList.configure({
    hasDraftContent: () => true,
    bodyText: body => body,
    noteCard: note => ({ id: note.id, title: note.title, type: note.type, typeName: note.type, tags: note.tags, description: '', updatedLabel: '', pinned: false }),
    typeName: id => id,
    displayTypeName: type => type.name
  });
  navigation.page = 'home';
  navigation.active = 'drafts';
  const draftsContext = {};
  await renderToString(createSSRApp(WorkspaceBreadcrumb).use(pinia), draftsContext);
  assert.match(draftsContext.teleports['#breadcrumbTitleIsland'], /<strong id="breadcrumbTitle">草稿箱<\/strong>/);

  navigation.page = 'note';
  navigation.editing = true;
  editor.form.title = '<script>unsafe</script>';
  const escapedContext = {};
  await renderToString(createSSRApp(WorkspaceBreadcrumb).use(pinia), escapedContext);
  assert.match(escapedContext.teleports['#breadcrumbTitleIsland'], /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(escapedContext.teleports['#breadcrumbTitleIsland'], /<script>/);
});
