import type { VaultData } from '../../api/contracts';

export type SyncConflictSnapshot = {
  base: VaultData | null;
  local: VaultData;
  remote: VaultData;
  revision: number;
  origin?: 'ignoredDraft';
};

export type CloudSyncState = {
  revision: number;
  pending: VaultData | null | undefined;
  draining: boolean;
  blocked: boolean;
  requiresLogin: boolean;
  baseVault: VaultData | null;
  syncConflict: SyncConflictSnapshot | null;
  lastError: string;
  refreshing: boolean;
  owner: string;
};

export type CloudSyncDependencies = {
  dev: boolean;
  state: CloudSyncState;
  getStatusListener: () => (message: string) => void;
  getAuthenticationListener: () => () => void;
  getRemoteUpdateListener: () => (vault: VaultData) => void;
  saveLocalDraft: (vault: VaultData, revision: number, owner: string) => Promise<unknown>;
  clearLocalDraft: () => Promise<unknown>;
  getVaultRevision: () => Promise<{ revision: number }>;
  getVault: () => Promise<{ revision: number; data: unknown }>;
  putVault: (revision: number, data: VaultData) => Promise<{ revision: number }>;
  validateVault: (value: unknown) => VaultData;
  mergeVault: (base: VaultData, local: VaultData, remote: VaultData) => VaultData | null;
};

function statusOf(error: unknown) {
  return error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
}

function messageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : '';
}

/** Owns the cloud save queue, optimistic concurrency merge and foreground refresh flow. */
export function createCloudSyncEngine(dependencies: CloudSyncDependencies) {
  const { state } = dependencies;
  const notify = (message: string) => dependencies.getStatusListener()(message);
  const requireAuthentication = () => dependencies.getAuthenticationListener()();
  const remoteUpdated = (vault: VaultData) => dependencies.getRemoteUpdateListener()(vault);

  async function drain() {
    if (state.draining) return;
    state.draining = true;
    let mergeAttempts = 0;
    try {
      while (state.pending) {
        const snapshot = state.pending;
        state.pending = null;
        if (dependencies.dev) {
          try {
            await dependencies.saveLocalDraft(snapshot, state.revision, state.owner);
          } catch {
            state.pending = state.pending || snapshot;
            state.lastError = '本地草稿保存失败；修改仍保留在当前页面，请立即导出或重试';
            notify(state.lastError);
            break;
          }
          state.baseVault = structuredClone(snapshot);
          state.lastError = '';
          if (!state.pending) notify('✓ 已保存到此设备（开发模式）');
          continue;
        }
        if (state.blocked) { state.pending = snapshot; notify(state.lastError); break; }
        let validSnapshot: VaultData;
        try {
          validSnapshot = dependencies.validateVault(snapshot);
        } catch (error) {
          state.pending = snapshot;
          state.lastError = messageOf(error) || '知识库内容超出当前限制；当前修改尚未保存';
          notify(state.lastError);
          break;
        }
        try {
          let result: { revision: number };
          try {
            result = await dependencies.putVault(state.revision, validSnapshot);
          } catch (error) {
            const status = statusOf(error);
            if (status !== 0 && status < 500) throw error;
            // A timed-out response can follow a successful server commit. Read
            // the authoritative vault before retrying so we never overwrite it.
            const latest = await dependencies.getVault();
            const remote = dependencies.validateVault(latest.data);
            if (JSON.stringify(remote) === JSON.stringify(validSnapshot)) result = { revision: latest.revision };
            else if (latest.revision !== state.revision) {
              const rebased = dependencies.mergeVault(state.baseVault!, state.pending || snapshot, remote);
              if (!rebased) {
                state.blocked = true;
                state.syncConflict = { base: structuredClone(state.baseVault), local: structuredClone(state.pending || snapshot), remote: structuredClone(remote), revision: latest.revision };
                state.lastError = '修改内容存在重叠；已保留双方版本，可在设置中整理';
                notify(state.lastError);
                state.pending = state.pending || snapshot;
                break;
              }
              state.revision = latest.revision;
              state.baseVault = structuredClone(remote);
              state.pending = rebased;
              notify('正在合并已保存的修改…');
              continue;
            } else throw error;
          }
          state.revision = result.revision;
          state.baseVault = structuredClone(validSnapshot);
          state.lastError = '';
          state.syncConflict = null;
          mergeAttempts = 0;
          if (!state.pending) {
            // Clear a pre-cloud-version recovery copy only after the cloud confirms the write.
            await dependencies.clearLocalDraft().catch(() => {});
            notify('✓ 已保存到 Docker 数据目录');
          }
        } catch (error) {
          const localVersion = state.pending || snapshot;
          if (statusOf(error) === 409 && mergeAttempts < 8) {
            mergeAttempts++;
            await new Promise(resolve => setTimeout(resolve, Math.min(25 * 2 ** (mergeAttempts - 1), 320)));
            try {
              const latest = await dependencies.getVault();
              const remote = dependencies.validateVault(latest.data);
              const newestLocal = state.pending || snapshot;
              const rebased = dependencies.mergeVault(state.baseVault!, newestLocal, remote);
              if (!rebased) {
                state.blocked = true;
                state.syncConflict = { base: structuredClone(state.baseVault), local: structuredClone(newestLocal), remote: structuredClone(remote), revision: latest.revision };
                state.lastError = '修改内容存在重叠；已保留双方版本，可在设置中整理';
              } else {
                state.revision = latest.revision;
                state.baseVault = structuredClone(remote);
                state.pending = rebased;
                notify('正在合并已保存的修改…');
                continue;
              }
            } catch (mergeError) {
              if (statusOf(mergeError) === 401) {
                state.blocked = true;
                state.requiresLogin = true;
                state.pending = localVersion;
                state.lastError = '登录状态已失效；本次修改仍保留在当前页面，请重新登录后继续同步';
                notify(state.lastError);
                requireAuthentication();
              } else state.lastError = `检测到Docker 服务端版本变化，但读取最新版本失败：${messageOf(mergeError) || '请重试同步'}`;
            }
          } else if (statusOf(error) === 409) {
            state.lastError = '修改暂未写入；内容仍保留，请稍后重试';
          } else if (statusOf(error) === 401) {
            state.blocked = true;
            state.requiresLogin = true;
            state.lastError = '登录状态已失效；本次修改仍保留在当前页面，请重新登录后继续同步';
            notify(state.lastError);
            requireAuthentication();
          } else {
            state.lastError = `保存未完成：${messageOf(error) || 'Docker 服务端保存失败'}；修改仍在当前页面，请保持页面打开并重试`;
          }
          notify(state.lastError);
          // Keep the newest unsaved version in memory; production never persists note bodies locally.
          if (!state.pending) state.pending = localVersion;
          break;
        }
      }
    } catch {
      state.lastError = '本地草稿保存失败，请立即导出；尚未同步';
      notify(state.lastError);
    } finally {
      state.draining = false;
    }
  }

  function queueSave(data: VaultData) {
    state.pending = structuredClone(data);
    if (state.blocked && state.syncConflict) state.syncConflict.local = structuredClone(data);
    notify(dependencies.dev ? '本地开发预览：正在保存到此设备…' : state.blocked ? state.lastError : '正在保存到 Docker 数据目录…');
    void drain();
  }

  async function flush() {
    if (state.pending && !state.draining) await drain();
    while (state.draining) await new Promise(resolve => setTimeout(resolve, 40));
    return !state.blocked && !state.pending && !state.lastError;
  }

  async function commitSave(data: VaultData) {
    queueSave(data);
    if (!await flush()) throw Error(state.lastError || '修改尚未写入 Docker 服务端，请保持页面打开并重试');
    return true;
  }

  function retrySync() {
    if (state.requiresLogin) { requireAuthentication(); return false; }
    if (!state.pending) return false;
    state.blocked = false;
    state.lastError = '';
    notify('正在重试 Docker 服务同步…');
    void drain();
    return true;
  }

  async function refreshCloud(getLocalData: VaultData | (() => VaultData | null) = () => null) {
    if (dependencies.dev || state.owner === 'local' || state.refreshing || state.draining || state.blocked || state.requiresLogin || !state.baseVault) return false;
    state.refreshing = true;
    try {
      if (state.pending) {
        notify('网络恢复后正在自动重试Docker 服务端保存…');
        await drain();
        if (state.pending || state.blocked || state.requiresLogin || state.lastError) return false;
      }
      const current = await dependencies.getVaultRevision();
      if (!Number.isSafeInteger(current.revision) || current.revision < 0 || current.revision === state.revision) return false;
      if (state.draining || state.blocked || state.requiresLogin) return false;
      const latest = await dependencies.getVault();
      if (!Number.isSafeInteger(latest.revision) || latest.revision < 0 || latest.revision === state.revision) return false;
      if (state.draining || state.blocked || state.requiresLogin) return false;
      const remote = dependencies.validateVault(latest.data);
      const currentLocal = typeof getLocalData === 'function' ? getLocalData() : getLocalData;
      const local = dependencies.validateVault(state.pending || currentLocal || state.baseVault);
      const merged = dependencies.mergeVault(state.baseVault, local, remote);
      if (!merged) {
        state.pending = structuredClone(local);
        state.blocked = true;
        state.syncConflict = { base: structuredClone(state.baseVault), local: structuredClone(local), remote: structuredClone(remote), revision: latest.revision };
        state.lastError = '修改存在重叠；双方版本均已保留，可在设置中整理';
        notify(state.lastError);
        return false;
      }
      state.revision = latest.revision;
      state.baseVault = structuredClone(remote);
      if (JSON.stringify(merged) === JSON.stringify(remote)) {
        state.pending = null;
        state.blocked = false;
        state.lastError = '';
        state.syncConflict = null;
        remoteUpdated(structuredClone(remote));
        notify('✓ 已载入最新保存内容');
        return true;
      }
      state.pending = merged;
      state.blocked = false;
      state.lastError = '';
      state.syncConflict = null;
      notify('正在合并已保存的修改…');
      // Publish the merged in-memory view before awaiting the write so edits made
      // during the request include remote additions and cannot re-save a stale vault.
      remoteUpdated(structuredClone(merged));
      await drain();
      return await flush();
    } catch (error) {
      if (statusOf(error) === 401) {
        state.blocked = true;
        state.requiresLogin = true;
        state.lastError = '登录状态已失效；请重新登录继续同步';
        notify(state.lastError);
        requireAuthentication();
      }
      return false;
    } finally {
      state.refreshing = false;
    }
  }

  function hasUnsaved() {
    return state.draining || !!state.pending || state.blocked || !!state.lastError;
  }

  return { queueSave, commitSave, retrySync, drain, flush, refreshCloud, hasUnsaved };
}
