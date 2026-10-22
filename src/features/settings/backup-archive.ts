import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type BackupAssetMetadata = {
  id: string;
  name: string;
  size: number;
  [key: string]: unknown;
};

export type BackupArchiveAsset = BackupAssetMetadata & { bytes: Uint8Array };

export type ParsedBackupArchive<T> = {
  data: T;
  assets: BackupAssetMetadata[];
  assetBytes: Record<string, Uint8Array>;
};

const ASSET_ID = /^[a-f0-9-]{36}$/;
const MAX_ARCHIVE_ENTRIES = 10_002;

export function validateBackupArchiveAssets(assets: BackupAssetMetadata[]) {
  if (assets.length > MAX_ARCHIVE_ENTRIES - 2) throw Error('附件清单无效');
  const seen = new Set<string>();
  for (const asset of assets) {
    if (!ASSET_ID.test(asset.id) || typeof asset.name !== 'string' || !Number.isSafeInteger(asset.size) || asset.size < 1 || seen.has(asset.id)) {
      throw Error('附件清单无效');
    }
    seen.add(asset.id);
  }
}

export function createBackupArchive(data: unknown, assets: BackupArchiveAsset[], exportedAt = new Date().toISOString()) {
  const metadata = assets.map(({ bytes, ...asset }) => asset);
  validateBackupArchiveAssets(metadata);
  const files: Record<string, Uint8Array> = {
    'vault.json': strToU8(JSON.stringify({ version: 2, exportedAt, ...(data as object) }))
  };
  const manifest: BackupAssetMetadata[] = metadata;

  for (const asset of assets) {
    if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength !== asset.size) throw Error('附件数据不完整');
    files[`assets/${asset.id}`] = asset.bytes;
  }

  files['assets.json'] = strToU8(JSON.stringify(manifest));
  // Store without compression: minimizes CPU/memory for already compressed images.
  return zipSync(files, { level: 0 });
}

export function parseBackupArchive<T>(filename: string, bytes: Uint8Array, validateVault: (value: unknown) => T): ParsedBackupArchive<T> {
  if (!filename.toLowerCase().endsWith('.zip')) {
    return { data: validateVault(JSON.parse(strFromU8(bytes))), assets: [], assetBytes: {} };
  }

  // Restrict archive structure and entry count without imposing a file-size quota.
  let entryCount = 0;
  const files = unzipSync(bytes, { filter(entry) {
    if (!['vault.json', 'assets.json'].includes(entry.name) && !/^assets\/[a-f0-9-]{36}$/.test(entry.name)) throw Error('备份包含未知文件');
    if (++entryCount > MAX_ARCHIVE_ENTRIES) throw Error('备份包含过多文件');
    return true;
  } });

  if (!files['vault.json'] || !files['assets.json']) throw Error('备份结构不完整');
  const data = validateVault(JSON.parse(strFromU8(files['vault.json'])));
  const parsedManifest: unknown = JSON.parse(strFromU8(files['assets.json']));
  if (!Array.isArray(parsedManifest)) throw Error('附件清单无效');

  const assets: BackupAssetMetadata[] = [];
  const assetBytes: Record<string, Uint8Array> = {};
  for (const value of parsedManifest) {
    if (!value || typeof value !== 'object') throw Error('附件清单无效');
    const asset = value as Partial<BackupAssetMetadata>;
    if (typeof asset.id !== 'string' || !ASSET_ID.test(asset.id) || typeof asset.name !== 'string' ||
      !Number.isSafeInteger(asset.size) || (asset.size as number) < 1) {
      throw Error('附件清单无效');
    }
    const content = files[`assets/${asset.id}`];
    if (!content || content.byteLength !== asset.size) throw Error('备份附件缺失或长度不符');
    assets.push(asset as BackupAssetMetadata);
    assetBytes[asset.id] = content;
  }
  validateBackupArchiveAssets(assets);
  if (Object.keys(files).length !== entryCount) throw Error('备份包含重复条目');
  if (Object.keys(files).length !== assets.length + 2) throw Error('备份包含未声明的附件');

  return { data, assets, assetBytes };
}
