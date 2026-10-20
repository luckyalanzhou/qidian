import type { WorkspaceShellCommand, WorkspaceShellCommandResult } from './workspace-shell-command.ts';

export type WorkspaceShellActionDependencies = {
  closeThemeMenu: () => void;
  applyTheme: (theme: string) => void;
  toggleThemeMenu: () => void;
  closeAccountMenu: () => void;
  toggleAccountMenu: () => void;
  openProfileSettings: () => void;
  openAppSettings: () => void;
  signOut: () => void;
  closeSlashMenu: () => void;
  toggleNoteTypes: () => void;
  addNoteType: () => void;
  openTypeDialog: (mode: 'edit' | 'delete', id: string) => void;
  noteTypeCount: () => number;
  toast: (message: string) => void;
  confirmDeleteNote: (id: string) => Promise<boolean>;
  moveNoteToTrash: (id: string) => Promise<boolean>;
  render: () => void;
};

export function createWorkspaceShellActions(dependencies: WorkspaceShellActionDependencies) {
  function run(command: WorkspaceShellCommand): WorkspaceShellCommandResult {
    switch (command.type) {
      case 'toggle-theme-menu': dependencies.toggleThemeMenu(); return true;
      case 'apply-theme': dependencies.applyTheme(command.theme); dependencies.closeThemeMenu(); return true;
      case 'toggle-account-menu': dependencies.toggleAccountMenu(); return true;
      case 'open-profile-settings': dependencies.openProfileSettings(); return true;
      case 'open-app-settings': dependencies.openAppSettings(); return true;
      case 'sign-out': dependencies.signOut(); return true;
      case 'toggle-note-types': dependencies.toggleNoteTypes(); return true;
      case 'add-note-type': dependencies.addNoteType(); return true;
      case 'edit-note-type': dependencies.openTypeDialog('edit', command.id); return true;
      case 'delete-note-type':
        if (dependencies.noteTypeCount() < 2 && command.id === 'note') {
          dependencies.toast('至少保留“普通笔记”作为默认类型');
          return true;
        }
        dependencies.openTypeDialog('delete', command.id);
        return true;
      case 'delete-note':
        return dependencies.confirmDeleteNote(command.id).then(async confirmed => {
          if (confirmed && await dependencies.moveNoteToTrash(command.id)) dependencies.render();
          return true;
        });
    }
  }

  function execute(command: WorkspaceShellCommand): WorkspaceShellCommandResult {
    dependencies.closeThemeMenu();
    dependencies.closeAccountMenu();
    dependencies.closeSlashMenu();
    return run(command);
  }

  return { execute };
}
