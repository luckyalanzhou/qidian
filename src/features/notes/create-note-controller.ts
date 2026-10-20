import type { VaultData, VaultNote } from '../../../shared/api-contracts.js';
import { createNote } from './note-actions.ts';

export type CreateNoteContext = {
  editing: boolean;
  typeFilter: string;
  active: string;
};

export type CreateNoteControllerDependencies = {
  getContext: () => CreateNoteContext;
  getVault: () => VaultData;
  mutateVault: <T>(operation: (vault: VaultData) => T) => T;
  saveDraft: (quiet?: boolean) => unknown;
  activate: (note: VaultNote) => void;
  closeMenu: () => void;
  render: () => void;
  scrollToTop: () => void;
  focusTitle: () => void;
};

export function createNoteController(dependencies: CreateNoteControllerDependencies) {
  function create(requestedType = 'note') {
    if (dependencies.getContext().editing) dependencies.saveDraft(true);

    const { typeFilter } = dependencies.getContext();
    const vault = dependencies.getVault();
    const noteTypes = vault.noteTypes || [];
    let type = requestedType === 'note' && typeFilter !== 'all' ? typeFilter : requestedType;
    if (!noteTypes.some(item => item.id === type)) type = noteTypes[0]?.id || '';

    const note = dependencies.mutateVault(data => createNote(data, type, '未分类'));
    dependencies.activate(note);
    dependencies.closeMenu();
    dependencies.render();
    dependencies.scrollToTop();
    dependencies.focusTitle();
    return note;
  }

  return { create };
}
