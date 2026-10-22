export type BackupNote = { id: string; body?: string; [key: string]: unknown };
export type BackupVault = { notes: BackupNote[]; theme?: string; trash?: unknown[]; [key: string]: unknown };
export type BackupRevision = string | number;

export type BackupWorkflowDependencies = {
  localPreview: boolean;
  getData: () => BackupVault;
  saveActiveEditor: () => unknown | Promise<unknown>;
  confirmAction: (message: string, options: { title: string; confirmText: string; danger?: boolean }) => Promise<boolean>;
  getBackup: (revision: BackupRevision) => Promise<unknown>;
  exportBackup: (data: BackupVault) => Promise<unknown>;
  createBackupSnapshot: () => Promise<unknown>;
  readBackup: (file: File) => Promise<BackupVault>;
  validateVault: (data: BackupVault) => BackupVault;
  cleanHTML: (html: unknown, keepStyles?: boolean) => string;
  commitSave: (data: BackupVault) => Promise<unknown>;
  replaceWorkspace: (data: BackupVault, mode: 'restore' | 'import') => void;
  downloadJSON: (data: unknown, filename: string) => void;
  pruneAssets: () => Promise<unknown>;
  clearImportFile: () => void;
  notify: (message: string) => void;
};

export function createBackupWorkflows(dependencies: BackupWorkflowDependencies) {
  async function pruneAssetsWithWarning() {
    try {
      await dependencies.pruneAssets();
      return '';
    } catch (error) {
      return `，附件清理未完成：${(error as Error)?.message || '请稍后重试'}`;
    }
  }

  async function downloadSnapshot(revision: BackupRevision) {
    try {
      const snapshot = await dependencies.getBackup(revision);
      dependencies.downloadJSON(snapshot, `栖点-正文快照-${revision}.json`);
      dependencies.notify('正文快照已下载；附件请通过完整备份导出');
    } catch (error) {
      dependencies.notify(`快照下载失败：${(error as Error)?.message || '请稍后重试'}`);
    }
  }

  async function restoreSnapshot(revision: BackupRevision) {
    const destination = dependencies.localPreview ? '本地预览数据' : 'Docker 服务端';
    const confirmed = await dependencies.confirmAction(
      `将用历史版本 ${revision} 替换当前知识库。恢复前会先下载当前完整备份（含附件），之后再提交到${destination}。是否继续？`,
      { title: '恢复历史备份', confirmText: '恢复', danger: true }
    );
    if (!confirmed) return;

    try {
      const snapshot = await dependencies.getBackup(revision) as BackupVault | null;
      if (!snapshot || !Array.isArray(snapshot.notes)) throw Error('历史快照结构无效');
      await dependencies.saveActiveEditor();
      await dependencies.exportBackup(dependencies.getData());
      await dependencies.createBackupSnapshot();
      const restored = dependencies.validateVault({
        ...snapshot,
        notes: snapshot.notes.map(note => ({ ...note, body: dependencies.cleanHTML(note.body, true) })),
        trash: snapshot.trash || []
      });
      await dependencies.commitSave(restored);
      dependencies.replaceWorkspace(restored, 'restore');
      const cleanupWarning = await pruneAssetsWithWarning();
      dependencies.notify(cleanupWarning ? `历史版本已恢复${cleanupWarning}` : '历史版本已恢复');
    } catch (error) {
      dependencies.notify(`恢复未完成：${(error as Error)?.message || '请稍后重试'}`);
    }
  }

  async function exportFullBackup() {
    await dependencies.saveActiveEditor();
    const current = dependencies.getData();
    try {
      await dependencies.exportBackup(current);
      dependencies.notify('完整备份已导出，包含图片和附件');
    } catch (error) {
      dependencies.notify(`完整备份失败：${(error as Error)?.message || '请稍后重试'}`);
      dependencies.downloadJSON(current, '栖点-紧急正文草稿.json');
    }
  }

  async function importBackup(file: File | null | undefined) {
    if (!file) return;
    try {
      const destination = dependencies.localPreview ? '本地预览数据' : 'Docker 服务端';
      const confirmed = await dependencies.confirmAction(
        dependencies.localPreview
          ? '导入会替换当前知识库。继续后将先保存编辑内容并导出完整备份，是否继续？'
          : '导入会替换当前知识库。继续后将先保存编辑内容、导出完整备份并创建服务端快照，是否继续？',
        { title: '导入备份', confirmText: '继续导入', danger: true }
      );
      if (!confirmed) return;
      await dependencies.saveActiveEditor();
      await dependencies.exportBackup(dependencies.getData());
      await dependencies.createBackupSnapshot();
      const restored = await dependencies.readBackup(file);
      const candidate = dependencies.validateVault({
        ...restored,
        notes: restored.notes.map(note => ({ ...note, body: dependencies.cleanHTML(note.body, true) })),
        trash: restored.trash || []
      });
      await dependencies.commitSave(candidate);
      dependencies.replaceWorkspace(candidate, 'import');
      const cleanupWarning = await pruneAssetsWithWarning();
      dependencies.notify(`${dependencies.localPreview ? '导入完成，本地预览数据已更新' : '导入完成，知识库已更新'}${cleanupWarning}`);
    } catch (error) {
      dependencies.notify(`导入失败：${(error as Error)?.message || '请稍后重试'}`);
    } finally {
      dependencies.clearImportFile();
    }
  }

  return { downloadSnapshot, restoreSnapshot, exportFullBackup, importBackup };
}
