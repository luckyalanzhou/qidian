import { test } from 'node:test';
import * as fixture from '../../support/ui-fixtures.mjs';
const { JSDOM, assert, empty, mount, readFile, renderReleaseNotes } = fixture;

test('remote Vault updates flow through the sync controller into the Pinia workspace', async t=>{
  const {dom,w,initialOptions}=await mount(empty);t.after(()=>dom.window.close());
  const remote={...structuredClone(empty),theme:'dark',notes:[{id:'remote-note',title:'远端笔记',type:'note',category:'开发',tags:[],body:'<p>远端正文</p>',created:1,updated:2,status:'published'}]};

  initialOptions.remoteUpdate(remote);

  assert.equal(w.vaultDataStore.value.notes[0].title,'远端笔记');
  assert.equal(w.vaultDataStore.value.theme,'dark');
  assert.equal(w.workspaceShellStore.resolvedDark,true);
  remote.notes[0].title='调用方后续修改';
  assert.equal(w.vaultDataStore.value.notes[0].title,'远端笔记','the Pinia Vault owns the received snapshot');
});

test('topbar version badge shows release details and the unified action refreshes versions before automatically updating', async () => {
  let versionChecks=0;
  const versions=[
    {currentVersion:'0.1.5',latestVersion:'0.1.5',updateAvailable:false,canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.5',notes:'当前版本说明\n<img src=x onerror=alert(1)>'},
    {currentVersion:'0.1.5',latestVersion:'0.1.6',updateAvailable:true,canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6',notes:'修复问题\n<img src=x onerror=alert(1)>'}
  ];
  const { dom, w, initialOptions } = await mount(empty,{versionInfo:()=>{versionChecks++;return versions.shift()||versions.at(-1)}});
  const badge=w.document.querySelector('#versionButton');
  assert.equal(badge.previousElementSibling.id,'topbarSearchIsland','the version badge sits beside the Vue top-bar search island');
  assert.ok(badge.previousElementSibling.querySelector('#searchTop'),'the top-bar search remains adjacent to the version badge');
  assert.equal(badge.nextElementSibling.id,'topbarMenusIsland','Vue owns the top-bar menu mount point after the version badge');
  assert.ok(badge.nextElementSibling.querySelector('#themeBtn'));
  assert.equal(w.document.querySelector('#currentVersionLabel').textContent,'v0.1.5');
  assert.equal(badge.dataset.updateAvailable,'false');
  assert.equal(w.document.querySelector('#appSettingsOverlay').textContent.includes('版本信息'),false,'version details should live in the top bar, not settings');
  badge.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#versionInfoOverlay').classList.contains('open'),true);
  assert.equal(w.document.querySelector('#versionInfoTitle').textContent,'版本信息');
  assert.equal(w.document.querySelector('.version-dialog .account-dialog-subtitle'),null,'the version dialog omits its redundant subtitle');
  assert.equal(w.document.querySelector('#installedVersion').textContent,'0.1.5');
  assert.equal(w.document.querySelector('#latestVersion').textContent,'0.1.5');
  assert.equal(badge.dataset.updateAvailable,'false');
  assert.doesNotMatch(badge.getAttribute('aria-label'),/发现新版本/);
  assert.match(w.document.querySelector('#releaseNotes').textContent,/<img src=x/);
  assert.equal(w.document.querySelector('#releaseNotes img'),null,'release notes render as safe text, not HTML');
  assert.equal(w.document.querySelector('#latestVersionLabel').textContent,'最新版本');
  assert.equal(versionChecks,1);
  const button=w.document.querySelector('#checkAndUpdateVersion'),progress=w.document.querySelector('#updateProgress'),actions=button.parentElement;
  assert.equal(button.textContent,'检查并更新');assert.equal(button.disabled,false);
  assert.equal(w.document.querySelector('#releaseLink').textContent,'Release');
  assert.equal(w.document.querySelector('#refreshVersion'),null);
  assert.equal(w.document.querySelector('#installVersion'),null);
  assert.equal(progress.parentElement.classList.contains('version-dialog-body'),true);
  assert.ok(w.document.querySelector('#releaseNotes').compareDocumentPosition(progress)&w.Node.DOCUMENT_POSITION_FOLLOWING,'release notes appear before the update progress and live log');
  assert.ok(progress.compareDocumentPosition(actions)&w.Node.DOCUMENT_POSITION_FOLLOWING,'progress and live log sit above the Release and update actions');
  assert.equal(w.document.querySelector('#updateProgressTrack').nextElementSibling.className,'update-progress-log-panel','the live log panel sits directly below the progress bar');
  assert.equal(w.document.querySelector('#updateProgressTrack').nextElementSibling.querySelector('pre').id,'updateProgressLog');
  button.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(versionChecks,2,'the combined action fetches fresh release metadata when clicked');
  assert.equal(w.document.querySelector('#latestVersion').textContent,'0.1.6');
  assert.equal(badge.dataset.updateAvailable,'true');
  assert.equal(initialOptions.updateRequests,1);
  assert.match(w.document.querySelector('#versionState').textContent,/已提交/);
  assert.match(w.document.querySelector('#updateProgressLog').textContent,/发现新版本 v0\.1\.6/);
  w.document.querySelector('#versionInfoOverlay [data-close="versionInfoOverlay"]').click();
  assert.equal(w.document.querySelector('#versionInfoOverlay').classList.contains('open'),false,'the close button dismisses the version dialog in the Vue workspace');
  dom.window.close();
});

test('version details reuse the startup release check and refresh cached information without blocking the dialog', async () => {
  let resolveVersion,versionChecks=0;
  const info={currentVersion:'0.1.5',latestVersion:'0.1.6',updateAvailable:true,canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6',notes:'## 新版本说明\n\n修复问题。'};
  const {dom,w}=await mount(empty,{local:false,versionInfo:()=>{versionChecks++;return new Promise(resolve=>{resolveVersion=resolve})}});
  assert.equal(versionChecks,1,'authenticated startup starts one release check');
  const badge=w.document.querySelector('#versionButton');
  badge.click();
  assert.equal(w.document.querySelector('#versionInfoOverlay').classList.contains('open'),true,'the dialog opens before the release request finishes');
  assert.equal(versionChecks,1,'opening the dialog reuses the in-flight startup request');
  assert.equal(w.document.querySelector('#installedVersion').textContent,'0.1.5','the bundled version is shown while the first check is pending');
  resolveVersion(info);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#latestVersion').textContent,'0.1.6');
  assert.match(w.document.querySelector('#releaseNotes').textContent,/修复问题/);
  badge.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(versionChecks,1,'reopening within the cache window does not request the same release again');
  dom.window.close();
});

test('the unified update action remains available when current and reports a completed check without deploying', async () => {
  const { dom, w } = await mount(empty, { versionInfo:{currentVersion:'0.1.6',latestVersion:'0.1.6',updateAvailable:false,canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6',notes:'## 本版优化与新增\n\n1. 修复问题。'} });
  w.document.querySelector('#versionButton').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(w.document.querySelector('#versionState').textContent,/当前已是最新版本/);
  const button=w.document.querySelector('#checkAndUpdateVersion');
  assert.equal(button.textContent,'检查并更新');assert.equal(button.disabled,false);
  button.click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#updateProgressTrack').dataset.mode,'complete');
  assert.match(w.document.querySelector('#updateProgressLog').textContent,/当前已是最新版本 v0\.1\.6/);
  assert.equal(w.document.querySelector('#updateProgressTrack').getAttribute('aria-valuenow'),'100');
  dom.window.close();
});

test('version details keep current and latest side by side and reserve space for notes and live update logs', async () => {
  const styles=await readFile(new URL('../../../src/styles.css',import.meta.url),'utf8');
  assert.match(styles, /@media\(max-width:560px\)\{#versionInfoOverlay\{align-items:center;/);
  assert.match(styles, /\.version-pair\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.version-pair>div\{[^}]*justify-content:space-between/, 'the current version is the left card and latest version is the right card');
  assert.match(styles, /\.version-pair>div\{[^}]*border:1px solid var\(--line\)/, 'both version values render in separate theme cards');
  assert.match(styles, /\.version-dialog\{width:min\(860px,100%\);height:min\(90svh,940px\)/, 'the dialog reserves enough height for its content');
  assert.match(styles, /\.version-dialog-body\{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;overflow:hidden\}/, 'version details stay fixed while the dialog remains open');
  assert.match(styles, /\.version-pair span\{color:var\(--sub\);font-size:11px\}/, 'version labels use compact text');
  assert.match(styles, /\.version-pair strong\{[^}]*font-size:12px/);
  assert.match(styles, /\.version-state\{[^}]*font-size:12px/);
  assert.match(styles, /\.release-notes\{[^}]*overflow:hidden/);
  assert.match(styles, /\.release-notes pre\{[^}]*overflow:hidden/);
  assert.match(styles, /\.update-progress-log\{[^}]*overflow:auto/,'only the live log content scrolls');
  assert.doesNotMatch(styles, /\.version-dialog-body\{[^}]*overflow:auto|\.release-notes\{[^}]*overflow:auto/);
  assert.match(styles, /\.version-dialog\{height:min\(94svh,1080px\);min-height:min\(86svh,760px\);max-height:96svh\}/, 'the modal uses nearly all available viewport height');
  assert.match(styles, /\.version-notes-section\{max-height:48%;min-height:0\}/, 'release notes receive more room before logs start');
  assert.match(styles, /\.release-notes\{min-height:0;max-height:none\}/, 'release notes are not cut at a short fixed height');
  assert.match(styles, /\.update-progress-log\{[^}]*min-height:150px/);
  assert.match(styles, /\.update-progress-log\{min-height:110px/);
  assert.match(styles, /\.update-progress-log\{min-height:200px\}/,'desktop live logs have enough height to inspect several lines at once');
  assert.match(styles, /\.version-pair\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px\}/,'the version cards stay side by side on mobile');
  assert.match(styles, /\.update-progress\{flex:1 1 0;min-height:clamp\(280px,34svh,380px\)\}/,'the progress card fits below the expanded release notes');
  assert.match(styles, /\.update-progress-log\{min-height:130px\}/,'mobile live logs stay usable without crowding the fixed dialog actions');
});

test('release notes use readable Markdown blocks, suppress generated release commit noise, and treat embedded HTML as text', () => {
  const dom=new JSDOM('<div id="notes"></div>',{url:'https://qidian.example/'}),container=dom.window.document.querySelector('#notes');
  renderReleaseNotes(container,'## 本版优化与新增\n\n1. 1. 适配账号偏好。\n2. 2. 支持 `v0.1.26`。\n3. release v0.0.1\n\n- 保留安装包说明。\n\n[版本详情](https://github.com/luckyalanzhou/qidian/releases)\n\n<img src=x onerror=alert(1)>\n\n[危险链接](javascript:alert(1))');
  assert.equal(container.querySelector('h2')?.textContent,'本版优化与新增');
  assert.deepEqual([...container.querySelectorAll('ol li')].map(node=>node.textContent),['适配账号偏好。','支持 v0.1.26。']);
  assert.deepEqual([...container.querySelectorAll('ul li')].map(node=>node.textContent),['保留安装包说明。']);
  assert.equal(container.querySelectorAll('a').length,1);
  assert.equal(container.querySelector('img,script'),null);
  assert.match(container.textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(container.textContent,/\[危险链接\]\(javascript:alert\(1\)\)/);
  dom.window.close();
});

test('historical updater logs from an older release stay out of the current update view', async () => {
  const {dom,w}=await mount(empty,{
    versionInfo:{currentVersion:'0.1.25',latestVersion:'0.1.26',updateAvailable:true,canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.26',notes:'## 本版优化与新增\n\n1. 1. 更新说明。'},
    updateStatus:{state:'success',version:'0.1.23',updatedAt:1791800000000,log:'旧版本部署完成'}
  });
  w.document.querySelector('#versionButton').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#updateProgress').hidden,true);
  assert.equal(w.document.querySelector('#updateProgressLog').textContent,'');
  assert.equal(w.document.querySelector('#releaseNotes h2')?.textContent,'本版优化与新增');
  assert.equal(w.document.querySelector('#checkAndUpdateVersion').textContent,'检查并更新');
  dom.window.close();
});

test('web update waits when current edits have not reached the Docker service', async () => {
  const { dom, w, initialOptions } = await mount(empty,{ flushResult:false });
  w.document.querySelector('#versionButton').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  w.document.querySelector('#checkAndUpdateVersion').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(initialOptions.updateRequests,undefined);
  assert.match(w.document.querySelector('#versionState').textContent,/尚未写入/);
  assert.equal(w.document.querySelector('#checkAndUpdateVersion').disabled,false);
  dom.window.close();
});

test('web update keeps tracking an updater restart and refreshes after the target version is online', async () => {
  let currentVersion='0.1.5',staleVersionReads=0,status={state:'idle',version:'',updatedAt:null,log:''};
  const { dom, w } = await mount(empty,{
    versionInfo:()=>{const reportedVersion=staleVersionReads>0?(staleVersionReads--,'0.1.5'):currentVersion;return {currentVersion:reportedVersion,latestVersion:'0.1.6',updateAvailable:reportedVersion!=='0.1.6',canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6',notes:''}},
    updateStatus:()=>{if(!status)throw Error('服务重启中');return status},
    onRequestSystemUpdate:()=>{status={state:'queued',version:'',updatedAt:null,log:''};staleVersionReads=1;return {accepted:true,version:'0.1.6'}}
  });
  w.document.querySelector('#versionButton').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const nativeSetTimeout=w.setTimeout.bind(w),nativeClearTimeout=w.clearTimeout.bind(w),timers=new Map();let nextTimer=0;
  w.setTimeout=(callback,delay=0,...args)=>{if([1000,1200,2000].includes(delay)){const id=++nextTimer;timers.set(id,{callback,delay,args});return id}return nativeSetTimeout(callback,delay,...args)};
  w.clearTimeout=id=>{if(timers.delete(id))return;nativeClearTimeout(id)};
  const fireNext=async delay=>{const entry=[...timers.entries()].find(([,timer])=>timer.delay===delay);assert.ok(entry,`expected a ${delay}ms timer`);timers.delete(entry[0]);entry[1].callback(...entry[1].args);await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0))};
  w.document.querySelector('#checkAndUpdateVersion').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(status.state,'queued');
  status=null;
  await fireNext(1000);
  assert.equal(w.document.querySelector('#checkAndUpdateVersion').textContent,'等待服务启动…');
  assert.equal(w.document.querySelector('#checkAndUpdateVersion').disabled,true);
  status={state:'unavailable',version:'0.1.6',updatedAt:null,log:'管理服务正在重启'};
  await fireNext(2000);
  assert.match(w.document.querySelector('#updateProgressState').textContent,/服务正在重启/);
  assert.ok(w.document.querySelector('#checkAndUpdateVersion').disabled,'the update stays locked during the agent restart');
  status={state:'success',version:'0.1.6',updatedAt:null,log:'更新完成'};currentVersion='0.1.6';
  await fireNext(1000);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(w.document.querySelector('#versionState').textContent,/等待新版本服务就绪/);
  await fireNext(2000);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('#installedVersion').textContent,'0.1.6');
  assert.match(w.document.querySelector('#versionState').textContent,/5 秒后自动刷新/);
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),'0.1.6','the pending job remains until the actual refresh');
  const realNow=w.Date.now;let elapsed=realNow();w.Date.now=()=>elapsed;
  elapsed+=4000;await fireNext(1000);
  assert.match(w.document.querySelector('#versionState').textContent,/1 秒后自动刷新/);
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),'0.1.6');
  status=null;elapsed+=1000;await fireNext(1000);
  assert.match(w.document.querySelector('#versionState').textContent,/等待新版本服务恢复/);
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),'0.1.6','do not refresh into an unavailable service');
  status={state:'success',version:'0.1.6',log:'更新完成'};
  dom.virtualConsole.removeAllListeners('jsdomError');await fireNext(2000);
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),null,'refresh is attempted only after five seconds and a final readiness check');
  dom.window.close();
});

test('checking versions never reloads for a historical success and new updates ignore old results', async () => {
  let currentVersion='0.1.5',status={state:'success',version:'0.1.4',updatedAt:100,log:'旧部署完成'};
  const {dom,w}=await mount(empty,{
    versionInfo:()=>({currentVersion,latestVersion:'0.1.6',updateAvailable:true,canUpdateDevice:true,installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases',notes:''}),
    updateStatus:()=>status
  });
  w.document.querySelector('#versionButton').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),null);
  const nativeSetTimeout=w.setTimeout.bind(w),nativeClearTimeout=w.clearTimeout.bind(w),timers=new Map();let nextTimer=0;
  w.setTimeout=(callback,delay=0,...args)=>{if(delay===1000){const id=++nextTimer;timers.set(id,{callback,delay,args});return id}return nativeSetTimeout(callback,delay,...args)};
  w.clearTimeout=id=>{if(timers.delete(id))return;nativeClearTimeout(id)};
  const firePoll=async()=>{const entry=[...timers.entries()].find(([,timer])=>timer.delay===1000);assert.ok(entry,'a one-second live status refresh is scheduled');timers.delete(entry[0]);entry[1].callback(...entry[1].args);await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0))};
  assert.equal(w.document.querySelector('#checkAndUpdateVersion').disabled,false);
  w.document.querySelector('#checkAndUpdateVersion').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),'0.1.6');
  assert.match(w.document.querySelector('#updateProgressState').textContent,/等待设备执行/);
  assert.match(w.document.querySelector('#updateProgressLog').textContent,/正在连接版本源/);
  status={state:'failed',version:'0.1.4',updatedAt:100,log:'旧失败'};
  await firePoll();
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),'0.1.6');
  currentVersion='0.1.6';status={state:'running',version:'0.1.6',log:'正在部署，未完成'};
  await firePoll();
  assert.ok(w.document.querySelector('#updateProgressLog').textContent.includes(status.log));
  assert.doesNotMatch(w.document.querySelector('#updateProgressLog').textContent,/旧失败/);
  assert.doesNotMatch(w.document.querySelector('#versionState').textContent,/部署完成，服务已启动/);
  status={state:'failed',version:'0.1.6',log:'本次部署失败'};
  await firePoll();
  assert.match(w.document.querySelector('#versionState').textContent,/更新失败/);
  assert.equal(w.sessionStorage.getItem('qidian.pendingDeviceUpdate'),null);
  dom.window.close();
});

test('web update refreshes the live log every second and follows new output until the user scrolls away', async () => {
  let status={state:'idle',version:'',updatedAt:null,log:''};
  const {dom,w}=await mount(empty,{updateStatus:()=>status});
  w.document.querySelector('#versionButton').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const nativeSetTimeout=w.setTimeout.bind(w),nativeClearTimeout=w.clearTimeout.bind(w),timers=new Map();let nextTimer=0;
  w.setTimeout=(callback,delay=0,...args)=>{if([1000].includes(delay)){const id=++nextTimer;timers.set(id,{callback,delay,args});return id}return nativeSetTimeout(callback,delay,...args)};
  w.clearTimeout=id=>{if(timers.delete(id))return;nativeClearTimeout(id)};
  const log=w.document.querySelector('#updateProgressLog');let scrollHeight=80,scrollTop=40;
  Object.defineProperties(log,{clientHeight:{configurable:true,get:()=>40},scrollHeight:{configurable:true,get:()=>scrollHeight},scrollTop:{configurable:true,get:()=>scrollTop,set:value=>{scrollTop=value}}});
  status={state:'running',version:'0.1.6',updatedAt:null,log:'开始下载安装包'};
  w.document.querySelector('#checkAndUpdateVersion').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(log.textContent.endsWith('开始下载安装包'));
  assert.equal(w.document.querySelector('#updateProgressState').textContent,'正在下载安装包与校验文件');
  assert.equal(w.document.querySelector('#versionState').hidden,true,'the active update stage replaces the duplicate summary above the release notes');
  assert.equal(w.document.querySelector('#updateProgressTrack').hasAttribute('aria-valuenow'),false,'indeterminate progress does not claim a percentage');
  assert.equal(log.scrollTop,80,'the log follows its tail when the user has not scrolled away');
  const firePoll=async()=>{const entry=[...timers.entries()].find(([,timer])=>timer.delay===1000);assert.ok(entry,'a one-second live log refresh is scheduled');timers.delete(entry[0]);entry[1].callback(...entry[1].args);await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0))};
  scrollHeight=120;
  status={state:'running',version:'0.1.6',updatedAt:null,log:'开始下载安装包\n正在下载：已接收 64 KB'};
  await firePoll();
  assert.match(log.textContent,/64 KB/);
  assert.equal(log.scrollTop,120,'new output stays visible while following the tail');
  log.scrollTop=0;log.dispatchEvent(new w.Event('scroll'));
  scrollHeight=160;
  status={state:'running',version:'0.1.6',updatedAt:null,log:'开始下载安装包\n正在下载：已接收 128 KB'};
  await firePoll();
  assert.match(log.textContent,/128 KB/);
  status={state:'running',version:'0.1.6',updatedAt:null,log:'开始下载安装包\n正在下载：已接收 128 KB\n管理文件已更新；等待 10 秒后拉取成品镜像并重启栖点服务以应用新版本…'};
  await firePoll();
  assert.equal(w.document.querySelector('#updateProgressState').textContent,'准备拉取新版本镜像');
  status={state:'running',version:'0.1.6',updatedAt:null,log:`${status.log}\n正在拉取适合当前设备架构的成品镜像并重启 Docker 容器…\nlatest: Pulling from luckyalanzhou/qidian`};
  await firePoll();
  assert.equal(w.document.querySelector('#updateProgressState').textContent,'正在拉取新版本镜像');
  status={state:'running',version:'0.1.6',updatedAt:null,log:`${status.log}\n正在确认容器已启动…`};
  await firePoll();
  assert.equal(w.document.querySelector('#updateProgressState').textContent,'正在确认服务启动状态');
  assert.equal(log.scrollTop,0,'manual inspection of earlier log lines is preserved');
  dom.window.close();
});

test('authenticated startup checks for updates and shows the red dot in the top bar', async () => {
  const { dom, w } = await mount(empty,{local:false,versionInfo:{
    currentVersion:'0.1.5',latestVersion:'0.1.6',updateAvailable:true,canUpdateDevice:true,
    installerAvailable:true,updaterAvailable:true,releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6',notes:''
  }});
  await new Promise(resolve=>setTimeout(resolve,0));
  const badge=w.document.querySelector('#versionButton');
  assert.equal(w.document.querySelector('#currentVersionLabel').textContent,'v0.1.5');
  assert.equal(badge.dataset.updateAvailable,'true');
  assert.ok(badge.querySelector('.version-alert-dot'));
  dom.window.close();
});

test('the unified action checks updates but only the first account can start deployment', async () => {
  const { dom, w, initialOptions } = await mount(empty,{ versionInfo:{
    currentVersion:'0.1.5', latestVersion:'0.1.6', updateAvailable:true, canUpdateDevice:false,
    installerAvailable:true, updaterAvailable:true,
    releaseUrl:'https://github.com/luckyalanzhou/qidian/releases/tag/v0.1.6', notes:''
  } });
  w.document.querySelector('#versionButton').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  const button=w.document.querySelector('#checkAndUpdateVersion');
  assert.equal(button.disabled,false);
  button.click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(initialOptions.updateRequests,undefined);
  assert.match(w.document.querySelector('#versionState').textContent,/只有首个账号可以更新设备/);
  dom.window.close();
});

test('a remote update refreshes the active editor and account preferences without losing editing state', async()=>{
  const note={id:'remote-note',title:'旧标题',type:'note',category:'开发',tags:['旧'],body:'<p>旧正文</p>',source:'',created:1,updated:2,pinned:false,status:'published'};
  const {dom,w,initialOptions}=await mount({...structuredClone(empty),notes:[note]});
  w.document.querySelector('[data-open="remote-note"]').click();
  assert.equal(w.document.querySelector('#editDoc').textContent.includes('编辑笔记'),true);
  w.document.querySelector('#editDoc').click();
  assert.equal(w.document.querySelector('.doc-meta .pill').textContent,'编辑笔记');
  assert.equal(w.document.querySelector('#saveEditor').textContent.trim().endsWith('保存笔记'),true);
  const remote=structuredClone(empty);remote.noteTypesExpanded=false;remote.notes=[{...note,title:'另一设备改好的标题',tags:['新版'],body:'<p>另一设备改好的正文</p>',updated:3}];
  initialOptions.remoteUpdate(remote);
  assert.equal(w.vaultDataStore.value.notes[0].title,'另一设备改好的标题','the Pinia Vault store receives the remote snapshot used by the editor');
  assert.equal(w.vaultDataStore.generation,2,'remote replacement advances the Vault change generation');
  assert.equal(w.document.querySelector('#editTitle').value,'另一设备改好的标题');
  assert.equal(w.document.querySelector('#sideTypes').hidden,true,'sidebar preference follows the same account on another device');
  assert.deepEqual(w.currentEditor.getJSON().content[0].content[0].text,'另一设备改好的正文');
  assert.equal(w.document.querySelector('#saveEditor').disabled,false,'远端刷新后编辑状态仍可继续使用');
  dom.window.close();
});

test('editing a published note updates its private draft and only changes the reader after republishing', async () => {
  const note = { id:'published-1', title:'原有标题', type:'note', category:'开发', tags:[], body:'<p>已发布正文</p>', source:'', created:1, updated:2, pinned:false };
  const { dom, w } = await mount({ ...structuredClone(empty), notes:[note] });
  w.document.querySelector('[data-open="published-1"]').click();
  w.document.querySelector('#editDoc').click();
  const title = w.document.querySelector('#editTitle'); title.value='后台新标题'; title.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(w.document.querySelector('#viewEditor'),null,'editing has one return-to-reading action');
  w.document.querySelector('#backDoc').click();
  w.document.querySelector('#actionDialogConfirm').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(w.document.querySelector('#main').textContent,/后台新标题/);
  w.document.querySelector('#backDoc').click();
  assert.match(w.document.querySelector('#main').textContent,/原有标题/);
  w.document.querySelector('[data-nav="drafts"]').click();
  assert.match(w.document.querySelector('#main').textContent,/后台新标题/);
  w.document.querySelector('[data-open="published-1"]').click();
  w.document.querySelector('#publishDoc').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(w.document.querySelector('#main').textContent,/后台新标题/);
  assert.equal(w.document.querySelector('#main .about-note'),null);
  dom.window.close();
});

test('a cloud conflict shows both note versions and requires a comparison backup before loading cloud',async()=>{
  const base=structuredClone(empty),make=(title,body)=>({id:'conflict-note',title,type:'note',category:'开发',tags:[],body,source:'',created:1,updated:1,pinned:false,status:'published'});
  base.notes=[make('原始标题','<p>共同原文</p>')];const local=structuredClone(base);local.notes[0].title='本机标题';local.notes[0].body='<p>本机正文</p>';const remote=structuredClone(base);remote.notes[0].title='云端标题';remote.notes[0].body='<p>云端正文</p>';
  const {dom,w,initialOptions}=await mount(base,{local:false,owner:'account-1',restoreConflict:true,syncConflict:{base,local,remote,revision:7}});
  assert.equal(w.document.querySelector('#reviewSyncConflict').hidden,false);
  w.document.querySelector('#accountButton').click();
  w.document.querySelector('#openAppSettings').click();
  w.document.querySelector('#reviewSyncConflict').click();
  const dialog=w.document.querySelector('#syncConflictOverlay');assert.equal(dialog.classList.contains('open'),true);
  assert.match(dialog.textContent,/本机标题/);assert.match(dialog.textContent,/云端标题/);
  const load=w.document.querySelector('#loadConflictCloud');assert.equal(load.disabled,true);
  w.document.querySelector('#downloadSyncConflict').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(load.disabled,false);assert.equal(initialOptions.conflictExports,1);
  load.click();assert.equal(w.document.querySelector('#actionDialogOverlay').classList.contains('open'),true);
  assert.equal(w.document.querySelector('#actionDialogTitle').textContent,'载入已保存版本');
  w.document.querySelector('#actionDialogCancel').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(dialog.classList.contains('open'),true,'cancel keeps the conflict review open');
  dom.window.close();
});

test('legacy matching mode keeps its prior plain-text structure conversion available', async () => {
  const { dom, w } = await mount();
  w.document.querySelector('#newSide').click();w.document.querySelector('[data-create-kind="note"]').click();
  w.document.querySelector('#editPasteMode').value='match';
  const text = [
    'VPS 运维备忘录', '',
    '标签： #VPS #Linux #Docker #PVE', '',
    '1. Docker 管理', '',
    '清理 Docker 无用资源', '',
    '删除未使用的镜像和构建缓存。', '',
    'docker system prune -a', '',
    '找到：', '',
    '#PermitRootLogin prohibit-password', '',
    'PermitRootLogin yes', '',
    '① 检查配置',
    '② 重启 SSH', '',
    '[!WARNING] 清理前确认数据',
    'Docker 卷可能存有数据库和配置。', '',
    '参数说明：', '',
    '参数\t说明',
    '--all\t清理全部未使用镜像', '',
    '⸻', '',
    '保留这是一段普通说明文字。'
  ].join('\n');
  const paste = new w.Event('paste', { bubbles:true, cancelable:true });
  Object.defineProperty(paste, 'clipboardData', { value:{ files:[], getData(type){ return type==='text/plain'?text:''; } } });
  const handled = w.currentEditor.view.someProp('handlePaste', handler => handler(w.currentEditor.view,paste,null));
  assert.equal(handled,true);
  assert.equal(paste.defaultPrevented,true);
  const html=w.currentEditor.getHTML();
  assert.match(html,/<h2>Docker 管理<\/h2>/);
  assert.match(html,/<p>标签： #VPS #Linux #Docker #PVE<\/p>/);
  assert.match(html,/<h3>清理 Docker 无用资源<\/h3>/);
  assert.match(html,/<pre><code>docker system prune -a<\/code><\/pre>/);
  assert.match(html,/<pre><code>#PermitRootLogin prohibit-password<\/code><\/pre>/);
  assert.match(html,/<ol><li><p>检查配置<\/p><\/li><li><p>重启 SSH<\/p><\/li><\/ol>/);
  assert.match(html,/<div class="callout warn">/);
  assert.match(html,/<table\b/);
  assert.match(html,/<th[^>]*><p>参数<\/p><\/th>/);
  assert.match(html,/<td[^>]*><p>清理全部未使用镜像<\/p><\/td>/);
  assert.match(html,/<hr>/);
  assert.match(html,/<p>保留这是一段普通说明文字。<\/p>/);
  assert.doesNotMatch(html,/\[!WARNING\]/);
  await new Promise(resolve=>setTimeout(resolve,250));
  dom.window.close();
});
