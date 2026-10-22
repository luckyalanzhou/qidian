import { HttpError, MAX_FILE_BYTES } from '../validation.js';

export const ASSET_PRUNE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function detectMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0, 6)))) return 'image/gif';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

function assetReferences(serialized, target = new Set()) {
  const pattern = /\/api\/assets\/([a-f0-9-]{36})(?:\?download=1)?/gi;
  for (const match of String(serialized || '').matchAll(pattern)) target.add(match[1].toLowerCase());
  return target;
}

/** Coordinates account-scoped attachment use cases independently of HTTP. */
export function createAssetService(repository, { now = Date.now, createId = () => crypto.randomUUID() } = {}) {
  async function list(db, accountId) {
    const { results } = await repository.listAccountAssets(db, accountId);
    return results;
  }

  async function create(db, accountId, name, bytes) {
    if (typeof name !== 'string' || !name || name.length > 200) throw new HttpError(400, '文件名太长');
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new HttpError(400, '文件为空');
    if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, '单个文件上限为 8 MB');

    const asset = { accountId, id: createId(), name, mime: detectMime(bytes), size: bytes.length, created: now(), bytes };
    try {
      await repository.saveAccountAsset(db, asset);
    } catch (error) {
      if (String(error).includes('ASSET_QUOTA')) throw new HttpError(413, '此账号附件总容量已达 100 MB，请先导出整理');
      throw error;
    }
    return { id: asset.id, name: asset.name, mime: asset.mime, size: asset.size, created: asset.created };
  }

  async function prune(db, accountId) {
    const { vaultData, snapshots, assets } = await repository.findAssetPruneCandidates(db, accountId);
    const referenced = assetReferences(vaultData);
    for (const snapshot of snapshots) assetReferences(snapshot.data, referenced);
    const cutoff = now() - ASSET_PRUNE_GRACE_MS;
    const unused = assets.filter(asset => !referenced.has(String(asset.id).toLowerCase()) &&
      Number.isSafeInteger(asset.created) && asset.created <= cutoff);
    await repository.deleteAccountAssets(db, accountId, unused.map(asset => asset.id));
    return { removed: unused.length, bytes: unused.reduce((total, asset) => total + Number(asset.size || 0), 0) };
  }

  async function read(db, accountId, id) {
    const metadata = await repository.findAccountAsset(db, accountId, id);
    if (!metadata) throw new HttpError(404, '附件不存在');
    const { results } = await repository.listAccountAssetChunks(db, accountId, id);
    const bytes = new Uint8Array(metadata.size);
    let offset = 0;
    for (const part of results) {
      const chunk = new Uint8Array(part.data);
      if (offset + chunk.length > bytes.length) throw new HttpError(500, '附件数据不完整');
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== bytes.length) throw new HttpError(500, '附件数据不完整');
    return { bytes, mime: metadata.mime, name: metadata.name };
  }

  return { list, create, prune, read };
}
