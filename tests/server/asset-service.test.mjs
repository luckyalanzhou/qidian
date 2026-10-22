import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_CHUNK_BYTES } from '../../server/repositories/asset-repository.js';
import { ASSET_PRUNE_GRACE_MS, createAssetService } from '../../server/application/asset-service.js';

const referenced = '11111111-1111-4111-8111-111111111111';
const historical = '22222222-2222-4222-8222-222222222222';
const orphan = '33333333-3333-4333-8333-333333333333';

function byteStream(bytes) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

test('asset service stores streamed chunks and reads them back without assembling the file', async () => {
  const calls = [], chunks = new Map();
  const repository = {
    deleteExpiredAccountAssetUploads: async (_db, accountId, cutoff) => calls.push(['expire', accountId, cutoff]),
    listAccountAssets: async (_db, accountId) => ({ results: [{ id:referenced, accountId }] }),
    beginAccountAssetUpload: async (_db, upload) => calls.push(['begin', upload]),
    appendAccountAssetUploadChunks: async (_db, accountId, id, incoming) => {
      calls.push(['append', accountId, id, incoming.map(({ ordinal, bytes }) => [ordinal, bytes.length])]);
      for (const { ordinal, bytes } of incoming) chunks.set(ordinal, bytes);
    },
    finalizeAccountAssetUpload: async (_db, metadata) => calls.push(['finalize', metadata]),
    deleteAccountAssetUpload: async (_db, accountId, id) => calls.push(['delete-upload', accountId, id]),
    findAccountAsset: async (_db, accountId, id) => ({ id, accountId, name:'pixel.png', mime:'image/png', size:4 }),
    getAccountAssetChunk: async (_db, _accountId, _id, ordinal) => ({ data:chunks.get(ordinal) })
  };
  const service = createAssetService(repository, { now:() => 765, createId:() => referenced });
  const bytes = new Uint8Array([0x89,0x50,0x4e,0x47]);

  assert.deepEqual(await service.list({}, 'account-a'), [{ id:referenced, accountId:'account-a' }]);
  assert.deepEqual(await service.create({}, 'account-a', 'pixel.png', byteStream(bytes)), {
    id:referenced, name:'pixel.png', mime:'image/png', size:4, created:765
  });
  const read = await service.read({}, 'account-a', referenced);
  assert.equal(read.size, 4);
  assert.deepEqual(new Uint8Array(await new Response(read.stream).arrayBuffer()), bytes);
  assert.deepEqual(calls.slice(0, 3), [
    ['expire', 'account-a', 765 - 24 * 60 * 60 * 1000],
    ['expire', 'account-a', 765 - 24 * 60 * 60 * 1000],
    ['begin', { accountId:'account-a', id:referenced, name:'pixel.png', created:765 }]
  ]);
  assert.deepEqual(calls[3], ['append','account-a',referenced,[[0,4]]]);
  assert.deepEqual(calls[4], ['finalize',{ accountId:'account-a', id:referenced, name:'pixel.png', mime:'image/png', size:4, created:765 }]);
});

test('asset upload uses a fixed memory buffer while accepting a file larger than 8 MiB', async () => {
  const data = new Uint8Array(8 * 1024 * 1024 + 1).fill(37);
  let maxBatchBytes = 0, uploadedBytes = 0, finalized;
  const service = createAssetService({
    deleteExpiredAccountAssetUploads: async () => {},
    beginAccountAssetUpload: async () => {},
    appendAccountAssetUploadChunks: async (_db, _accountId, _id, chunks) => {
      const bytes = chunks.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
      maxBatchBytes = Math.max(maxBatchBytes, bytes);
      uploadedBytes += bytes;
    },
    finalizeAccountAssetUpload: async (_db, asset) => { finalized = asset; },
    deleteAccountAssetUpload: async () => {}
  }, { now:() => 20, createId:() => referenced });

  const asset = await service.create({}, 'account-a', 'large.bin', new ReadableStream({
    start(controller) {
      for (let offset=0; offset<data.length; offset+=64*1024) controller.enqueue(data.subarray(offset, offset+64*1024));
      controller.close();
    }
  }));
  assert.equal(asset.size,data.length);
  assert.equal(uploadedBytes,data.length);
  assert.ok(maxBatchBytes <= 16 * ASSET_CHUNK_BYTES,'database write batches stay bounded independently of total file size');
  assert.equal(finalized.size,data.length);
});

test('failed or empty uploads are removed from staging', async () => {
  const deleted=[];
  const service=createAssetService({
    deleteExpiredAccountAssetUploads:async()=>{},
    beginAccountAssetUpload:async()=>{},
    appendAccountAssetUploadChunks:async()=>{throw Error('disk full')},
    finalizeAccountAssetUpload:async()=>{},
    deleteAccountAssetUpload:async(_db,accountId,id)=>deleted.push([accountId,id])
  },{createId:()=>referenced});
  await assert.rejects(service.create({},'account-a','a.bin',byteStream(new Uint8Array([1]))),/disk full/);
  await assert.rejects(service.create({},'account-a','empty.bin',byteStream(new Uint8Array())),error=>error.status===400);
  assert.deepEqual(deleted,[['account-a',referenced],['account-a',referenced]]);
});

test('asset pruning preserves current and historical references and removes only old orphans', async () => {
  let deletion;
  const now = ASSET_PRUNE_GRACE_MS * 10;
  const service = createAssetService({
    findAssetPruneCandidates: async (_db, accountId) => ({
      vaultData: `note image /api/assets/${referenced}`,
      snapshots: [{ data: `historical /api/assets/${historical}?download=1` }],
      assets: [
        { id:referenced, size:10, created:now - ASSET_PRUNE_GRACE_MS - 1 },
        { id:historical, size:20, created:now - ASSET_PRUNE_GRACE_MS - 1 },
        { id:orphan, size:30, created:now - ASSET_PRUNE_GRACE_MS - 1 }
      ]
    }),
    deleteAccountAssets: async (db, accountId, ids) => { deletion = { accountId, ids }; }
  }, { now:() => now });

  assert.deepEqual(await service.prune({}, 'account-a'), { removed:1, bytes:30 });
  assert.deepEqual(deletion,{ accountId:'account-a', ids:[orphan] });
});

test('asset read rejects missing metadata and incomplete chunks', async () => {
  const service=createAssetService({
    deleteExpiredAccountAssetUploads:async()=>{},
    findAccountAsset:async(_db,_accountId,id)=>id===referenced?{id,name:'a.bin',mime:'application/octet-stream',size:1}:null,
    getAccountAssetChunk:async()=>({data:new Uint8Array([1,2])})
  });
  await assert.rejects(service.read({},'account-a',orphan),error=>error.status===404);
  const corrupt=await service.read({},'account-a',referenced);
  await assert.rejects(new Response(corrupt.stream).arrayBuffer(),error=>error.status===500&&/不完整/.test(error.message));
});
