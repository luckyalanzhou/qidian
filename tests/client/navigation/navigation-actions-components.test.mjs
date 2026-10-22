import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDashboardActions } from '../../../src/features/dashboard/actions.ts';
import { mountWorkspaceKeyboardEvents } from '../../../src/features/navigation/workspace-keyboard-events.ts';

test('Vue note list and cards dispatch navigation commands directly without document click routing', async t => {
  const require = createRequire(import.meta.url);
  const pluginEntry = require.resolve('@vitejs/plugin-vue');
  const compilerPath = require.resolve('@vue/compiler-sfc', { paths: [dirname(pluginEntry)] });
  const esbuildPath = require.resolve('esbuild', { paths: [dirname(pluginEntry)] });
  const { parse, compileScript } = require(compilerPath);
  const { build } = require(esbuildPath);
  const cacheDir = join(process.cwd(), 'node_modules', '.cache');
  await mkdir(cacheDir, { recursive: true });
  const tempDir = await mkdtemp(join(cacheDir, 'qidian-vue-component-test-'));
  const bundlePath = join(tempDir, 'notes-list-page.mjs');
  await build({
    stdin: {
    sourcefile: 'navigation-actions-components.test-entry.ts',
      resolveDir: process.cwd(),
      contents: [
        "export { default as NotesListPage } from './src/features/notes/NotesListPage.vue';",
        "export { default as BookmarkPage } from './src/features/bookmarks/BookmarkPage.vue';",
        "export { default as DashboardPage } from './src/features/dashboard/DashboardPage.vue';",
        "export { default as EditorPage } from './src/features/editor/EditorPage.vue';",
        "export { default as NoteTypeDialog } from './src/features/notes/NoteTypeDialog.vue';",
        "export { default as CaptureDialog } from './src/features/capture/CaptureDialog.vue';",
        "export { default as CreateMenuDialog } from './src/features/create-menu/CreateMenuDialog.vue';",
        "export { default as SidebarNavigation } from './src/features/navigation/SidebarNavigation.vue';",
        "export { default as MobileNavigation } from './src/features/navigation/MobileNavigation.vue';",
        "export { default as WorkspaceTopbarMenus } from './src/features/navigation/WorkspaceTopbarMenus.vue';",
        "export { default as GlobalSearchDialog } from './src/features/search/GlobalSearchDialog.vue';",
        "export { default as CommandPalette } from './src/features/command-palette/CommandPalette.vue';",
        "export { default as ReaderPage } from './src/features/reader/ReaderPage.vue';",
        "export { default as AppSettings } from './src/features/settings/AppSettings.vue';",
        "export { default as ProfileSettings } from './src/features/account/ProfileSettings.vue';",
        "export { default as BackupHistoryDialog } from './src/features/settings/BackupHistoryDialog.vue';",
        "export { useNavigationActionsStore } from './src/features/navigation/navigation-actions-store.ts';",
        "export { useNavigationStore } from './src/features/navigation/store.ts';",
        "export { useNoteListStore } from './src/features/notes/store.ts';",
        "export { useDashboardStore } from './src/features/dashboard/store.ts';",
        "export { useBookmarkStore } from './src/features/bookmarks/store.ts';",
        "export { useEditorStore } from './src/features/editor/store.ts';",
        "export { useEditorPageActionsStore } from './src/features/editor/editor-page-actions-store.ts';",
        "export { useNoteTypeDialogStore } from './src/features/notes/type-dialog-store.ts';",
        "export { useCaptureDialogStore } from './src/features/capture/capture-dialog-store.ts';",
        "export { useCreateMenuStore } from './src/features/create-menu/store.ts';",
        "export { useSidebarStore } from './src/features/navigation/sidebar-store.ts';",
        "export { useWorkspaceShellActionsStore } from './src/features/navigation/workspace-shell-actions-store.ts';",
        "export { useWorkspaceShellStore } from './src/features/navigation/workspace-shell-store.ts';",
        "export { useReaderStore } from './src/features/reader/store.ts';",
        "export { useReaderActionsStore } from './src/features/reader/reader-actions-store.ts';",
        "export { useVaultStore } from './src/features/vault/store.ts';",
        "export { useAppSettingsStore } from './src/features/settings/app-settings-store.ts';",
        "export { useProfileSettingsStore } from './src/features/account/profile-settings-store.ts';",
        "export { useBackupHistoryStore } from './src/features/settings/backup-history-store.ts';",
        "export { useGlobalSearchStore } from './src/features/search/store.ts';",
        "export { useCommandPaletteStore } from './src/features/command-palette/store.ts';"
      ].join('\n')
    },
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    plugins: [{
      name: 'vue-sfc-client-compiler',
      setup(buildContext) {
        buildContext.onLoad({ filter: /\.vue$/ }, async args => {
          const source = await readFile(args.path, 'utf8');
          const { descriptor, errors } = parse(source, { filename: args.path });
          if (errors.length) throw errors[0];
          const compiled = compileScript(descriptor, { id: args.path, inlineTemplate: true });
          return { contents: compiled.content, loader: 'ts', resolveDir: dirname(args.path) };
        });
      }
    }]
  });
  const dom = new JSDOM('<div id="app"></div><aside id="sidebar"><div id="sidebarBrandIsland"></div><div id="sidebarCreateIsland"></div><div id="qidianSidebarIsland"></div></aside><div id="topbarSearchIsland"></div><div id="topbarMenusIsland"></div><main id="dashboardHost"></main>', {
    url: 'http://localhost',
    pretendToBeVisual: true
  });
  const names = ['window', 'document', 'navigator', 'Document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'MutationObserver', 'Event', 'getComputedStyle'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }

  let app;
  t.after(async () => {
    app?.unmount();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const [{ createApp, h, Fragment, nextTick }, { createPinia }, components] = await Promise.all([
    import('vue'),
    import('pinia'),
    import(pathToFileURL(bundlePath).href)
  ]);
  const { NotesListPage, BookmarkPage, DashboardPage, EditorPage, ReaderPage, AppSettings, ProfileSettings, BackupHistoryDialog, NoteTypeDialog, CaptureDialog, CreateMenuDialog, SidebarNavigation, MobileNavigation, WorkspaceTopbarMenus, GlobalSearchDialog, CommandPalette, useNavigationActionsStore, useNavigationStore, useNoteListStore, useDashboardStore, useBookmarkStore, useEditorStore, useEditorPageActionsStore, useNoteTypeDialogStore, useCaptureDialogStore, useCreateMenuStore, useSidebarStore, useWorkspaceShellActionsStore, useWorkspaceShellStore, useReaderStore, useReaderActionsStore, useVaultStore, useAppSettingsStore, useProfileSettingsStore, useBackupHistoryStore, useGlobalSearchStore, useCommandPaletteStore } = components;
  const pinia = createPinia();
  const vault = useVaultStore(pinia);
  const navigation = useNavigationStore(pinia);
  const noteList = useNoteListStore(pinia);
  const dashboard = useDashboardStore(pinia);
  const bookmarks = useBookmarkStore(pinia);
  const bookmarkCommands = [];
  bookmarks.bindActions(action => {
    bookmarkCommands.push(action);
    if (action.type === 'add-link') bookmarks.openEditor({ kind: 'link', id: '', parentId: action.parentId || '', title: '', url: '' });
    if (action.type === 'delete') bookmarks.openDeleteDialog({ kind: 'item', id: action.id, itemKind: 'link', title: 'MDN', hasChildren: false });
    if (action.type === 'bulk-delete') bookmarks.openBulkDialog('delete', ['bookmark-mdn']);
  });
  const editorData = useEditorStore(pinia);
  const editorRuntimeActions = [];
  const editorPageActions = useEditorPageActionsStore(pinia);
  const editorPageCommands = [];
  editorPageActions.bind(command => { editorPageCommands.push(command); });
  const editorFormChanges = [];
  let editorFormBlurs = 0;
  editorData.bindRuntime({
    initialize() {}, dispatch(action) { editorRuntimeActions.push(action); },
    formChanged: () => editorFormChanges.push({ ...editorData.form }),
    formBlurred: () => { editorFormBlurs += 1; }
  });
  const noteTypeDialog = useNoteTypeDialogStore(pinia);
  const captureDialog = useCaptureDialogStore(pinia);
  const createMenu = useCreateMenuStore(pinia);
  const sidebar = useSidebarStore(pinia);
  const actions = useNavigationActionsStore(pinia);
  const shellActions = useWorkspaceShellActionsStore(pinia);
  const shell = useWorkspaceShellStore(pinia);
  const reader = useReaderStore(pinia);
  const readerActions = useReaderActionsStore(pinia);
  const appSettings = useAppSettingsStore(pinia);
  const appSettingsCommands = [];
  appSettings.bindActionHandler(action => appSettingsCommands.push(action));
  const profileSettings = useProfileSettingsStore(pinia);
  profileSettings.configure({
    local: true, username: '本地预览', getAccountProfile: async () => ({ id: 'local', username: '本地预览', created: 0, avatarMime: null }),
    getAccountAvatar: async () => new Blob(), saveAccountAvatar: async () => undefined,
    removeAccountAvatar: async () => undefined, changeAccountPassword: async () => undefined
  });
  const backupHistory = useBackupHistoryStore(pinia);
  const backupActions = [];
  backupHistory.configure({ listBackups: async () => [{ revision: 2, created: 1 }], localPreview: false, downloadSnapshot: async revision => backupActions.push(['download', revision]), restoreSnapshot: async revision => backupActions.push(['restore', revision]) });
  const note = {
    id: 'note-1', title: '路由配置', type: 'note', category: '网络', tags: ['OpenWrt'],
    body: '<h2 id="reader-heading">网关配置</h2><p>阅读页操作。</p>', source: '', created: 1, updated: 1, pinned: false, status: 'published',
    publishedSnapshot: { title: '已发布版本', type: 'note', category: '网络', tags: ['OpenWrt'], body: '<h2 id="reader-heading">网关配置</h2><p>阅读页操作。</p>', source: '', updated: 1 }
  };
  vault.replace({ categories: ['网络'], noteTypes: [{ id: 'note', name: '普通笔记' }, { id: 'command', name: '命令速查' }], notes: [note], bookmarks: [{ id: 'folder-reading', kind: 'folder', title: '阅读', children: [{ id: 'folder-reference', kind: 'folder', title: '参考', children: [{ id: 'bookmark-mdn', kind: 'link', title: 'MDN', url: 'https://developer.mozilla.org' }] }] }], trash: [] });
  reader.configure({
    document: dom.window.document,
    readableNoteBody: body => ({ html: String(body || '') }),
    typeLabel: () => '普通笔记',
    formatDate: timestamp => `date-${timestamp}`,
    safeUrl: value => /^https?:\/\//.test(value),
    isDraft: () => false,
    needsPublish: () => true,
    publishedView: value => value.publishedSnapshot ? { ...value, ...value.publishedSnapshot } : value
  });
  navigation.page = 'home';
  sidebar.configure({
    isDraft: () => false,
    needsPublish: () => false,
    hasDraftContent: () => false,
    displayTypeName: type => type.name
  });
  noteList.configure({
    hasDraftContent: () => true,
    bodyText: body => body,
    typeName: () => '普通笔记',
    displayTypeName: type => type.name,
    noteCard: value => ({
      id: value.id, title: value.title, type: value.type, typeName: '普通笔记',
      tags: value.tags, description: '网关配置', updatedLabel: '今天', pinned: false
    })
  });
  dashboard.configure({
    isDraft: () => false,
    publishedView: value => value,
    noteCard: value => ({ id: value.id, title: value.title, type: value.type, typeName: '普通笔记', tags: value.tags, description: '网关配置', updatedLabel: '今天', pinned: false }),
    isSafeUrl: value => /^https?:\/\//.test(value)
  });
  let dashboardPersistCalls = 0;
  dashboard.bindActions(createDashboardActions({
    getVault: () => vault.value,
    mutateVault: operation => vault.mutate(operation),
    persist: () => { dashboardPersistCalls += 1; }
  }));
  const commands = [];
  const shellCommands = [];
  const readerCommands = [];
  actions.bind(command => { commands.push(command); if (command.type === 'create-from-menu') createMenu.closeForNavigation(); return true; });
  shellActions.bind(command => {
    shellCommands.push(command);
    shell.closeThemeMenu();
    shell.closeAccountMenu();
    if (command.type === 'toggle-theme-menu') shell.toggleThemeMenu();
    if (command.type === 'toggle-account-menu') shell.toggleAccountMenu();
    if (command.type === 'apply-theme') { shell.setThemeState(command.theme, command.theme === 'dark'); shell.closeThemeMenu(); }
    return true;
  });
  readerActions.bind(command => { readerCommands.push(command); });
  app = createApp({
    render() {
      return h(Fragment, null, [
        h(WorkspaceTopbarMenus),
        h(CommandPalette),
        h(GlobalSearchDialog),
        h(SidebarNavigation),
        h(MobileNavigation),
        h(DashboardPage),
        h(NotesListPage),
        h(BookmarkPage),
        h(ReaderPage),
        h(EditorPage),
        h(NoteTypeDialog),
        h(CaptureDialog),
        h(CreateMenuDialog),
        h(AppSettings),
        h(ProfileSettings, { key: profileSettings.revision, flow: profileSettings.controller, local: true }),
        h(BackupHistoryDialog)
      ]);
    }
  });
  app.use(pinia);
  app.provide(Symbol.for('v-scx'), { modules: new Set() });
  app.mount(dom.window.document.querySelector('#app'));
  await nextTick();
  assert.ok(dom.window.document.querySelector('#appSettingsOverlay'), 'settings are rendered by the shared Vue root');
  const globalSearch = useGlobalSearchStore(pinia);
  const commandPalette = useCommandPaletteStore(pinia);
  const disposeKeyboardEvents = mountWorkspaceKeyboardEvents(dom.window.document, {
    isEditing: () => false,
    toggleCommandPalette: () => commandPalette.toggle(),
    saveDraft() {}, updateEditorBaseline() {}, closeSearch() {}, closeCapture() {}, closeCreateMenu() {}, closeBackupHistory() {},
    closeAccountSettings() {}, closeThemeMenu() {}, closeAccountMenu() {}, closeWorkspaceMenu() {}, closeSlashMenu() {}, openNote() {}
  });
  t.after(disposeKeyboardEvents);
  globalSearch.configure({
    bodyText: body => body,
    typeLabel: id => id,
    formatDate: value => String(value),
    isSafeUrl: url => /^https:\/\//.test(url)
  });
  dom.window.document.querySelector('#searchTop').click();
  await nextTick();
  assert.equal(globalSearch.open, true, 'desktop search opens directly from the Vue search trigger');
  globalSearch.close();
  await nextTick();
  await nextTick();
  const mobileSearchTrigger = dom.window.document.querySelector('#mobileSearch');
  mobileSearchTrigger.focus();
  assert.equal(dom.window.document.activeElement, mobileSearchTrigger, 'the search trigger can receive focus before opening the dialog');
  mobileSearchTrigger.click();
  assert.equal(dom.window.document.activeElement, mobileSearchTrigger, 'opening the dialog does not blur its trigger before focus capture');
  await nextTick();
  await nextTick();
  assert.equal(globalSearch.open, true, 'mobile search opens directly from the Vue navigation');
  const searchDialog = dom.window.document.querySelector('#switcher');
  assert.ok(searchDialog, 'Vue renders the search dialog when the store opens');
  assert.equal(searchDialog.getAttribute('aria-modal'), 'true', 'search exposes modal semantics to assistive technology');
  const searchInput = dom.window.document.querySelector('#globalSearch');
  assert.equal(dom.window.document.activeElement, searchInput, 'opening the dialog moves focus to search input');
  globalSearch.setQuery('no matching record');
  await nextTick();
  const tab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  searchInput.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, true, 'Tab remains inside the search dialog when there are no results');
  assert.equal(dom.window.document.activeElement, searchInput);
  globalSearch.setQuery('');
  await nextTick();
  const searchResults = [...searchDialog.querySelectorAll('.switcher-item')];
  assert.equal(searchResults.length, 2, 'the fixture exposes one note and one bookmark result');
  searchResults.at(-1).focus();
  const lastTab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  searchResults.at(-1).dispatchEvent(lastTab);
  assert.equal(lastTab.defaultPrevented, true, 'Tab from the final search result wraps to the search input');
  assert.equal(dom.window.document.activeElement, searchInput);
  const firstReverseTab = new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  searchInput.dispatchEvent(firstReverseTab);
  assert.equal(firstReverseTab.defaultPrevented, true, 'Shift+Tab from the search input wraps to the final result');
  assert.equal(dom.window.document.activeElement, searchResults.at(-1));
  searchInput.focus();
  searchInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  await nextTick();
  await nextTick();
  assert.equal(globalSearch.open, false, 'the search keyboard shortcut closes the dialog');
  assert.equal(commandPalette.open, false, 'closing the search dialog does not bubble the shortcut and open a second dialog');
  assert.equal(dom.window.document.activeElement, mobileSearchTrigger, 'closing from the keyboard restores focus to the opener');
  globalSearch.show();
  await nextTick();
  dom.window.document.querySelector('.search-dismiss-layer').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await nextTick();
  assert.equal(globalSearch.open, false, 'clicking outside the search dialog closes it through its component backdrop');
  dom.window.document.querySelector('#newSide').click();
  assert.equal(commands.at(-1)?.type, 'open-create-menu', 'the sidebar create action uses the typed navigation command');
  dom.window.document.querySelector('#brandHome').click();
  assert.deepEqual(commands.at(-1), { type: 'dashboard' }, 'the sidebar brand returns home through the typed Vue navigation command');
  commands.splice(0, commands.length);
  appSettings.setIndicators({ hasConflict: true, hasIgnoredDraft: true });
  appSettings.show();
  await nextTick();
  await nextTick();
  const settingsOverlay = dom.window.document.querySelector('#appSettingsOverlay');
  assert.equal(settingsOverlay.classList.contains('open'), true);
  assert.equal(dom.window.document.querySelector('#reviewSyncConflict').hidden, false);
  assert.equal(dom.window.document.querySelector('#restoreLocalDraft').hidden, false);
  dom.window.document.querySelector('#exportBtn').click();
  assert.deepEqual(appSettingsCommands, ['export-backup']);
  appSettings.close();
  await nextTick();
  assert.equal(settingsOverlay.classList.contains('open'), false);

  navigation.page = 'bookmarks';
  await nextTick();
  const bookmarkSearch = dom.window.document.querySelector('#dashboardHost .bookmark-page input[type="search"]');
  assert.ok(bookmarkSearch, 'the bookmark feature page is mounted by Vue');
  bookmarkSearch.value = 'MDN';
  bookmarkSearch.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(dom.window.document.querySelectorAll('#dashboardHost .bookmark-card').length, 1);
  assert.equal(bookmarks.snapshot.query, 'mdn');
  assert.deepEqual(bookmarkCommands, [], 'view-only actions are handled in Pinia without calling the legacy action adapter');
  dom.window.document.querySelector('#dashboardHost .bookmark-page .workspace-page-actions > button.secondary-btn').click();
  await nextTick();
  dom.window.document.querySelector('#dashboardHost [aria-label="选择MDN"]').click();
  await nextTick();
  assert.equal(bookmarks.snapshot.selection.count, 1);
  assert.deepEqual(bookmarkCommands, [], 'organizing and selection remain feature-local UI state');
  dom.window.document.querySelector('#dashboardHost [data-bm-folder="folder-reading"]').click();
  await nextTick();
  assert.equal(bookmarks.snapshot.selectedFolder, 'folder-reading');
  assert.equal(bookmarks.snapshot.query, '');
  assert.deepEqual(bookmarkCommands, [], 'folder selection does not dispatch through the legacy DOM view');
  dom.window.document.querySelector('#dashboardHost .bookmark-page .workspace-page-actions > button.primary-btn').click();
  await nextTick();
  const bookmarkDialog = dom.window.document.querySelector('#bookmarkEditOverlay');
  assert.ok(bookmarkDialog, 'adding a bookmark opens its feature dialog');
  assert.equal(bookmarkDialog.querySelector('#bookmarkEditParent').value, 'folder-reading');
  bookmarkDialog.querySelector('#bookmarkEditName').value = '说明文档';
  bookmarkDialog.querySelector('#bookmarkEditName').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  bookmarkDialog.querySelector('#bookmarkEditUrl').value = 'https://docs.example.test';
  bookmarkDialog.querySelector('#bookmarkEditUrl').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  bookmarkDialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
  assert.deepEqual(bookmarkCommands, [
    { type: 'add-link', parentId: 'folder-reading' },
    { type: 'save-editor' }
  ]);
  assert.equal(bookmarks.editor.title, '说明文档');
  bookmarks.closeEditor();
  bookmarkCommands.length = 0;
  const bookmarkCard = dom.window.document.querySelector('#dashboardHost .bookmark-card');
  bookmarkCard.querySelector('.item-menu summary').click();
  bookmarkCard.querySelector('.item-menu-panel .danger-btn').click();
  await nextTick();
  const deleteDialog = dom.window.document.querySelector('#bookmarkDeleteOverlay');
  assert.ok(deleteDialog, 'deleting a bookmark opens the in-page confirmation dialog');
  assert.equal(deleteDialog.getAttribute('role'), null, 'the dialog container is not mistaken for the alertdialog');
  assert.equal(deleteDialog.querySelector('[role="alertdialog"] #bookmarkDeleteTitle').textContent, '删除书签');
  deleteDialog.querySelector('.danger-btn').click();
  await nextTick();
  assert.deepEqual(bookmarkCommands, [
    { type: 'delete', id: 'bookmark-mdn' },
    { type: 'confirm-delete' }
  ]);
  bookmarks.closeDeleteDialog();
  bookmarkCommands.length = 0;
  dom.window.document.querySelector('#dashboardHost [aria-label="选择MDN"]').click();
  await nextTick();
  const bulkDeleteButton = dom.window.document.querySelector('#dashboardHost .bookmark-selection-bar .danger-btn');
  assert.ok(bulkDeleteButton && !bulkDeleteButton.disabled);
  bulkDeleteButton.click();
  await nextTick();
  const bulkDialog = dom.window.document.querySelector('#bookmarkBulkOverlay');
  assert.ok(bulkDialog, 'bulk deletion opens the feature confirmation dialog');
  assert.match(bulkDialog.querySelector('#bookmarkBulkMessage').textContent, /1 个网址移入回收站/);
  bulkDialog.querySelector('.danger-btn').click();
  await nextTick();
  assert.deepEqual(bookmarkCommands, [
    { type: 'bulk-delete' },
    { type: 'confirm-bulk' }
  ]);
  bookmarks.closeBulkDialog();
  bookmarkCommands.length = 0;

  let pickerClicks = 0;
  const bookmarkFileInput = dom.window.document.querySelector('#dashboardHost .bookmark-page input[type="file"]');
  assert.ok(bookmarkFileInput.classList.contains('visually-hidden'), 'the native browser picker stays visually hidden');
  assert.equal(bookmarkFileInput.getAttribute('accept'), '.html,.htm,text/html', 'bookmark import accepts browser-exported HTML only');
  const styles = await readFile(new URL('../../../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.visually-hidden\{position:absolute!important;width:1px!important;height:1px!important/);
  bookmarkFileInput.click = () => { pickerClicks++; };
  dom.window.document.querySelector('#dashboardHost .bookmark-tools summary').click();
  bookmarkCommands.length = 0;
  [...dom.window.document.querySelectorAll('#dashboardHost .bookmark-tools button')].find(button => button.textContent.includes('导入书签')).click();
  await nextTick();
  assert.equal(pickerClicks, 1, 'the import action opens the Vue-owned file picker');
  assert.deepEqual(bookmarkCommands, [{ type: 'import' }]);
  bookmarkCommands.length = 0;
  bookmarks.openImportDialog({ items: [], folders: [{ id: 'folder-preview', path: '资料 / 手册' }], added: 2, duplicates: 1, skipped: 0 });
  await nextTick();
  const importDialog = dom.window.document.querySelector('#bookmarkImportOverlay');
  assert.ok(importDialog, 'the parsed bookmark file is presented in a Vue import preview');
  assert.match(importDialog.querySelector('#bookmarkImportMessage').textContent, /新增 2 个书签 · 跳过 1 个重复项/);
  assert.equal(importDialog.querySelector('[aria-label="导入分组预览"]').textContent.trim(), '资料 / 手册');
  importDialog.querySelector('.primary-btn').click();
  await nextTick();
  assert.deepEqual(bookmarkCommands, [{ type: 'confirm-import' }]);
  bookmarks.closeImportDialog();
  await nextTick();
  bookmarkCommands.length = 0;
  dom.window.document.querySelector('#dashboardHost .bookmark-tools').open = false;
  navigation.page = 'home';
  await nextTick();

  profileSettings.show();
  await nextTick();
  await nextTick();
  assert.equal(dom.window.document.querySelector('#profileSettingsOverlay').classList.contains('open'), true);
  assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('#profileSettingsOverlay [role="dialog"]'));
  assert.equal(dom.window.document.querySelector('#profileSettingsMessage').textContent, '当前是本地界面预览；请登录部署后的栖点管理头像和密码。');
  profileSettings.close();
  await nextTick();
  await nextTick();
  assert.equal(dom.window.document.querySelector('#profileSettingsOverlay').classList.contains('open'), false);
  assert.ok(dom.window.document.querySelector('#backupHistoryOverlay'), 'backup history is rendered by the shared Vue root');
  backupHistory.show();
  await backupHistory.refresh();
  await nextTick();
  assert.equal(dom.window.document.querySelector('#backupHistoryOverlay').classList.contains('open'), true);
  assert.equal(dom.window.document.querySelectorAll('#backupHistoryList .backup-row').length, 1);
  assert.match(dom.window.document.querySelector('#backupHistoryOverlay').textContent, /不含附件文件/);
  dom.window.document.querySelector('[data-backup-download="2"]').click();
  dom.window.document.querySelector('[data-backup-restore="2"]').click();
  await nextTick();
  assert.deepEqual(backupActions, [['download', 2], ['restore', 2]], 'backup controls call their configured workflows directly from Vue');
  backupHistory.close();
  await nextTick();
  assert.equal(dom.window.document.querySelector('#backupHistoryOverlay').classList.contains('open'), false);
  dom.window.document.querySelector('.note-item-menu').open = true;

  let bubbledClicks = 0;
  dom.window.document.addEventListener('click', () => { bubbledClicks += 1; });
  dom.window.document.querySelector('#toggleNoteTypes').click();
  dom.window.document.querySelector('#addNoteType').click();
  dom.window.document.querySelector('#sideTypes [data-type-edit="note"]').click();
  dom.window.document.querySelector('#sideTypes [data-type-delete="command"]').click();
  assert.equal(dom.window.document.querySelector('#addCategory'), null, 'category creation is no longer part of the sidebar');
  assert.equal(dom.window.document.querySelector('#categoryFeatureOverlay'), null, 'the category dialog is no longer mounted');
  dom.window.document.querySelector('#qidianSidebarIsland [data-dashboard]').click();
  dom.window.document.querySelector('#qidianSidebarIsland [data-nav="recent"]').click();
  dom.window.document.querySelector('#qidianSidebarIsland [data-type-nav="note"]').click();
  dom.window.document.querySelector('#mobileHome').click();
  dom.window.document.querySelector('#mobileCats').click();
  dom.window.document.querySelector('#mobileNew').click();
  dom.window.document.querySelector('#mobileBookmarks').click();
  dom.window.document.querySelector('#dashboardHost [data-new="note"]').click();
  dom.window.document.querySelector('#dashboardHost .note-card-open[data-open="note-1"]').click();
  dom.window.document.querySelector('#dashboardHost [data-note-edit="note-1"]').click();
  dom.window.document.querySelector('#dashboardHost [data-note-delete="note-1"]').click();
  dom.window.document.querySelector('#dashboardHost .home-type-tabs [data-type="all"]').click();

  assert.deepEqual(commands, [
    { type: 'dashboard' },
    { type: 'home', category: 'recent' },
    { type: 'note-type', id: 'note' },
    { type: 'dashboard' },
    { type: 'home', category: 'all' },
    { type: 'open-create-menu' },
    { type: 'bookmarks' },
    { type: 'create-note', kind: 'note' },
    { type: 'open-note', id: 'note-1' },
    { type: 'open-note', id: 'note-1', forceEdit: true },
    { type: 'filter-home', typeFilter: 'all' }
  ]);
  assert.deepEqual(shellCommands, [
    { type: 'toggle-note-types' },
    { type: 'add-note-type' },
    { type: 'edit-note-type', id: 'note' },
    { type: 'delete-note-type', id: 'command' },
    { type: 'delete-note', id: 'note-1' }
  ]);
  assert.equal(bubbledClicks, 0, 'these Vue actions do not reach the legacy document click router');
  dom.window.document.querySelector('#themeBtn').click();
  await nextTick();
  assert.equal(shell.themeMenuOpen, true, 'the Vue theme button dispatches the typed shell action');
  assert.deepEqual(shellCommands.at(-1), { type: 'toggle-theme-menu' });
  dom.window.document.querySelector('[data-theme-choice="dark"]').click();
  await nextTick();
  assert.equal(shell.themePreference, 'dark', 'theme choices are routed through the shell action boundary');
  assert.equal(shell.themeMenuOpen, false);
  dom.window.document.querySelector('#accountButton').click();
  await nextTick();
  assert.equal(shell.accountMenuOpen, true, 'the account menu is opened by its direct Vue action');
  dom.window.document.querySelector('#openAppSettings').click();
  await nextTick();
  assert.deepEqual(shellCommands.at(-1), { type: 'open-app-settings' });
  assert.equal(shell.accountMenuOpen, false, 'opening settings closes the account menu');
  dom.window.document.querySelector('#accountButton').click();
  await nextTick();
  dom.window.document.querySelector('#dashboardHost').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await nextTick();
  assert.equal(shell.accountMenuOpen, false, 'clicking outside the topbar closes open menus without a global route handler');

  navigation.page = 'dashboard';
  await nextTick();
  const dashboardGroups = dom.window.document.querySelector('#dashboardHost .dashboard-bookmark-groups');
  assert.ok(dashboardGroups, 'the dashboard page is mounted as a Vue feature when its route is active');
  dom.window.document.querySelector('#dashboardHost [data-dashboard-add-bookmark]').click();
  assert.deepEqual(commands.at(-1), { type: 'add-bookmark' }, 'the Vue dashboard button dispatches add-bookmark directly through typed navigation');
  commands.pop();
  dom.window.document.querySelector('#dashboardHost [data-dashboard-layout="double"]').click();
  await nextTick();
  assert.equal(dashboardGroups.classList.contains('is-double'), true, 'the layout follows the reactive dashboard snapshot');
  assert.equal(vault.value.dashboardBookmarkLayout, 'double');
  dom.window.document.querySelector('#dashboardHost [data-dashboard-bookmark-folder="folder-reading"]').click();
  await nextTick();
  assert.equal(dom.window.document.querySelector('#dashboardHost [data-dashboard-folder="folder-reading"]').open, false, 'folder disclosure follows Pinia state rather than a direct DOM toggle');
  dom.window.document.querySelector('#dashboardHost [data-dashboard-folders="expand"]').click();
  await nextTick();
  assert.equal(dom.window.document.querySelectorAll('#dashboardHost .dashboard-bookmark-card[open]').length, 1);
  assert.equal(dashboardPersistCalls, 3, 'each changed Vue preference is persisted through its dashboard action');

  navigation.page = 'note';
  navigation.noteId = note.id;
  navigation.editing = true;
  editorData.sync({
    noteId: note.id, title: note.title, type: note.type, category: note.category, tags: note.tags.join(', '), source: note.source,
    noteTypes: [{ id: 'note', label: '普通笔记' }, { id: 'command', label: '命令速查' }], categories: ['网络'], publishLabel: '保存笔记', pasteMode: 'rich', revision: 0
  });
  editorData.setOutline([
    { level: 2, text: '网关配置', position: 2 },
    { level: 3, text: 'DNS 设置', position: 10 }
  ]);
  await nextTick();
  const mobileOutline = dom.window.document.querySelector('.editor-outline-mobile .editor-outline-link');
  const desktopOutline = dom.window.document.querySelector('.edit-inspector .editor-outline-link.level-3');
  assert.equal(mobileOutline.textContent, '网关配置');
  assert.equal(desktopOutline.textContent, 'DNS 设置');
  desktopOutline.click();
  assert.deepEqual(editorRuntimeActions, [{ group: 'outline', action: 'goto', position: 10 }], 'Vue renders outline state and dispatches a typed navigation action');
  editorData.setToolbarState({
    marks: { bold: true, italic: false, underline: false, strikeThrough: false, code: false },
    block: 'h2', inTable: true, inCodeBlock: true, inCallout: true,
    canUndo: true, canRedo: false, hasLink: true, canConvertTable: true,
    paragraph: { visible: true, moveUp: true, moveDown: false, duplicate: true, delete: true }
  });
  await nextTick();
  assert.equal(dom.window.document.querySelector('#blockSelect').value, 'h2');
  assert.equal(dom.window.document.querySelector('[data-fmt="bold"]').getAttribute('aria-pressed'), 'true');
  assert.equal(dom.window.document.querySelector('.table-tools').hidden, false);
  assert.equal(dom.window.document.querySelector('.code-tools').hidden, false);
  assert.equal(dom.window.document.querySelector('[data-editor-action="undo"]').disabled, false);
  assert.equal(dom.window.document.querySelector('[data-editor-action="delete-callout"]').disabled, false);
  assert.equal(dom.window.document.querySelector('[data-block-action="moveDown"]').disabled, true);
  assert.ok(dom.window.document.querySelector('.editor-properties summary'));
  assert.ok(dom.window.document.querySelector('.editor-extra-tools summary'));
  const editorTitle = dom.window.document.querySelector('#editTitle');
  assert.equal(editorTitle.value, '路由配置');
  editorTitle.value = 'Vue 表单状态';
  editorTitle.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const editorType = dom.window.document.querySelector('#editType');
  editorType.value = 'command';
  editorType.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(dom.window.document.querySelector('#editCategory'), null, 'category is not an editable field');
  const editorTags = dom.window.document.querySelector('#editTags');
  editorTags.value = 'OpenWrt, Docker';
  editorTags.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const editorSource = dom.window.document.querySelector('#editSource');
  editorSource.value = 'https://example.com';
  editorSource.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const clicksBeforeEditorActions = bubbledClicks;
  dom.window.document.querySelector('#saveEditor').click();
  dom.window.document.querySelector('#addAttachment').click();
  dom.window.document.querySelector('#exportHtml').click();
  dom.window.document.querySelector('#addImgButton').click();
  dom.window.document.querySelector('#deleteEditorNote').click();
  assert.deepEqual(editorPageCommands, [
    { type: 'save-current' },
    { type: 'choose-attachment' },
    { type: 'export-html' },
    { type: 'choose-image' },
    { type: 'delete-current' }
  ]);
  assert.equal(bubbledClicks, clicksBeforeEditorActions, 'editor page actions do not enter the document-level compatibility click router');
  editorTitle.dispatchEvent(new dom.window.Event('blur'));
  await nextTick();
  assert.deepEqual(editorData.form, { title: 'Vue 表单状态', type: 'command', category: '网络', tags: 'OpenWrt, Docker', source: 'https://example.com' });
  assert.equal(editorFormChanges.length, 4);
  assert.deepEqual(editorFormChanges.at(-1), editorData.form, 'the form-change boundary observes v-model values before saving');
  assert.equal(editorFormBlurs, 1, 'leaving a metadata field flushes the editor save');

  const dialogSubmissions = [];
  noteTypeDialog.bindSave(input => { dialogSubmissions.push(input); noteTypeDialog.close(); });
  noteTypeDialog.open({ mode: 'create', id: null, title: '新增笔记类型', hint: '', name: '' });
  await nextTick();
  const typeName = dom.window.document.querySelector('#typeNameInput');
  typeName.value = '读书笔记';
  typeName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  typeName.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();
  assert.deepEqual(dialogSubmissions[0], { mode: 'create', id: null, name: '读书笔记' });

  noteTypeDialog.open({
    mode: 'delete', id: 'reading', title: '删除笔记类型', hint: '类型下的笔记会保留。', noteCount: 2,
    options: [{ id: 'note', name: '普通笔记' }, { id: 'task', name: '待办', autoCreate: true }]
  });
  const clicksBeforeDialogActions = bubbledClicks;
  await nextTick();
  assert.equal(dom.window.document.querySelector('#typeDialogHint').textContent, '类型下的笔记会保留。');
  const replacement = dom.window.document.querySelector('#typeReplacement');
  replacement.value = 'task';
  replacement.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  dom.window.document.querySelector('#typeDialogConfirm').click();
  await nextTick();
  assert.deepEqual(dialogSubmissions[1], { mode: 'delete', id: 'reading', targetId: 'task' });
  assert.equal(bubbledClicks, clicksBeforeDialogActions, 'the Vue dialog consumes its confirmation instead of triggering the legacy click router');

  createMenu.open();
  await nextTick();
  assert.ok(dom.window.document.querySelector('#createFeatureOverlay [role="dialog"]'));
  assert.deepEqual(Array.from(dom.window.document.querySelectorAll('#createFeatureOverlay [data-create-kind]')).map(button => button.dataset.createKind), ['note', 'bookmark', 'capture']);
  const clicksBeforeCreateAction = bubbledClicks;
  dom.window.document.querySelector('#createFeatureOverlay [data-create-kind="bookmark"]').click();
  await nextTick();
  assert.equal(createMenu.visible, false, 'selecting a create action closes the menu after navigation accepts it');
  assert.deepEqual(commands.at(-1), { type: 'create-from-menu', kind: 'bookmark' });
  assert.equal(bubbledClicks, clicksBeforeCreateAction, 'the Vue create menu dispatches a typed action without document click routing');

  const captureSubmissions = [];
  const capturePasteTargets = [];
  let rejectCapture = true;
  captureDialog.bindSave(input => {
    if (rejectCapture) throw new Error('保存失败，请重试');
    captureSubmissions.push(input);
  });
  captureDialog.bindPasteHandler(event => {
    capturePasteTargets.push(event.target?.id);
    event.preventDefault();
  });
  const captureLauncher = dom.window.document.createElement('button');
  captureLauncher.id = 'captureLauncher';
  dom.window.document.body.append(captureLauncher);
  captureLauncher.focus();
  captureDialog.open({
    types: [{ id: 'note', name: '普通笔记' }, { id: 'clip', name: '网页摘录' }],
    pasteMode: 'markdown'
  });
  await nextTick();
  assert.equal(dom.window.document.querySelector('#captureOverlay[role="dialog"]'), null);
  assert.ok(dom.window.document.querySelector('#captureOverlay form[role="dialog"]'));
  assert.deepEqual(Array.from(dom.window.document.querySelectorAll('#captureType option')).map(option => option.value), ['note', 'clip']);
  assert.equal(dom.window.document.querySelector('#captureCat'), null, 'quick capture uses note type without a category field');
  assert.equal(dom.window.document.querySelector('#captureType').value, 'clip');
  assert.equal(dom.window.document.querySelector('#capturePasteMode').value, 'markdown');

  const captureName = dom.window.document.querySelector('#captureName');
  captureName.value = '路由器维护';
  captureName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const captureSource = dom.window.document.querySelector('#captureSource');
  captureSource.value = 'https://example.com/guide';
  captureSource.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const capturePad = dom.window.document.querySelector('#capturePad');
  const pasteEvent = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  capturePad.dispatchEvent(pasteEvent);
  assert.deepEqual(capturePasteTargets, ['capturePad'], 'the Vue capture pad forwards paste directly to its feature handler');
  assert.equal(pasteEvent.defaultPrevented, true, 'the feature paste handler controls native browser insertion');
  capturePad.innerHTML = '<p>更新 DNS 配置</p>';
  dom.window.document.querySelector('#captureOverlay form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  await nextTick();
  assert.equal(captureDialog.visible, true, 'a failed save keeps the dialog available for correction or retry');
  assert.equal(dom.window.document.querySelector('#captureMessage').textContent, '保存失败，请重试');

  rejectCapture = false;
  dom.window.document.querySelector('#captureOverlay form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setImmediate(resolve));
  await nextTick();
  assert.deepEqual(captureSubmissions[0], {
    title: '路由器维护', type: 'clip', source: 'https://example.com/guide', body: '<p>更新 DNS 配置</p>'
  });
  assert.equal(captureDialog.visible, false, 'successful save closes the dialog only after the save handler resolves');
  assert.notEqual(dom.window.document.activeElement, captureLauncher, 'successful navigation does not steal focus back to the capture launcher');

  captureLauncher.focus();
  assert.equal(dom.window.document.activeElement, captureLauncher, 'the launcher can receive focus after the save dialog closes');
  captureDialog.open({ types: [{ id: 'clip', name: '网页摘录' }], pasteMode: 'rich' });
  await nextTick();
  await nextTick();
  assert.equal(dom.window.document.activeElement, dom.window.document.querySelector('#capturePad'), 'opening moves focus into the capture content field');
  assert.equal(captureDialog.saving, false);
  dom.window.document.querySelector('#captureOverlay .dialog-foot .secondary-btn').click();
  assert.equal(captureDialog.visible, false);
  await nextTick();
  assert.equal(dom.window.document.activeElement, captureLauncher, 'canceling restores focus to the control that opened the dialog');

  navigation.page = 'note';
  navigation.noteId = note.id;
  navigation.editing = false;
  navigation.previewing = false;
  await nextTick();
  await nextTick();
  assert.equal(reader.active, true, 'the reader route is active in Pinia');
  assert.equal(reader.snapshot.title, '已发布版本');
  assert.ok(dom.window.document.querySelector('.reader-shell'), 'the Vue reader page is mounted');
  assert.equal(dom.window.document.querySelector('#dashboardHost').getAttribute('aria-label'), '已发布版本');
  assert.equal(dom.window.document.querySelector('.reader-shell .doc-content h2').textContent, '网关配置');
  assert.ok(dom.window.document.querySelector('#showDraftView'));
  const clicksBeforeReaderActions = bubbledClicks;
  dom.window.document.querySelector('#editDoc').click();
  dom.window.document.querySelector('#showDraftView').click();
  dom.window.document.querySelector('#pinDoc').click();
  dom.window.document.querySelector('.document-more').open = true;
  dom.window.document.querySelector('#duplicateDoc').click();
  dom.window.document.querySelector('#deleteDoc').click();
  navigation.previewing = true;
  await nextTick();
  await nextTick();
  dom.window.document.querySelector('#publishDoc').click();
  assert.deepEqual(readerCommands, [
    { type: 'edit-current' },
    { type: 'show-pending-changes' },
    { type: 'toggle-current-pin' },
    { type: 'duplicate-current' },
    { type: 'delete-current' },
    { type: 'publish-current' }
  ]);
  assert.equal(bubbledClicks, clicksBeforeReaderActions, 'reader actions do not enter the document-level compatibility click router');

  navigation.noteId = 'missing-note';
  await nextTick();
  await nextTick();
  assert.deepEqual(commands.at(-1), { type: 'home', category: 'all' }, 'a stale reader route recovers through the typed navigation action');
});
