import { test } from 'node:test';
import * as fixture from '../../support/ui-fixtures.mjs';
const { JSDOM, assert, createTrashEntry, designVault, empty, mount, readFile, validateVault } = fixture;

test('vault validation defaults legacy data to an empty trash and validates stored items', () => {
  const note={id:'old-note',title:'旧笔记',type:'note',category:'开发',tags:[],body:'<p>内容</p>',source:'',created:1,updated:2,pinned:false};
  assert.deepEqual(validateVault(structuredClone(empty)).trash,[]);
  const deleted={...createTrashEntry('note',note,{index:0}),deletedAt:100};
  const validated=validateVault({...structuredClone(empty),trash:[deleted]});
  assert.equal(validated.trash[0].item.title,'旧笔记');
  assert.throws(()=>validateVault({...structuredClone(empty),trash:[{...deleted,deletedAt:-1}]}),/删除时间无效/);
  assert.throws(()=>validateVault({...structuredClone(empty),notes:[note],trash:[deleted]}),/笔记编号无效或重复/);
});

test('product branding shows the name without repeated promotional taglines', async () => {
  const dom = new JSDOM(await readFile(new URL('../../../index.html',import.meta.url),'utf8'));
  const { document } = dom.window;
  assert.equal(document.title, '栖点');
  assert.equal(document.querySelector('.auth-brand strong').textContent, '栖点');
  assert.equal(document.querySelector('#brandHome .brand-copy strong').textContent, '栖点');
  assert.equal(document.querySelector('.auth-brand span'), null);
  assert.equal(document.querySelector('#brandHome .brand-copy span'), null);
  assert.equal(document.querySelector('.side-footer'), null);
  assert.ok(document.querySelector('#topbarMenusIsland'),'the static page reserves a Vue top-bar menu mount point');
  assert.equal(document.querySelector('#themeBtn'),null,'theme controls are rendered by Vue');
  assert.equal(document.querySelector('#accountButton'),null,'account controls are rendered by Vue');
  assert.equal(document.querySelector('#menuBtn'),null,'the mobile menu button is rendered by Vue');
  assert.equal(document.querySelector('#globalSearch'),null,'global search input is rendered by Vue only while open');
  assert.equal(document.querySelector('#mobileShade'),null,'the mobile drawer shade is rendered by Vue');
  assert.ok(document.querySelector('#breadcrumbTitleIsland'),'the static page reserves a Vue breadcrumb mount point');
  assert.equal(document.querySelector('#breadcrumbTitle'),null,'the breadcrumb title is rendered by Vue');
  const settingsIcon=document.querySelector('#i-settings');
  assert.equal(settingsIcon.querySelector('path').hasAttribute('transform'),false,'the settings gear is centered directly in its viewBox');
  const topbar=await readFile(new URL('../../../src/features/navigation/WorkspaceTopbarMenus.vue',import.meta.url),'utf8');
  assert.match(topbar,/id="openAppSettings"[\s\S]*?href="#i-settings"/,'the Vue-owned account menu uses the shared settings icon');
  const mobileDrawer=await readFile(new URL('../../../src/features/navigation/MobileDrawerControls.vue',import.meta.url),'utf8');
  assert.match(mobileDrawer,/id="menuBtn"[\s\S]*?shell\.mobileMenuOpen/,'the mobile drawer button reads Pinia-owned shell state');
  assert.match(mobileDrawer,/id="mobileShade"[\s\S]*?:aria-hidden="!shell\.mobileMenuOpen"/,'the shade follows the Vue-owned mobile drawer state');
  assert.match(mobileDrawer,/@click="shell\.toggleMobileMenu\(\)"/,'Vue owns the mobile drawer toggle');
  assert.match(mobileDrawer,/@click="closeDrawer"/,'Vue owns closing the drawer from its shade');
  assert.match(mobileDrawer,/function closeDrawer\(\)[\s\S]*?focusController\.close\(true\)/,'closing from the drawer returns focus to its toggle');
  dom.window.close();
});

test('sidebar fallback follows actual Vue mount state even when Pinia stores are imported',async t=>{
  const legacy=await mount(structuredClone(empty));
  t.after(()=>legacy.dom.window.close());
  assert.ok(legacy.w.document.querySelector('#sideCore'),'the non-Vue fallback builds its own navigation');
  assert.ok(legacy.w.document.querySelector('#sideTypes'),'the fallback includes the note-type navigation target');
  assert.equal(legacy.legacyEditorPageControllerCreations,1,'the compatibility workspace retains its lazy editor adapter');
  const vue=await mount(structuredClone(empty),{readerBridge:true});
  t.after(()=>vue.dom.window.close());
  assert.equal(vue.w.document.querySelector('#sideCore'),null,'the Vue path does not generate a second legacy sidebar');
});

test('production workspace uses the Vue path even without the mount-state fallback flag',async t=>{
  const production=await mount(structuredClone(empty),{productionBuild:true});
  t.after(()=>production.dom.window.close());
  assert.equal(production.w.document.querySelector('#sideCore'),null,'production builds do not render the legacy navigation');
  assert.equal(production.w.document.querySelector('#sideTypes'),null,'production builds do not render the legacy note-type list');
  assert.equal(production.w.document.querySelector('#main').hidden,true,'production pages stay owned by the Vue host');
  assert.equal(production.legacyEditorPageControllerCreations,0,'production Vue builds do not construct the legacy editor adapter');
});

test('workspace reads the current Vault Store snapshot after replacement', async t=>{
  const {dom,w}=await mount(empty);t.after(()=>dom.window.close());
  w.vaultDataStore.replace({...structuredClone(empty),notes:[{id:'store-replacement',title:'来自当前 Vault',type:'note',category:'开发',tags:[],body:'<p>当前 Pinia 快照</p>',created:1,updated:2,status:'published'}]});
  w.document.querySelector('#sideCore [data-nav="all"]').click();
  assert.equal(w.document.querySelector('.note-list .note-card h3')?.textContent,'来自当前 Vault');
});

test('mobile drawer exposes its state and every home entry closes it on the dashboard', async () => {
  const { dom, w } = await mount();
  const menu=w.document.querySelector('#menuBtn'),shade=w.document.querySelector('#mobileShade');
  assert.equal(menu.getAttribute('aria-controls'),'sidebar');
  assert.equal(menu.getAttribute('aria-expanded'),'false');
  menu.click();
  assert.equal(w.document.body.classList.contains('menu-open'),true);
  assert.equal(menu.getAttribute('aria-expanded'),'true');
  assert.equal(shade.getAttribute('aria-hidden'),'false');
  w.document.querySelector('#sideCore [data-dashboard]').click();
  assert.equal(w.document.body.classList.contains('menu-open'),false);
  assert.equal(menu.getAttribute('aria-expanded'),'false');
  assert.equal(w.document.querySelector('#mobileHome').classList.contains('selected'),true);
  menu.click();
  shade.click();
  assert.equal(w.document.body.classList.contains('menu-open'),false);
  assert.equal(shade.getAttribute('aria-hidden'),'true');
  menu.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(w.document.body.classList.contains('menu-open'),false);
  dom.window.close();
});

test('mobile drawer close button and shade share focus-restoring close behavior', async () => {
  const source = await readFile(new URL('../../../src/features/navigation/MobileDrawerControls.vue', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../../../src/styles.css', import.meta.url), 'utf8');
  assert.match(source, /id="mobileDrawerClose"[\s\S]*?aria-label="关闭菜单"[\s\S]*?@click="closeDrawer"/);
  assert.match(source, /function closeDrawer\(\)[\s\S]*?focusController\.close\(true\)/);
  assert.match(source, /id="mobileShade"[\s\S]*?@click="closeDrawer"/);
  assert.match(styles, /body\.menu-open \.mobile-drawer-close\{[^}]*display:inline-flex/);
});

test('dashboard collapse survives an immediate refresh and reload with independent nested states', async () => {
  const vault={...empty,bookmarks:[{id:'root',kind:'folder',title:'根分组',children:[{id:'nested',kind:'folder',title:'子分组',children:[]}]}]};
  const options={owner:'account-a'};
  const {dom,w,saves}=await mount(vault,options);
  w.document.querySelector('[data-dashboard-bookmark-folder="nested"]').click();
  w.document.querySelector('[data-dashboard-bookmark-folder="root"]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const saved=structuredClone(saves.at(-1));
  options.remoteUpdate(saved);
  assert.equal(w.document.querySelector('[data-dashboard-folder="root"]').open,false);
  assert.equal(w.document.querySelector('[data-dashboard-folder="nested"]').open,true);
  assert.equal(w.document.querySelector('[data-dashboard-bookmark-folder="root"]').getAttribute('aria-expanded'),'false');
  assert.equal(saved.dashboardBookmarkFolders.root,false);
  assert.equal(saved.dashboardBookmarkFolders.nested,true);
  dom.window.close();
  const reloaded=await mount(saved,{owner:'account-a'});
  assert.equal(reloaded.w.document.querySelector('[data-dashboard-folder="root"]').open,false);
  reloaded.w.document.querySelector('[data-dashboard-bookmark-folder="root"]').click();
  assert.equal(reloaded.w.document.querySelector('[data-dashboard-folder="nested"]').open,true);
  reloaded.dom.window.close();
  const other=await mount(vault,{owner:'account-b'});
  assert.equal(other.w.document.querySelector('[data-dashboard-folder="root"]').open,true);
  assert.equal(other.w.document.querySelector('[data-dashboard-folder="nested"]').open,false);
  other.dom.window.close();
});

test('destructive actions remain visible when the Docker transaction is not confirmed', async () => {
  const note={id:'unsaved-delete',title:'不能误报删除',type:'note',category:'开发',tags:[],body:'<p>内容</p>',source:'',created:1,updated:2,pinned:false,status:'published'};
  const {dom,w}=await mount({...structuredClone(empty),notes:[note]},{commitError:'Docker 服务端保存失败'});
  w.document.querySelector('#sideCore [data-nav="all"]').click();
  w.document.querySelector('[data-note-delete="unsaved-delete"]').click();
  w.document.querySelector('#actionDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(w.document.querySelector('#main').textContent,/不能误报删除/,'failed deletion rolls the optimistic view back');
  assert.match(w.document.querySelector('#toast').textContent,/Docker 服务端保存失败/);
  dom.window.close();
});

test('mounted Vue workspace routes do not render duplicate legacy page markup', async t=>{
  const {dom,w}=await mount(structuredClone(empty),{readerBridge:true});
  t.after(()=>dom.window.close());
  const legacyMain=w.document.querySelector('#main'),vueHost=w.document.querySelector('#dashboardHost');
  assert.equal(legacyMain.hidden,true,'the legacy page host stays hidden while Vue owns the active route');
  assert.equal(vueHost.hidden,false,'the Vue page host is active');
  assert.equal(legacyMain.querySelector('.dashboard-page'),null,'the dashboard is not rendered into the hidden legacy host');
  assert.equal(w.document.querySelector('#bookmarkOverlay'),null,'the Vue path does not instantiate the legacy bookmark editor overlay');
  w.document.querySelector('#mobileCats').click();
  assert.equal(legacyMain.hidden,true);
  assert.equal(legacyMain.querySelector('.note-page-layout'),null,'the notes list is not rendered a second time');
  w.document.querySelector('#mobileBookmarks').click();
  assert.equal(legacyMain.hidden,true);
  assert.equal(legacyMain.querySelector('.bookmark-page'),null,'bookmark state sync does not render a hidden legacy page');
  w.document.querySelector('#mobileHome').click();
  assert.equal(legacyMain.hidden,true);
  assert.equal(legacyMain.querySelector('.dashboard-page'),null);
});

test('reloading Docker data asks in the app dialog and cancel leaves current data untouched',async()=>{
 const note={id:'reload-local',title:'当前页面内容',type:'note',category:'开发',tags:[],body:'<p>保留</p>',source:'',created:1,updated:2,pinned:false,status:'published'};
 const {dom,w,saves}=await mount({...structuredClone(empty),notes:[note]});
 w.document.querySelector('#accountButton').click();w.document.querySelector('#openAppSettings').click();
 w.document.querySelector('#reloadCloud').click();
 assert.equal(w.document.querySelector('#actionDialogTitle').textContent,'重新载入数据');
 assert.match(w.document.querySelector('#actionDialogMessage').textContent,/替换当前草稿/);
 w.document.querySelector('#actionDialogCancel').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(w.document.querySelector('#main').textContent,/当前页面内容/);
 assert.equal(saves.length,0);
 dom.window.close();
});

test('reloading Docker data replaces the workspace without stale publish state or lost cloud content',async()=>{
 const cloud={...structuredClone(empty),notes:[{id:'cloud-note',title:'云端已保存',type:'note',category:'开发',tags:[],body:'<p>云端正文</p>',source:'',created:1,updated:3,pinned:false,status:'published'}]};
 const current={...structuredClone(empty),notes:[{id:'local-note',title:'当前页面内容',type:'note',category:'开发',tags:[],body:'<p>本机正文</p>',source:'',created:1,updated:2,pinned:false,status:'published'}]};
 const {dom,w}=await mount(current,{cloudData:cloud});
 w.document.querySelector('#accountButton').click();w.document.querySelector('#openAppSettings').click();w.document.querySelector('#reloadCloud').click();
 w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));
 assert.match(w.document.querySelector('#main').textContent,/云端已保存/);
 assert.doesNotMatch(w.document.querySelector('#main').textContent,/当前页面内容/);
 assert.equal(w.document.querySelector('#appSettingsOverlay').classList.contains('open'),false);
 dom.window.close();
});

test('manual retry continues the retained sync queue instead of queueing a stale page snapshot', async () => {
  const options={ local:false, owner:'account-1' };
  const { dom, w, saves } = await mount(empty, options);
  w.document.querySelector('#accountButton').click();
  w.document.querySelector('#openAppSettings').click();
  w.document.querySelector('#retrySync').click();
  assert.equal(options.retryRequests, 1);
  assert.equal(saves.length, 0);
  dom.window.close();
});

test('note categories are removed from the interface without overwriting legacy values', async t => {
  const legacy = { id:'legacy-category', title:'旧分类笔记', type:'note', category:'系统维护', tags:[], body:'<p>兼容数据</p>', source:'', created:1, updated:2, pinned:false, status:'published' };
  const { dom, w } = await mount({ ...structuredClone(empty), notes:[legacy], categories:['系统维护'] });
  t.after(() => dom.window.close());
  w.document.querySelector('[data-open="legacy-category"]').click();
  assert.doesNotMatch(w.document.querySelector('#main').textContent, /系统维护/);
  assert.equal(w.document.querySelector('#main .pill')?.textContent, '普通笔记');
  w.document.querySelector('#editDoc').click();
  assert.ok(w.document.querySelector('#editType'), 'note type remains editable');
  assert.equal(w.document.querySelector('#editCategory')?.type, 'hidden', 'legacy category data stays hidden from the editor form');
  assert.equal(w.document.querySelector('#addCategory'), null, 'category creation is removed');
  w.document.querySelector('#saveEditor').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.vaultDataStore.value.notes[0].category, '系统维护', 'editing does not erase legacy category data');
});

test('unified navigation exposes peer workspaces and creation choices without mutating content',async()=>{
 const {dom,w,saves}=await mount(designVault());
 assert.deepEqual([...w.document.querySelectorAll('#sideCore>.side-link')].map(n=>n.textContent.replace(/\d+/g,'').trim()),['首页','笔记','书签','回收站']);
 assert.equal(w.document.querySelector('#sideTypes').closest('.side-section').hidden,true);
 w.document.querySelector('#newSide').click();assert.equal(saves.length,0);
 assert.deepEqual([...w.document.querySelectorAll('[data-create-kind]')].map(n=>n.dataset.createKind),['note','bookmark','capture']);
 w.document.querySelector('[data-create-kind="bookmark"]').click();
 assert.equal(w.document.querySelector('#breadcrumbTitle').textContent,'书签导航');
 assert.ok(w.document.querySelector('#bmURL'));assert.equal(saves.length,0);
 w.document.querySelector('[data-bm-close]').click();w.document.querySelector('#mobileCats').click();
 assert.equal(w.document.querySelector('#sideTypes').closest('.side-section').hidden,false);
 assert.equal(w.document.querySelector('#mobileCats').classList.contains('selected'),true);
 w.document.querySelector('#mobileNew').click();w.document.querySelector('[data-create-kind="capture"]').click();
 assert.equal(w.document.querySelector('#captureOverlay').classList.contains('open'),true);dom.window.close();
});
