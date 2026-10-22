import { createBackupArchive, parseBackupArchive, type BackupAssetMetadata, type BackupArchiveAsset } from './backup-archive.ts';
import { createBackupArchiveInWorker, parseBackupArchiveInWorker } from './backup-archive-worker-client.ts';

type BackupVault = { notes: Array<{ body: string; [key: string]: unknown }>; [key: string]: unknown };
type BackupFile = Pick<File, 'name' | 'arrayBuffer'>;
type BackupServiceAsset = BackupAssetMetadata;

function rewriteBodyAssetReference(value: unknown, source: string, replacement: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) rewriteBodyAssetReference(item, source, replacement);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'body' && typeof child === 'string') {
      (value as Record<string, unknown>)[key] = child.replaceAll(source, replacement);
    } else rewriteBodyAssetReference(child, source, replacement);
  }
}

export type BackupDataServiceDependencies<TVault extends BackupVault> = {
  dev: boolean;
  getRevision: () => number;
  flush: () => Promise<boolean>;
  getLastError: () => string;
  listAssets: () => Promise<BackupServiceAsset[]>;
  getAssetResponse: (id: string) => Promise<Response>;
  upload: (file: File) => Promise<{ url: string }>;
  validateVault: (value: unknown) => TVault;
  download: (blob: Blob, name: string) => void;
  listSnapshots: () => Promise<unknown>;
  createSnapshot: () => Promise<unknown>;
  getSnapshot: (id: string | number) => Promise<{ data: unknown }>;
  now?: () => number;
  date?: () => string;
};

export function createBackupDataService<TVault extends BackupVault>(dependencies: BackupDataServiceDependencies<TVault>) {
  async function exportBackup(data: TVault) {
    if (!await dependencies.flush()) throw Error(dependencies.getLastError() || '当前修改尚未写入 Docker 服务端，暂不能生成一致备份');
    const metadata = dependencies.dev ? [] : await dependencies.listAssets();
    const exportedAt = new Date().toISOString();
    const assets: BackupArchiveAsset[] = [];
    for (const asset of metadata) {
      const bytes = new Uint8Array(await (await dependencies.getAssetResponse(asset.id)).arrayBuffer());
      assets.push({ ...asset, bytes });
    }
    const archive = await createBackupArchiveInWorker(data, assets, exportedAt) || createBackupArchive(data, assets, exportedAt);
    const date = dependencies.date?.() || new Date().toLocaleDateString('sv-SE');
    const blobBuffer = archive.buffer instanceof ArrayBuffer && archive.byteOffset === 0 && archive.byteLength === archive.buffer.byteLength
      ? archive.buffer
      : new Uint8Array(archive).buffer as ArrayBuffer;
    dependencies.download(new Blob([blobBuffer], { type: 'application/zip' }), `栖点-完整备份-${date}.zip`);
  }

  async function readBackup(file: BackupFile): Promise<TVault> {
    const bytes = await file.arrayBuffer();
    const parsed = await parseBackupArchiveInWorker(file.name, bytes)
      || parseBackupArchive(file.name, new Uint8Array(bytes), dependencies.validateVault);
    const data = dependencies.validateVault(parsed.data);
    const { assets, assetBytes } = parsed;
    if (assets.length && dependencies.dev) throw Error('含附件的备份须在 SQLite 完整预览模式导入');
    const existing = dependencies.dev ? [] : await dependencies.listAssets();
    const existingById = new Map(existing.map(asset => [asset.id, asset]));
    for (const asset of assets) {
      const bytes = assetBytes[asset.id];
      const found = existingById.get(asset.id);
      let same = false;
      if (found && found.size === asset.size) {
        const stored = new Uint8Array(await (await dependencies.getAssetResponse(asset.id)).arrayBuffer());
        same = stored.length === bytes.length && stored.every((value, index) => value === bytes[index]);
      }
      if (same) continue;
      const fileBytes = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(fileBytes).set(bytes);
      const created = await dependencies.upload(new File([fileBytes], asset.name));
      rewriteBodyAssetReference(data, `/api/assets/${asset.id}`, created.url);
    }
    return data;
  }

  async function createBackupSnapshot() {
    if (dependencies.dev) return { revision: dependencies.getRevision(), created: dependencies.now?.() ?? Date.now() };
    return dependencies.createSnapshot();
  }

  async function getBackup(id: string | number) {
    return (await dependencies.getSnapshot(id)).data;
  }

  return {
    exportBackup,
    readBackup,
    listBackups: () => dependencies.dev ? Promise.resolve([]) : dependencies.listSnapshots(),
    createBackupSnapshot,
    getBackup
  };
}
