import { test } from 'node:test';
import * as fixture from '../../support/ui-fixtures.mjs';
const { TRASH_RETENTION_MS, TextSelection, assert, classifyClipboard, createTrashEntry, designVault, empty, mount, parseQidianMarkdown, pruneExpiredTrash, qidianSchema, readFile, restoreTrashEntry, sanitizeMarkdownDocument } = fixture;

test('trash expiration is exact at 30 days and restoring notes returns them to the vault', () => {
  const note={id:'restore-note',title:'还原测试',type:'note',category:'开发',tags:[],body:'<p>保留内容</p>',source:'',created:1,updated:2,pinned:false};
  const data={...structuredClone(empty),notes:[],trash:[createTrashEntry('note',note,{index:0}, {}, 100)]};
  assert.equal(pruneExpiredTrash(data,100+TRASH_RETENTION_MS-1),0);
  assert.equal(pruneExpiredTrash(data,100+TRASH_RETENTION_MS),1);
  data.trash=[createTrashEntry('note',note,{index:0}, {}, 200)];
  restoreTrashEntry(data,data.trash[0].id);
  assert.equal(data.notes[0].body,note.body);assert.deepEqual(data.trash,[]);
});

test('new notes stay in the private draft box until published', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  assert.equal(w.document.querySelector('#saveEditor').textContent.trim().endsWith('发布笔记'),true);
  assert.equal(w.document.querySelector('.doc-meta .pill').textContent,'编辑笔记');
  const title = w.document.querySelector('#editTitle'); title.value = '只在后台的草稿'; title.dispatchEvent(new w.Event('input',{ bubbles:true }));
  w.document.querySelector('#backDoc').click();
  w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));
  w.document.querySelector('#backDoc').click();
  assert.doesNotMatch(w.document.querySelector('#main').textContent, /只在后台的草稿/);
  w.document.querySelector('#sideCore [data-nav="all"]').click();w.document.querySelector('[data-nav="drafts"]').click();
  assert.match(w.document.querySelector('#main').textContent, /草稿箱/);
  assert.match(w.document.querySelector('#main').textContent, /只在后台的草稿/);
  w.document.querySelector('[data-open]').click();
  w.document.querySelector('#publishDoc').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(saves.at(-1).notes[0].status, 'published');
  assert.equal(saves.at(-1).notes[0].publishedSnapshot, undefined);
  assert.equal(w.document.querySelector('#main .about-note'),null,'routine publication status is not displayed');
  dom.window.close();
});

test('an untouched empty new note is discarded instead of entering the draft box', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  assert.equal(w.document.querySelector('#sideCore [data-nav="drafts"] .count').textContent,'0');
  w.document.querySelector('#sideCore [data-nav="drafts"]').click();
  assert.match(w.document.querySelector('#main').textContent,/暂无草稿/);
  assert.equal(w.document.querySelector('#main .note-card'),null);
  assert.ok(saves.every(snapshot=>snapshot.notes.length===0),'no empty placeholder is written to the vault');
  dom.window.close();
});

test('duplicating a published note routes through the vault action and saves its published content as a draft', async () => {
  const vault=structuredClone(empty);
  vault.notes=[{
    id:'published-source',title:'工作标题',type:'note',category:'开发',tags:['工作'],body:'<p>未发布正文</p>',source:'',created:1,updated:2,pinned:true,status:'published',publishedAt:2,
    publishedSnapshot:{title:'已发布标题',body:'<p>已发布正文</p>',category:'开发',type:'note',tags:['公开'],source:'',updated:2}
  }];
  const {dom,w,saves}=await mount(vault);
  try {
    w.document.querySelector('#sideCore [data-nav="all"]').click();
    w.document.querySelector('[data-open="published-source"]').click();
    w.document.querySelector('#duplicateDoc').click();
    for(let attempt=0;attempt<40&&w.workspaceNavigationStore.noteId==='published-source';attempt++)await new Promise(resolve=>setTimeout(resolve,5));

    const copy=saves.at(-1).notes[0];
    assert.notEqual(copy.id,'published-source');
    assert.equal(copy.title,'已发布标题（副本）');
    assert.equal(copy.body,'<p>已发布正文</p>');
    assert.deepEqual(copy.tags,['公开']);
    assert.equal(copy.status,'draft');
    assert.equal(copy.pinned,false);
    assert.equal(copy.publishedAt,null);
    assert.equal(copy.publishedSnapshot,undefined);
    assert.equal(w.workspaceNavigationStore.noteId,copy.id);
    assert.equal(w.workspaceNavigationStore.editing,true,'a duplicate opens directly in the editor');
  } finally { dom.window.close(); }
});

test('untouched command and troubleshooting templates are not mistaken for written drafts', async () => {
  for (const type of ['command','issue']) {
    const { dom, w, saves } = await mount();
    w.document.querySelector('#sideCore [data-nav="all"]').click();
    w.document.querySelector(`[data-type-nav="${type}"]`).click();
    w.document.querySelector('[data-new="note"]').click();
    w.document.querySelector('#sideCore [data-nav="drafts"]').click();
    assert.match(w.document.querySelector('#main').textContent,/暂无草稿/,`${type} template is only a starter, not authored content`);
    assert.ok(saves.every(snapshot=>snapshot.notes.length===0));
    dom.window.close();
  }
});

test('a new draft is removed when its actual content is cleared before leaving', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title=w.document.querySelector('#editTitle');title.value='临时内容';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(saves.at(-1).notes[0].title,'临时内容');
  title.value='';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,300));
  w.document.querySelector('#sideCore [data-nav="drafts"]').click();
  assert.match(w.document.querySelector('#main').textContent,/暂无草稿/);
  assert.ok(saves.at(-1).notes.length===0,'clearing all content removes the draft from the saved vault');
  dom.window.close();
});

test('deleting a cleared new note leaves the editor after its empty draft was removed', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title=w.document.querySelector('#editTitle');title.value='临时内容';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,300));
  title.value='';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(saves.at(-1).notes.length,0,'clearing the draft removes it from the vault');
  w.document.querySelector('#deleteEditorNote').click();
  const confirmation=w.document.querySelector('#actionDialogOverlay');
  assert.equal(confirmation.classList.contains('open'),true);
  assert.match(w.document.querySelector('#actionDialogMessage').textContent,/不会进入回收站/,'an empty detached draft is confirmed as a discard, not a recycle-bin move');
  w.document.querySelector('#actionDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#editorSurface'),null,'confirm exits the detached empty editor');
  assert.equal(saves.at(-1).notes.length,0);
  assert.equal(saves.at(-1).trash.length,0,'an empty note is not added to the recycle bin');
  dom.window.close();
});

test('deleted notes remain recoverable for 30 days and can be restored from the recycle bin', async () => {
  const note={id:'trash-note',title:'待还原笔记',type:'note',category:'开发',tags:[],body:'<p>保留正文</p>',source:'',created:1,updated:2,pinned:false,status:'published'};
  const {dom,w,saves}=await mount({...structuredClone(empty),notes:[note]});
  w.document.querySelector('#sideCore [data-nav="all"]').click();
  w.document.querySelector('[data-note-delete="trash-note"]').click();
  assert.equal(w.document.querySelector('#actionDialogOverlay').classList.contains('open'),true);
  w.document.querySelector('#actionDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(saves.at(-1).notes,[]);
  assert.equal(saves.at(-1).trash[0].item.id,'trash-note');
  w.document.querySelector('[data-trash-nav]').click();
  assert.match(w.document.querySelector('#main').textContent,/保留 30 天/);
  assert.match(w.document.querySelector('#main').textContent,/待还原笔记/);
  w.document.querySelector('[data-trash-restore]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(saves.at(-1).notes[0].id,'trash-note');
  assert.deepEqual(saves.at(-1).trash,[]);
  dom.window.close();
});

test('editor more menu moves the current note and its unsaved edits to the recycle bin', async () => {
  const note={id:'edit-delete',title:'正在编辑',type:'note',category:'开发',tags:[],body:'<p>旧正文</p>',source:'',created:1,updated:2,pinned:false,status:'published'};
  const {dom,w,saves}=await mount({...structuredClone(empty),notes:[note]});
  w.document.querySelector('#sideCore [data-nav="all"]').click();
  w.document.querySelector('[data-open="edit-delete"]').click();
  w.document.querySelector('#editDoc').click();
  assert.ok(w.document.querySelector('.document-more #deleteEditorNote'));
  w.currentEditor.commands.setContent('<p>未保存的最新正文</p>');
  w.document.querySelector('#deleteEditorNote').click();
  assert.equal(w.document.querySelector('#actionDialogOverlay').classList.contains('open'),true);
  w.document.querySelector('#actionDialogCancel').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(w.document.querySelector('#editorSurface'),'cancel keeps the editor open');
  w.document.querySelector('#deleteEditorNote').click();
  w.document.querySelector('#actionDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(saves.at(-1).notes,[]);
  assert.match(saves.at(-1).trash[0].item.body,/未保存的最新正文/);
  assert.equal(w.document.querySelector('#editorSurface'),null,'return to the note list after deletion');
  assert.doesNotMatch(w.document.querySelector('#main').textContent,/正在编辑/);
  dom.window.close();
});

test('the reader presents article metadata and keeps a section outline available on mobile', async () => {
  const note = { id:'article-note', title:'一篇长文笔记', type:'note', category:'开发', tags:['教程'], body:'<h2>部署前准备</h2><p>先检查环境。</p><h3>确认版本</h3><pre><code>node --version</code></pre>', source:'', created:1, updated:2, pinned:false };
  const { dom, w } = await mount({ ...structuredClone(empty), notes:[note] });
  w.document.querySelector('[data-open="article-note"]').click();
  assert.ok(w.document.querySelector('.reader-shell'));
  assert.match(w.document.querySelector('.doc-meta').textContent, /阅读约 1 分钟/);
  assert.match(w.document.querySelector('.reader-shell .doc-title').textContent, /一篇长文笔记/);
  assert.equal(w.document.querySelector('.mobile-toc summary').textContent.includes('本文目录'), true);
  assert.equal(w.document.querySelector('.mobile-toc a[href="#sec-0"]').textContent, '部署前准备');
  assert.equal(w.document.querySelector('#main .about-note'),null,'the reader has no service footer');
  assert.equal(w.document.querySelector('.right-rail .outline a[href="#sec-1"]').textContent, '确认版本');
  dom.window.close();
});

test('the reader projection derives the published, sanitized note snapshot from the active vault', async t=>{
  const note={id:'vue-reader',title:'安全的阅读标题',type:'note',category:'开发',tags:['Vue'],body:'<h2>章节标题</h2><p>正文内容</p><script>globalThis.pwned=true</script>',source:'javascript:alert(1)',created:1,updated:2,pinned:true};
  const {dom,w}=await mount({...structuredClone(empty),notes:[note]});
  t.after(()=>dom.window.close());
  w.document.querySelector('[data-open="vue-reader"]').click();
  const snapshot=w.readerDataStore.snapshot;
  assert.equal(snapshot.noteId,'vue-reader');
  assert.equal(snapshot.title,'安全的阅读标题');
  assert.equal(snapshot.bodyHtml.includes('<script'),false,'the Vue view receives sanitized HTML only');
  assert.match(snapshot.bodyHtml,/章节标题/);
  assert.deepEqual([...snapshot.outline].map(item=>[item.name,item.id,item.level]),[['章节标题','sec-0',2]]);
  assert.equal(snapshot.sourceUrl,'','unsafe source protocols are not sent to the Vue link');
  assert.equal(snapshot.pinned,true);
  assert.equal(w.document.querySelector('#main').hidden,false);
  assert.equal(w.document.querySelector('#dashboardHost').hidden,true);
  assert.equal(w.readerDataStore.active,true);
});

test('legacy Markdown notes render as formatted content and the outline contains headings only', async()=>{
  const note={id:'markdown-note',title:'Markdown 使用笔记',type:'note',category:'开发',tags:['Markdown'],body:'<p># Markdown 使用笔记</p><p><br></p><p>## 安装</p><p><br></p><p>1. 从 [GitHub Releases](https://github.com/example/releases) 下载最新版。</p><p><br></p><p>2. 在 iStoreOS 上传并安装 **安装包**。</p><p><br></p><p>```sh</p><p>cat /tmp/qidian-install.log</p><p>```</p><p><br></p><p>普通说明文本。</p>',source:'',created:1,updated:2,pinned:false};
  const {dom,w}=await mount({...structuredClone(empty),notes:[note]});
  const preview=w.document.querySelector('.note-card p').textContent;
  assert.match(preview,/安装/);assert.match(preview,/GitHub Releases/);
  assert.doesNotMatch(preview,/[#*`]|\[GitHub Releases\]/,'the note card preview hides Markdown syntax');
  w.document.querySelector('[data-open="markdown-note"]').click();
  const body=w.document.querySelector('#docRead');
  assert.deepEqual([...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(heading=>[heading.tagName,heading.textContent]),[['H2','安装']],'the duplicated document title is omitted and the first section is promoted to the correct level');
  assert.equal(body.querySelectorAll('ol > li').length,2,'numbered steps separated by blank lines stay a single ordered list');
  assert.equal(body.querySelector('a[href="https://github.com/example/releases"]')?.textContent,'GitHub Releases');
  assert.equal(body.querySelector('pre code')?.textContent,'cat /tmp/qidian-install.log');
  assert.deepEqual([...w.document.querySelectorAll('.right-rail .outline a')].map(link=>link.textContent),['安装'],'the desktop outline includes only semantic headings, not list items or code');
  assert.equal(w.document.querySelector('.right-rail .outline a').classList.contains('sub'),false,'the first section is not indented as a subsection');
  assert.deepEqual([...w.document.querySelectorAll('.mobile-toc .outline a')].map(link=>link.textContent),['安装'],'the mobile outline mirrors the same headings');
  const styles=await readFile(new URL('../../../src/styles.css',import.meta.url),'utf8');
   assert.match(styles,/\.note-list\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,420px\),1fr\)\)/,'desktop notes adapt column count to available card width');
  assert.match(styles,/@media\(max-width:1000px\)\{\.note-list\{grid-template-columns:minmax\(0,1fr\)\}\}/,'narrow layouts return to one column');
  assert.match(styles,/\.reader-shell \.doc-title::before\{content:none;display:none\}/,'the decorative English overline is removed');
  dom.window.close();
});

test('the reader outline follows the visible heading and disconnects when leaving the note', async () => {
  const note = { id:'outline-note', title:'章节目录', type:'note', category:'开发', tags:[], body:'<h2>准备</h2><p>内容</p><h3>确认环境</h3><p>更多内容</p>', source:'', created:1, updated:2, pinned:false };
  const { dom, w } = await mount({ ...structuredClone(empty), notes:[note] });
  let observerCallback;
  const observer={observed:[],disconnected:false,observe(element){this.observed.push(element)},disconnect(){this.disconnected=true}};
  w.IntersectionObserver=class { constructor(callback){observerCallback=callback;return observer} };
  w.document.querySelector('[data-open="outline-note"]').click();
  assert.equal(observer.observed.length,2);
  const secondHeading=w.document.querySelector('#sec-1');
  observerCallback([{isIntersecting:true,boundingClientRect:{top:20},target:secondHeading}]);
  assert.equal(w.document.querySelector('.right-rail a[href="#sec-1"]').getAttribute('aria-current'),'location');
  assert.equal(w.document.querySelector('.mobile-toc a[href="#sec-0"]').classList.contains('current'),false);
  w.document.querySelector('#backDoc').click();
  assert.equal(observer.disconnected,true);
  dom.window.close();
});

test('workspace navigation restores the originating note list and scroll position', async t => {
  const note = { id:'nav-note', title:'导航返回', type:'note', category:'开发', tags:[], body:'<p>正文</p>', source:'', created:1, updated:2, pinned:false };
  const { dom, w } = await mount({ ...structuredClone(empty), notes:[note] });
  t.after(() => dom.window.close());
  let scroll = 0;
  Object.defineProperty(w, 'scrollY', { configurable:true, get:() => scroll });
  w.scrollTo = options => { scroll = Number(options?.top || 0); };

  w.document.querySelector('#sideCore [data-nav="all"]').click();
  scroll = 428;
  w.document.querySelector('[data-open="nav-note"]').click();
  assert.equal(scroll, 0, 'opening a note starts at the top');
  w.document.querySelector('#backDoc').click();
  assert.match(w.document.querySelector('#main').textContent,/导航返回/);
  assert.equal(scroll, 428, 'returning from the reader restores the originating list position');
});

test('a safe pending draft is queued for cloud sync immediately after recovery', async () => {
  const { dom, saves } = await mount(empty, { local:false, owner:'account-1', restoreDraft:true });
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].notes, []);
  dom.window.close();
});

test('a dismissed local draft can be restored from settings without another prompt', async () => {
  const { dom, w, saves } = await mount(empty, { local:false, owner:'account-1', ignoredDraft:true });
  assert.ok(w.document.querySelector('#restoreLocalDraft'));
  assert.equal(w.document.querySelector('#restoreLocalDraft').hidden, false);
  w.document.querySelector('#accountButton').click();
  w.document.querySelector('#openAppSettings').click();
  w.document.querySelector('#restoreLocalDraft').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(saves.length, 1);
  assert.equal(w.document.querySelector('#restoreLocalDraft').hidden, true);
  assert.equal(w.document.querySelector('#appSettingsOverlay').classList.contains('open'), false);
  dom.window.close();
});

test('editor preserves draft when navigating home before debounce finishes', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title = w.document.querySelector('#editTitle'); title.value = '不丢失的笔记'; title.dispatchEvent(new w.Event('input',{ bubbles:true }));
  w.currentEditor.commands.setContent('<p>中文内容 ✅</p>');
  w.document.querySelector('[data-nav="all"]').click();
  w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(saves.at(-1).notes[0].title,'不丢失的笔记'); assert.match(saves.at(-1).notes[0].body,/中文内容/);
  w.document.querySelector('[data-nav="drafts"]').click();
  assert.match(w.document.querySelector('#main').textContent,/不丢失的笔记/); dom.window.close();
});

test('leaving a changed editor asks to save and cancel keeps the editor open', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title=w.document.querySelector('#editTitle');title.value='离开前询问保存';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.document.querySelector('[data-nav="all"]').click();
  assert.equal(w.document.querySelector('#actionDialogOverlay').classList.contains('open'),true);
  assert.match(w.document.querySelector('#actionDialogMessage').textContent,/是否保存后离开/);
  w.document.querySelector('#actionDialogCancel').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(w.document.querySelector('#editTitle'),'cancel keeps the user in the editor');
  w.document.querySelector('[data-nav="all"]').click();
  w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#editTitle'),null);
  assert.equal(saves.at(-1).notes[0].title,'离开前询问保存');
  dom.window.close();
});

test('opening the recycle bin from a changed editor asks first and saves only when confirmed', async () => {
  const {dom,w,saves}=await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title=w.document.querySelector('#editTitle');title.value='回收站导航前保存';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.document.querySelector('[data-trash-nav]').click();
  assert.equal(w.document.querySelector('#actionDialogOverlay').classList.contains('open'),true);assert.match(w.document.querySelector('#actionDialogMessage').textContent,/是否保存后离开/);
  w.document.querySelector('#actionDialogCancel').click();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(w.document.querySelector('#editTitle'));
  w.document.querySelector('[data-trash-nav]').click();w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#editTitle'),null);assert.match(w.document.querySelector('#main').textContent,/回收站/);
  assert.equal(saves.at(-1).notes[0].title,'回收站导航前保存');assert.deepEqual(saves.at(-1).trash,[]);
  dom.window.close();
});

test('leaving an unchanged editor does not show a save prompt', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.document.querySelector('[data-nav="all"]').click();
  assert.equal(w.document.querySelector('#actionDialogOverlay').classList.contains('open'),false);
  assert.equal(w.document.querySelector('#editTitle'),null);
  dom.window.close();
});

test('sidebar brand returns to the dashboard and saves the active draft first', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title = w.document.querySelector('#editTitle');
  title.value = '通过品牌返回时保留';
  title.dispatchEvent(new w.Event('input', { bubbles:true }));
  w.currentEditor.commands.setContent('<p>品牌按钮导航内容</p>');
  const brand = w.document.querySelector('#brandHome');
  assert.equal(brand.tagName, 'BUTTON');
  brand.querySelector('.brand-copy strong').click();
  w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(saves.at(-1).notes[0].title, '通过品牌返回时保留');
  assert.match(saves.at(-1).notes[0].body, /品牌按钮导航内容/);
  assert.equal(w.document.querySelector('#breadcrumbTitle').textContent, '首页');
  w.document.querySelector('#sideCore [data-nav="all"]').click();
  w.document.querySelector('[data-nav="drafts"]').click();
  assert.match(w.document.querySelector('#main').textContent, /通过品牌返回时保留/);
  dom.window.close();
});

test('editor sends changes on blur and shortly after typing stops', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const title = w.document.querySelector('#editTitle');
  title.value = '离开输入框时立即排队';
  title.dispatchEvent(new w.Event('input', { bubbles:true }));
  title.dispatchEvent(new w.Event('blur'));
  assert.equal(saves.at(-1).notes[0].title, '离开输入框时立即排队');

  const body = w.document.querySelector('#editorSurface');
  w.currentEditor.commands.setContent('<p>暂停输入后自动同步</p>');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.match(saves.at(-1).notes[0].body, /暂停输入后自动同步/);
  dom.window.close();
});

test('an expired cloud session asks the same account to log in without discarding the editor', async () => {
  const note={id:'reauth-note',title:'原题',type:'note',category:'开发',tags:[],body:'<p>原文</p>',source:'',created:1,updated:1,pinned:false,status:'published',publishedAt:1};
  const vault={...structuredClone(empty),notes:[note]};
  const {dom,w,initialOptions}=await mount(vault,{username:'alan'});
  w.document.querySelector('[data-open="reauth-note"]').click();
  w.document.querySelector('#editDoc').click();
  const title=w.document.querySelector('#editTitle');title.value='本机未同步标题';title.dispatchEvent(new w.Event('input',{bubbles:true}));
  initialOptions.authenticationRequired();
  assert.equal(initialOptions.reauthentication.username,'alan');
  await initialOptions.reauthentication.onAuthenticated({data:{...vault,notes:[{...note,title:'本机未同步标题',updated:2}]},conflict:false,synced:true});
  assert.equal(w.document.querySelector('#editTitle').value,'本机未同步标题');
  assert.equal(w.currentEditor.getHTML(),'<p>原文</p>');
  assert.equal(w.document.querySelector('#toast').textContent,'');
  dom.window.close();
});

test('web paste keeps safe rich formatting, table spans, and background colors', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const paste = new w.Event('paste', { bubbles:true, cancelable:true });
  Object.defineProperty(paste, 'clipboardData', { value:{
    files:[],
    getData(type){ return type==='text/html' ? '<p style="text-align:center"><strong>网页标题</strong> <span style="background-color: rgb(255, 245, 150)">高亮</span></p><table><tbody><tr><td colspan="2">合并表格</td></tr></tbody></table>' : '网页标题 高亮 合并表格'; },
  } });
  const handled = w.currentEditor.view.someProp('handlePaste', handler => handler(w.currentEditor.view,paste,null));
  assert.equal(handled,true);
  assert.match(w.currentEditor.getHTML(), /网页标题/);
  assert.match(w.currentEditor.getHTML(), /colspan="2"/);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.match(saves.at(-1).notes[0].body, /background-color: rgb\(255, 245, 150\)/);
  dom.window.close();
});

test('HTML paste removes executable markup and keeps text when an image URL is unsafe', async () => {
  const {dom,w}=await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/html'?'<p onclick="alert(1)">安全文字 <a href="javascript:alert(1)">危险链接</a><img src="javascript:alert(1)" alt="图片说明"></p><script>alert(2)</script>':'安全文字 危险链接 图片说明';}}});
  w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,paste,null));
  const html=w.currentEditor.getHTML();
  assert.match(html,/安全文字/);
  assert.match(html,/危险链接/);
  assert.match(html,/图片说明/);
  assert.doesNotMatch(html,/javascript:|onclick|<script|alert\(/i);
  dom.window.close();
});

test('clipboard classifier separates safe rich HTML, Markdown and ordinary prose', () => {
  assert.equal(classifyClipboard({ text:'## VPS 管理\n\n说明内容' }), 'markdown');
  assert.equal(classifyClipboard({ text:':::warning\n请先备份\n:::' }), 'markdown');
  assert.equal(classifyClipboard({ text:'[!WARNING] 危险操作' }), 'markdown');
  assert.equal(classifyClipboard({ text:'这是一段普通文字\n下一行仍是普通文字。' }), 'plain');
  assert.equal(classifyClipboard({ html:'<p><strong>网页格式</strong></p>', text:'## 标题' }), 'html');
  assert.equal(classifyClipboard({ html:'<div><p>## 标题</p><p>内容</p></div>', text:'## 标题\n\n内容' }), 'markdown');
  assert.equal(classifyClipboard({ text:'## 标题', mode:'plain' }), 'plain');
  assert.equal(classifyClipboard({ text:'普通内容', mode:'markdown' }), 'markdown');
});

test('rich paste keeps Markdown source editable and preview renders clickable links', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const source = '## 参考\n\n- [Matt Pocock Skills 项目](https://github.com/mattpocock/skills)\n\n- [OpenAI Codex 技能说明](https://developers.openai.com/codex/skills/)';
  const html = `<div><p>${source.replaceAll('\n', '<br>')}</p></div>`;
  const paste = new w.Event('paste', { bubbles:true, cancelable:true });
  Object.defineProperty(paste, 'clipboardData', { value:{ files:[], getData(type){ return type === 'text/html' ? html : type === 'text/plain' ? source : ''; } } });
  w.currentEditor.view.someProp('handlePaste', handler => handler(w.currentEditor.view, paste, null));
  const title = w.document.querySelector('#editTitle');
  title.value = '链接资料';
  title.dispatchEvent(new w.Event('input', { bubbles:true }));
  const sourceHTML = w.currentEditor.getHTML();
  assert.match(sourceHTML, /## 参考/);
  assert.match(sourceHTML, /\[Matt Pocock Skills 项目\]\(https:\/\/github\.com\/mattpocock\/skills\)/);
  assert.doesNotMatch(sourceHTML, /<h2>|<a\b/);

  const previewButton = w.document.querySelector('#editorMarkdownPreviewToggle');
  previewButton.click();
  const preview = w.document.querySelector('#editorMarkdownPreview');
  assert.equal(w.document.querySelector('#editorSurface').hidden, true);
  assert.equal(preview.hidden, false);
  assert.match(preview.innerHTML, /<h3>参考<\/h3>/);
  const link = preview.querySelector('a[href="https://github.com/mattpocock/skills"]');
  assert.equal(link?.textContent, 'Matt Pocock Skills 项目');
  assert.equal(link?.target, '_blank');
  assert.match(link?.rel || '', /noopener/);
  assert.equal(previewButton.textContent, '继续编辑');

  previewButton.click();
  assert.equal(w.document.querySelector('#editorSurface').hidden, false);
  assert.equal(preview.hidden, true);
  assert.match(w.currentEditor.getHTML(), /\[Matt Pocock Skills 项目\]/, 'returning to editing keeps source intact');
  w.document.querySelector('#saveEditor').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const readerLink = w.document.querySelector('#docRead a[href="https://github.com/mattpocock/skills"]');
  assert.equal(readerLink?.textContent, 'Matt Pocock Skills 项目', 'a saved Markdown link opens as a real link in the reader');
  assert.equal(readerLink?.target, '_blank');
  dom.window.close();
});

test('automatic rich paste preserves Markdown while explicit Markdown mode converts it to rich text', async () => {
  const plain = [
    '## Docker 管理', '',
    '### 清理 Docker 无用资源', '',
    '删除未使用的镜像。', '',
    '```bash', 'docker system prune -a', '```', '',
    ':::warning', '清理前确认数据。', '', 'Docker 卷可能存有数据库。', ':::', '',
    '| 参数 | 说明 |', '| --- | --- |', '| --all | 清理未使用镜像 |'
  ].join('\n');
  const richHTML = '<h2>Docker 管理</h2><h3>清理 Docker 无用资源</h3><p>删除未使用的镜像。</p><pre><code class="language-bash">docker system prune -a</code></pre><div class="callout warn"><p>清理前确认数据。</p><p>Docker 卷可能存有数据库。</p></div><table><thead><tr><th><p>参数</p></th><th><p>说明</p></th></tr></thead><tbody><tr><td><p>--all</p></td><td><p>清理未使用镜像</p></td></tr></tbody></table>';
  const capture = async (clipboard, mode = 'rich') => {
    const {dom,w}=await mount();
    w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
    w.document.querySelector('#editPasteMode').value=mode;
    const event=new w.Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'clipboardData',{value:{files:[],getData(type){return clipboard[type]||'';}}});
    w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,event,null));
    await new Promise(resolve=>setTimeout(resolve,0));
    const editor=w.currentEditor.view.dom;
    const structure={source:editor.textContent,headings:[...editor.querySelectorAll('h2,h3')].map(node=>node.textContent),commands:[...editor.querySelectorAll('pre')].map(node=>node.textContent),languages:[...editor.querySelectorAll('pre code')].map(node=>node.className),warning:editor.querySelector('.callout.warn')?.textContent,table:[...editor.querySelectorAll('tr')].map(row=>[...row.cells].map(cell=>cell.textContent))};
    await new Promise(resolve=>setTimeout(resolve,250));
    dom.window.close();
    return structure;
  };
  const automatic=await capture({'text/plain':plain});
  assert.match(automatic.source,/## Docker 管理/);
  assert.match(automatic.source,/```bash/);
  assert.deepEqual(automatic.headings,[]);
  assert.deepEqual(automatic.commands,[]);
  const converted=await capture({'text/plain':plain},'markdown');
  assert.deepEqual(converted.headings,['Docker 管理','清理 Docker 无用资源']);
  assert.deepEqual(converted.languages,['language-bash']);
  assert.ok(converted.warning);
  assert.ok(converted.table.length > 0);
  const richClipboard=await capture({'text/html':richHTML,'text/plain':plain});
  assert.deepEqual(richClipboard.headings,['Docker 管理','清理 Docker 无用资源']);
});

test('Markdown paste preserves nested lists, GFM tables, languages, callouts and open details through HTML reload', async () => {
  const {dom,w}=await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.document.querySelector('#editPasteMode').value='markdown';
  const source=[
    '## 保真验收', '', '- 主项', '  - 子项', '',
    '| 名称 | 说明 |', '| --- | --- |', '| 栖点 | 私人笔记 |', '',
    '```yaml', 'service: qidian', '```', '',
    ':::tip', '提示内容需要保留。', ':::', '',
    '[!WARNING] 不要直接删除数据', '> 先确认备份可用。', '',
    '<details open>', '<summary>点击查看</summary>', '<div data-type="detailsContent"><p>折叠内容。</p></div>', '</details>', '',
    '[危险链接](javascript:alert(1))'
  ].join('\n');
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?source:'';}}});
  w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,paste,null));
  await new Promise(resolve=>setTimeout(resolve,0));
  let html=w.currentEditor.getHTML();
  assert.match(html,/<h2>保真验收<\/h2>/);
  assert.match(html,/<li><p>主项<\/p><ul><li><p>子项<\/p><\/li><\/ul><\/li>/);
  assert.match(html,/<table\b/);
  assert.match(html,/<pre><code class="language-yaml">service: qidian<\/code><\/pre>/);
  assert.match(html,/<div class="callout good">/);
  assert.match(html,/<div class="callout warn">/);
  assert.match(html,/<details open="">/);
  assert.match(html,/data-type="detailsContent"/);
  assert.doesNotMatch(html,/javascript:|alert\(1\)/);
  w.currentEditor.commands.setContent(html);
  html=w.currentEditor.getHTML();
  assert.match(html,/<details open="">/,'the saved HTML restore keeps the details state');
  assert.match(html,/<code class="language-yaml">service: qidian<\/code>/,'the saved HTML restore keeps the code language');
  await new Promise(resolve=>setTimeout(resolve,250));
  dom.window.close();
});

test('plain-text paste mode remains literal and does not infer Markdown or command blocks', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.document.querySelector('#editPasteMode').value='plain';
  const paste = new w.Event('paste', { bubbles:true, cancelable:true });
  Object.defineProperty(paste, 'clipboardData', { value:{ files:[], getData(type){ return type==='text/plain'?'docker system prune -a\n[!WARNING] 注意':''; } } });
  const handled = w.currentEditor.view.someProp('handlePaste', handler => handler(w.currentEditor.view,paste,null));
  assert.equal(handled,true);
  assert.doesNotMatch(w.currentEditor.getHTML(),/<pre>/);
  assert.match(w.currentEditor.getHTML(),/\[!WARNING\] 注意/);
  await new Promise(resolve=>setTimeout(resolve,250));
  dom.window.close();
});

test('default paste keeps ordinary prose literal instead of guessing headings or commands', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const text='VPS 服务器测试与维护\n\ndocker system prune -a 这条命令只作说明，不是代码块。';
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?text:'';}}});
  w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,paste,null));
  const html=w.currentEditor.getHTML();
  assert.doesNotMatch(html,/<h[1-6]|<pre|<ol|<ul/);
  assert.equal((html.match(/<br>/g)||[]).length,2,'blank lines remain visible line breaks');
  assert.match(html,/VPS 服务器测试与维护/);
  assert.match(html,/docker system prune -a 这条命令只作说明/);
  assert.equal(w.currentEditor.state.doc.textContent,'VPS 服务器测试与维护docker system prune -a 这条命令只作说明，不是代码块。');
  dom.window.close();
});

test('the selected paste mode stays consistent in the note editor and quick capture', async()=>{
  const vault={...structuredClone(empty),pasteMode:'plain'};
  const {dom,w}=await mount(vault);
  w.document.querySelector('#quickCapture').click();
  assert.equal(w.document.querySelector('#capturePasteMode').value,'plain');
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  assert.equal(w.document.querySelector('#editPasteMode').value,'plain');
  dom.window.close();
});

test('pasting into a code block inserts exact text without Markdown parsing', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.currentEditor.commands.setContent('<pre><code>原有代码</code></pre>');
  w.currentEditor.commands.setTextSelection(3);
  assert.equal(w.currentEditor.isActive('codeBlock'),true);
  const source='# 不能变成标题\n```bash\n命令原样保留\n```';
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?source:'';}}});
  w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,paste,null));
  const html=w.currentEditor.getHTML();
  assert.doesNotMatch(html,/<h1>|<h2>/);
  assert.equal((html.match(/<pre/g)||[]).length,1);
  assert.match(w.currentEditor.state.doc.textContent,/# 不能变成标题/);
  assert.match(w.currentEditor.state.doc.textContent,/```bash/);
  assert.match(w.currentEditor.state.doc.textContent,/命令原样保留/);
  dom.window.close();
});

test('a pasted Markdown document can be undone and redone as one editor action', async () => {
  const {dom,w}=await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.document.querySelector('#editPasteMode').value='markdown';
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?'## 新标题\n\n正文内容':'';}}});
  w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,paste,null));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(w.currentEditor.getHTML(),/<h2>新标题<\/h2>/);
  assert.equal(w.currentEditor.commands.undo(),true);
  assert.doesNotMatch(w.currentEditor.getHTML(),/新标题|正文内容/);
  assert.equal(w.currentEditor.commands.redo(),true);
  assert.match(w.currentEditor.getHTML(),/<h2>新标题<\/h2>/);
  await new Promise(resolve=>setTimeout(resolve,250));
  dom.window.close();
});

test('Markdown sanitizer strips unsafe links and image URLs and rejects hostile attributes', () => {
  const safeUrl=(url,image=false)=>image?/^https?:\/\//i.test(String(url||'')):/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(String(url||''));
  const hostile={type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'危险链接',marks:[{type:'link',attrs:{href:'javascript:alert(1)',target:'_blank'}}]}]},
    {type:'image',attrs:{src:'javascript:alert(1)',alt:'图片替代文字',onerror:'alert(1)'}},
    {type:'codeBlock',attrs:{language:'bash"><img src=x onerror=alert(1)>'},content:[{type:'text',text:'echo safe'}]},
  ]};
  const safe=sanitizeMarkdownDocument(hostile,qidianSchema,safeUrl);
  const checked=qidianSchema.nodeFromJSON(safe);checked.check();
  assert.doesNotMatch(JSON.stringify(safe),/javascript:|onerror|<img/);
  assert.match(JSON.stringify(safe),/图片替代文字/);
  assert.equal(safe.content.at(-1).attrs.language,null);
});

test('quick capture uses the same Markdown parser and retains fenced code language', async () => {
  const { dom, w } = await mount();
  w.document.execCommand=(command,_showUI,value)=>{
    if(command==='insertHTML')w.document.querySelector('#capturePad').insertAdjacentHTML('beforeend',value);
    return true;
  };
  w.document.querySelector('#quickCapture').click();
  const pad=w.document.querySelector('#capturePad');
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?'# Docker 快速记录\n\n```bash\ndocker run hello-world\n```':'';}}});
  pad.dispatchEvent(paste);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(paste.defaultPrevented,true);
  assert.equal(w.document.querySelector('#captureName').value,'Docker 快速记录');
  assert.match(pad.innerHTML,/<pre[^>]*><code class="language-bash">docker run hello-world<\/code><\/pre>/);
  dom.window.close();
});

test('quick capture can paste exact plain text with blank lines and no forced Markdown', async()=>{
  const {dom,w}=await mount();
  w.document.querySelector('#quickCapture').click();
  w.document.querySelector('#capturePasteMode').value='plain';
  const pad=w.document.querySelector('#capturePad');
  const source='# 按原文保留\n第一行\n\n末尾';
  const paste=new w.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?source:'';}}});
  pad.dispatchEvent(paste);
  assert.equal(paste.defaultPrevented,true);
  assert.match(pad.innerHTML,/<p># 按原文保留<br>第一行<br><br>末尾<\/p>/);
  assert.doesNotMatch(pad.innerHTML,/<h1>|<pre>/);
  dom.window.close();
});

test('quick capture waits for the Vault transaction before opening the saved draft', async t=>{
  const {dom,w,saves}=await mount();
  t.after(()=>dom.window.close());
  w.document.querySelector('#quickCapture').click();
  w.document.querySelector('#captureName').value='网络配置摘录';
  w.document.querySelector('#captureType').value='clip';
  assert.equal(w.document.querySelector('#captureCat'), null, 'quick capture has no category field');
  w.document.querySelector('#captureSource').value='https://example.com/guide';
  w.document.querySelector('#capturePad').innerHTML='<p>保留重点</p><script>unsafe()</script>';
  w.document.querySelector('#captureSave').click();
  await new Promise(resolve=>setTimeout(resolve,0));

  const note=saves.at(-1).notes[0];
  assert.equal(note.title,'网络配置摘录');
  assert.equal(note.type,'clip');
  assert.equal(note.category,'未分类', 'new notes retain only the hidden legacy default');
  assert.equal(note.source,'https://example.com/guide');
  assert.equal(note.body,'<p>保留重点</p>');
  assert.equal(note.status,'draft');
  assert.equal(w.document.querySelector('#captureOverlay').classList.contains('open'),false);
  assert.ok(w.document.querySelector('#docRead'),'navigation happens only after the committed note is opened');
});

test('a failed quick capture transaction keeps the dialog open and the workspace unchanged', async t=>{
  const {dom,w,initialOptions}=await mount(empty,{commitError:'SQLite 提交失败'});
  t.after(()=>dom.window.close());
  w.document.querySelector('#quickCapture').click();
  w.document.querySelector('#captureName').value='未提交摘录';
  w.document.querySelector('#capturePad').innerHTML='<p>内容</p>';
  w.document.querySelector('#captureSave').click();
  await new Promise(resolve=>setTimeout(resolve,0));

  assert.equal(w.vaultDataStore.value.notes.length,0);
  assert.equal(w.workspaceNavigationStore.page,'dashboard');
  assert.equal(w.document.querySelector('#captureOverlay').classList.contains('open'),true);
  assert.match(w.document.querySelector('#toast').textContent,/SQLite 提交失败/);
  assert.equal(initialOptions.flushCalls||0,0,'a failed transaction does not proceed to a second save');
});

test('pasting fills an empty note title and preserves a manually entered title', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const pastePlain=text=>{
    const event=new w.Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'clipboardData',{value:{files:[],getData(type){return type==='text/plain'?text:'';}}});
    w.currentEditor.view.someProp('handlePaste',handler=>handler(w.currentEditor.view,event,null));
  };
  const title=w.document.querySelector('#editTitle');
  pastePlain('# VPS 常用命令\n\n整理服务器常用命令。');
  assert.equal(title.value,'VPS 常用命令');
  title.value='我手动填写的标题';
  title.dispatchEvent(new w.Event('input',{bubbles:true}));
  pastePlain('# 后续粘贴内容\n\n继续补充说明。');
  assert.equal(title.value,'我手动填写的标题');
  await new Promise(resolve=>setTimeout(resolve,250));
  dom.window.close();
});

test('table toolbar can add and remove rows and columns inside a selected table', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.currentEditor.chain().focus().insertTable({ rows:2, cols:2, withHeaderRow:true }).run();
  const addRow = w.document.querySelector('[data-table-action="addRowAfter"]');
  assert.equal(addRow.disabled, false, 'table actions enable when the selection is in a table');
  addRow.click();
  assert.equal(w.currentEditor.view.dom.querySelectorAll('tr').length, 3);
  w.document.querySelector('[data-table-action="addColumnAfter"]').click();
  assert.equal(w.currentEditor.view.dom.querySelector('tr').children.length, 3);
  w.document.querySelector('[data-table-action="deleteColumn"]').click();
  assert.equal(w.currentEditor.view.dom.querySelector('tr').children.length, 2);
  w.document.querySelector('[data-table-action="deleteRow"]').click();
  assert.equal(w.currentEditor.view.dom.querySelectorAll('tr').length, 2);
  const deleteTable = w.document.querySelector('[data-table-action="deleteTable"]');
  assert.equal(deleteTable.disabled, false);
  deleteTable.click();
  assert.equal(w.currentEditor.view.dom.querySelector('table'), null, 'delete the whole active table');
  dom.window.close();
});

test('table insert button creates a table in a blank new note', async () => {
  const { dom, w } = await mount();
  try {
    w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
    assert.equal(w.currentEditor.view.dom.querySelector('table'),null);
    w.document.querySelector('#editorToolbar [data-insert="table"]').click();
    assert.equal(w.currentEditor.view.dom.querySelectorAll('table tr').length,3);
    assert.equal(w.currentEditor.view.dom.querySelectorAll('table tr:first-child th, table tr:first-child td').length,2);
    assert.equal(w.document.querySelector('.table-tools').hidden,false,'show table controls immediately after insertion');
    assert.equal(w.document.querySelector('[data-table-action="deleteRow"]').disabled,false);
  } finally { dom.window.close(); }
});

test('contextual editor action removes only the active command block', async () => {
  const { dom, w } = await mount();
  try {
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor=w.currentEditor;
  editor.commands.setContent('<p>保留在前</p><pre><code>docker ps</code></pre><p>保留在后</p>');
  const deleteCode=w.document.querySelector('[data-editor-action="delete-code-block"]');
  assert.equal(deleteCode.parentElement.hidden,true,'hide code actions outside a command block');
  let codePosition=-1;
  editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='docker ps')codePosition=pos});
  assert.notEqual(codePosition,-1);
  editor.commands.setTextSelection({from:codePosition+2,to:codePosition+2});
  assert.equal(deleteCode.hidden,false);
  assert.equal(deleteCode.disabled,false);
  deleteCode.click();
  assert.doesNotMatch(editor.getHTML(),/<pre[\s>]/);
  assert.match(editor.getHTML(),/保留在前/);
  assert.match(editor.getHTML(),/保留在后/);
  } finally { dom.window.close(); }
});

test('editor toolbar disclosure preserves the active command block selection', async () => {
  const { dom, w } = await mount();
  try {
    w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
    const editor=w.currentEditor;
    editor.commands.setContent('<p>保留在前</p><pre><code>docker ps</code></pre><p>保留在后</p>');
    let codePosition=-1;
    editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='docker ps')codePosition=pos});
    editor.commands.setTextSelection({from:codePosition+2,to:codePosition+2});
    const disclosure=w.document.querySelector('summary[aria-label="更多格式"]');
    const mouseDown=new w.MouseEvent('mousedown',{bubbles:true,cancelable:true});
    disclosure.dispatchEvent(mouseDown);
    assert.equal(mouseDown.defaultPrevented,true,'opening contextual tools must not take focus away from the editor');
    disclosure.click();
    assert.equal(disclosure.parentElement.open,true,'the disclosure still opens after preserving the editor selection');
    w.document.querySelector('[data-editor-action="delete-code-block"]').click();
    assert.doesNotMatch(editor.getHTML(),/<pre[\s>]/);
    assert.match(editor.getHTML(),/保留在前/);
    assert.match(editor.getHTML(),/保留在后/);
  } finally { dom.window.close(); }
});

test('deleting the final table row or column removes the table instead of leaving an undeletable cell', async () => {
  for (const { rows, cols, action } of [
    { rows: 1, cols: 2, action: 'deleteRow' },
    { rows: 2, cols: 1, action: 'deleteColumn' },
  ]) {
    const { dom, w } = await mount();
    try {
      w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
      w.currentEditor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
      const button=w.document.querySelector(`[data-table-action="${action}"]`);
      assert.equal(button.disabled,false);
      button.click();
      assert.equal(w.currentEditor.view.dom.querySelector('table'),null,`remove the table when ${action} would remove its last dimension`);
    } finally { dom.window.close(); }
  }
});

test('editor offers undo, redo, inline code, clear formatting and link removal while writing', async () => {
  const { dom, w } = await mount();
  w.Range.prototype.getClientRects=()=>[];
  w.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,right:0});
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor=w.currentEditor;
  editor.commands.setContent('<p><strong>加粗文本</strong> <a href="https://example.com">打开网页</a></p>');
  const unlink=w.document.querySelector('[data-editor-action="unlink"]');
  let linkPosition=-1;
  editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='打开网页')linkPosition=pos});
  assert.notEqual(linkPosition,-1);
  editor.commands.setTextSelection({from:linkPosition,to:linkPosition+4});
  assert.equal(unlink.disabled,false);
  unlink.click();
  assert.match(editor.getHTML(),/打开网页/);
  assert.doesNotMatch(editor.getHTML(),/href="https:\/\/example.com"/);
  let boldPosition=-1;
  editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='加粗文本')boldPosition=pos});
  editor.commands.setTextSelection({from:boldPosition,to:boldPosition+2});
  w.document.querySelector('[data-fmt="code"]').click();
  assert.equal(editor.isActive('code'),true);
  w.document.querySelector('[data-editor-action="clear-format"]').click();
  assert.doesNotMatch(editor.getHTML(),/<code>/);
  editor.commands.setTextSelection({from:boldPosition+2,to:boldPosition+4});
  w.document.querySelector('[data-editor-action="clear-format"]').click();
  assert.doesNotMatch(editor.getHTML(),/<strong>/);
  editor.chain().focus().insertContent('<p>可撤销内容</p>').run();
  const undo=w.document.querySelector('[data-editor-action="undo"]');
  assert.equal(undo.disabled,false);
  undo.click();
  assert.doesNotMatch(editor.getHTML(),/可撤销内容/);
  const redo=w.document.querySelector('[data-editor-action="redo"]');
  assert.equal(redo.disabled,false);
  redo.click();
  assert.match(editor.getHTML(),/可撤销内容/);
  dom.window.close();
});

test('format toolbar applies commands to the active text selection', async t => {
  const { dom, w } = await mount();
  t.after(() => dom.window.close());
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor = w.currentEditor;
  editor.commands.setContent('<p>需要加粗</p>');
  editor.commands.setTextSelection({ from: 1, to: 5 });
  w.document.querySelector('#editorToolbar [data-fmt="bold"]').click();
  assert.match(editor.getHTML(), /<strong>需要加粗<\/strong>/);
  assert.equal(editor.isActive('bold'), true);
});

test('paragraph and font color controls dispatch typed changes to the active editor', async t => {
  const { dom, w } = await mount();
  t.after(() => dom.window.close());
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor = w.currentEditor;
  editor.commands.setContent('<p>选择要修改的文字</p>');
  editor.commands.setTextSelection({ from: 1, to: 7 });

  const block = w.document.querySelector('#blockSelect');
  block.value = 'h2';
  block.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(editor.isActive('heading', { level: 2 }), true);

  const color = w.document.querySelector('#fontColor');
  color.value = '#ff0000';
  color.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(editor.getHTML(), /style="color:\s*(#ff0000|rgb\(255, 0, 0\))/i);
});

test('paragraph format restores its selection after the toolbar control takes focus', async t => {
  const { dom, w } = await mount();
  t.after(() => dom.window.close());
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor=w.currentEditor;
  editor.commands.setContent('<p>第一段</p><p>第二段</p><p>第三段</p>');
  const positions=new Map();
  editor.state.doc.descendants((node,pos)=>{if(node.isText)positions.set(node.text,pos)});
  editor.commands.setTextSelection(positions.get('第二段')+1);
  const block=w.document.querySelector('#blockSelect');
  block.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,cancelable:true}));
  editor.commands.setTextSelection(positions.get('第三段')+1);
  block.value='h2';
  block.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(editor.getHTML(),/<h2>第二段<\/h2>/);
  assert.doesNotMatch(editor.getHTML(),/<h2>第三段<\/h2>/);
});

test('link toolbar applies a safe link to selected text and unlink preserves the text', async t => {
  const { dom, w } = await mount();
  t.after(() => dom.window.close());
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor = w.currentEditor;
  editor.commands.setContent('<p>link text</p>');
  editor.commands.setTextSelection({ from: 1, to: 10 });
  w.document.querySelector('#editorToolbar [data-insert="link"]').click();
  const overlay=w.document.querySelector('#actionDialogOverlay');
  assert.equal(overlay.classList.contains('open'),true);
  assert.equal(w.document.querySelector('#actionDialogTitle').textContent,'插入链接');
  w.document.querySelector('#actionDialogInput').value='https://example.com/docs';
  w.document.querySelector('#actionDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(editor.getHTML(), /<a href="https:\/\/example\.com\/docs"[^>]*>link text<\/a>/);
  const unlink = w.document.querySelector('[data-editor-action="unlink"]');
  assert.equal(unlink.disabled, false);
  unlink.click();
  assert.doesNotMatch(editor.getHTML(), /<a\b/);
  assert.match(editor.getHTML(), /link text/);
});

test('editor symbol input uses the in-page dialog and supports keyboard cancellation and submission', async t => {
  const { dom, w } = await mount();
  t.after(() => dom.window.close());
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor=w.currentEditor;editor.commands.setContent('<p>正文</p>');editor.commands.setTextSelection(3);
  const button=w.document.querySelector('#editorToolbar [data-insert="emoji"]');
  button.click();
  const overlay=w.document.querySelector('#actionDialogOverlay'),input=w.document.querySelector('#actionDialogInput');
  assert.equal(overlay.classList.contains('open'),true);
  assert.equal(input.hidden,false);assert.equal(input.getAttribute('aria-labelledby'),null);
  input.value='⚠️';
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(overlay.classList.contains('open'),false,'Escape cancels without inserting the symbol');
  assert.doesNotMatch(editor.getHTML(),/⚠️/);
  button.click();input.value='⚠️';
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(editor.getHTML(),/⚠️/,'Enter submits the custom input dialog');
});

test('callout toolbar removes the whole hint block only when the cursor is inside it', async () => {
  const { dom, w, saves } = await mount();
  w.Range.prototype.getClientRects=()=>[];
  w.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,right:0});
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.currentEditor.chain().focus().insertContent('<div class="callout"><p>要删除的提示</p></div><p>保留正文</p>').run();
  const remove = w.document.querySelector('[data-delete-block="callout"]');
  assert.ok(remove, 'the toolbar should expose a delete-hint action');
  assert.equal(remove.disabled, true, 'the action should be disabled outside a hint block');
  let calloutPosition=-1;
  w.currentEditor.state.doc.descendants((node,pos)=>{if(node.type.name==='callout')calloutPosition=pos});
  const state=w.currentEditor.state;
  w.currentEditor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc,calloutPosition+2)));
  assert.equal(remove.disabled, false, 'the action should enable while the cursor is in a hint block');
  remove.click();
  assert.doesNotMatch(w.currentEditor.getHTML(),/class="callout/);
  assert.match(w.currentEditor.getHTML(),/保留正文/);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.doesNotMatch(saves.at(-1).notes[0].body,/class="callout/);
  assert.match(saves.at(-1).notes[0].body,/保留正文/);
  dom.window.close();
});

test('sidebar note types collapse preference is saved in the account vault', async () => {
  const { dom, w, saves } = await mount();
  let toggle = w.document.querySelector('#toggleNoteTypes');
  assert.ok(toggle.closest('.side-heading'));
  assert.equal(w.document.querySelector('#addCategory'), null, 'the category section is removed');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.querySelector('svg')?.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(toggle.querySelector('span')?.textContent, '笔记类型', 'the section label should be part of the toggle button');
  assert.equal(toggle.tagName, 'BUTTON', 'the full heading area should be a keyboard-accessible button');
  assert.equal(w.document.querySelector('#sideTypes').hidden, false);
  w.document.querySelector('[data-type-nav="command"]').click();
  const title = w.document.querySelector('#breadcrumbTitle').textContent;
  toggle = w.document.querySelector('#toggleNoteTypes');
  toggle.querySelector('span').click();
  assert.equal(w.document.querySelector('#sideTypes').hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-label'), '展开笔记类型');
  assert.equal(w.document.querySelector('#breadcrumbTitle').textContent, title);
  assert.equal(saves.at(-1).noteTypesExpanded, false);
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  assert.equal(w.document.querySelector('#sideTypes').hidden, true, 'collapsed state should survive sidebar rerenders');
  toggle = w.document.querySelector('#toggleNoteTypes');
  const savesBeforeExpand = saves.length;
  toggle.querySelector('svg').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(w.document.querySelector('#sideTypes').hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(saves.length, savesBeforeExpand + 1);
  assert.equal(saves.at(-1).noteTypesExpanded, true);
  w.document.querySelector('#toggleNoteTypes span').click();
  w.document.querySelector('#addNoteType').click();
  assert.equal(w.document.querySelector('#sideTypes').hidden, true, 'the add button should remain independent of the collapse control');
  assert.equal(w.document.querySelector('#typeOverlay').classList.contains('open'), true);
  w.document.querySelector('[data-close="typeOverlay"]').click();
  dom.window.close();
});

test('note types can be created and renamed from the sidebar and persist in the vault', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#addNoteType').click();
  w.document.querySelector('#typeNameInput').value = '读书笔记';
  w.document.querySelector('#typeDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  let created = saves.at(-1).noteTypes.find(t => t.name === '读书笔记');
  assert.ok(created); assert.match(created.id, /^custom_/);
  assert.ok(w.document.querySelector(`[data-type-edit="${created.id}"]`));
  w.document.querySelector('[data-type-edit="command"]').click();
  const name = w.document.querySelector('#typeNameInput'); name.value = '终端命令';
  w.document.querySelector('#typeDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(saves.at(-1).noteTypes.find(t => t.id === 'command'), { id:'command', name:'终端命令' });
  dom.window.close();
});

test('deleting a note type requires a target and preserves its notes by reassignment', async () => {
  const vault = structuredClone(empty);
  vault.notes.push({ id:'nclip', title:'网页资料', type:'clip', category:'开发', tags:[], body:'<p>保留正文 📌</p>', source:'', created:1, updated:2, pinned:false });
  const { dom, w, saves } = await mount(vault);
  w.document.querySelector('[data-type-delete="clip"]').click();
  assert.match(w.document.querySelector('#typeDialogBody').textContent, /1 篇笔记/);
  w.document.querySelector('#typeReplacement').value = 'note';
  w.document.querySelector('#typeDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const saved = saves.at(-1);
  assert.equal(saved.noteTypes.some(t => t.id === 'clip'), false);
  assert.equal(saved.notes[0].type, 'note'); assert.match(saved.notes[0].body,/保留正文/);
  dom.window.close();
});

test('deleting the last non-default type creates a default target and preserves its notes', async () => {
  const vault = { ...structuredClone(empty), noteTypes:[{id:'issue',name:'故障排查'}], notes:[{ id:'nissue', title:'排查记录', type:'issue', category:'开发', tags:[], body:'<p>仍然保留</p>', source:'', created:1, updated:2, pinned:false }] };
  const { dom, w, saves } = await mount(vault);
  const deleteButton = w.document.querySelector('[data-type-delete="issue"]');
  assert.equal(deleteButton.disabled, false, 'the last non-default type can be removed');
  deleteButton.click();
  const replacement = w.document.querySelector('#typeReplacement');
  assert.equal(replacement.value, 'note');
  assert.match(replacement.options[0].textContent, /自动创建/);
  w.document.querySelector('#typeDialogConfirm').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const saved = saves.at(-1);
  assert.deepEqual(saved.noteTypes, [{ id:'note', name:'普通笔记' }]);
  assert.equal(saved.notes[0].type, 'note');
  assert.match(saved.notes[0].body, /仍然保留/);
  dom.window.close();
});

test('the final ordinary note type remains available as a fallback', async () => {
  const vault = { ...structuredClone(empty), noteTypes:[{id:'note',name:'普通笔记'}] };
  const { dom, w } = await mount(vault);
  assert.equal(w.document.querySelector('[data-type-delete="note"]').disabled, true);
  dom.window.close();
});

test('HTML rendering retains rich tables, details, callouts and removes executable markup', async () => {
  const { dom, w, saves } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const body = w.document.querySelector('#editorSurface');
  w.currentEditor.commands.setContent('<details><summary>折叠</summary><div data-type="detailsContent"><p>✅</p></div></details><div class="callout warn">提示</div><p><span style="background-color: rgb(255, 245, 150)">高亮</span></p><table><tbody><tr><th>列一</th><td colspan="2" style="color: red">表格</td></tr></tbody></table><img src="https://example.com/a.png" style="width: 50%" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">恶意</a>');
  w.document.querySelector('#saveEditor').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const stored = saves.at(-1).notes[0].body;
  assert.match(stored,/<details>/); assert.match(stored,/callout warn/); assert.match(stored,/colspan="2"/); assert.match(stored,/color: red/); assert.match(stored,/background-color: rgb\(255, 245, 150\)/); assert.match(stored,/width: 50%/);
  assert.doesNotMatch(stored,/onerror|<script|javascript:/); dom.window.close();
});

test('code copy control stays outside horizontally scrolling code and uses an accessible icon', async () => {
  const { dom, w } = await mount();
  const code = 'docker run --name qinglong --publish 5700:5700 --volume /root/ql:/ql/data --restart=always whyour/qinglong:2.11.3';
  let copied = '';
  Object.defineProperty(w, 'isSecureContext', { configurable:true, value:true });
  Object.defineProperty(w.navigator, 'clipboard', { configurable:true, value:{ writeText:async text => { copied = text; } } });
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const body = w.document.querySelector('#editorSurface');
  w.currentEditor.commands.setContent(`<pre><code>${code}</code></pre>`);
  w.document.querySelector('#saveEditor').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const button = w.document.querySelector('.copy-code');
  assert.ok(button);
  assert.equal(button.closest('pre'), null, 'copy button must not scroll with pre contents');
  assert.equal(button.parentElement.className, 'code-block');
  assert.equal(button.getAttribute('aria-label'), '复制代码');
  assert.ok(button.querySelector('svg'), 'copy control should show an icon instead of text');
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied, code);
  assert.equal(button.getAttribute('aria-label'), '已复制代码');
  dom.window.close();
});

test('code copy falls back to selection and execCommand on plain HTTP', async () => {
  const { dom, w } = await mount();
  const code = 'docker compose up -d --remove-orphans';
  Object.defineProperty(w, 'isSecureContext', { configurable:true, value:false });
  let copied = '', selectionWasReady = false;
  w.document.execCommand = command => {
    const field = w.document.activeElement;
    assert.equal(command, 'copy');
    copied = field.value;
    selectionWasReady = field.tagName === 'TEXTAREA' && field.selectionStart === 0 && field.selectionEnd === code.length;
    return true;
  };
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.currentEditor.commands.setContent(`<pre><code>${code}</code></pre>`);
  w.document.querySelector('#saveEditor').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const button = w.document.querySelector('.copy-code');
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied, code);
  assert.equal(selectionWasReady, true);
  assert.equal(button.getAttribute('aria-label'), '已复制代码');
  assert.equal(w.document.querySelector('#toast').classList.contains('show'), false);
  dom.window.close();
});

test('code copy reports failure only when both clipboard methods fail', async () => {
  const { dom, w } = await mount();
  Object.defineProperty(w, 'isSecureContext', { configurable:true, value:false });
  w.document.execCommand = () => false;
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.currentEditor.commands.setContent('<pre><code>echo unavailable</code></pre>');
  w.document.querySelector('#saveEditor').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  w.document.querySelector('.copy-code').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(w.document.querySelector('#toast').textContent, /复制失败/);
  dom.window.close();
});

test('local note search and returning from a note preserve the current list scope',async()=>{
 const {dom,w}=await mount(designVault());w.document.querySelector('#mobileCats').click();
 const local=w.document.querySelector('#notePageSearch');assert.match(local.placeholder,/筛选本页笔记/);assert.match(local.getAttribute('aria-label'),/当前笔记/);assert.equal(w.document.querySelector('.section-right .muted'),null,'the visible note total is not duplicated beside the create action');local.value='测试笔记正文';local.dispatchEvent(new w.Event('input'));
 assert.equal(w.document.querySelectorAll('.note-list .note-card').length,1);
 w.document.querySelector('.note-card-open').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert.ok(w.document.querySelector('#docRead'));w.document.querySelector('#backDoc').click();
 assert.equal(w.document.querySelector('#notePageSearch').value,'测试笔记正文');
 const menu=w.document.querySelector('.note-item-menu');assert.equal(menu.open,false);menu.querySelector('summary').click();assert.equal(menu.open,true);dom.window.close();
});

test('editor groups secondary tools and metadata without losing code, table or formatting commands',async()=>{
 const {dom,w}=await mount();w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 const categoryField=w.document.querySelector('.editor-properties #editCategory');assert.ok(!categoryField||categoryField.type==='hidden','legacy category storage never appears as an editable field');assert.ok(w.document.querySelector('.editor-extra-tools [data-insert="callout"]'));
 assert.ok(w.document.querySelector('.editor-extra-tools [data-fmt="strikeThrough"]'));assert.ok(w.document.querySelector('#editorToolbar>[data-insert="code"]'));
 assert.ok(w.document.querySelector('#editorToolbar>[data-insert="table"]'));assert.ok(w.document.querySelector('.document-more #exportHtml'));dom.window.close();
 const styles=await readFile(new URL('../../../src/styles.css',import.meta.url),'utf8');
 assert.match(styles,/\.editor-extra-panel\{width:min\(280px,calc\(100vw - 32px\)\);min-width:min\(280px,calc\(100vw - 32px\)\);max-width:calc\(100vw - 32px\)/,'the mobile More menu has a stable width and remains within the viewport');
});

test('editor task lists toggle and persist checked state in the note HTML',async t=>{
 const {dom,w,saves}=await mount();t.after(()=>dom.window.close());w.scrollBy=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};w.Range.prototype.getClientRects=function(){return [{top:0,bottom:1,left:0,right:1}]};w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 w.currentEditor.commands.setContent('<p>先做这件事</p>');w.document.querySelector('[data-fmt="toggleTaskList"]').click();
 const list=w.currentEditor.view.dom.querySelector('ul[data-type="taskList"]');assert.ok(list);assert.equal(list.querySelectorAll('li[data-type="taskItem"]').length,1);
 const checkbox=list.querySelector('input[type="checkbox"]');checkbox.click();
 assert.match(w.currentEditor.getHTML(),/data-checked="true"/,'clicking the task checkbox stores its checked state');
 assert.ok(w.document.querySelector('#editorSurface ul[data-type="taskList"]'),'clicking a task checkbox must not trigger note type navigation or convert the list to bullets');
 await new Promise(resolve=>setTimeout(resolve,300));assert.match(saves.at(-1).notes[0].body,/data-checked="true"/,'the sanitized saved HTML keeps the checked state');
});

test('attachment picker uploads through the editor flow and inserts a private download link',async t=>{
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 const file=new w.File(['private attachment'],'guide.txt',{type:'text/plain'}),picker=w.document.querySelector('#attachmentFile');
 Object.defineProperty(picker,'files',{configurable:true,value:[file]});picker.dispatchEvent(new w.Event('change',{bubbles:true}));
 await new Promise(resolve=>setTimeout(resolve,0));
 const link=w.currentEditor.view.dom.querySelector('a[href="/api/assets/00000000-0000-4000-8000-000000000001?download=1"]');
 assert.ok(link,'the selected file is uploaded and linked to its authenticated asset endpoint');
 assert.equal(link.textContent,'guide.txt');assert.match(w.currentEditor.getHTML(),/0\.0 KB/);
});

test('editor mount renders stored note content only once', async t => {
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 w.currentEditor.commands.setContent('<p>只显示一份正文</p>');
 w.document.querySelector('#backDoc').click();w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));w.document.querySelector('#editDoc').click();
 const host=w.document.querySelector('#editorSurface');
 assert.equal(host.children.length,1,'the ProseMirror surface is the only child of its mount');
 assert.equal(host.firstElementChild.classList.contains('ProseMirror'),true);
 assert.equal(host.textContent,'只显示一份正文','stored content is rendered once in the editable surface');
 assert.equal(host.firstElementChild.getAttribute('data-placeholder'),'开始输入内容，或直接粘贴网页文字、表格和图片...');
});

test('pressing Enter in a task item creates a new task item', async t => {
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 Object.defineProperty(globalThis,'KeyboardEvent',{configurable:true,value:w.KeyboardEvent});
 const editor=w.currentEditor;editor.commands.setContent('<p>第一项</p>');editor.commands.toggleTaskList();
 assert.equal(editor.state.doc.firstChild.type.name,'taskList');
 let end=-1;editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text==='第一项')end=pos+node.nodeSize});assert.notEqual(end,-1);
 editor.commands.setTextSelection(end);assert.equal(editor.state.selection.$from.parent.type.name,'paragraph');assert.equal(editor.state.selection.$from.node(-1).type.name,'taskItem');assert.equal(editor.state.selection.$from.parentOffset,3);assert.equal(editor.commands.keyboardShortcut('Enter'),true);
 const list=editor.state.doc.firstChild;assert.equal(list.type.name,'taskList');assert.equal(list.childCount,2,JSON.stringify(editor.getJSON()));
 assert.equal(list.child(0).textContent,'第一项');assert.equal(list.child(1).textContent,'');
});

test('Tab nests a task item and Shift-Tab lifts it back out', async t => {
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 const priorKeyboardEvent=globalThis.KeyboardEvent;Object.defineProperty(globalThis,'KeyboardEvent',{configurable:true,value:w.KeyboardEvent});t.after(()=>Object.defineProperty(globalThis,'KeyboardEvent',{configurable:true,value:priorKeyboardEvent}));
 const editor=w.currentEditor;editor.commands.setContent('<p>第一项</p><p>子任务</p>');editor.commands.setTextSelection({from:1,to:editor.state.doc.content.size-1});editor.commands.toggleTaskList();
 const positionFor=text=>{let position=-1;editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text===text)position=pos});return position};
 editor.commands.setTextSelection(positionFor('子任务'));assert.equal(editor.commands.keyboardShortcut('Tab'),true);
 let taskList=editor.state.doc.firstChild;assert.equal(taskList.childCount,1);assert.equal(taskList.firstChild.childCount,2);assert.equal(taskList.firstChild.child(1).type.name,'taskList');
 editor.commands.setTextSelection(positionFor('子任务'));assert.equal(editor.commands.keyboardShortcut('Shift-Tab'),true);
 taskList=editor.state.doc.firstChild;assert.equal(taskList.childCount,2);assert.equal(taskList.child(1).textContent,'子任务');
});

test('Markdown task lists retain checked states and inline formatting',()=>{
 const parsed=parseQidianMarkdown('- [x] 已完成 **重点**\n- [ ] 待处理');
 const safe=sanitizeMarkdownDocument(parsed,qidianSchema,value=>/^https?:\/\//i.test(value));
 const document=qidianSchema.nodeFromJSON(safe);document.check();
 const list=document.child(0);assert.equal(list.type.name,'taskList');assert.equal(list.childCount,2);assert.equal(list.child(0).attrs.checked,true);assert.equal(list.child(1).attrs.checked,false);
 assert.equal(list.child(0).textContent,'已完成 重点');let boldFound=false;list.child(0).descendants(node=>{if(node.isText&&node.text==='重点'&&node.marks.some(mark=>mark.type.name==='bold'))boldFound=true});assert.ok(boldFound);
});

test('Markdown conversion keeps safe links clickable and strips unsafe link targets',()=>{
 const parsed=parseQidianMarkdown('参考：[OpenAI](https://openai.com) 与 [危险](javascript:alert(1))');
 const safe=sanitizeMarkdownDocument(parsed,qidianSchema,value=>/^https?:\/\//i.test(value));
 const document=qidianSchema.nodeFromJSON(safe);document.check();
 const links=[];document.descendants(node=>{if(node.isText)for(const mark of node.marks)if(mark.type.name==='link')links.push({text:node.text,href:mark.attrs.href})});
 assert.deepEqual(links,[{text:'OpenAI',href:'https://openai.com'}]);
});

test('editor outline follows headings and in-note search cycles through cross-format matches',async t=>{
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.scrollBy=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};w.Range.prototype.getClientRects=function(){return [{top:0,bottom:1,left:0,right:1}]};w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  assert.equal(w.document.querySelector('.editor-outline-mobile').hidden,true);assert.equal(w.document.querySelector('.edit-inspector').hidden,true);
 w.currentEditor.commands.setContent('<h2>章节一</h2><p>定<strong>位</strong>成功</p><h3>章节二</h3><p>再次定位</p>');
  assert.equal(w.document.querySelector('.editor-outline-mobile').hidden,false);assert.equal(w.document.querySelector('.edit-inspector').hidden,false);
 const outline=w.document.querySelectorAll('.right-rail .editor-outline-links [data-outline-index]');assert.equal(outline.length,2);assert.equal(outline[1].textContent,'章节二');outline[1].click();assert.ok(w.currentEditor.state.selection.from>1,'selecting an outline item jumps into its heading');
 const input=w.document.querySelector('#editorFindInput');input.value='定位';input.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(w.document.querySelector('#editorFindCount').textContent,'1 / 2');
 w.document.querySelector('#editorFindNext').click();assert.equal(w.document.querySelector('#editorFindCount').textContent,'2 / 2');
 dom.window.close();
});

test('editor paragraph actions reorder, duplicate and delete the selected paragraph',async t=>{
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.scrollBy=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};w.Range.prototype.getClientRects=function(){return [{top:0,bottom:1,left:0,right:1}]};w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 const editor=w.currentEditor;editor.commands.setContent('<p>第一段</p><p>第二段</p>');editor.commands.setTextSelection(9);
 const textOrder=()=>Array.from(editor.state.doc.content.content,node=>node.textContent);
 w.document.querySelector('[data-block-action="moveUp"]').click();assert.deepEqual(textOrder(),['第二段','第一段']);editor.commands.setTextSelection(2);
 w.document.querySelector('[data-block-action="duplicate"]').click();assert.deepEqual(textOrder(),['第二段','第二段','第一段']);
 w.document.querySelector('[data-block-action="delete"]').click();assert.deepEqual(textOrder(),['第二段','第一段']);
});

test('editor converts selected TSV and Markdown rows into editable tables',async t=>{
 const {dom,w}=await mount();t.after(()=>dom.window.close());w.scrollBy=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};w.Range.prototype.getClientRects=function(){return [{top:0,bottom:1,left:0,right:1}]};w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 const editor=w.currentEditor;editor.commands.setContent('<p>| 名称 | 网址 |</p><p>| --- | --- |</p><p>| 栖点 | https://example.com |</p>');editor.commands.setTextSelection({from:1,to:editor.state.doc.content.size-1});
 const convert=w.document.querySelector('[data-editor-action="convert-table"]');const selected=editor.state.selection.content().content;assert.equal(convert.disabled,false,selected.textBetween(0,selected.size,'\n'));convert.click();assert.equal(editor.state.doc.child(0).type.name,'table');assert.equal(editor.state.doc.child(0).childCount,2);assert.equal(editor.state.doc.child(0).child(1).textContent,'栖点https://example.com');
});

test('table Tab navigation creates a row after the final cell and Shift-Tab moves back',async t=>{
 const {dom,w}=await mount();t.after(()=>dom.window.close());Object.defineProperty(globalThis,'KeyboardEvent',{configurable:true,value:w.KeyboardEvent});w.scrollBy=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};w.Range.prototype.getClientRects=function(){return [{top:0,bottom:1,left:0,right:1}]};w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
 const editor=w.currentEditor;editor.chain().focus().insertTable({rows:2,cols:2,withHeaderRow:true}).run();editor.commands.setTextSelection(18);editor.commands.keyboardShortcut('Tab');assert.equal(editor.state.doc.child(0).childCount,3);editor.commands.keyboardShortcut('Shift-Tab');assert.equal(editor.state.doc.child(0).childCount,3);
});

test('typed editor action bridge routes formatting and table controls to the active Tiptap editor',async t=>{
  const {dom,w}=await mount();t.after(()=>dom.window.close());w.scrollBy=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [this.getBoundingClientRect()]};w.Range.prototype.getClientRects=function(){return [{top:0,bottom:1,left:0,right:1}]};
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  const editor=w.currentEditor;editor.commands.setContent('<p>bridge</p>');editor.commands.setTextSelection({from:1,to:7});
  await w.editorDataStore.dispatch({group:'format',action:'bold'});
  let bold=false;editor.state.doc.descendants(node=>{if(node.isText&&node.text==='bridge'&&node.marks.some(mark=>mark.type.name==='bold'))bold=true});assert.ok(bold);
  editor.commands.setContent('<p></p>');await w.editorDataStore.dispatch({group:'insert',action:'table'});
  assert.equal(editor.state.doc.firstChild.type.name,'table');
  await w.editorDataStore.dispatch({group:'table',action:'addRowAfter'});
  assert.equal(editor.state.doc.firstChild.childCount,4);
});
