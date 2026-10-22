import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_PRUNE_GRACE_MS, createAssetService } from '../../server/application/asset-service.js';

const referenced = '11111111-1111-4111-8111-111111111111';
const historical = '22222222-2222-4222-8222-222222222222';
const orphan = '33333333-3333-4333-8333-333333333333';

test('asset service lists, creates and reconstructs account-scoped attachments', async () => {
  const calls = [];
  const repository = {
    listAccountAssets: async (db, accountId) => ({ results: [{ id: referenced, accountId }] }),
    saveAccountAsset: async (db, asset) => calls.push(asset),
    findAccountAsset: async (db, accountId, id) => ({ id, accountId, name: 'pixel.png', mime: 'image/png', size: 4 }),
    listAccountAssetChunks: async () => ({ results: [{ data: new Uint8Array([0x89, 0x50]) }, { data: new Uint8Array([0x4e, 0x47]) }] })
  };
  const service = createAssetService(repository, { now: () => 765, createId: () => referenced });

  assert.deepEqual(await service.list({}, 'account-a'), [{ id: referenced, accountId: 'account-a' }]);
  assert.deepEqual(await service.create({}, 'account-a', 'pixel.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])), {
    id: referenced, name: 'pixel.png', mime: 'image/png', size: 4, created: 765
  });
  assert.deepEqual(calls[0], {
    accountId: 'account-a', id: referenced, name: 'pixel.png', mime: 'image/png', size: 4,
    created: 765, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  });
  assert.deepEqual(await service.read({}, 'account-a', referenced), {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png', name: 'pixel.png'
  });
});

test('asset pruning preserves references in the current vault and retained snapshots', async () => {
  let deletion;
  const now = ASSET_PRUNE_GRACE_MS * 10;
  const service = createAssetService({
    findAssetPruneCandidates: async (db, accountId) => ({
      vaultData: `note image /api/assets/${referenced}`,
      snapshots: [{ data: `historical /api/assets/${historical}?download=1` }],
      assets: [
        { id: referenced, size: 10, created: now - ASSET_PRUNE_GRACE_MS - 1 },
        { id: historical, size: 20, created: now - ASSET_PRUNE_GRACE_MS - 1 },
        { id: orphan, size: 30, created: now - ASSET_PRUNE_GRACE_MS - 1 }
      ]
    }),
    deleteAccountAssets: async (db, accountId, ids) => { deletion = { accountId, ids }; }
  }, { now: () => now });

  assert.deepEqual(await service.prune({}, 'account-a'), { removed: 1, bytes: 30 });
  assert.deepEqual(deletion, { accountId: 'account-a', ids: [orphan] });
});

test('asset pruning keeps recent unreferenced uploads during the cross-device save window', async () => {
  const now = ASSET_PRUNE_GRACE_MS * 10;
  let deleted = [];
  const service = createAssetService({
    findAssetPruneCandidates: async () => ({
      vaultData: '', snapshots: [],
      assets: [
        { id: orphan, size: 30, created: now - ASSET_PRUNE_GRACE_MS - 1 },
        { id: '44444444-4444-4444-8444-444444444444', size: 40, created: now - ASSET_PRUNE_GRACE_MS + 1 }
      ]
    }),
    deleteAccountAssets: async (_db, _accountId, ids) => { deleted = ids; }
  }, { now: () => now });

  assert.deepEqual(await service.prune({}, 'account-a'), { removed: 1, bytes: 30 });
  assert.deepEqual(deleted, [orphan]);
});

test('asset service maps quota, missing-file and corrupt-chunk outcomes consistently', async () => {
  const service = createAssetService({
    saveAccountAsset: async () => { throw new Error('ASSET_QUOTA exceeded'); },
    findAccountAsset: async (db, accountId, id) => id === referenced ? { id, name: 'a.bin', mime: 'application/octet-stream', size: 1 } : null,
    listAccountAssetChunks: async () => ({ results: [{ data: new Uint8Array([1, 2]) }] })
  }, { createId: () => referenced });

  await assert.rejects(service.create({}, 'account-a', 'a.bin', new Uint8Array([1])), error => error.status === 413 && /100 MB/.test(error.message));
  await assert.rejects(service.read({}, 'account-a', orphan), error => error.status === 404);
  await assert.rejects(service.read({}, 'account-a', referenced), error => error.status === 500 && /不完整/.test(error.message));
});
