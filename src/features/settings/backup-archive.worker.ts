import { createBackupArchive, parseBackupArchive, type BackupArchiveAsset } from './backup-archive.ts';

type ExportRequest = { id: number; type: 'export'; data: unknown; assets: BackupArchiveAsset[] };
type ImportRequest = { id: number; type: 'import'; filename: string; bytes: ArrayBuffer };
type Request = ExportRequest | ImportRequest;
type ResponseMessage = { id: number; result?: unknown; error?: string };

const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<Request>) => void): void;
  postMessage(message: ResponseMessage, transfer?: Transferable[]): void;
};

workerScope.addEventListener('message', event => {
  const request = event.data;
  try {
    if (request.type === 'export') {
      const archive = createBackupArchive(request.data, request.assets);
      workerScope.postMessage({ id: request.id, result: archive }, [archive.buffer]);
      return;
    }
    const result = parseBackupArchive(request.filename, new Uint8Array(request.bytes), value => value);
    const transfer = Object.values(result.assetBytes).map(bytes => bytes.buffer);
    workerScope.postMessage({ id: request.id, result }, transfer);
  } catch (error) {
    workerScope.postMessage({ id: request.id, error: error instanceof Error ? error.message : '备份处理失败' });
  }
});

export type { Request as BackupArchiveWorkerRequest };
