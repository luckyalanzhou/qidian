import type { VaultData, VaultNote } from '../../../shared/api-contracts.js';
import { saveNoteDraft } from '../notes/draft-actions.ts';

export type EditorDraftFields = Pick<VaultNote, 'title' | 'type' | 'category' | 'tags' | 'source' | 'body'>;

export type EditorDraftControllerDependencies = {
  getVault: () => VaultData;
  getNoteId: () => string | null;
  getEditingDraft: () => VaultNote | null;
  setEditingDraft: (note: VaultNote) => void;
  isEditing: () => boolean;
  isDraft: (note: VaultNote) => boolean;
  hasDraftContent: (note: VaultNote) => boolean;
  getBaseline: () => string | null;
  setBaseline: (value: string) => void;
  getTransientNewNoteId: () => string | null;
  clearTransientNewNote: () => void;
  createPublishedSnapshot: (note: VaultNote) => NonNullable<VaultNote['publishedSnapshot']>;
  snapshot: (note: VaultNote) => string;
  readEditorFields: () => EditorDraftFields | null;
  resetPendingPublish: () => void;
  mutateVault: <T>(operation: (vault: VaultData) => T) => T;
  persist: () => unknown;
  now?: () => number;
};

export function createEditorDraftController(dependencies: EditorDraftControllerDependencies) {
  function ensureDraft(): VaultNote {
    let note = dependencies.getEditingDraft();
    if (!note) {
      const stored = dependencies.getVault().notes.find(item => item.id === dependencies.getNoteId());
      if (!stored) throw new Error('当前笔记不存在');
      note = structuredClone(stored);
      if (!dependencies.isDraft(note) && !note.publishedSnapshot) {
        note.publishedSnapshot = dependencies.createPublishedSnapshot(note);
      }
      dependencies.setEditingDraft(note);
      dependencies.setBaseline(dependencies.snapshot(note));
    }
    return note;
  }

  function updateFromEditor() {
    const note = dependencies.getEditingDraft();
    if (!dependencies.isEditing() || !note) return;
    const fields = dependencies.readEditorFields();
    if (!fields) return;
    dependencies.resetPendingPublish();
    Object.assign(note, fields, { updated: dependencies.now?.() ?? Date.now() });
  }

  function hasChanges() {
    const note = dependencies.getEditingDraft();
    if (!dependencies.isEditing() || !note || !dependencies.getBaseline() || !dependencies.readEditorFields()) return false;
    updateFromEditor();
    return dependencies.snapshot(note) !== dependencies.getBaseline();
  }

  function saveDraft(_quiet = false) {
    const note = dependencies.getEditingDraft();
    if (!dependencies.isEditing() || !note) return true;
    if (dependencies.readEditorFields()) updateFromEditor();

    const transient = dependencies.getTransientNewNoteId() === note.id;
    const baseline = dependencies.getBaseline();
    if (!transient && baseline && dependencies.snapshot(note) === baseline
      && (!dependencies.isDraft(note) || dependencies.hasDraftContent(note))) return true;
    const unchangedNew = transient && !!baseline && dependencies.snapshot(note) === baseline;
    const result = dependencies.mutateVault(vault => saveNoteDraft(vault, note, {
        transient,
        unchangedNew,
        isDraft: dependencies.isDraft,
        hasContent: dependencies.hasDraftContent
      }));
    if (transient) dependencies.clearTransientNewNote();
    return result?.shouldPersist ? dependencies.persist() : true;
  }

  return { ensureDraft, updateFromEditor, hasChanges, saveDraft };
}
