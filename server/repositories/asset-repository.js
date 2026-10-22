const CHUNK_BYTES = 256 * 1024;

export function listAccountAssets(db, accountId) {
  return db.prepare('SELECT id, name, mime, size, created FROM account_assets WHERE account_id = ? ORDER BY created DESC')
    .bind(accountId).all();
}

export function saveAccountAsset(db, { accountId, id, name, mime, size, created, bytes }) {
  const statements = [db.prepare('INSERT INTO account_assets(account_id, id, name, mime, size, created) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(accountId, id, name, mime, size, created)];
  for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
    statements.push(db.prepare('INSERT INTO account_asset_chunks(account_id, asset_id, ordinal, data) VALUES (?, ?, ?, ?)')
      .bind(accountId, id, offset / CHUNK_BYTES, bytes.slice(offset, offset + CHUNK_BYTES).buffer));
  }
  return db.batch(statements);
}

export function findAccountAsset(db, accountId, id) {
  return db.prepare('SELECT * FROM account_assets WHERE account_id = ? AND id = ?').bind(accountId, id).first();
}

export function listAccountAssetChunks(db, accountId, id) {
  return db.prepare('SELECT data FROM account_asset_chunks WHERE account_id = ? AND asset_id = ? ORDER BY ordinal')
    .bind(accountId, id).all();
}

export async function findAssetPruneCandidates(db, accountId) {
  const [vault, snapshots, assets] = await Promise.all([
    db.prepare('SELECT data FROM account_vaults WHERE account_id = ?').bind(accountId).first(),
    db.prepare('SELECT data FROM account_snapshots WHERE account_id = ?').bind(accountId).all(),
    db.prepare('SELECT id, size, created FROM account_assets WHERE account_id = ?').bind(accountId).all()
  ]);
  return { vaultData: vault?.data, snapshots: snapshots.results, assets: assets.results };
}

export function deleteAccountAssets(db, accountId, assetIds) {
  if (!assetIds.length) return Promise.resolve();
  return db.batch(assetIds.map(id => db.prepare('DELETE FROM account_assets WHERE account_id = ? AND id = ?').bind(accountId, id)));
}
