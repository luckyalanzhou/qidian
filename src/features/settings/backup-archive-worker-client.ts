import type { BackupArchiveAsset, ParsedBackupArchive } from './backup-archive.ts';
import type { BackupArchiveWorkerRequest } from './backup-archive.worker.ts';

let nextId = 0;

function runWorker<T>(request: BackupArchiveWorkerRequest, transfer: Transferable[]): Promise<T> | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./backup-archive.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++nextId;
    worker.onmessage = event => {
      const message = event.data as { id: number; result?: T; error?: string };
      if (message.id !== id) return;
      if (message.error) reject(Error(message.error));
      else resolve(message.result as T);
    };
    worker.onerror = event => reject(Error(event.message || '备份处理失败'));
    worker.onmessageerror = () => reject(Error('备份处理结果无法读取'));
    worker.postMessage({ ...request, id }, transfer);
  }).finally(() => worker.terminate());
}

export function createBackupArchiveInWorker(data: unknown, assets: BackupArchiveAsset[]) {
  const transfer = assets.map(asset => asset.bytes.buffer);
  return runWorker<Uint8Array>({ id: 0, type: 'export', data, assets }, transfer);
}

export function parseBackupArchiveInWorker(filename: string, bytes: ArrayBuffer) {
  return runWorker<ParsedBackupArchive<unknown>>({ id: 0, type: 'import', filename, bytes }, [bytes]);
}
