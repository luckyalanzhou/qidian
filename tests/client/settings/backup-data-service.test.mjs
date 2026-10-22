import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupArchive, parseBackupArchive } from '../../../src/features/settings/backup-archive.ts';
import { createBackupDataService } from '../../../src/features/settings/backup-data-service.ts';

const id = '123e4567-e89b-12d3-a456-426614174000';
const content = new Uint8Array([9, 8, 7]);
const vault = { notes: [{ id: 'n1', body: `<p><img src="/api/assets/${id}"></p>` }], trash: [] };

function harness(options = {}) {
  const events = [];
  const service = createBackupDataService({
    dev: options.dev ?? false,
    getRevision: () => 8,
    flush: async () => { events.push('flush'); return options.flush ?? true; },
    getLastError: () => '同步失败',
    listAssets: async () => { events.push('list-assets'); return options.assets || []; },
    getAssetResponse: async assetId => { events.push(`read-asset:${assetId}`); return new Response(options.storedBytes || content); },
    upload: async file => { events.push(`upload:${file.name}`); return { url: '/api/assets/reuploaded' }; },
    validateVault: value => value,
    download: (blob, name) => events.push(['download', blob, name]),
    listSnapshots: async () => { events.push('list-snapshots'); return [{ revision: 8 }]; },
    createSnapshot: async () => { events.push('create-snapshot'); return { revision: 9 }; },
    getSnapshot: async revision => { events.push(`get-snapshot:${revision}`); return { data: vault }; },
    now: () => 123,
    date: () => '2026-10-19'
  });
  return { service, events };
}

function zipFile(data = vault, bytes = content) {
  const archive = createBackupArchive(data, [{ id, name: 'image.bin', size: bytes.length, bytes }]);
  return { name: 'backup.zip', size: archive.length, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) };
}

test('export flushes pending cloud writes and downloads a complete archive', async () => {
  const h = harness({ assets: [{ id, name: 'image.bin', size: content.length }] });
  await h.service.exportBackup(vault);

  const download = h.events.find(event => Array.isArray(event) && event[0] === 'download');
  assert.ok(download);
  assert.equal(download[2], '栖点-完整备份-2026-10-19.zip');
  assert.deepEqual(h.events.filter(event => typeof event === 'string'), ['flush', 'list-assets', `read-asset:${id}`]);
  const archived = new Uint8Array(await download[1].arrayBuffer());
  const parsed = parseBackupArchive('backup.zip', archived, value => value);
  assert.deepEqual(parsed.data.notes, vault.notes);
  assert.deepEqual(parsed.assetBytes[id], content);
});

test('export refuses a backup while the cloud save queue has an error', async () => {
  const h = harness({ flush: false });
  await assert.rejects(h.service.exportBackup(vault), /同步失败/);
  assert.deepEqual(h.events, ['flush']);
});

test('import does not reject a backup based on the former 130 MiB file-size cap', async () => {
  const h = harness();
  const bytes = new TextEncoder().encode(JSON.stringify(vault));
  const restored = await h.service.readBackup({
    name: 'vault.json',
    size: 130 * 1024 * 1024 + 1,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  });
  assert.deepEqual(restored, vault);
});

test('import reuses an identical stored attachment without uploading a duplicate', async () => {
  const h = harness({ assets: [{ id, name: 'image.bin', size: content.length }] });
  const restored = await h.service.readBackup(zipFile());

  assert.match(restored.exportedAt, /^2026-/);
  assert.deepEqual(restored, { ...vault, version: 2, exportedAt: restored.exportedAt });
  assert.deepEqual(h.events, ['list-assets', `read-asset:${id}`]);
});

test('import uploads changed attachment bytes and rewrites references in the restored notes', async () => {
  const h = harness({ assets: [{ id, name: 'image.bin', size: content.length }], storedBytes: new Uint8Array([0, 0, 0]) });
  const data = {
    ...vault,
    notes: [{ ...vault.notes[0], publishedSnapshot: { body: `<img src="/api/assets/${id}">` } }],
    trash: [{ kind: 'note', item: { body: `<img src="/api/assets/${id}">`, publishedSnapshot: { body: `<img src="/api/assets/${id}">` } } }]
  };
  const restored = await h.service.readBackup(zipFile(data));

  assert.match(restored.notes[0].body, /\/api\/assets\/reuploaded/);
  assert.match(restored.notes[0].publishedSnapshot.body, /\/api\/assets\/reuploaded/);
  assert.match(restored.trash[0].item.body, /\/api\/assets\/reuploaded/);
  assert.match(restored.trash[0].item.publishedSnapshot.body, /\/api\/assets\/reuploaded/);
  assert.deepEqual(h.events, ['list-assets', `read-asset:${id}`, 'upload:image.bin']);
});

test('local preview supports JSON imports and local history stubs but rejects ZIP attachments', async () => {
  const h = harness({ dev: true });
  const localHistory = await h.service.createBackupSnapshot();
  assert.deepEqual(localHistory, { revision: 8, created: 123 });
  assert.deepEqual(await h.service.listBackups(), []);
  assert.deepEqual(await h.service.getBackup(3), vault);
  await assert.rejects(h.service.readBackup(zipFile()), /SQLite 完整预览模式/);
  assert.deepEqual(await h.service.readBackup({ name: 'vault.json', size: 10, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(vault)).buffer }), vault);
  assert.equal(h.events.includes('list-snapshots'), false);
  assert.equal(h.events.includes('create-snapshot'), false);
});
