import { HttpError } from '../validation.js';
import { ASSET_CHUNK_BYTES } from '../repositories/asset-repository.js';

export const ASSET_PRUNE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const ASSET_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING_CHUNKS = 16;
const MIME_PREFIX_BYTES = 12;

function detectMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0, 6)))) return 'image/gif';
  if (new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value || []);
}

function assetReferences(serialized, target = new Set()) {
  const pattern = /\/api\/assets\/([a-f0-9-]{36})(?:\?download=1)?/gi;
  for (const match of String(serialized || '').matchAll(pattern)) target.add(match[1].toLowerCase());
  return target;
}

/** Coordinates account-scoped attachment use cases with bounded-memory chunk IO. */
export function createAssetService(repository, { now = Date.now, createId = () => crypto.randomUUID() } = {}) {
  async function list(db, accountId) {
    await repository.deleteExpiredAccountAssetUploads(db, accountId, now() - ASSET_UPLOAD_TTL_MS);
    const { results } = await repository.listAccountAssets(db, accountId);
    return results;
  }

  async function create(db, accountId, name, stream) {
    if (typeof name !== 'string' || !name || name.length > 200) throw new HttpError(400, '文件名太长');
    const reader = stream?.getReader?.();
    if (!reader) throw new HttpError(400, '文件为空');

    const id = createId(), created = now();
    let size = 0;
    let ordinal = 0;
    let buffered = 0;
    let chunk = new Uint8Array(ASSET_CHUNK_BYTES);
    const prefix = new Uint8Array(MIME_PREFIX_BYTES);
    let prefixSize = 0;
    let pending = [];

    async function flushChunk() {
      pending.push({ ordinal: ordinal++, bytes: chunk.slice(0, buffered) });
      buffered = 0;
      chunk = new Uint8Array(ASSET_CHUNK_BYTES);
      if (pending.length >= MAX_PENDING_CHUNKS) {
        await repository.appendAccountAssetUploadChunks(db, accountId, id, pending, now());
        pending = [];
      }
    }

    try {
      await repository.deleteExpiredAccountAssetUploads(db, accountId, created - ASSET_UPLOAD_TTL_MS);
      await repository.beginAccountAssetUpload(db, { accountId, id, name, created });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = asBytes(value);
        if (!bytes.length) continue;
        size += bytes.length;
        if (!Number.isSafeInteger(size)) throw new HttpError(413, '文件超出当前运行环境可处理的大小');
        if (prefixSize < MIME_PREFIX_BYTES) {
          const count = Math.min(MIME_PREFIX_BYTES - prefixSize, bytes.length);
          prefix.set(bytes.subarray(0, count), prefixSize);
          prefixSize += count;
        }

        let offset = 0;
        while (offset < bytes.length) {
          const count = Math.min(ASSET_CHUNK_BYTES - buffered, bytes.length - offset);
          chunk.set(bytes.subarray(offset, offset + count), buffered);
          buffered += count;
          offset += count;
          if (buffered === ASSET_CHUNK_BYTES) await flushChunk();
        }
      }
      if (!size) throw new HttpError(400, '文件为空');
      if (buffered) await flushChunk();
      if (pending.length) await repository.appendAccountAssetUploadChunks(db, accountId, id, pending, now());

      const mime = detectMime(prefix.subarray(0, prefixSize));
      await repository.finalizeAccountAssetUpload(db, { accountId, id, name, mime, size, created });
      return { id, name, mime, size, created };
    } catch (error) {
      await reader.cancel().catch(() => {});
      await repository.deleteAccountAssetUpload(db, accountId, id).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
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
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 1) throw new HttpError(500, '附件数据不完整');

    let ordinal = 0;
    let sent = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (sent === metadata.size) {
          controller.close();
          return;
        }
        try {
          const row = await repository.getAccountAssetChunk(db, accountId, id, ordinal);
          if (!row) throw new HttpError(500, '附件数据不完整');
          const bytes = asBytes(row.data);
          const expected = Math.min(ASSET_CHUNK_BYTES, metadata.size - sent);
          if (bytes.byteLength !== expected) throw new HttpError(500, '附件数据不完整');
          sent += bytes.byteLength;
          ordinal += 1;
          controller.enqueue(bytes);
          if (sent === metadata.size) controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });
    return { stream, mime: metadata.mime, name: metadata.name, size: metadata.size };
  }

  return { list, create, prune, read };
}
