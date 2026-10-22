const CHUNK_BYTES = 256 * 1024;
export const ASSET_CHUNK_BYTES = CHUNK_BYTES;

export function listAccountAssets(db, accountId) {
  return db.prepare('SELECT id, name, mime, size, created FROM account_assets WHERE account_id = ? AND complete = 1 ORDER BY created DESC')
    .bind(accountId).all();
}

export function beginAccountAssetUpload(db, { accountId, id, name, created }) {
  return db.prepare(`INSERT INTO account_assets(account_id, id, name, mime, size, created, complete)
    VALUES (?, ?, ?, 'application/octet-stream', 0, ?, 0)`).bind(accountId, id, name, created).run();
}

export function appendAccountAssetUploadChunks(db, accountId, id, chunks, updated = Date.now()) {
  if (!chunks.length) return Promise.resolve();
  return db.batch([...chunks.map(({ ordinal, bytes }) => db.prepare(
    'INSERT INTO account_asset_chunks(account_id, asset_id, ordinal, data) VALUES (?, ?, ?, ?)'
  ).bind(accountId, id, ordinal, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))),
  db.prepare('UPDATE account_assets SET created = ? WHERE account_id = ? AND id = ? AND complete = 0').bind(updated, accountId, id)]);
}

export async function finalizeAccountAssetUpload(db, { accountId, id, name, mime, size, created }) {
  const upload = await db.prepare('SELECT name FROM account_assets WHERE account_id = ? AND id = ? AND complete = 0')
    .bind(accountId, id).first();
  const chunks = await db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes
    FROM account_asset_chunks WHERE account_id = ? AND asset_id = ?`).bind(accountId, id).first();
  if (!upload || upload.name !== name || Number(chunks?.bytes) !== size || Number(chunks?.count) !== Math.ceil(size / CHUNK_BYTES)) {
    throw new Error('Incomplete attachment upload');
  }
  const result = await db.prepare(`UPDATE account_assets SET mime = ?, size = ?, created = ?, complete = 1
    WHERE account_id = ? AND id = ? AND complete = 0`).bind(mime, size, created, accountId, id).run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new Error('Incomplete attachment upload');
  return result;
}

export function deleteAccountAssetUpload(db, accountId, id) {
  return db.prepare('DELETE FROM account_assets WHERE account_id = ? AND id = ? AND complete = 0').bind(accountId, id).run();
}

export function deleteExpiredAccountAssetUploads(db, accountId, olderThan) {
  return db.prepare('DELETE FROM account_assets WHERE account_id = ? AND complete = 0 AND created < ?').bind(accountId, olderThan).run();
}

export function findAccountAsset(db, accountId, id) {
  return db.prepare('SELECT id, name, mime, size, created FROM account_assets WHERE account_id = ? AND id = ? AND complete = 1').bind(accountId, id).first();
}

export function getAccountAssetChunk(db, accountId, id, ordinal) {
  return db.prepare('SELECT data FROM account_asset_chunks WHERE account_id = ? AND asset_id = ? AND ordinal = ?')
    .bind(accountId, id, ordinal).first();
}

export async function findAssetPruneCandidates(db, accountId) {
  const [vault, snapshots, assets] = await Promise.all([
    db.prepare('SELECT data FROM account_vaults WHERE account_id = ?').bind(accountId).first(),
    db.prepare('SELECT data FROM account_snapshots WHERE account_id = ?').bind(accountId).all(),
    db.prepare('SELECT id, size, created FROM account_assets WHERE account_id = ? AND complete = 1').bind(accountId).all()
  ]);
  return { vaultData: vault?.data, snapshots: snapshots.results, assets: assets.results };
}

export function deleteAccountAssets(db, accountId, assetIds) {
  if (!assetIds.length) return Promise.resolve();
  return db.batch(assetIds.map(id => db.prepare('DELETE FROM account_assets WHERE account_id = ? AND id = ?').bind(accountId, id)));
}
