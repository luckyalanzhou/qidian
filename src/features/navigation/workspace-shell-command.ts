export type WorkspaceShellCommand =
  | { type: 'toggle-theme-menu' }
  | { type: 'apply-theme'; theme: string }
  | { type: 'toggle-account-menu' }
  | { type: 'open-profile-settings' }
  | { type: 'open-app-settings' }
  | { type: 'sign-out' }
  | { type: 'toggle-note-types' }
  | { type: 'add-note-type' }
  | { type: 'edit-note-type'; id: string }
  | { type: 'delete-note-type'; id: string }
  | { type: 'delete-note'; id: string };

export type WorkspaceShellCommandResult = boolean | Promise<boolean>;
