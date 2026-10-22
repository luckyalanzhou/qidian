import { validateVault } from '../shared/vault-validation.js';
import { api } from './api/client.ts';
import { getAuthConfig, getAuthSession, logoutAccount, registerWithCredential, requestLoginChallenge, verifyLoginChallenge } from './api/auth.ts';
import { getAccountAvatar, getAccountProfile, getPasswordSalt, removeAccountAvatar, saveAccountAvatar, updateAccountPassword } from './api/account.ts';
import { getSystemUpdateStatus, getSystemVersion, requestSystemUpdate } from './api/system-updates.ts';
import { listBackups as requestListBackups, createBackupSnapshot as requestCreateBackupSnapshot, getBackupSnapshot } from './api/backups.ts';
import { getAssetResponse, listAssets, pruneAssets as requestAssetPrune, uploadAsset } from './api/assets.ts';
import { getVault, getVaultRevision, putVault } from './api/vault.ts';
import { makeRegistrationCredential, makeLoginVerifier } from './features/auth/credentials.js';
import { draftRecoveryState } from './draft-recovery.js';
import { mergeVault } from './features/sync/vault-merge.js';
import { createBackupDataService } from './features/settings/backup-data-service.ts';
import { createCloudSyncEngine } from './features/sync/cloud-sync-engine.ts';
import { createDraftRepository } from './features/sync/draft-repository.ts';
import { createAccountSessionService } from './features/auth/account-session-service.ts';
import { createHtmlExportService } from './features/notes/html-export-service.ts';
import { createSyncConflictExportService } from './features/sync/conflict-export-service.ts';
export { api, getAuthConfig, logoutAccount, getAccountAvatar, getAccountProfile, removeAccountAvatar, saveAccountAvatar,
  getSystemUpdateStatus, getSystemVersion, requestSystemUpdate };
const DEV = import.meta.env.DEV;
let revision = 0, pending, draining = false, blocked = false, requiresLogin = false, baseVault = null, syncConflict = null;
let listener = () => {}, authenticationListener = () => {}, remoteUpdateListener = () => {}, lastError = '', refreshing = false;
let owner = 'local';
const draftRepository = createDraftRepository({
  databaseName: DEV ? 'qidian-development' : 'qidian-private-drafts',
  version: 2
});
const draftOp = (method, value, account = 'local', slot = 'active') => method === 'get'
  ? draftRepository.read(account, slot)
  : method === 'put' ? draftRepository.write(value, account, slot) : draftRepository.remove(account, slot);
const accountSessionService = createAccountSessionService({
  makeRegistrationCredential,
  makeLoginVerifier,
  registerWithCredential,
  readLegacyDraft: () => draftOp('get', undefined, 'legacy'),
  storeAccountDraft: (draft, accountId) => draftOp('put', draft, accountId),
  requestLoginChallenge,
  verifyLoginChallenge,
  getAuthSession,
  getPasswordSalt,
  updateAccountPassword
});
const cloudSync = createCloudSyncEngine({
  dev: DEV,
  state: {
    get revision() { return revision; }, set revision(value) { revision = value; },
    get pending() { return pending; }, set pending(value) { pending = value; },
    get draining() { return draining; }, set draining(value) { draining = value; },
    get blocked() { return blocked; }, set blocked(value) { blocked = value; },
    get requiresLogin() { return requiresLogin; }, set requiresLogin(value) { requiresLogin = value; },
    get baseVault() { return baseVault; }, set baseVault(value) { baseVault = value; },
    get syncConflict() { return syncConflict; }, set syncConflict(value) { syncConflict = value; },
    get lastError() { return lastError; }, set lastError(value) { lastError = value; },
    get refreshing() { return refreshing; }, set refreshing(value) { refreshing = value; },
    get owner() { return owner; }, set owner(value) { owner = value; }
  },
  getStatusListener: () => listener,
  getAuthenticationListener: () => authenticationListener,
  getRemoteUpdateListener: () => remoteUpdateListener,
  saveLocalDraft: (data, savedRevision, accountId) => draftOp('put', { data, revision: savedRevision, pending: false, owner: accountId }, accountId),
  clearLocalDraft: () => draftOp('delete', undefined, owner),
  getVaultRevision,
  getVault,
  putVault,
  validateVault,
  mergeVault
});
export const registerAccount = (username, password) => accountSessionService.registerAccount(username, password);
/** @param {string} username @param {string} password @param {(stage:string)=>void} [onStage] */
export async function loginAccount(username, password, onStage = () => {}) {
  const session = await accountSessionService.verifyAccount(username, password, onStage);
  return prepareInitialData(session);
}
export async function reauthenticateAccount(username, password, onStage = () => {}) {
  const session = await accountSessionService.verifyAccount(username, password, onStage);
  if (owner !== 'local' && session.id !== owner) {
    await logoutAccount().catch(() => {});
    throw new Error('请使用发生同步错误的原账号重新登录；当前修改仍保留在此页面');
  }
  const remote = validateVault(session.data);
  const retained = pending ? structuredClone(pending) : null;
  const previousBase = baseVault;
  const previousRevision = revision;
  revision = session.revision;
  baseVault = remote;
  requiresLogin = false;
  if (!retained) {
    blocked = false; lastError = ''; syncConflict = null;
    listener('✓ 已重新连接 Docker 私人服务');
    return { data: structuredClone(remote), conflict: false, synced: true };
  }
  const merged = previousBase ? mergeVault(previousBase, retained, remote) : null;
  if (!merged) {
    revision = previousRevision;
    baseVault = previousBase;
    blocked = true;
    syncConflict = { base:previousBase ? structuredClone(previousBase) : null, local:structuredClone(retained), remote:structuredClone(remote), revision:session.revision };
    lastError = '修改有重叠，已保留两个版本。';
    listener(lastError);
    return { data: retained, conflict: true, synced: false };
  }
  pending = merged;
  blocked = false; lastError = ''; syncConflict = null;
  listener('正在合并已保存的修改…');
  await cloudSync.drain();
  const synced = await flush();
  return { data: structuredClone(synced ? baseVault : pending || merged), conflict: false, synced };
}
export const changeAccountPassword = (currentPassword, newPassword) => accountSessionService.changeAccountPassword(currentPassword, newPassword);
async function prepareInitialData(session) {
  revision = session.revision;
  baseVault = validateVault(session.data);
  const [cached, ignoredDraft] = await Promise.all([
    draftOp('get', undefined, session.id).catch(() => null),
    draftOp('get', undefined, session.id, 'ignored').catch(() => null)
  ]);
  let ignored = ignoredDraft;
  const recovery = cached?.owner === session.id ? draftRecoveryState(cached, revision) : 'none';
  if (recovery === 'restore') {
    return { data: validateVault(cached.data), local: false, owner: session.id, username: session.username, restoreDraft: true, restoreConflict: false, ignoredDraft: !!ignored?.pending };
  }
  if (recovery === 'ask' || recovery === 'restore-conflict') {
    // Never load a stale full-vault snapshot over newer cloud data. Keep it in
    // the one-time recovery slot and start this session from the cloud version.
    await draftOp('put', { ...cached, owner: session.id, pending: true, conflictAcceptedCloudRevision: revision }, session.id, 'ignored');
    await draftOp('delete', undefined, session.id);
    ignored = cached;
  }
  return { data: validateVault(session.data), local: false, owner: session.id, username: session.username, ignoredDraft: !!ignored?.pending };
}
export async function bootstrap() {
  // Vite is an explicitly local development mode; production never falls back around authentication.
  if (DEV) {
    const cached = await draftOp('get').catch(() => null);
    const data = validateVault(cached?.data || { categories: [], noteTypes: undefined, notes: [], theme: 'light', pasteMode: 'rich' });
    baseVault = structuredClone(data);
    return { data, local: true };
  }
  const session = await getAuthSession();
  return prepareInitialData(session);
}
export async function restoreIgnoredDraft() {
  const cached = await draftOp('get', undefined, owner, 'ignored');
  if (!cached?.pending || cached.owner !== owner) throw Error('未找到此账号的本地草稿');
  const conflict = cached.revision !== revision;
  if (conflict) {
    const local = validateVault(cached.data);
    blocked = true; pending = structuredClone(local);
    syncConflict = { base:null, local:structuredClone(local), remote:structuredClone(baseVault), revision, origin:'ignoredDraft' };
    lastError = '旧版暂存内容与已保存版本不同；请先导出暂存内容，再载入已保存版本';
    listener(lastError);
    // Keep the recovery copy until the user exports both versions and explicitly
    // chooses the cloud copy. Production still makes no new local note-body writes.
  } else {
    blocked = false; lastError = ''; syncConflict = null; pending = structuredClone(cached.data);
    await draftOp('delete', undefined, owner, 'ignored');
  }
  return { data: validateVault(cached.data), conflict };
}
export async function reloadCloud() {
  if (DEV) {
    const cached = await draftOp('get');
    const data = validateVault(cached?.data || { categories: [], notes: [], theme: 'light', pasteMode: 'rich' });
    baseVault = structuredClone(data);
    return data;
  }
  const cloud = await getVault();
  const resolvingIgnoredDraft = syncConflict?.origin === 'ignoredDraft';
  revision = cloud.revision; pending = null; blocked = false; lastError = ''; syncConflict = null;
  await draftOp('delete', undefined, owner);
  if (resolvingIgnoredDraft) await draftOp('delete', undefined, owner, 'ignored');
  listener(owner === 'local' ? '✓ 已载入本地预览数据库' : '✓ 已载入最新Docker 服务端版本');
  baseVault = validateVault(cloud.data);
  return structuredClone(baseVault);
}
export function setOwner(value) { owner = value || 'local'; }
export function onStatus(fn) { listener = fn; if (blocked) fn(lastError); }
export function onAuthenticationRequired(fn) { authenticationListener = fn || (() => {}); }
export function onRemoteUpdate(fn) { remoteUpdateListener = fn || (() => {}); }
export function getSyncConflict() { return syncConflict ? structuredClone(syncConflict) : null; }
const syncConflictExportService = createSyncConflictExportService({
  getConflict: () => syncConflict,
  dev: DEV,
  listAssets,
  getAssetResponse,
  download
});
export const exportSyncConflict = () => syncConflictExportService.exportSyncConflict();
export const refreshCloud = (getLocalData = () => null) => cloudSync.refreshCloud(getLocalData);
export const queueSave = data => cloudSync.queueSave(data);
export const commitSave = data => cloudSync.commitSave(data);
export const retrySync = () => cloudSync.retrySync();
export const flush = () => cloudSync.flush();
export const hasUnsaved = () => cloudSync.hasUnsaved();
export async function upload(file) {
  if (DEV) throw Error('文件上传需要启动本地 SQLite 完整预览；当前为界面开发模式');
  if (!file.size) throw Error('文件为空');
  return uploadAsset(file);
}
export async function pruneAssets() {
  if (DEV) return { removed: 0, bytes: 0 };
  return requestAssetPrune();
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const htmlExportService = createHtmlExportService({ getAssetResponse, download });
const backupDataService = createBackupDataService({
  dev: DEV,
  getRevision: () => revision,
  flush,
  getLastError: () => lastError,
  listAssets,
  getAssetResponse,
  upload,
  validateVault,
  download,
  listSnapshots: requestListBackups,
  createSnapshot: requestCreateBackupSnapshot,
  getSnapshot: getBackupSnapshot
});
export const exportBackup = data => backupDataService.exportBackup(data);
export const exportHTML = (note, sanitizedHTML) => htmlExportService.exportHTML(note, sanitizedHTML);
export const readBackup = file => backupDataService.readBackup(file);
export const listBackups = () => backupDataService.listBackups();
export const createBackupSnapshot = () => backupDataService.createBackupSnapshot();
export const getBackup = id => backupDataService.getBackup(id);
window.addEventListener('online', () => { if (pending && !blocked) void cloudSync.drain(); });
