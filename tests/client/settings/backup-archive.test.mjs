import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { createBackupArchive, parseBackupArchive, validateBackupArchiveAssets } from '../../../src/features/settings/backup-archive.ts';

const assetId = '123e4567-e89b-12d3-a456-426614174000';
const vault = { notes: [{ id: 'n1', title: '备份测试', body: `<img src="/api/assets/${assetId}">` }], trash: [] };
const validate = value => {
  if (!value || !Array.isArray(value.notes)) throw Error('知识库结构无效');
  return value;
};

test('full backup archive round-trips the vault, attachment manifest, and attachment bytes', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const archive = createBackupArchive(vault, [{ id: assetId, name: '图片.png', mime: 'image/png', size: bytes.length, created: 12, bytes }], '2026-10-19T00:00:00.000Z');
  const parsed = parseBackupArchive('qidian.zip', archive, validate);

  assert.deepEqual(parsed.data, { ...vault, version: 2, exportedAt: '2026-10-19T00:00:00.000Z' });
  assert.deepEqual(parsed.assets, [{ id: assetId, name: '图片.png', mime: 'image/png', size: 4, created: 12 }]);
  assert.deepEqual(parsed.assetBytes[assetId], bytes);
});

test('legacy JSON vault backups remain supported without attachments', () => {
  const parsed = parseBackupArchive('vault.JSON', strToU8(JSON.stringify(vault)), validate);
  assert.deepEqual(parsed.data, vault);
  assert.deepEqual(parsed.assets, []);
  assert.deepEqual(parsed.assetBytes, {});
});

test('backup archive rejects paths outside the documented format', () => {
  const archive = zipSync({ 'vault.json': strToU8(JSON.stringify(vault)), 'assets.json': strToU8('[]'), '../notes.txt': strToU8('unexpected') });
  assert.throws(() => parseBackupArchive('backup.zip', archive, validate), /未知文件/);
});

test('backup archive rejects missing attachment data and malformed manifests', () => {
  const missing = zipSync({
    'vault.json': strToU8(JSON.stringify(vault)),
    'assets.json': strToU8(JSON.stringify([{ id: assetId, name: 'missing.png', size: 3 }]))
  });
  assert.throws(() => parseBackupArchive('backup.zip', missing, validate), /附件缺失或长度不符/);

  const malformed = zipSync({
    'vault.json': strToU8(JSON.stringify(vault)),
    'assets.json': strToU8(JSON.stringify([{ id: 'invalid', name: 'bad.png', size: 1 }]))
  });
  assert.throws(() => parseBackupArchive('backup.zip', malformed, validate), /附件清单无效/);
});

test('backup archive round-trips attachments larger than the former per-file limit', () => {
  const bytes = new Uint8Array(8 * 1024 * 1024 + 1).fill(37);
  const archive = createBackupArchive(vault, [{ id: assetId, name: 'large.bin', size: bytes.byteLength, bytes }]);
  const parsed = parseBackupArchive('backup.zip', archive, validate);
  assert.equal(parsed.assetBytes[assetId].byteLength, bytes.byteLength);
  assert.deepEqual(parsed.assetBytes[assetId], bytes);
});

test('backup asset metadata permits an aggregate size above the former archive limit', () => {
  const assets = Array.from({ length: 14 }, (_, index) => ({
    id: `${assetId.slice(0, -1)}${index.toString(16)}`,
    name: `attachment-${index}.bin`,
    size: 8 * 1024 * 1024
  }));
  assert.doesNotThrow(() => validateBackupArchiveAssets(assets));
});

test('backup archive rejects undeclared attachment files', () => {
  const archive = zipSync({
    'vault.json': strToU8(JSON.stringify(vault)),
    'assets.json': strToU8('[]'),
    [`assets/${assetId}`]: new Uint8Array([1])
  }, { level: 0 });
  assert.throws(() => parseBackupArchive('backup.zip', archive, validate), /未声明的附件/);
});
