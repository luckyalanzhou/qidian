import type { SystemVersion, UpdateAcceptance, UpdateStatus } from '../../api/contracts';

type VersionStateKind = 'info' | 'current' | 'available' | 'success' | 'error';
type ProgressMode = 'idle' | 'checking' | 'blocked' | 'error' | 'updating' | 'verifying' | 'complete';

type Dependencies = {
  document: Document;
  window: Window & typeof globalThis;
  appVersion: string;
  getSystemVersion: (options?: { installedOnly?: boolean }) => Promise<SystemVersion>;
  getSystemUpdateStatus: () => Promise<UpdateStatus>;
  requestSystemUpdate: () => Promise<UpdateAcceptance>;
  flush: () => Promise<boolean>;
  renderReleaseNotes: (container: Element, markdown: string) => void;
  closeAccountMenu: () => void;
  closeAppSettings: () => void;
};

const VERSION_INFO_CACHE_MS = 5 * 60 * 1000;
const UPDATE_REFRESH_DELAY_MS = 5000;

export function createSystemUpdateController(dependencies: Dependencies) {
  const { document, window } = dependencies;
  const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => { if (timer !== null) window.clearTimeout(timer); };
  let versionPollTimer: ReturnType<typeof setTimeout> | null = null;
  let versionInfo: SystemVersion | null = null;
  let versionInfoCheckedAt = 0;
  let versionCheckPromise: Promise<void> | null = null;
  let updateLogFollowing = true;
  let updateActionRunning = false;
  let updateProgressMessages: string[] = [];
  let updateTargetVersion = '';
  let updateVerificationTimer: ReturnType<typeof setTimeout> | null = null;
  let updateReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let updateVersionCheckRunning = false;
  let updateReloadScheduled = false;
  let updateLogRelevant = false;
  let lastUpdateStatus: UpdateStatus | null = null;
  let updateTerminalBaseline = '';
  let updateRefreshDeadline = 0;
  let versionDialogReturnFocus: HTMLElement | null = null;

  try {
    updateTargetVersion = window.sessionStorage.getItem('qidian.pendingDeviceUpdate') || '';
    updateLogRelevant = !!updateTargetVersion;
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }

  function ensureVersionInfoUI() {
    if ($('#versionInfoOverlay')) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="overlay" id="versionInfoOverlay"><section class="dialog version-dialog" role="dialog" aria-modal="true" aria-labelledby="versionInfoTitle"><div class="dialog-head"><div><h2 id="versionInfoTitle">版本信息</h2></div><button class="round-btn" data-close="versionInfoOverlay" aria-label="关闭"><span class="ico"><svg><use href="#i-close"/></svg></span></button></div><div class="dialog-body version-dialog-body"><div class="version-pair"><div class="version-current"><span>当前版本</span><strong id="installedVersion">—</strong></div><div class="version-latest" id="latestVersionCard"><span id="latestVersionLabel">最新版本</span><strong id="latestVersion">尚未检查</strong></div></div><p class="version-state" id="versionState" role="status" aria-live="polite">正在检查版本…</p><section class="version-notes-section"><div class="version-section-heading"><h3>版本说明</h3><span id="releasePublishedAt" hidden></span></div><div id="releaseNotes" class="release-notes">读取中…</div></section><section id="updateProgress" class="update-progress" data-mode="idle" hidden aria-label="更新进度与实时日志"><div class="update-progress-head"><div class="update-progress-title-row"><strong id="updateProgressTitle">本次更新</strong><span id="updateProgressTime" class="update-progress-time"></span></div><div class="update-progress-stage" role="status" aria-live="polite"><span class="update-progress-stage-mark" aria-hidden="true"></span><span id="updateProgressState">等待设备响应</span></div></div><div id="updateProgressTrack" class="update-progress-track" data-mode="idle" role="progressbar" aria-label="更新进度" aria-valuemin="0" aria-valuemax="100" aria-valuetext="尚未开始"><span id="updateProgressBar"></span></div><div class="update-progress-log-panel"><div class="update-progress-log-heading">实时日志</div><pre id="updateProgressLog" class="update-progress-log" aria-label="更新实时日志" aria-live="polite" tabindex="0"></pre></div></section></div><div class="dialog-foot version-dialog-foot"><div class="version-dialog-actions"><a id="releaseLink" class="secondary-btn" href="https://github.com/luckyalanzhou/qidian/releases" target="_blank" rel="noopener noreferrer">Release</a><button class="primary-btn" id="checkAndUpdateVersion" type="button" disabled>检查中…</button></div></div></section></div>`);
    $('#versionInfoOverlay')?.addEventListener('click', event => {
      if ((event.target as Element).id === 'versionInfoOverlay') closeVersionInfo();
    });
    $('#updateProgressLog')?.addEventListener('scroll', () => {
      const log = $('#updateProgressLog');
      updateLogFollowing = !!log && log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    });
  }

  function handleVersionDialogKeydown(event: KeyboardEvent) {
    const overlay = $('#versionInfoOverlay');
    if (!overlay?.classList.contains('open')) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeVersionInfo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function renderVersionBadge(info: Pick<SystemVersion, 'currentVersion' | 'updateAvailable' | 'latestVersion'> | null) {
    const button = $('#versionButton'), label = $('#currentVersionLabel');
    if (!button || !label) return;
    const current = info?.currentVersion || dependencies.appVersion;
    const available = !!info?.updateAvailable;
    label.textContent = current ? `v${current}` : '版本';
    button.setAttribute('data-update-available', String(available));
    const description = current ? `栖点当前版本 v${current}` : '查看版本信息';
    const accessible = available ? `${description}，发现新版本 v${info?.latestVersion}` : description;
    button.setAttribute('title', accessible);
    button.setAttribute('aria-label', accessible);
  }

  function setVersionState(message: string, kind: VersionStateKind = 'info') {
    const node = $('#versionState');
    if (!node) return;
    node.textContent = message;
    node.setAttribute('data-kind', kind);
  }

  function renderPublishedAt(value?: string | null) {
    const node = $('#releasePublishedAt'), date = value ? new Date(value) : null;
    if (!node) return;
    node.textContent = date && Number.isFinite(date.getTime())
      ? `发布于 ${date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}`
      : '';
    (node as HTMLElement).hidden = !node.textContent;
  }

  function renderVersionInfo(info: SystemVersion) {
    const installed = $('#installedVersion'), latest = $('#latestVersion'), label = $('#latestVersionLabel');
    const card = $('#latestVersionCard'), notes = $('#releaseNotes'), releaseLink = $('#releaseLink');
    if (installed) installed.textContent = info.currentVersion || '未知';
    if (latest) latest.textContent = info.latestVersion || '未知';
    if (label) label.textContent = info.updateAvailable ? '可更新版本' : '最新版本';
    card?.setAttribute('data-update-available', String(!!info.updateAvailable));
    if (notes) dependencies.renderReleaseNotes(notes, info.notes || '此版本没有附加更新说明。');
    renderPublishedAt(info.publishedAt);
    try {
      const release = new URL(info.releaseUrl || 'https://github.com/luckyalanzhou/qidian/releases');
      if (releaseLink) releaseLink.setAttribute('href', release.origin === 'https://github.com' ? release.href : 'https://github.com/luckyalanzhou/qidian/releases');
    } catch {
      releaseLink?.setAttribute('href', 'https://github.com/luckyalanzhou/qidian/releases');
    }
    renderVersionBadge(info);
    setVersionAction(info);
  }

  function setVersionAction(info: SystemVersion | null) {
    const button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
    if (!button) return;
    button.hidden = false;
    if (updateTargetVersion) { button.disabled = true; button.textContent = '更新进行中…'; return; }
    if (updateActionRunning) { button.disabled = true; button.textContent = '正在检查并更新…'; return; }
    button.disabled = false;
    button.textContent = info ? '检查并更新' : '检查并更新';
  }

  function setUpdateProgressMode(mode: ProgressMode, message?: string) {
    const progress = $('#updateProgress'), track = $('#updateProgressTrack');
    if (!progress || !track) return;
    progress.setAttribute('data-mode', mode);
    track.setAttribute('data-mode', mode);
    if (mode === 'complete') {
      track.setAttribute('aria-valuenow', '100');
      track.setAttribute('aria-valuetext', message || '已完成');
    } else {
      track.removeAttribute('aria-valuenow');
      track.setAttribute('aria-valuetext', message || '正在处理，暂不提供百分比');
    }
  }

  function updateProgressStage(status: UpdateStatus, waitingForRestart = false) {
    if (status.state === 'failed') return '更新失败 · 查看日志了解原因';
    if (status.state === 'queued') return '更新任务已提交 · 等待设备执行';
    if (waitingForRestart) return '设备服务正在重启 · 等待恢复';
    if (status.state === 'success') return updateTargetVersion ? '服务已启动 · 正在确认目标版本' : '更新完成 · 服务已重启';
    const lines = String(status.log || '').split(/\r?\n/).reverse();
    const stages: Array<[RegExp, string]> = [
      [/正在确认容器已启动|容器.{0,20}(?:运行状态|已启动)|health.{0,20}(?:check|healthy)/i, '正在确认服务启动状态'],
      [/正在拉取适合|Pulling from|Pulling fs layer|Pull complete|Already exists|Download complete|Verifying Checksum|Extracting/i, '正在拉取新版本镜像'],
      [/等待.{0,50}(?:拉取|镜像)/i, '准备拉取新版本镜像'],
      [/管理文件已更新/i, '设备管理文件已更新 · 准备重启服务'],
      [/正在更新设备管理文件|校验通过，正在更新设备管理文件/i, '正在更新设备管理文件'],
      [/正在校验 SHA-256|sha256sum -c/i, '正在校验安装包'],
      [/开始下载|正在下载：已接收/i, '正在下载安装包与校验文件'],
      [/正在连接公开版本源|正在读取最新 Release/i, '正在检查最新版本'],
      [/正在检查 Docker 与数据目录/i, '正在检查设备与数据目录']
    ];
    for (const line of lines) for (const [pattern, label] of stages) if (pattern.test(line)) return label;
    return status.state === 'running' ? '设备正在执行更新…' : '等待设备响应';
  }

  function renderUpdateLog(serverLog = '') {
    const log = $('#updateProgressLog');
    if (!log) return;
    log.textContent = [...updateProgressMessages, serverLog].filter(Boolean).join('\n');
    if (updateLogFollowing) log.scrollTop = log.scrollHeight;
  }

  function appendUpdateProgressMessage(message: string) {
    if (!message) return;
    updateProgressMessages.push(message);
    if (updateProgressMessages.length > 8) updateProgressMessages = updateProgressMessages.slice(-8);
    renderUpdateLog(lastUpdateStatus?.log || '');
  }

  function startUpdateCheck() {
    updateTerminalBaseline = lastUpdateStatus && ['success', 'failed'].includes(lastUpdateStatus.state) ? updateStatusFingerprint(lastUpdateStatus) : '';
    lastUpdateStatus = null;
    updateActionRunning = true;
    updateProgressMessages = [];
    updateLogFollowing = true;
    updateLogRelevant = false;
    const state = $('#versionState') as HTMLElement | null;
    if (state) state.hidden = true;
    const progress = $('#updateProgress'), title = $('#updateProgressTitle'), time = $('#updateProgressTime'), stage = $('#updateProgressState');
    if (progress) (progress as HTMLElement).hidden = false;
    if (title) title.textContent = '检查并更新';
    if (time) time.textContent = '';
    if (stage) stage.textContent = '正在检查最新版本…';
    setUpdateProgressMode('checking', '正在检查最新版本');
    appendUpdateProgressMessage('正在连接版本源，检查最新版本…');
    setVersionState('正在检查最新版本…');
    setVersionAction(versionInfo);
  }

  function finishUpdateCheck(message: string, options: { mode?: ProgressMode; kind?: VersionStateKind; log?: string } = {}) {
    const mode = options.mode || 'complete', kind = options.kind || 'current', log = options.log ?? message;
    updateActionRunning = false;
    const state = $('#versionState') as HTMLElement | null;
    if (state) state.hidden = false;
    const title = $('#updateProgressTitle'), stage = $('#updateProgressState');
    if (title) title.textContent = '版本检查';
    if (stage) stage.textContent = message;
    setUpdateProgressMode(mode, message);
    if (log) appendUpdateProgressMessage(log);
    setVersionState(message, kind);
    setVersionAction(versionInfo);
  }

  function clearPendingDeviceUpdate() {
    updateTargetVersion = '';
    try { window.sessionStorage.removeItem('qidian.pendingDeviceUpdate'); } catch { /* storage can be unavailable */ }
  }

  function updateStatusFingerprint(status: UpdateStatus) {
    return JSON.stringify([status.state, status.version, status.updatedAt]);
  }

  function countDownUpdateRefresh(targetVersion: string) {
    if (updateTargetVersion !== targetVersion || !updateReloadScheduled) return;
    const remaining = Math.max(0, Math.ceil((updateRefreshDeadline - window.Date.now()) / 1000));
    setVersionState(`栖点 ${targetVersion} 已部署，服务已启动；${remaining} 秒后自动刷新页面。`, 'success');
    const state = $('#versionState') as HTMLElement | null;
    if (state) state.hidden = true;
    const stage = $('#updateProgressState');
    if (stage) stage.textContent = `部署完成 · ${remaining} 秒后刷新`;
    setUpdateProgressMode('complete', `部署完成，${remaining} 秒后刷新`);
    const button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
    if (button) { button.disabled = true; button.textContent = `${remaining} 秒后刷新`; }
    if (remaining > 0) { updateReloadTimer = window.setTimeout(() => countDownUpdateRefresh(targetVersion), 1000); return; }
    void refreshAfterDeployment(targetVersion);
  }

  async function refreshAfterDeployment(targetVersion: string) {
    try {
      const status = await dependencies.getSystemUpdateStatus();
      const installed = await dependencies.getSystemVersion({ installedOnly: true });
      if (status.state !== 'success' || status.version !== targetVersion || installed.currentVersion !== targetVersion) throw Error('服务还未就绪');
      clearPendingDeviceUpdate();
      window.location.reload();
    } catch {
      setVersionState('倒计时已结束，正在等待新版本服务恢复后自动刷新…');
      const state = $('#versionState') as HTMLElement | null, stage = $('#updateProgressState');
      if (state) state.hidden = true;
      if (stage) stage.textContent = '倒计时结束 · 等待新版本服务恢复';
      setUpdateProgressMode('verifying', '倒计时结束，等待新版本服务恢复');
      const button = $('#checkAndUpdateVersion');
      if (button) button.textContent = '等待服务启动…';
      updateReloadTimer = window.setTimeout(() => void refreshAfterDeployment(targetVersion), 2000);
    }
  }

  async function verifyUpdatedVersion(targetVersion: string) {
    if (updateVersionCheckRunning || updateReloadScheduled || !targetVersion || updateTargetVersion !== targetVersion) return;
    updateVersionCheckRunning = true;
    try {
      const installed = await dependencies.getSystemVersion({ installedOnly: true });
      const info: SystemVersion = {
        ...versionInfo,
        currentVersion: installed.currentVersion,
        latestVersion: versionInfo?.latestVersion || targetVersion,
        updateAvailable: false
      };
      if (updateTargetVersion !== targetVersion) return;
      if (info.currentVersion !== targetVersion || lastUpdateStatus?.state !== 'success' || lastUpdateStatus.version !== targetVersion) throw Error('新版本服务还未就绪');
      versionInfo = info;
      versionInfoCheckedAt = window.Date.now();
      renderVersionInfo(info);
      clearTimer(updateVerificationTimer);
      clearTimer(versionPollTimer);
      updateReloadScheduled = true;
      clearTimer(updateReloadTimer);
      updateRefreshDeadline = window.Date.now() + UPDATE_REFRESH_DELAY_MS;
      countDownUpdateRefresh(targetVersion);
    } catch {
      setVersionState('更新已完成，正在等待新版本服务就绪…');
      const state = $('#versionState') as HTMLElement | null, stage = $('#updateProgressState');
      if (state) state.hidden = true;
      if (stage) stage.textContent = '更新任务完成 · 等待新版本服务就绪';
      const button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
      if (button) { button.disabled = true; button.textContent = '等待服务启动…'; }
      clearTimer(updateVerificationTimer);
      updateVerificationTimer = window.setTimeout(() => void verifyUpdatedVersion(targetVersion), 2000);
    } finally {
      updateVersionCheckRunning = false;
    }
  }

  function renderUpdateStatus(incomingStatus: UpdateStatus) {
    if (updateReloadScheduled) return;
    lastUpdateStatus = incomingStatus;
    let status = incomingStatus;
    // A previous job must never replace the version requested by this page.
    if (updateTargetVersion && ((status.version && status.version !== updateTargetVersion) || (['success', 'failed'].includes(status.state) && updateStatusFingerprint(status) === updateTerminalBaseline))) {
      status = { state: 'queued', version: '', updatedAt: null, logUpdatedAt: null, log: '' };
    } else if (['queued', 'running'].includes(status.state)) updateTerminalBaseline = '';
    if (!updateTargetVersion && status.version && ['queued', 'running'].includes(status.state)) {
      updateTargetVersion = status.version;
      updateLogRelevant = true;
      try { window.sessionStorage.setItem('qidian.pendingDeviceUpdate', updateTargetVersion); } catch { /* storage can be unavailable */ }
    }
    const waitingForRestart = !!updateTargetVersion && ['idle', 'unavailable'].includes(status.state);
    const activeUpdate = ['queued', 'running'].includes(status.state);
    if (activeUpdate || waitingForRestart) updateLogRelevant = true;
    if (!updateLogRelevant && !activeUpdate && !waitingForRestart && ['success', 'failed', 'unavailable'].includes(status.state)) {
      status = { state: 'idle', version: '', updatedAt: null, logUpdatedAt: null, log: '' };
    }
    const state = $('#versionState') as HTMLElement | null, progress = $('#updateProgress'), title = $('#updateProgressTitle'), time = $('#updateProgressTime'), stage = $('#updateProgressState');
    const button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
    if (state) state.hidden = !!updateTargetVersion && status.state !== 'failed';
    if (progress) (progress as HTMLElement).hidden = !updateLogRelevant || status.state === 'idle' && !updateTargetVersion;
    if (title) title.textContent = updateTargetVersion ? `本次更新 · v${updateTargetVersion}` : status.version ? `上次更新 · v${status.version}` : '本次更新';
    const logUpdatedAt = status.logUpdatedAt == null ? null : new Date(status.logUpdatedAt);
    if (time) time.textContent = logUpdatedAt && Number.isFinite(logUpdatedAt.getTime()) ? `最近日志 · ${logUpdatedAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '';
    const stageText = updateProgressStage(status, waitingForRestart);
    if (stage) stage.textContent = stageText;
    renderUpdateLog(status.log || '');
    if (status.state === 'failed') setUpdateProgressMode('error', '更新失败');
    else if (updateReloadScheduled) setUpdateProgressMode('complete', '新版本已启动，等待刷新');
    else if (activeUpdate || waitingForRestart || updateTargetVersion) setUpdateProgressMode('updating', stageText);
    else if (status.state === 'success') setUpdateProgressMode('complete', '更新完成');
    if (activeUpdate || waitingForRestart || updateTargetVersion) {
      if (button) { button.disabled = true; button.textContent = updateReloadScheduled ? '即将刷新' : '更新进行中…'; }
    } else setVersionAction(versionInfo);
    if (status.state === 'success' && updateTargetVersion && status.version === updateTargetVersion) void verifyUpdatedVersion(status.version);
    if (status.state === 'failed' && updateTargetVersion) {
      updateLogRelevant = true;
      clearPendingDeviceUpdate();
      setVersionState('更新失败；查看本次日志后可以重试。', 'error');
      setVersionAction(versionInfo);
    }
    clearTimer(versionPollTimer);
    if ((activeUpdate || updateTargetVersion) && ($('#versionInfoOverlay')?.classList.contains('open') || updateTargetVersion)) {
      versionPollTimer = window.setTimeout(() => void refreshUpdateStatus(), 1000);
    }
  }

  async function refreshUpdateStatus() {
    if (updateReloadScheduled) return;
    try {
      renderUpdateStatus(await dependencies.getSystemUpdateStatus());
    } catch (error) {
      if (updateReloadScheduled) return;
      const message = error instanceof Error ? error.message : '服务暂不可用，稍后重新检查。';
      setVersionState(updateTargetVersion ? '服务正在重启，等待新版本恢复…' : message, updateTargetVersion ? 'info' : 'error');
      if (updateTargetVersion) {
        const button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
        if (button) { button.disabled = true; button.textContent = '等待服务启动…'; }
        setUpdateProgressMode('verifying', '服务重启中，等待恢复');
      }
      clearTimer(versionPollTimer);
      const button = $('#checkAndUpdateVersion');
      if (updateTargetVersion || ($('#versionInfoOverlay')?.classList.contains('open') && button?.textContent === '正在检查并更新…')) {
        versionPollTimer = window.setTimeout(() => void refreshUpdateStatus(), 2000);
      }
    }
  }

  async function checkSystemVersion() {
    ensureVersionInfoUI();
    if (updateReloadScheduled) return;
    if (updateTargetVersion) {
      setVersionState(`正在等待 v${updateTargetVersion} 服务恢复…`);
      const button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
      if (button) { button.disabled = true; button.textContent = '更新进行中…'; }
      await refreshUpdateStatus();
      return;
    }
    if (versionCheckPromise) return versionCheckPromise;
    if (versionInfo && window.Date.now() - versionInfoCheckedAt < VERSION_INFO_CACHE_MS) {
      await refreshUpdateStatus();
      return;
    }
    if (!versionInfo) {
      const installed = $('#installedVersion'), latest = $('#latestVersion'), card = $('#latestVersionCard'), notes = $('#releaseNotes'), publishedAt = $('#releasePublishedAt'), button = $('#checkAndUpdateVersion') as HTMLButtonElement | null;
      if (installed) installed.textContent = dependencies.appVersion || '读取中…';
      if (latest) latest.textContent = '检查中…';
      card?.setAttribute('data-kind', 'info');
      setVersionState('正在检查最新版本…');
      if (notes) dependencies.renderReleaseNotes(notes, '读取中…');
      if (publishedAt) (publishedAt as HTMLElement).hidden = true;
      if (button) { button.disabled = true; button.textContent = '正在检查…'; }
    } else {
      setVersionState('正在刷新版本信息…');
      setVersionAction(versionInfo);
    }
    const request = (async () => {
      try {
        versionInfo = await dependencies.getSystemVersion();
        versionInfoCheckedAt = window.Date.now();
        renderVersionInfo(versionInfo);
        setVersionState(versionInfo.updateAvailable
          ? (!versionInfo.canUpdateDevice ? '发现新版本；只有首个账号可以更新设备。' : versionInfo.updaterAvailable ? '发现新版本，可以在线更新。' : '发现新版本；请先通过 iStoreOS 安装新版管理组件。')
          : '当前已是最新版本。', versionInfo.updateAvailable ? 'available' : 'current');
        if (versionInfo.updateAvailable && !versionInfo.installerAvailable) setVersionState('发现新版本，但安装包尚未就绪，请稍后再试。', 'error');
      } catch (error) {
        if (versionInfo) {
          renderVersionInfo(versionInfo);
          setVersionState('暂时无法刷新；仍显示上次读取的版本信息。', 'error');
          setVersionAction(versionInfo);
        } else {
          const latest = $('#latestVersion'), label = $('#latestVersionLabel'), card = $('#latestVersionCard'), notes = $('#releaseNotes'), publishedAt = $('#releasePublishedAt');
          if (latest) latest.textContent = '暂不可用';
          if (label) label.textContent = '最新版本';
          card?.setAttribute('data-update-available', 'false');
          if (notes) dependencies.renderReleaseNotes(notes, '暂时无法读取更新说明。');
          if (publishedAt) (publishedAt as HTMLElement).hidden = true;
          setVersionState(error instanceof Error ? error.message : '版本检查失败，请稍后重试。', 'error');
          setVersionAction(null);
        }
      }
      await refreshUpdateStatus();
    })();
    versionCheckPromise = request;
    try { await request; } finally { if (versionCheckPromise === request) versionCheckPromise = null; }
  }

  async function openVersionInfo() {
    dependencies.closeAccountMenu();
    dependencies.closeAppSettings();
    ensureVersionInfoUI();
    const overlay = $('#versionInfoOverlay');
    if (overlay && !overlay.classList.contains('open')) {
      const HTMLElementType = document.defaultView?.HTMLElement;
      versionDialogReturnFocus = HTMLElementType && document.activeElement instanceof HTMLElementType
        ? document.activeElement
        : null;
      overlay.classList.add('open');
      overlay.querySelector<HTMLElement>('[data-close="versionInfoOverlay"]')?.focus();
    }
    if (versionInfo) renderVersionInfo(versionInfo);
    void checkSystemVersion();
  }

  async function checkAndUpdateVersion() {
    if (updateActionRunning || updateTargetVersion || updateReloadScheduled) return;
    startUpdateCheck();
    try {
      const info = await dependencies.getSystemVersion();
      versionInfo = info;
      versionInfoCheckedAt = window.Date.now();
      renderVersionInfo(info);
      if (!info.updateAvailable) {
        updateLogRelevant = false;
        finishUpdateCheck(`当前已是最新版本 v${info.currentVersion || info.latestVersion}。`);
        return;
      }
      appendUpdateProgressMessage(`发现新版本 v${info.latestVersion}。`);
      if (!info.installerAvailable) {
        updateLogRelevant = false;
        finishUpdateCheck('发现新版本，但安装包尚未就绪，请稍后重试。', { mode: 'blocked', kind: 'error', log: '安装包尚未就绪，本次未启动更新。' });
        return;
      }
      if (!info.updaterAvailable) {
        updateLogRelevant = false;
        finishUpdateCheck('发现新版本；请先通过 iStoreOS 更新管理组件。', { mode: 'blocked', kind: 'error', log: '设备端更新管理组件尚未就绪，本次未启动更新。' });
        return;
      }
      if (!info.canUpdateDevice) {
        updateLogRelevant = false;
        finishUpdateCheck('发现新版本；只有首个账号可以更新设备。', { mode: 'blocked', kind: 'error', log: '当前账号没有设备更新权限，本次未启动更新。' });
        return;
      }
      const title = $('#updateProgressTitle'), stage = $('#updateProgressState');
      if (title) title.textContent = `正在更新 · v${info.latestVersion}`;
      if (stage) stage.textContent = '正在保存当前修改…';
      setUpdateProgressMode('updating', '正在准备更新');
      appendUpdateProgressMessage('安装包和设备更新服务均已就绪，正在确认当前数据已保存…');
      if (!await dependencies.flush()) throw Error('当前修改尚未写入，请检查连接后重试更新。');
      if (stage) stage.textContent = '正在提交设备更新任务…';
      appendUpdateProgressMessage('当前数据已保存，正在提交设备更新任务…');
      const accepted = await dependencies.requestSystemUpdate();
      updateTargetVersion = accepted?.version || info.latestVersion || '';
      updateLogRelevant = true;
      updateActionRunning = false;
      updateReloadScheduled = false;
      try { window.sessionStorage.setItem('qidian.pendingDeviceUpdate', updateTargetVersion); } catch { /* storage can be unavailable */ }
      const state = $('#versionState') as HTMLElement | null;
      if (state) state.hidden = true;
      setVersionState(`已提交 v${updateTargetVersion} 更新；安装与服务重启完成后，将倒计时 5 秒自动刷新。`);
      await refreshUpdateStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法检查或提交更新，请稍后重试。';
      updateLogRelevant = false;
      finishUpdateCheck(message, { mode: 'error', kind: 'error', log: `操作失败：${message}` });
    } finally {
      updateActionRunning = false;
      if (!updateTargetVersion && !updateReloadScheduled) setVersionAction(versionInfo);
    }
  }

  function closeVersionInfo() {
    const overlay = $('#versionInfoOverlay');
    overlay?.classList.remove('open');
    const returnFocus = versionDialogReturnFocus;
    versionDialogReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
    if (!updateTargetVersion) clearTimer(versionPollTimer);
  }

  function handleClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    if (target.closest('[data-close="versionInfoOverlay"]')) { closeVersionInfo(); return; }
    if (target.closest('#versionButton')) { void openVersionInfo(); return; }
    if (target.closest('#checkAndUpdateVersion')) void checkAndUpdateVersion();
  }

  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleVersionDialogKeydown, true);

  return {
    open: openVersionInfo,
    close: closeVersionInfo,
    check: checkSystemVersion,
    renderBadge: renderVersionBadge,
    hasPendingUpdate: () => !!updateTargetVersion,
    dispose() {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleVersionDialogKeydown, true);
      clearTimer(versionPollTimer);
      clearTimer(updateVerificationTimer);
      clearTimer(updateReloadTimer);
    }
  };
}
