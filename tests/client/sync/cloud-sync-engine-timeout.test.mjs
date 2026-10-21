import test from 'node:test';
import assert from 'node:assert/strict';
import { createViteTestServer } from '../../support/vite-test-server.mjs';
import { fileURLToPath } from 'node:url';

test('a lost save response is reconciled with the server before retrying', async t => {
  const server = await createViteTestServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  t.after(() => server.close());
  const { createCloudSyncEngine } = await server.ssrLoadModule('/src/features/sync/cloud-sync-engine.ts');
  const snapshot = { notes: [{ id: 'one', body: 'saved' }] };
  let saved = null;
  let writes = 0;
  const state = {
    revision: 4, pending: null, draining: false, blocked: false, requiresLogin: false,
    baseVault: { notes: [{ id: 'one', body: 'old' }] }, syncConflict: null, lastError: '',
    refreshing: false, owner: 'account-test'
  };
  const engine = createCloudSyncEngine({
    dev: false, state,
    getStatusListener: () => () => undefined,
    getAuthenticationListener: () => () => undefined,
    getRemoteUpdateListener: () => () => undefined,
    saveLocalDraft: async () => undefined, clearLocalDraft: async () => undefined,
    getVaultRevision: async () => ({ revision: 5 }),
    getVault: async () => ({ revision: 5, data: saved }),
    putVault: async (_revision, data) => {
      writes += 1;
      saved = structuredClone(data);
      throw new TypeError('response lost after commit');
    },
    validateVault: value => value,
    mergeVault: () => null
  });

  await engine.commitSave(snapshot);
  assert.equal(writes, 1, 'the ambiguous write is not repeated');
  assert.equal(state.revision, 5);
  assert.equal(state.pending, null);
  assert.equal(state.lastError, '');
});

test('an oversized vault is rejected before network access and retained for recovery', async t => {
  const server = await createViteTestServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom'
  });
  t.after(() => server.close());
  const { createCloudSyncEngine } = await server.ssrLoadModule('/src/features/sync/cloud-sync-engine.ts');
  const snapshot = { tooLarge: true };
  let writes = 0;
  const messages = [];
  const state = {
    revision: 4, pending: null, draining: false, blocked: false, requiresLogin: false,
    baseVault: { notes: [] }, syncConflict: null, lastError: '', refreshing: false, owner: 'account-test'
  };
  const engine = createCloudSyncEngine({
    dev: false, state,
    getStatusListener: () => message => messages.push(message),
    getAuthenticationListener: () => () => undefined,
    getRemoteUpdateListener: () => () => undefined,
    saveLocalDraft: async () => undefined, clearLocalDraft: async () => undefined,
    getVaultRevision: async () => ({ revision: 4 }),
    getVault: async () => ({ revision: 4, data: { notes: [] } }),
    putVault: async () => { writes += 1; return { revision: 5 }; },
    validateVault: value => {
      if (value.tooLarge) throw Object.assign(new Error('知识库内容已超过 1 MB。请先导出备份，再删除不再需要的内容；当前修改尚未保存。'), { status: 413 });
      return value;
    },
    mergeVault: () => null
  });

  await assert.rejects(engine.commitSave(snapshot), /超过 1 MB/);
  assert.equal(writes, 0);
  assert.deepEqual(state.pending, snapshot);
  assert.match(state.lastError, /先导出备份/);
  assert.ok(messages.includes(state.lastError));
});
