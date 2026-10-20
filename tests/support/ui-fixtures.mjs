import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';

import { JSDOM } from 'jsdom';

import { createPinia } from 'pinia';

import createDOMPurify from 'dompurify';

import { createQidianEditor } from '../../src/features/editor/editor.js';

import { createEditorPageLifecycle } from '../../src/features/editor/page-lifecycle.ts';

import { createLegacyEditorPageController } from '../../src/compat/editor/legacy-page-controller.ts';

import { createEditorHtmlInserter } from '../../src/features/editor/html-inserter.ts';

import { createEditorPagePreparation } from '../../src/features/editor/page-preparation.ts';

import { createEditorActionDispatcher } from '../../src/features/editor/action-dispatcher.ts';

import { TextSelection } from '@tiptap/pm/state';

import { DEFAULT_NOTE_TYPES, validateVault } from '../../server/validation.js';

import { createBookmarkView } from '../../src/compat/bookmarks-view.js';

import { bookmarksHTML, mergeBookmarks, parseBookmarks } from '../../src/features/bookmarks/data.js';

import { createRecycleBinView } from '../../src/compat/recycle-bin-view.js';

import { createTrashWorkflows } from '../../src/features/trash/workflows.ts';

import { createDashboardActions } from '../../src/features/dashboard/actions.ts';

import { createVaultMutation } from '../../src/features/vault/mutation.ts';

import { createBookmarkMutationActions } from '../../src/features/bookmarks/mutation-actions.ts';

import { createVaultPersistence } from '../../src/features/vault/persistence.ts';

import { createWorkspaceReplacementFlow } from '../../src/features/vault/workspace-replacement-flow.ts';

import { createNoteTypeDialogFlow } from '../../src/features/notes/type-dialog-flow.ts';

import { createNoteTypeDialogPresenter } from '../../src/features/notes/type-dialog-presenter.ts';

import { createNoteTypeDialogOpenFlow } from '../../src/features/notes/type-dialog-open-flow.ts';

import { createLegacyNoteTypeDialog } from '../../src/compat/notes/legacy-type-dialog.ts';

import { createCategoryDialogFlow } from '../../src/features/categories/category-dialog-flow.ts';

import { createCategoryDialogController } from '../../src/features/categories/category-dialog-controller.ts';

import { createLegacyCategoryDialog } from '../../src/compat/categories/legacy-category-dialog.ts';

import { createCaptureFlow } from '../../src/features/capture/capture-flow.ts';

import { createCaptureDialogController } from '../../src/features/capture/capture-dialog-controller.ts';

import { createCaptureDialogPresenter } from '../../src/features/capture/capture-dialog-presenter.ts';

import { createCaptureDOMAdapter } from '../../src/features/capture/capture-dom-adapter.ts';

import { createLegacyCaptureDialog } from '../../src/compat/capture/legacy-capture-dialog.ts';

import { mountEditorSearch } from '../../src/features/editor/search-controller.ts';

import { createEditorCommandController } from '../../src/features/editor/command-controller.ts';

import { createEditorPageActions } from '../../src/features/editor/page-actions.ts';

import { createEditorRuntimeController } from '../../src/features/editor/runtime-controller.ts';

import { createEditorOutlineController } from '../../src/features/editor/outline-controller.ts';

import { createLegacyEditorToolbarView } from '../../src/compat/editor/legacy-toolbar-view.ts';

import { createEditorToolbarState } from '../../src/features/editor/toolbar-state.ts';

import { createEditorInsertController } from '../../src/features/editor/insert-controller.ts';

import { createEditorDraftController } from '../../src/features/editor/draft-controller.ts';

import { createEditorAutosaveController } from '../../src/features/editor/autosave-controller.ts';

import { createEditorFormAdapter } from '../../src/features/editor/form-adapter.ts';

import { connectSessionRecoveryFlow } from '../../src/features/auth/session-recovery-flow.ts';

import { createWorkspaceViewDispatcher } from '../../src/features/navigation/workspace-view-dispatcher.ts';

import { createVueWorkspaceViewPresentation } from '../../src/features/navigation/vue-workspace-view-presentation.ts';

import { createLegacyWorkspaceViewPresentation } from '../../src/compat/navigation/legacy-workspace-view-presentation.ts';

import { createWorkspaceNavigationActions } from '../../src/features/navigation/workspace-navigation-actions.ts';

import { createWorkspaceShellActions } from '../../src/features/navigation/workspace-shell-actions.ts';

import { createLegacyWorkspaceRenderer } from '../../src/compat/navigation/legacy-workspace-renderer.js';

import { mountWorkspaceInteractionRuntime } from '../../src/features/lifecycle/workspace-interaction-runtime.ts';

import { createCurrentVaultSnapshot } from '../../src/features/sync/current-vault-snapshot.ts';

import { renderLegacyEditorMarkup } from '../../src/compat/editor/legacy-editor-view.js';

import { createEditorToolbarEvents } from '../../src/features/editor/toolbar-events.ts';

import { mountEditorFileInputEvents } from '../../src/features/editor/file-input-events.ts';

import { mountBackupImportFileEvents } from '../../src/features/settings/import-file-events.ts';

import { createProfileSettingsFlow } from '../../src/features/account/profile-settings-flow.ts';

import { createSignOutFlow } from '../../src/features/account/sign-out-flow.ts';

import { createAppSettingsActions } from '../../src/features/settings/app-settings-actions.ts';

import { createNotePublishFlow } from '../../src/features/editor/note-publish-flow.ts';

import { createContentInsertionController } from '../../src/features/editor/content-insertion.ts';

import { createAttachmentUploadFlow } from '../../src/features/editor/attachment-upload.ts';

import { saveNoteDraft } from '../../src/features/notes/draft-actions.ts';

import { createNoteDeleteWorkflow } from '../../src/features/notes/delete-workflow.ts';

import { createEditorDeleteWorkflow } from '../../src/features/notes/editor-delete-workflow.ts';

import { createNote as createVaultNote, duplicateNote as duplicateVaultNote } from '../../src/features/notes/note-actions.ts';

import { createNoteController as createNewNoteController } from '../../src/features/notes/create-note-controller.ts';

import { isDraftNote as isDraft, needsPublish, publishedNoteView as publishedView, selectNotes } from '../../src/features/notes/selectors.ts';

import { createNoteType, deleteNoteType, renameNoteType } from '../../src/features/notes/type-actions.ts';

import { createHtmlContentTools } from '../../src/features/content/html-content.ts';

import { createPastedTitleAutofill } from '../../src/features/content/pasted-title-autofill.ts';

import { createLegacyEditorOutlineView } from '../../src/compat/editor/legacy-editor-outline-view.ts';

import { createMobileMenuFocusController } from '../../src/features/navigation/mobile-menu-focus-controller.ts';

import { createReaderSnapshot } from '../../src/features/reader/snapshot.ts';

import { createReaderActions } from '../../src/features/reader/actions.ts';

import { mountCodeCopyButtons } from '../../src/features/reader/code-copy.ts';

import { mountHeadingObserver } from '../../src/features/reader/heading-observer.ts';

import { createDraftContentTools } from '../../src/features/notes/draft-content.ts';

import { createNoteCardSnapshot } from '../../src/features/notes/card-snapshot.ts';

import { createEditorSessionSnapshot, normalizeEditorPasteMode } from '../../src/features/editor/session-snapshot.ts';

import { createSlashMenuController } from '../../src/features/editor/slash-menu-controller.ts';

import { renderLegacyCategoryOptions } from '../../src/compat/categories/legacy-option-markup.ts';

import { createLegacyCreateMenu } from '../../src/compat/create-menu/legacy-create-menu.ts';

import { createThemeController } from '../../src/features/appearance/theme-controller.ts';

import { createRemoteEditorRefresh } from '../../src/features/editor/remote-refresh.ts';

import { createRemoteVaultUpdateController } from '../../src/features/sync/remote-vault-update-controller.ts';

import { createSystemUpdateController } from '../../src/features/system-updates/controller.ts';

import { createSyncConflictController } from '../../src/features/sync/sync-conflict-controller.ts';

import { createWorkspaceNavigationController } from '../../src/features/navigation/workspace-navigation-controller.ts';

import { createWorkspaceNavigationEvents, createWorkspaceNavigationEventsForMode } from '../../src/features/navigation/workspace-navigation-events.ts';

import { mountWorkspaceClickRouter } from '../../src/features/navigation/workspace-click-router.ts';

import { createWorkspaceShellEvents } from '../../src/features/navigation/workspace-shell-events.ts';

import { mountWorkspaceKeyboardEvents } from '../../src/features/navigation/workspace-keyboard-events.ts';

import { mountWorkspaceStaticDomEvents } from '../../src/features/navigation/workspace-static-dom-events.ts';

import { createWorkspaceContentEvents } from '../../src/features/navigation/workspace-content-events.ts';

import { mountItemMenuController } from '../../src/features/navigation/item-menu-controller.ts';

import { mountModalFocusLoop } from '../../src/features/dialogs/modal-focus-loop.ts';

import { mountEditorDocumentLifecycle } from '../../src/features/editor/document-lifecycle.ts';

import { mountWorkspaceLifecycle } from '../../src/features/lifecycle/workspace-lifecycle.ts';

import { mountWorkspaceSession } from '../../src/features/lifecycle/workspace-session.ts';

import { useNavigationStore } from '../../src/features/navigation/store.ts';

import { useCategoryDialogStore } from '../../src/features/categories/category-dialog-store.ts';

import { useNavigationActionsStore } from '../../src/features/navigation/navigation-actions-store.ts';

import { useWorkspaceShellActionsStore } from '../../src/features/navigation/workspace-shell-actions-store.ts';

import { useVaultStore } from '../../src/features/vault/store.ts';

import { useToastStore } from '../../src/features/notifications/store.ts';

import { useWorkspaceShellStore } from '../../src/features/navigation/workspace-shell-store.ts';

import { createBackupWorkflows } from '../../src/features/settings/backup-workflows.ts';

import { createBackupHistoryOpenFlow } from '../../src/features/settings/backup-history-open-flow.ts';

import { createTrashEntry, pruneExpiredTrash, restoreTrashEntry, TRASH_RETENTION_MS } from '../../src/domain/trash-data.js';

import { renderReleaseNotes } from '../../src/features/system-updates/release-notes.js';

import { classifyClipboard, looksLikeMarkdown, plainTextToDocument, sanitizeMarkdownDocument } from '../../src/features/content/paste.js';

import { parseQidianMarkdown, qidianSchema } from '../../src/features/content/markdown.js';

const loadMarkdownTools = async () => import('../../src/features/content/markdown.js');

const empty = { categories: ['开发'], noteTypes:[{id:'note',name:'普通笔记'},{id:'clip',name:'网页收藏'},{id:'command',name:'命令速查'},{id:'issue',name:'故障排查'}], notes: [], theme:'light', pasteMode:'rich' };

function createActionDialogHarness(document) {
  document.body.insertAdjacentHTML('beforeend','<div class="overlay" id="actionDialogOverlay"><section class="dialog action-dialog" role="dialog" aria-modal="true" aria-labelledby="actionDialogTitle" aria-describedby="actionDialogMessage" tabindex="-1"><div class="dialog-head"><h2 id="actionDialogTitle">确认操作</h2></div><div class="dialog-body"><p id="actionDialogMessage" class="action-dialog-message"></p><label class="form-label" id="actionDialogInputLabel" for="actionDialogInput" hidden></label><input class="form-text" id="actionDialogInput" type="text" autocomplete="off" hidden></div><div class="dialog-foot"><button class="secondary-btn" id="actionDialogCancel" type="button">取消</button><button class="primary-btn" id="actionDialogConfirm" type="button">确认</button></div></section></div>');
  const overlay=document.querySelector('#actionDialogOverlay'),dialog=overlay.querySelector('[role="dialog"]'),input=document.querySelector('#actionDialogInput');
  let pending=null;
  const close=accepted=>{
    if(!pending)return;
    const current=pending;pending=null;overlay.classList.remove('open');
    current.resolve(current.mode==='prompt'?accepted?input.value:null:!!accepted);
    if(current.returnFocus?.isConnected)current.returnFocus.focus();
  };
  document.querySelector('#actionDialogConfirm').addEventListener('click',()=>close(true));
  document.querySelector('#actionDialogCancel').addEventListener('click',()=>close(false));
  overlay.addEventListener('click',event=>{if(event.target===overlay)close(false)});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(false)}
    else if(event.key==='Enter'&&pending){event.preventDefault();event.stopPropagation();close(true)}
  });
  return options=>{
    if(pending)return Promise.resolve(options.mode==='prompt'?null:false);
    const mode=options.mode||'confirm';
    document.querySelector('#actionDialogTitle').textContent=options.title||'确认操作';
    document.querySelector('#actionDialogMessage').textContent=options.message||'';
    document.querySelector('#actionDialogConfirm').textContent=options.confirmText||'确认';
    document.querySelector('#actionDialogCancel').textContent=options.cancelText||'取消';
    document.querySelector('#actionDialogConfirm').classList.toggle('danger-btn',!!options.danger);
    input.value=String(options.inputValue??'');input.maxLength=options.maxLength||2048;input.hidden=mode!=='prompt';
    const label=document.querySelector('#actionDialogInputLabel');label.textContent=options.inputLabel||'';label.hidden=mode!=='prompt';
    overlay.classList.add('open');
    return new Promise(resolve=>{pending={mode,resolve,returnFocus:document.activeElement};(mode==='prompt'?input:document.querySelector('#actionDialogConfirm')).focus()});
  };
}

function createSyncConflictDialogHarness(document,window) {
  document.body.insertAdjacentHTML('beforeend','<div class="overlay" id="syncConflictOverlay"><section class="dialog sync-conflict-dialog" role="dialog" aria-modal="true"><div id="syncConflictSummary"></div><div id="syncConflictVersions"></div><p id="syncConflictBackupStatus" role="status"></p><button id="downloadSyncConflict" type="button">下载两版对照备份</button><button id="loadConflictCloud" type="button" disabled>载入 Docker 服务端版本</button></section></div>');
  const overlay=document.querySelector('#syncConflictOverlay'),summary=document.querySelector('#syncConflictSummary'),versions=document.querySelector('#syncConflictVersions'),status=document.querySelector('#syncConflictBackupStatus'),download=document.querySelector('#downloadSyncConflict'),restore=document.querySelector('#loadConflictCloud');
  const renderVersion=version=>{
    const section=document.createElement('section'),heading=document.createElement('h3');section.className='sync-conflict-version';heading.textContent=`${version.title} · ${version.changedCount} 篇笔记有变化`;section.append(heading);
    if(version.notes.length){for(const note of version.notes){const article=document.createElement('article'),title=document.createElement('strong'),excerpt=document.createElement('p');article.className='sync-conflict-note';title.textContent=note.title+(note.deleted?'（已删除）':'');excerpt.textContent=note.excerpt;article.append(title,excerpt);section.append(article)}}
    else{const empty=document.createElement('p');empty.textContent='冲突涉及分类、书签或其他结构化信息；完整内容已放入对照备份。';section.append(empty)}
    return section;
  };
  let actionHandler=()=>undefined;
  const store={visible:false,backupReady:false,exporting:false,restoring:false,bindActions(handler){actionHandler=handler},dispatch(action){return actionHandler(action)},show(local,remote){this.visible=true;this.backupReady=false;this.exporting=false;this.restoring=false;overlay.classList.add('open');summary.textContent='部分修改无法自动合并。系统已保留两个版本，请下载对照备份后再选择如何恢复。';versions.replaceChildren(renderVersion(local),renderVersion(remote));status.textContent='下载对照备份后，才能载入已保存版本。';status.className='account-settings-message';restore.disabled=true},close(){this.visible=false;overlay.classList.remove('open')},startExport(){this.exporting=true;download.disabled=true;status.textContent='正在整理两个版本及附件…'},exportSucceeded(){this.exporting=false;this.backupReady=true;download.disabled=false;restore.disabled=false;status.textContent='对照备份已下载，确认后可载入 Docker 服务端版本。';status.className='account-settings-message success'},exportFailed(message){this.exporting=false;download.disabled=false;status.textContent=message;status.className='account-settings-message error'},startRestore(){this.restoring=true;restore.disabled=true},restoreFailed(message){this.restoring=false;status.textContent=message;status.className='account-settings-message error'},finishRestore(){this.restoring=false;restore.disabled=!this.backupReady}};
  download.addEventListener('click',()=>void store.dispatch('download-backup'));
  restore.addEventListener('click',()=>void store.dispatch('restore-cloud'));
  return store;
}

async function mount(vault=empty, initialOptions={}) {
  const dom = new JSDOM(await readFile(new URL('../../index.html',import.meta.url),'utf8'), { url:'http://localhost', runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window; const saves = [];
  let legacyEditorPageControllerCreations=0;
  w.document.body.insertAdjacentHTML('beforeend', `<div class="overlay" id="captureOverlay"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="captureTitle"><div class="dialog-head"><h2 id="captureTitle">快速收集</h2><button class="round-btn" data-close="captureOverlay" aria-label="关闭">关闭</button></div><div class="dialog-body"><label class="form-label" for="captureName">笔记标题</label><input id="captureName" class="form-text"><div class="dialog-row"><label>内容类型<select id="captureType" class="form-text"></select></label></div><label for="captureSource">来源网址（可选）</label><input id="captureSource" class="form-text"><label for="capturePad">内容</label><div id="capturePad" class="capture-pad doc-content" contenteditable="true"></div><select id="capturePasteMode" class="field"><option value="rich">网页格式 / 自动识别</option><option value="match">整理文本（兼容）</option><option value="markdown">按 Markdown 解析</option><option value="plain">仅纯文本</option></select></div><div class="dialog-foot"><button class="secondary-btn" data-close="captureOverlay">取消</button><button class="primary-btn" id="captureSave">收集并保存</button></div></section></div>`);
  const openActionDialog=createActionDialogHarness(w.document);
  const pinia=createPinia();
  const toastStore=useToastStore(pinia);
  toastStore.$subscribe((_mutation, state) => { const host=w.document.querySelector('#toast'); host.textContent=state.message; host.classList.toggle('show',state.visible); }, {flush:'sync'});
  const workspaceShellStore=useWorkspaceShellStore(pinia);
  w.workspaceShellStore=workspaceShellStore;
  w.document.querySelector('#breadcrumbTitleIsland').innerHTML='<strong id="breadcrumbTitle">全部笔记</strong>';
  w.document.querySelector('#topbarMenusIsland').innerHTML='<div id="themeMenuRoot" class="theme-menu"><button id="themeBtn" class="round-btn theme-toggle" type="button" aria-haspopup="menu" aria-expanded="false"><span class="ico"><svg><use href="#i-moon"/></svg></span></button><div id="themeMenu" class="theme-popover" role="menu" hidden><button role="menuitemradio" data-theme-choice="system" aria-checked="false"><span>跟随系统</span><span class="theme-choice-check">✓</span></button><button role="menuitemradio" data-theme-choice="light" aria-checked="true"><span>浅色</span><span class="theme-choice-check">✓</span></button><button role="menuitemradio" data-theme-choice="dark" aria-checked="false"><span>深色</span><span class="theme-choice-check">✓</span></button></div></div><div id="accountMenuRoot" class="account-menu"><button id="accountButton" class="avatar account-trigger" type="button" aria-expanded="false" aria-controls="accountMenu"><svg class="account-user-icon"><use href="#i-user"/></svg></button><div id="accountMenu" class="account-popover" role="menu" hidden><div class="account-menu-identity"><strong id="accountMenuUsername">我的账号</strong></div><button id="openProfileSettings">个人资料</button><button id="openAppSettings">设置</button><button id="accountLogout" class="account-logout">退出登录</button></div></div>';
  w.document.querySelector('#mobileMenuButtonIsland').innerHTML='<button id="menuBtn" class="round-btn mobile-only" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="打开菜单"><span class="ico"><svg><use href="#i-menu"/></svg></span></button>';
  w.document.querySelector('#mobileShadeIsland').innerHTML='<div class="mobile-shade" id="mobileShade" aria-hidden="true"></div>';
  w.document.querySelector('#menuBtn').addEventListener('click',()=>workspaceShellStore.toggleMobileMenu());
  w.document.querySelector('#mobileShade').addEventListener('click',()=>workspaceShellStore.closeMobileMenu());
  const renderTopbarFixture=()=>{
    const themeButton=w.document.querySelector('#themeBtn'),themeMenu=w.document.querySelector('#themeMenu'),accountButton=w.document.querySelector('#accountButton'),accountMenu=w.document.querySelector('#accountMenu');
    w.document.querySelector('#breadcrumbTitle').textContent=workspaceShellStore.breadcrumbTitle;
    themeMenu.hidden=!workspaceShellStore.themeMenuOpen;themeButton.setAttribute('aria-expanded',String(workspaceShellStore.themeMenuOpen));
    themeButton.querySelector('use').setAttribute('href',workspaceShellStore.resolvedDark?'#i-sun':'#i-moon');
    const themeLabel=workspaceShellStore.themePreference==='system'?`主题：跟随系统（当前${workspaceShellStore.resolvedDark?'深色':'浅色'}）`:`主题：${workspaceShellStore.themePreference==='dark'?'深色':'浅色'}`;
    themeButton.title=themeLabel;themeButton.setAttribute('aria-label',`${themeLabel}，打开主题设置`);
    w.document.querySelectorAll('[data-theme-choice]').forEach(choice=>{const selected=choice.dataset.themeChoice===workspaceShellStore.themePreference;choice.classList.toggle('selected',selected);choice.setAttribute('aria-checked',String(selected))});
    accountMenu.hidden=!workspaceShellStore.accountMenuOpen;accountButton.setAttribute('aria-expanded',String(workspaceShellStore.accountMenuOpen));accountButton.title=`账号：${workspaceShellStore.username}`;
    w.document.querySelector('#accountMenuUsername').textContent=workspaceShellStore.username;w.document.querySelector('#accountLogout').hidden=workspaceShellStore.localPreview;
  };
  workspaceShellStore.$subscribe(renderTopbarFixture,{flush:'sync'});renderTopbarFixture();
  const renderMobileDrawerFixture=()=>{
    const open=workspaceShellStore.mobileMenuOpen,menu=w.document.querySelector('#menuBtn'),shade=w.document.querySelector('#mobileShade');
    w.document.body.classList.toggle('menu-open',open);menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'关闭菜单':'打开菜单');shade.setAttribute('aria-hidden',String(!open));
  };
  workspaceShellStore.$subscribe(renderMobileDrawerFixture,{flush:'sync'});renderMobileDrawerFixture();
  w.workspaceNavigationStore = useNavigationStore(pinia); w.navigationActionsStore = useNavigationActionsStore(pinia); w.workspaceShellActionsStore = useWorkspaceShellActionsStore(pinia);
  const renderMobileNavigationFixture=()=>{
    const page=w.workspaceNavigationStore.page,notesContext=page==='home'||page==='note';
    w.document.querySelector('#mobileHome').classList.toggle('selected',page==='dashboard');
    w.document.querySelector('#mobileCats').classList.toggle('selected',notesContext);
    w.document.querySelector('#mobileBookmarks').classList.toggle('selected',page==='bookmarks');
  };
  w.workspaceNavigationStore.$subscribe(renderMobileNavigationFixture,{flush:'sync'});
  w.vaultDataStore = useVaultStore(pinia);
  w.sidebarDataStore={configure(){}};
  const createViewStore=()=>({active:false,setActive(value){this.active=value},bindActions(){}});
  const dashboardActions={};
  w.dashboardDataStore={...createViewStore(),configure(){},bindActions(actions){Object.assign(dashboardActions,actions)},saveFolder(...args){return dashboardActions.saveFolder(...args)},setLayout(...args){return dashboardActions.setLayout(...args)},setAllFolders(...args){return dashboardActions.setAllFolders(...args)}};
  w.noteTypeDialogStore={bindSave(){},open(){},close(){}};
  w.categoryDialogStore=useCategoryDialogStore(pinia);
  w.captureDialogStore={bindSave(){},bindPasteHandler(){},open(){},close(){}};
  w.noteListDataStore={...createViewStore(),configure(){}};
  w.bookmarkDataStore={...createViewStore(),viewState:{closed:new Set(),selected:new Set(),query:'',organizing:false,selectedFolder:'',pinnedOnly:false,directoryOpen:true},snapshot:{sections:[]},dispatched:[],syncPreferences(){},openFolder(id){this.viewState.selectedFolder=id},leave(){},resume(){return 0},bindActions(handler){this.actionHandler=handler},dispatch(action){this.dispatched.push(action);return this.actionHandler?.(action)},openEditor(draft){this.editor={...draft,error:'',saving:false}},closeEditor(){this.editor=null}};
  w.trashDataStore=createViewStore();
  let editorRuntime={initialize(){},dispatch(){}};
  w.editorDataStore={
    active:false,
    snapshot:{revision:0},
    slashMenu:{visible:false,left:0,top:0},
    baseline:null,
    transientNewNoteId:null,
    setActive(value){this.active=value},
    setBaseline(value){this.baseline=value},
    setTransientNewNoteId(value){this.transientNewNoteId=value},
    clearTransientNewNote(){this.transientNewNoteId=null},
    showSlashMenu(position){this.slashMenu={visible:true,...position}},
    closeSlashMenu(){this.slashMenu.visible=false},
    sync(snapshot){this.snapshot={...snapshot,revision:this.snapshot.revision+1};this.active=true},
    setToolbarState(state){this.toolbar=state},
    setOutline(items){this.outline=items.map(item=>({...item}))},
    bindRuntime(runtime){editorRuntime=runtime},
    initialize(){return editorRuntime.initialize()},
    dispatch(action){return editorRuntime.dispatch(action)}
  };
  let readerDependencies=null;
  w.readerDataStore={
    configure(dependencies){readerDependencies=dependencies},
    bindActions(){},
    get snapshot(){const stored=w.vaultDataStore.value?.notes.find(note=>note.id===w.workspaceNavigationStore.noteId);if(!stored||!readerDependencies)return{};const working=w.workspaceNavigationStore.previewing||readerDependencies.isDraft(stored);return createReaderSnapshot({...readerDependencies,stored,note:working?stored:readerDependencies.publishedView(stored),working,previewing:w.workspaceNavigationStore.previewing})},
    get active(){return w.vaultDataStore.ready&&w.workspaceNavigationStore.page==='note'&&!w.workspaceNavigationStore.editing&&!!w.workspaceNavigationStore.noteId}
  };
  w.readerActionsStore={bind(){}};
  w.createEditorPageActions=createEditorPageActions;
  w.editorPageActionsStore={bind(){}};
  const workspaceAppMounted=!!initialOptions.readerBridge;
  const IS_PRODUCTION_BUILD=!!initialOptions.productionBuild;
  const syncConflictStore=createSyncConflictDialogHarness(w.document,w);
  w.document.querySelector('#qidianVueIslands').innerHTML='<nav class="bottom-nav" aria-label="手机导航"><button id="mobileHome" type="button" data-dashboard>首页</button><button id="mobileCats" type="button" data-nav="all">笔记</button><button id="mobileNew" type="button">新建</button><button id="mobileBookmarks" type="button">书签</button><button id="mobileSearch" type="button">搜索</button></nav>';
  renderMobileNavigationFixture();
  let systemDark=!!initialOptions.systemDark;const systemThemeListeners=new Set();
  w.matchMedia=query=>({media:query,get matches(){return query==='(prefers-color-scheme: dark)'&&systemDark},addEventListener:(type,listener)=>{if(type==='change')systemThemeListeners.add(listener)},removeEventListener:(type,listener)=>{if(type==='change')systemThemeListeners.delete(listener)} });
  initialOptions.setSystemDark=dark=>{systemDark=dark;for(const listener of systemThemeListeners)listener({matches:dark,media:'(prefers-color-scheme: dark)'})};
  w.structuredClone = structuredClone;
  for (const [key,value] of Object.entries(initialOptions.localStorage || {})) w.localStorage.setItem(key,value);
  for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'Event', 'CustomEvent']) Object.defineProperty(globalThis, key, { configurable:true, value:w[key] });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable:true, value:w.requestAnimationFrame.bind(w) });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable:true, value:w.cancelAnimationFrame.bind(w) });
  w.DEFAULT_NOTE_TYPES = DEFAULT_NOTE_TYPES;
  w.mountWorkspaceLifecycle = mountWorkspaceLifecycle;
  w.mountWorkspaceSession = mountWorkspaceSession;
  w.validateVault = validateVault;
  w.createBookmarkView = createBookmarkView;
  w.createRecycleBinView = createRecycleBinView;
  w.createTrashEntry = createTrashEntry;
  w.DOMPurify = createDOMPurify(w); w.initial = { data: structuredClone(vault), local:true, ...initialOptions };
  w.queueSave = data => saves.push(structuredClone(data)); w.flush = async () => { initialOptions.flushCalls=(initialOptions.flushCalls||0)+1; return initialOptions.flushResult??true; }; w.commitSave = async data => { w.queueSave(data); if(initialOptions.commitError)throw Error(initialOptions.commitError); if(!await w.flush())throw Error('修改尚未写入 Docker 服务端，请保持页面打开并重试'); return true; }; w.retrySync = () => { initialOptions.retryRequests = (initialOptions.retryRequests || 0) + 1; return true; }; w.onStatus = callback => { if (initialOptions.restoreConflict) callback('草稿与 Docker 服务端版本冲突；请导出后再载入服务端版本'); }; w.onAuthenticationRequired = callback => { initialOptions.authenticationRequired = callback; }; w.onRemoteUpdate = callback => { initialOptions.remoteUpdate = callback; }; w.getSyncConflict = () => initialOptions.syncConflict ? structuredClone(initialOptions.syncConflict) : null; w.exportSyncConflict = async () => { initialOptions.conflictExports = (initialOptions.conflictExports || 0) + 1; return true; }; w.refreshCloud = async () => false; w.reauthenticateAccount = async () => ({ data:structuredClone(vault), conflict:false, synced:true }); w.showAuthentication = (_config,recovery) => { initialOptions.reauthentication = recovery; return Promise.resolve(); }; w.setOwner = () => {};
  const editorFactory = options => { w.currentEditor = createQidianEditor(options); return w.currentEditor; };
  w.createQidianEditor = editorFactory; w.__qidianTestEditorFactory = editorFactory;
  w.reloadCloud = async () => structuredClone(initialOptions.cloudData || vault);
  w.exportBackup = async data => { initialOptions.settingsBackups=(initialOptions.settingsBackups||[]).concat([structuredClone(data)]); };
  w.createEditorCommandController = createEditorCommandController;
  w.createThemeController = createThemeController;
  w.createRemoteEditorRefresh = createRemoteEditorRefresh;
  w.createRemoteVaultUpdateController = createRemoteVaultUpdateController;
  w.createNewNoteController = createNewNoteController;
  w.upload = async file => ({ url:'/api/assets/00000000-0000-4000-8000-000000000001', mime:file.type });
  w.exportHTML = async () => true;
  w.listBackups = async () => initialOptions.backups || [];
  w.getAccountProfile = async () => ({ id:'local-preview', username:'本地预览', created:0, avatarMime:null });
  w.getAccountAvatar = async () => new w.Blob();
  w.saveAccountAvatar = async () => ({ ok:true });
  w.removeAccountAvatar = async () => ({ ok:true });
  w.changeAccountPassword = async () => ({ ok:true });
  w.getSystemVersion = async () => typeof initialOptions.versionInfo==='function' ? initialOptions.versionInfo() : initialOptions.versionInfo || ({ currentVersion:'0.1.5', latestVersion:'0.1.6', updateAvailable:true, canUpdateDevice:true, installerAvailable:true, updaterAvailable:true, releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6', notes:'修复问题\n<img src=x onerror=alert(1)>' });
  w.getSystemUpdateStatus = async () => typeof initialOptions.updateStatus==='function' ? initialOptions.updateStatus() : initialOptions.updateStatus || ({ state:'idle', version:'', updatedAt:null, log:'' });
  w.requestSystemUpdate = async () => { assert.ok(initialOptions.flushCalls>0,'pending edits are flushed before the container restarts'); initialOptions.updateRequests=(initialOptions.updateRequests||0)+1; return initialOptions.onRequestSystemUpdate ? initialOptions.onRequestSystemUpdate() : { accepted:true, version:'0.1.6' }; };
  w.getBackup = async revision => { initialOptions.requestedBackup = revision; return structuredClone(initialOptions.snapshot || ({ categories:[], noteTypes:structuredClone(empty.noteTypes), notes:[], theme:'light', pasteMode:'rich', revision })); };
  w.readBackup = async file => { initialOptions.importedFile=file; return structuredClone(initialOptions.importData || vault); };
  w.exportBackup = async data => { if(initialOptions.backupError)throw Error(initialOptions.backupError); if(initialOptions.onBackup)await initialOptions.onBackup(); (initialOptions.backupOrder??=[]).push('download'); initialOptions.exportedBeforeRestore = structuredClone(data); };
  w.createBackupSnapshot = async () => { (initialOptions.backupOrder??=[]).push('snapshot'); initialOptions.backupSnapshots=(initialOptions.backupSnapshots||0)+1; return { revision:1 }; };
  w.pruneAssets = async () => { initialOptions.assetPrunes=(initialOptions.assetPrunes||0)+1; return { removed:0, bytes:0 }; };
  w.download = () => {};
  w.restoreIgnoredDraft = async () => ({ data: structuredClone(vault), conflict:false });
  w.hasUnsaved = () => false; w.scrollTo = () => {}; w.confirm = () => { throw new Error('native confirm is not allowed'); }; w.prompt = () => { throw new Error('native prompt is not allowed'); };
  w.globalSearchDataStore = { open:false, query:'', configure(){}, show(query=''){this.query=query;this.open=true}, close(){this.open=false} };
  const appSource = (await readFile(new URL('../../src/app/workspace-composition.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  w.createPastedTitleAutofill = createPastedTitleAutofill;
  w.createLegacyEditorOutlineView = createLegacyEditorOutlineView;
  w.createMobileMenuFocusController = createMobileMenuFocusController;
  w.createLegacyCategoryDialog = createLegacyCategoryDialog;
  w.createCategoryDialogController = createCategoryDialogController;
  w.createSignOutFlow = createSignOutFlow;
  w.createCaptureDialogPresenter = createCaptureDialogPresenter;
  w.createCaptureDialogController = createCaptureDialogController;
  w.createBackupHistoryOpenFlow = createBackupHistoryOpenFlow;
  w.createNoteTypeDialogOpenFlow = createNoteTypeDialogOpenFlow;
  const start = appSource.indexOf("const authGate = document.querySelector('#loginGate');");
  const end = appSource.lastIndexOf('\n})();\n}');
  assert.ok(start >= 0 && end > start, 'workspace entrypoint should remain available to DOM tests');
  const mountProfileSettings=(root,dependencies)=>{
    root.innerHTML='<div class="overlay" id="profileSettingsOverlay"><section class="dialog account-dialog" role="dialog" aria-modal="true"><div class="dialog-head"><h2>个人资料</h2><button data-close="profileSettingsOverlay">关闭</button></div><div class="dialog-body account-settings-body"><strong id="profileUsername"></strong><button id="chooseAvatar">更换头像</button><button id="removeAvatar">移除头像</button><p id="profileSettingsMessage"></p><div class="account-password-section"><h3>修改密码</h3><form id="passwordChangeForm"><button id="changePasswordButton">更新密码</button></form></div></div></section></div>';
    const overlay=root.querySelector('#profileSettingsOverlay');
    return {show:async()=>{overlay.classList.add('open');root.querySelector('#profileUsername').textContent=dependencies.username;root.querySelector('#profileSettingsMessage').textContent=dependencies.local?'当前是本地界面预览；请登录部署后的栖点管理头像和密码。':''},close:()=>overlay.classList.remove('open'),refresh:async()=>null};
  };
  const profileSettingsHost=w.document.createElement('div');
  w.document.querySelector('#qidianVueIslands').append(profileSettingsHost);
  let profileSettingsInstance;
  w.profileSettingsStore={
    configure(dependencies){profileSettingsInstance=mountProfileSettings(profileSettingsHost,dependencies)},
    show(){return profileSettingsInstance.show()},
    close(){return profileSettingsInstance.close()},
    refresh(){return profileSettingsInstance.refresh()}
  };
  const mountAppSettings=(root,onAction)=>{
    root.innerHTML='<div class="overlay" id="appSettingsOverlay"><section class="dialog account-dialog" role="dialog" aria-modal="true"><div class="dialog-head"><div><h2>设置</h2><p class="account-dialog-subtitle">管理数据恢复和备份迁移。</p></div><button data-close="appSettingsOverlay">关闭</button></div><div class="dialog-body account-settings-body"><section><h3>数据与恢复</h3><button id="retrySync">重试保存</button><button id="reloadCloud">重新载入数据</button><button id="reviewSyncConflict" hidden>整理未合并修改</button><button id="restoreLocalDraft" hidden>恢复旧版暂存内容</button></section><section><h3>备份与迁移</h3><button id="backupHistory">自动备份</button><button id="exportBtn">导出完整备份</button><button id="importBtn">导入备份</button></section></div><div class="dialog-foot account-dialog-foot"><span class="hint">设置只影响当前账号</span></div></section></div>';
    const overlay=root.querySelector('#appSettingsOverlay');
    const actions={retrySync:'retry-sync',reloadCloud:'reload-cloud',reviewSyncConflict:'review-conflict',restoreLocalDraft:'restore-draft',backupHistory:'backup-history',exportBtn:'export-backup',importBtn:'import-backup'};
    for(const [id,action] of Object.entries(actions))root.querySelector('#'+id).addEventListener('click',()=>onAction(action));
    return {show:async()=>overlay.classList.add('open'),close:()=>overlay.classList.remove('open'),setIndicators:({hasConflict=false,hasIgnoredDraft=false}={})=>{root.querySelector('#reviewSyncConflict').hidden=!hasConflict;root.querySelector('#restoreLocalDraft').hidden=!hasIgnoredDraft}};
  };
  const appSettingsHost=w.document.createElement('div');
  w.document.querySelector('#qidianVueIslands').append(appSettingsHost);
  let appSettingsInstance;
  w.appSettingsStore={
    bindActionHandler(handler){appSettingsInstance=mountAppSettings(appSettingsHost,handler)},
    show(){return appSettingsInstance.show()},
    close(){return appSettingsInstance.close()},
    setIndicators(indicators){return appSettingsInstance.setIndicators(indicators)}
  };
  const mountBackupHistoryList=(root,listBackups,localPreview)=>({refresh:async()=>{
    root.innerHTML='<div class="empty backup-empty">正在读取 Docker 服务端快照…</div>';
    try{const backups=await listBackups();if(!backups.length){root.innerHTML=`<div class="empty backup-empty">${localPreview?'本地开发预览不创建服务端快照。':'当前账号还没有可查看的快照。'}</div>`;return}root.innerHTML=backups.slice(0,20).map(item=>`<article class="backup-row"><div class="backup-row-info"><strong>版本 ${item.revision}</strong><time>${new Date(item.created).toLocaleString('zh-CN')}</time></div><div class="backup-row-actions"><button class="secondary-btn" data-backup-download="${item.revision}">下载正文</button><button class="secondary-btn" data-backup-restore="${item.revision}">恢复此版本</button></div></article>`).join('')}catch(error){root.innerHTML=`<div class="empty backup-empty">读取失败：${error.message||'请稍后重试'}</div>`}
  }});
  const backupHistoryHost=w.document.createElement('div');
  w.document.querySelector('#qidianVueIslands').append(backupHistoryHost);
  let backupHistoryListInstance;
  w.backupHistoryStore={
    configure({listBackups,localPreview}){
      backupHistoryHost.innerHTML='<div class="overlay" id="backupHistoryOverlay"><section class="dialog backup-dialog"><div id="backupHistoryList" class="backup-history-list"></div><p class="backup-footnote">历史快照只包含笔记正文和元数据，不含附件文件。要保留附件，请定期下载完整备份。</p></section></div>';
      backupHistoryListInstance=mountBackupHistoryList(backupHistoryHost.querySelector('#backupHistoryList'),listBackups,localPreview);
    },
    show(){backupHistoryHost.querySelector('#backupHistoryOverlay').classList.add('open')},
    close(){backupHistoryHost.querySelector('#backupHistoryOverlay')?.classList.remove('open')},
    refresh(){return backupHistoryListInstance.refresh()}
  };
  w.createEditorPageLifecycle = createEditorPageLifecycle;
  w.createLegacyEditorPageController = dependencies=>{legacyEditorPageControllerCreations++;return createLegacyEditorPageController(dependencies)};
  w.createEditorHtmlInserter = createEditorHtmlInserter;
  w.createEditorPagePreparation = createEditorPagePreparation;
  w.createEditorActionDispatcher = createEditorActionDispatcher;
  w.createWorkspaceNavigationActions = createWorkspaceNavigationActions;
  w.createWorkspaceNavigationEventsForMode = createWorkspaceNavigationEventsForMode;
  w.createWorkspaceReplacementFlow = createWorkspaceReplacementFlow;
  w.createWorkspaceShellActions = createWorkspaceShellActions;
  const runWorkspace = w.Function('initial', 'createQidianEditor', 'flush', 'classifyClipboard', 'looksLikeMarkdown', 'plainTextToDocument', 'sanitizeMarkdownDocument', 'loadMarkdownTools', 'createRecycleBinView', 'createTrashWorkflows', 'createVaultMutation', 'createBookmarkMutationActions', 'bookmarksHTML', 'mergeBookmarks', 'parseBookmarks', 'createDashboardActions', 'createVaultPersistence', 'createNoteTypeDialogFlow', 'createNoteTypeDialogPresenter', 'createLegacyNoteTypeDialog', 'createCategoryDialogFlow', 'createCategoryDialogController', 'createCaptureFlow', 'createCaptureDialogController', 'createCaptureDOMAdapter', 'createLegacyCaptureDialog', 'createNoteDeleteWorkflow', 'createEditorDeleteWorkflow', 'createEditorDraftController', 'createEditorAutosaveController', 'createEditorFormAdapter', 'connectSessionRecoveryFlow', 'createWorkspaceViewDispatcher', 'createVueWorkspaceViewPresentation', 'createLegacyWorkspaceViewPresentation', 'createLegacyWorkspaceRenderer', 'renderLegacyEditorMarkup', 'mountWorkspaceInteractionRuntime', 'createCurrentVaultSnapshot', 'navigationActionsStore', 'workspaceShellActionsStore', 'createTrashEntry', 'APP_VERSION', 'renderReleaseNotes', 'mountEditorSearch', 'createEditorCommandController', 'createEditorInsertController', 'createEditorRuntimeController', 'createEditorOutlineController', 'createEditorToolbarState', 'createLegacyEditorToolbarView', 'profileSettingsStore', 'createAppSettingsActions', 'createNotePublishFlow', 'createContentInsertionController', 'createAttachmentUploadFlow', 'backupHistoryStore', 'createBackupWorkflows', 'createWorkspaceNavigationController', 'createWorkspaceNavigationEvents', 'createWorkspaceShellEvents', 'createWorkspaceContentEvents', 'createEditorToolbarEvents', 'createSystemUpdateController', 'createSyncConflictController', 'appSettingsStore', 'syncConflictStore', 'editorDataStore', 'vaultDataStore', 'dashboardDataStore', 'noteTypeDialogStore', 'categoryDialogStore', 'captureDialogStore', 'createMenuStore', 'bookmarkDataStore', 'trashDataStore', 'readerDataStore', 'workspaceShellStore', 'workspaceAppMounted', 'IS_PRODUCTION_BUILD', 'getSystemVersion', 'getSystemUpdateStatus', 'requestSystemUpdate', 'openActionDialog', 'createNoteType', 'deleteNoteType', 'renameNoteType', 'createVaultNote', 'duplicateVaultNote', 'isDraft', 'needsPublish', 'publishedView', 'selectNotes', 'createHtmlContentTools', 'createReaderSnapshot', 'createReaderActions', 'createDraftContentTools', 'createNoteCardSnapshot', 'createEditorSessionSnapshot', 'normalizeEditorPasteMode', 'createSlashMenuController', 'renderLegacyCategoryOptions', 'createLegacyCreateMenu', 'notificationDataStore', 'mountCodeCopyButtons', 'mountHeadingObserver', appSource.slice(start, end + '\n})();'.length));
  runWorkspace(w.initial, editorFactory, w.flush, classifyClipboard, looksLikeMarkdown, plainTextToDocument, sanitizeMarkdownDocument, loadMarkdownTools, createRecycleBinView, createTrashWorkflows, createVaultMutation, createBookmarkMutationActions, bookmarksHTML, mergeBookmarks, parseBookmarks, createDashboardActions, createVaultPersistence, createNoteTypeDialogFlow, createNoteTypeDialogPresenter, createLegacyNoteTypeDialog, createCategoryDialogFlow, createCategoryDialogController, createCaptureFlow, createCaptureDialogController, createCaptureDOMAdapter, createLegacyCaptureDialog, createNoteDeleteWorkflow, createEditorDeleteWorkflow, createEditorDraftController, createEditorAutosaveController, createEditorFormAdapter, connectSessionRecoveryFlow, createWorkspaceViewDispatcher, createVueWorkspaceViewPresentation, createLegacyWorkspaceViewPresentation, createLegacyWorkspaceRenderer, renderLegacyEditorMarkup, mountWorkspaceInteractionRuntime, createCurrentVaultSnapshot, w.navigationActionsStore, w.workspaceShellActionsStore, createTrashEntry, initialOptions.appVersion || '0.1.5', renderReleaseNotes, mountEditorSearch, createEditorCommandController, createEditorInsertController, createEditorRuntimeController, createEditorOutlineController, createEditorToolbarState, createLegacyEditorToolbarView, w.profileSettingsStore, createAppSettingsActions, createNotePublishFlow, createContentInsertionController, createAttachmentUploadFlow, w.backupHistoryStore, createBackupWorkflows, createWorkspaceNavigationController, createWorkspaceNavigationEvents, createWorkspaceShellEvents, createWorkspaceContentEvents, createEditorToolbarEvents, createSystemUpdateController, createSyncConflictController, w.appSettingsStore, syncConflictStore, w.editorDataStore, w.vaultDataStore, w.dashboardDataStore, w.noteTypeDialogStore, w.categoryDialogStore, w.captureDialogStore, w.createMenuStore, w.bookmarkDataStore, w.trashDataStore, w.readerDataStore, w.workspaceShellStore, workspaceAppMounted, IS_PRODUCTION_BUILD, w.getSystemVersion, w.getSystemUpdateStatus, w.requestSystemUpdate, openActionDialog, createNoteType, deleteNoteType, renameNoteType, createVaultNote, duplicateVaultNote, isDraft, needsPublish, publishedView, selectNotes, createHtmlContentTools, createReaderSnapshot, createReaderActions, createDraftContentTools, createNoteCardSnapshot, createEditorSessionSnapshot, normalizeEditorPasteMode, createSlashMenuController, renderLegacyCategoryOptions, createLegacyCreateMenu, toastStore, mountCodeCopyButtons, mountHeadingObserver);
  await new Promise(resolve=>setTimeout(resolve,0));
  return { dom, w, saves, initialOptions, legacyEditorPageControllerCreations };
}

const designVault=()=>({...structuredClone(empty),notes:[{id:'design-note',title:'共享关键词笔记',type:'note',category:'开发',tags:[],body:'<h2>开始</h2><p>测试笔记正文</p>',created:1,updated:2,status:'published'}],bookmarks:[{id:'d-root',kind:'folder',title:'工作',children:[{id:'d-a',kind:'link',title:'共享关键词网站',url:'https://example.com/a',pinned:true},{id:'d-child',kind:'folder',title:'文档',children:[{id:'d-b',kind:'link',title:'文档站点',url:'https://example.com/b'}]}]},{id:'d-other',kind:'folder',title:'生活',children:[{id:'d-c',kind:'link',title:'生活站点',url:'https://example.org/c'}]}]});

export { assert, readFile, JSDOM, createPinia, createDOMPurify, createQidianEditor, createEditorPageLifecycle, createLegacyEditorPageController, createEditorHtmlInserter, createEditorPagePreparation, createEditorActionDispatcher, TextSelection, DEFAULT_NOTE_TYPES, validateVault, createBookmarkView, bookmarksHTML, mergeBookmarks, parseBookmarks, createRecycleBinView, createTrashWorkflows, createDashboardActions, createVaultMutation, createBookmarkMutationActions, createVaultPersistence, createWorkspaceReplacementFlow, createNoteTypeDialogFlow, createNoteTypeDialogPresenter, createNoteTypeDialogOpenFlow, createLegacyNoteTypeDialog, createCategoryDialogFlow, createCategoryDialogController, createLegacyCategoryDialog, createCaptureFlow, createCaptureDialogController, createCaptureDialogPresenter, createCaptureDOMAdapter, createLegacyCaptureDialog, mountEditorSearch, createEditorCommandController, createEditorPageActions, createEditorRuntimeController, createEditorOutlineController, createLegacyEditorToolbarView, createEditorToolbarState, createEditorInsertController, createEditorDraftController, createEditorAutosaveController, createEditorFormAdapter, connectSessionRecoveryFlow, createWorkspaceViewDispatcher, createVueWorkspaceViewPresentation, createLegacyWorkspaceViewPresentation, createWorkspaceNavigationActions, createWorkspaceShellActions, createLegacyWorkspaceRenderer, mountWorkspaceInteractionRuntime, createCurrentVaultSnapshot, renderLegacyEditorMarkup, createEditorToolbarEvents, mountEditorFileInputEvents, mountBackupImportFileEvents, createProfileSettingsFlow, createSignOutFlow, createAppSettingsActions, createNotePublishFlow, createContentInsertionController, createAttachmentUploadFlow, saveNoteDraft, createNoteDeleteWorkflow, createEditorDeleteWorkflow, createVaultNote, duplicateVaultNote, createNewNoteController, isDraft, needsPublish, publishedView, selectNotes, createNoteType, deleteNoteType, renameNoteType, createHtmlContentTools, createPastedTitleAutofill, createLegacyEditorOutlineView, createMobileMenuFocusController, createReaderSnapshot, createReaderActions, mountCodeCopyButtons, mountHeadingObserver, createDraftContentTools, createNoteCardSnapshot, createEditorSessionSnapshot, normalizeEditorPasteMode, createSlashMenuController, renderLegacyCategoryOptions, createLegacyCreateMenu, createThemeController, createRemoteEditorRefresh, createRemoteVaultUpdateController, createSystemUpdateController, createSyncConflictController, createWorkspaceNavigationController, createWorkspaceNavigationEvents, createWorkspaceNavigationEventsForMode, mountWorkspaceClickRouter, createWorkspaceShellEvents, mountWorkspaceKeyboardEvents, mountWorkspaceStaticDomEvents, createWorkspaceContentEvents, mountItemMenuController, mountModalFocusLoop, mountEditorDocumentLifecycle, mountWorkspaceLifecycle, mountWorkspaceSession, useNavigationStore, useCategoryDialogStore, useNavigationActionsStore, useWorkspaceShellActionsStore, useVaultStore, useToastStore, useWorkspaceShellStore, createBackupWorkflows, createBackupHistoryOpenFlow, createTrashEntry, pruneExpiredTrash, restoreTrashEntry, TRASH_RETENTION_MS, renderReleaseNotes, classifyClipboard, looksLikeMarkdown, plainTextToDocument, sanitizeMarkdownDocument, parseQidianMarkdown, qidianSchema, loadMarkdownTools, empty, createActionDialogHarness, createSyncConflictDialogHarness, mount, designVault };
