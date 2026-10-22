import { test } from 'node:test';
import * as fixture from '../../support/ui-fixtures.mjs';
const { assert, createProfileSettingsFlow, createTrashEntry, empty, mount, readFile, validateVault } = fixture;

test('emptying the recycle bin requires confirmation but never requires or starts a backup', async () => {
  const note={id:'clear-trash-note',title:'永久删除测试',type:'note',category:'开发',tags:[],body:'<p>内容</p>',source:'',created:1,updated:2,pinned:false,status:'published'};
  const trash=[createTrashEntry('note',note,{index:0})];
  const options={};const {dom,w,saves}=await mount({...structuredClone(empty),trash},options);
  w.document.querySelector('[data-trash-nav]').click();
  w.document.querySelector('[data-trash-clear]').click();
  assert.match(w.document.querySelector('#trashClearOverlay').textContent,/此操作无法撤销/);
  assert.equal(options.exportedBeforeRestore,undefined);
  w.document.querySelector('[data-trash-cancel]').click();
  assert.equal(saves.length,0,'cancel keeps the trashed content');
  w.document.querySelector('[data-trash-clear]').click();
  w.document.querySelector('#trashClearOverlay form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(saves.at(-1).trash,[]);
  assert.equal(options.exportedBeforeRestore,undefined,'permanent clear does not call the export flow');
  assert.match(w.document.querySelector('#main').textContent,/回收站为空/);
  dom.window.close();
});

test('autosave has no persistent typing or save status; recovery is kept in settings', async () => {
  const { dom, w } = await mount(empty, { local:false, owner:'account-1' });
  assert.equal(w.document.querySelector('#syncStatus'), null);
  assert.equal(w.document.querySelector('#saveStatus'), null);
  assert.equal(w.document.querySelector('#reviewSyncConflict').hidden, true);
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  assert.equal(w.document.querySelector('.doc-date'), null);
  assert.equal(w.document.querySelector('#saveStatus'), null);
  dom.window.close();
});

test('theme menu supports system, light and dark preferences and follows system changes', async () => {
  const options={systemDark:true};
  const { dom, w, saves } = await mount(empty,options);
  const button=w.document.querySelector('#themeBtn'),menu=w.document.querySelector('#themeMenu'),icon=button.querySelector('use');
  assert.equal(w.document.documentElement.dataset.theme,'light','an explicit light preference overrides a dark system');
  assert.equal(w.document.documentElement.dataset.themePreference,'light');
  assert.equal(icon.getAttribute('href'),'#i-moon');
  button.click();
  assert.equal(menu.hidden,false);
  assert.equal(button.getAttribute('aria-expanded'),'true');
  w.document.querySelector('[data-theme-choice="system"]').click();
  assert.equal(menu.hidden,true);
  assert.equal(w.document.documentElement.dataset.themePreference,'system');
  assert.equal(w.document.documentElement.dataset.theme,'dark');
  assert.match(button.getAttribute('aria-label'),/跟随系统/);
  assert.equal(saves.at(-1).theme,'system');
  options.setSystemDark(false);
  assert.equal(w.document.documentElement.dataset.theme,'light','system preference reacts without another save');
  assert.equal(w.document.querySelector('meta[name="theme-color"]').content,'#f6f7fb');
  button.click();
  w.document.querySelector('[data-theme-choice="dark"]').click();
  assert.equal(w.document.documentElement.dataset.theme,'dark');
  assert.equal(w.document.documentElement.dataset.themePreference,'dark');
  assert.equal(saves.at(-1).theme,'dark');
  dom.window.close();
});

test('system theme is accepted by vault validation and mobile dashboard keeps both workspaces near the first screen', async () => {
  const validated=validateVault({...structuredClone(empty),bookmarks:[],theme:'system'});
  assert.equal(validated.theme,'system');
  const styles=await readFile(new URL('../../../src/styles.css',import.meta.url),'utf8');
  assert.match(styles,/\.dashboard-notes \.note-card:nth-child\(n\+3\)\{display:none\}/);
  assert.match(styles,/env\(safe-area-inset-bottom\)/);
  assert.match(styles,/min-height:100dvh/);
});

test('account menu separates profile from app settings and removes settings from the sidebar', async () => {
  const { dom, w } = await mount();
  assert.equal(w.document.querySelector('#sideManage'),null,'the empty management section should be removed from the sidebar');
  assert.equal(w.document.querySelector('#manageSettings'),null);
  assert.ok(w.document.querySelector('#openProfileSettings'));
  assert.ok(w.document.querySelector('#openAppSettings'));
  for(const id of ['backupHistory','retrySync','reloadCloud','restoreLocalDraft','exportBtn','importBtn']){
    assert.ok(w.document.querySelector(`#appSettingsOverlay #${id}`),`${id} should be organized inside app settings`);
    assert.equal(w.document.querySelector(`#${id}`)?.closest('.sidebar-scroll'),null,`${id} should no longer be a sidebar item`);
  }
  const trigger=w.document.querySelector('#accountButton'), menu=w.document.querySelector('#accountMenu');
  assert.ok(trigger.querySelector('use[href="#i-user"]'),'empty avatar should show a user icon');
  assert.equal(menu.hidden,true);
  trigger.click();
  assert.equal(menu.hidden,false);
  assert.equal(trigger.getAttribute('aria-expanded'),'true');
  w.document.querySelector('#openProfileSettings').click();
  assert.equal(menu.hidden,true);
  assert.equal(w.document.querySelector('#profileSettingsOverlay').classList.contains('open'),true);
  assert.equal(w.document.querySelector('#appSettingsOverlay').classList.contains('open'),false);
  const profile=w.document.querySelector('#profileSettingsOverlay');
  assert.ok(profile.textContent.includes('更换头像'));
  assert.ok(profile.textContent.includes('修改密码'));
  assert.equal(profile.querySelector('.account-dialog-subtitle'),null,'profile dialog should not repeat its purpose under the title');
  assert.equal(profile.querySelector('.profile-upload-actions>span'),null,'account type label is redundant');
  assert.equal(profile.querySelector('#profileCreated'),null,'account creation date is not needed in the profile dialog');
  assert.equal(profile.querySelector('.account-dialog-foot'),null,'header close button is the only profile dialog close action');
  assert.equal(profile.querySelector('#backupHistory'),null);
  assert.ok(menu.querySelector('#accountLogout'),'logout remains available in the account menu');
  w.document.querySelector('[data-close="profileSettingsOverlay"]').click();
  assert.equal(w.document.querySelector('#profileSettingsOverlay').classList.contains('open'),false);
  trigger.click();
  w.document.querySelector('#openAppSettings').click();
  assert.equal(w.document.querySelector('#appSettingsOverlay').classList.contains('open'),true);
  assert.equal(w.document.querySelector('#profileSettingsOverlay').classList.contains('open'),false);
  assert.ok(w.document.querySelector('#appSettingsOverlay').textContent.includes('数据与恢复'));
  assert.ok(w.document.querySelector('#appSettingsOverlay').textContent.includes('备份与迁移'));
  assert.ok(w.document.querySelector('#appSettingsOverlay').textContent.includes('设置只影响当前账号'));
  assert.equal(w.document.querySelectorAll('#appSettingsOverlay [data-close="appSettingsOverlay"]').length,1,'the fixed header is the only settings close action');
  dom.window.close();
});

test('account settings keep the footer visible while long dialog content scrolls independently', async () => {
  const styles=await readFile(new URL('../../../src/styles.css',import.meta.url),'utf8');
  assert.match(styles,/\.account-dialog\{display:flex;flex-direction:column;min-height:0;max-height:min\(90vh,920px\);overflow:hidden\}/);
  assert.match(styles,/\.account-dialog>\.dialog-body\{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain\}/);
  assert.match(styles,/\.account-dialog>\.dialog-foot\{background:var\(--panel\)\}/);
  assert.match(styles,/\.account-password-section #changePasswordButton\{margin-bottom:5px\}/);
  assert.match(styles,/\.account-settings-message:empty\{display:none\}/,'empty account status messages should not reserve vertical space');
  assert.match(styles,/\.account-password-section\{border-top:1px solid var\(--line\);padding-top:12px;margin-top:12px\}/,'profile sections use compact spacing');
  assert.match(styles,/\.bookmark-page \.bookmark-card:focus-within>\.item-menu/);
  assert.match(styles,/@media\(hover:none\), \(max-width:720px\)\{\.bookmark-page \.bookmark-card>\.item-menu,.bookmark-page \.bookmark-section-heading>\.item-menu\{opacity:1\}\}/);
});

test('profile settings keep local preview read-only and clear password fields when closed', async () => {
  let requests=0;
  const flow=createProfileSettingsFlow({local:true,username:'预览账号',getAccountProfile:async()=>{requests++;throw Error('must not call API')},getAccountAvatar:async()=>{requests++;return new Blob()},saveAccountAvatar:async()=>{requests++},removeAccountAvatar:async()=>{requests++},changeAccountPassword:async()=>{requests++}});
  flow.state.currentPassword='secret';flow.state.newPassword='Private-pass-1!';flow.state.confirmPassword='Private-pass-1!';
  await flow.show();
  assert.equal(flow.state.visible,true);
  assert.equal(flow.state.username,'预览账号');
  assert.match(flow.state.profileMessage,/本地界面预览/);
  assert.equal(requests,0);
  flow.close();
  assert.equal(flow.state.visible,false);
  assert.equal(flow.state.currentPassword,'');
  assert.equal(flow.state.newPassword,'');
  assert.equal(flow.state.confirmPassword,'');
});

test('profile settings refresh the account avatar and revoke the previous object URL', async () => {
  const profile={id:'account-1',username:'alan',created:1,avatarMime:'image/png'};
  const revoked=[],published=[];let avatar=0;
  const flow=createProfileSettingsFlow({local:false,username:'alan',getAccountProfile:async()=>profile,getAccountAvatar:async()=>{avatar++;return new Blob(['avatar-'+avatar],{type:'image/png'})},saveAccountAvatar:async()=>{},removeAccountAvatar:async()=>{},changeAccountPassword:async()=>{},createAvatarUrl:()=> 'blob:avatar-'+avatar,revokeAvatarUrl:url=>revoked.push(url),onProfileChange:(value,url)=>published.push([value.username,url])});
  await flow.refresh();
  assert.equal(flow.state.username,'alan');assert.equal(flow.state.avatarUrl,'blob:avatar-1');assert.equal(flow.state.hasAvatar,true);
  await flow.refresh();
  assert.deepEqual(revoked,['blob:avatar-1']);assert.equal(flow.state.avatarUrl,'blob:avatar-2');
  assert.deepEqual(published,[['alan','blob:avatar-1'],['alan','blob:avatar-2']]);
  flow.dispose();assert.deepEqual(revoked,['blob:avatar-1','blob:avatar-2']);
});

test('profile avatar upload reports success and rejects unsupported image types', async () => {
  const profile={id:'account-1',username:'alan',created:1,avatarMime:null};let saved=null,reads=0;
  const flow=createProfileSettingsFlow({local:false,username:'alan',getAccountProfile:async()=>{reads++;return profile},getAccountAvatar:async()=>new Blob(),saveAccountAvatar:async file=>{saved=file},removeAccountAvatar:async()=>{},changeAccountPassword:async()=>{},processAvatar:async file=>new File([file],'qidian-avatar.webp',{type:'image/webp'})});
  const ok=await flow.uploadAvatar(new File(['input'],'avatar.png',{type:'image/png'}));
  assert.equal(ok,true);assert.equal(saved.type,'image/webp');assert.equal(reads,1);assert.equal(flow.state.profileMessage,'头像已保存到 Docker 服务端');
  const invalidFlow=createProfileSettingsFlow({local:false,username:'alan',getAccountProfile:async()=>profile,getAccountAvatar:async()=>new Blob(),saveAccountAvatar:async()=>{},removeAccountAvatar:async()=>{},changeAccountPassword:async()=>{}});
  assert.equal(await invalidFlow.uploadAvatar(new File(['gif'],'avatar.gif',{type:'image/gif'})),false);
  assert.match(invalidFlow.state.profileMessage,/只支持 PNG、JPEG 或 WebP/);
});

test('profile password changes validate confirmation and report server results', async () => {
  const changed=[];let reject=false;
  const flow=createProfileSettingsFlow({local:false,username:'alan',getAccountProfile:async()=>({id:'account-1',username:'alan',created:1,avatarMime:null}),getAccountAvatar:async()=>new Blob(),saveAccountAvatar:async()=>{},removeAccountAvatar:async()=>{},changeAccountPassword:async(current,next)=>{if(reject)throw Error('当前密码不正确');changed.push([current,next])}});
  Object.assign(flow.state,{currentPassword:'current',newPassword:'New-secure-1!',confirmPassword:'mismatch'});
  assert.equal(await flow.submitPassword(),false);assert.equal(changed.length,0);assert.match(flow.state.passwordMessage,/不一致/);
  flow.state.confirmPassword=flow.state.newPassword;
  assert.equal(await flow.submitPassword(),true);assert.deepEqual(changed,[['current','New-secure-1!']]);assert.equal(flow.state.currentPassword,'');assert.match(flow.state.passwordMessage,/其他设备的登录已退出/);
  reject=true;Object.assign(flow.state,{currentPassword:'wrong',newPassword:'New-secure-2!',confirmPassword:'New-secure-2!'});
  assert.equal(await flow.submitPassword(),false);assert.equal(flow.state.passwordMessage,'当前密码不正确');assert.equal(flow.state.changingPassword,false);
});

test('automatic backup history lists revisions with separate download and restore actions', async () => {
  const { dom, w } = await mount(empty, { backups:[{ revision:12, created:Date.UTC(2026,9,10) }, { revision:11, created:Date.UTC(2026,9,9) }] });
  w.document.querySelector('#accountButton').click();
  w.document.querySelector('#openAppSettings').click();
  w.document.querySelector('#backupHistory').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(w.document.querySelectorAll('#backupHistoryList .backup-row').length, 2);
  assert.ok(w.document.querySelector('[data-backup-download="12"]'));
  assert.ok(w.document.querySelector('[data-backup-restore="12"]'));
  assert.match(w.document.querySelector('#backupHistoryOverlay').textContent, /不含附件文件/);
  dom.window.close();
});

test('restoring a history revision downloads the current full backup before queueing the older vault', async () => {
  const current = structuredClone(empty);
  current.notes.push({ id:'current', title:'当前版本', type:'note', category:'开发', tags:[], body:'<p>当前</p>', source:'', created:1, updated:2, pinned:false });
  const restoreOptions = {
    backups:[{ revision:12, created:Date.UTC(2026,9,10) }],
    snapshot:{ categories:['开发'], noteTypes:structuredClone(empty.noteTypes), notes:[{ id:'restored', title:'历史版本', type:'note', category:'开发', tags:[], body:'<p>历史</p>', source:'', created:1, updated:1, pinned:false }], theme:'light', pasteMode:'rich' },
  };
  const { dom, w, saves } = await mount(current, restoreOptions);
  w.document.querySelector('#accountButton').click();
  w.document.querySelector('#openAppSettings').click();
  w.document.querySelector('#backupHistory').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  w.document.querySelector('[data-backup-restore="12"]').click();
  w.document.querySelector('#actionDialogConfirm').click();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(restoreOptions.requestedBackup, '12');
  assert.equal(w.document.querySelector('#toast').textContent, '历史版本已恢复');
  assert.equal(restoreOptions.exportedBeforeRestore.notes[0].title, '当前版本');
  assert.deepEqual(restoreOptions.backupOrder,['download','snapshot'],'the confirmed full backup precedes the server snapshot and replacement');
  assert.equal(saves.at(-1).notes[0].title, '历史版本');
  assert.equal(w.document.querySelector('#backupHistoryOverlay').classList.contains('open'), false);
  dom.window.close();
});

test('importing a backup asks in the app dialog before exporting or replacing current data',async()=>{
 const options={};const {dom,w,saves}=await mount(empty,options);
 const input=w.document.querySelector('#importFile');
 Object.defineProperty(input,'files',{configurable:true,value:[{name:'knowledge.json'}]});
 input.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(w.document.querySelector('#actionDialogTitle').textContent,'导入备份');
 assert.match(w.document.querySelector('#actionDialogMessage').textContent,/替换当前知识库/);
 w.document.querySelector('#actionDialogCancel').click();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(options.exportedBeforeRestore,undefined);
 assert.equal(saves.length,0);
 dom.window.close();
});
