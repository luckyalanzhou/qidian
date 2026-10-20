import { createApp } from 'vue';
import { pinia } from '../stores/pinia';
import VueFeatures from './VueFeatures.vue';
import { useBookmarkStore } from '../features/bookmarks/store';
import { useCaptureDialogStore } from '../features/capture/capture-dialog-store';
import { useCreateMenuStore } from '../features/create-menu/store';
import { useDashboardStore } from '../features/dashboard/store';
import { useNavigationStore } from '../features/navigation/store';
import { useSidebarStore } from '../features/navigation/sidebar-store';
import { useNoteListStore } from '../features/notes/store';
import { useNoteTypeDialogStore } from '../features/notes/type-dialog-store';
import { useTrashStore } from '../features/trash/store';
import { useReaderStore } from '../features/reader/store';
import { useReaderActionsStore } from '../features/reader/reader-actions-store';
import { useEditorStore } from '../features/editor/store';
import { useEditorPageActionsStore } from '../features/editor/editor-page-actions-store';
import { useSyncConflictStore } from '../features/sync/store';
import { useVaultStore } from '../features/vault/store';
import { useWorkspaceShellStore } from '../features/navigation/workspace-shell-store';
import { useNavigationActionsStore } from '../features/navigation/navigation-actions-store';
import { useWorkspaceShellActionsStore } from '../features/navigation/workspace-shell-actions-store';
import { useCommandPaletteStore } from '../features/command-palette/store';
import { useGlobalSearchStore } from '../features/search/store';
import { useToastStore } from '../features/notifications/store';
import { useAppSettingsStore } from '../features/settings/app-settings-store';
import { useProfileSettingsStore } from '../features/account/profile-settings-store';
import { useBackupHistoryStore } from '../features/settings/backup-history-store';

export { pinia };
export const workspaceNavigationStore = useNavigationStore(pinia);
export const workspaceShellStore = useWorkspaceShellStore(pinia);
export const navigationActionsStore = useNavigationActionsStore(pinia);
export const workspaceShellActionsStore = useWorkspaceShellActionsStore(pinia);
export const commandPaletteStore = useCommandPaletteStore(pinia);
export const globalSearchDataStore = useGlobalSearchStore(pinia);
export const notificationDataStore = useToastStore(pinia);
export const appSettingsStore = useAppSettingsStore(pinia);
export const profileSettingsStore = useProfileSettingsStore(pinia);
export const backupHistoryStore = useBackupHistoryStore(pinia);
export const sidebarDataStore = useSidebarStore(pinia);
export const bookmarkDataStore = useBookmarkStore(pinia);
export const captureDialogStore = useCaptureDialogStore(pinia);
export const createMenuStore = useCreateMenuStore(pinia);
export const syncConflictStore = useSyncConflictStore(pinia);
export const editorDataStore = useEditorStore(pinia);
export const editorPageActionsStore = useEditorPageActionsStore(pinia);
export const vaultDataStore = useVaultStore(pinia);
export const dashboardDataStore = useDashboardStore(pinia);
export const noteListDataStore = useNoteListStore(pinia);
export const noteTypeDialogStore = useNoteTypeDialogStore(pinia);
export const trashDataStore = useTrashStore(pinia);
export const readerDataStore = useReaderStore(pinia);
export const readerActionsStore = useReaderActionsStore(pinia);

let workspaceApp: ReturnType<typeof createApp> | null = null;
export let workspaceAppMounted = false;

export function mountWorkspaceApp(root: Element | null = document.querySelector('#qidianVueIslands')) {
  if (!root) return false;
  if (workspaceApp) return true;

  const app = createApp(VueFeatures);
  app.use(pinia);
  app.mount(root);
  workspaceApp = app;
  workspaceAppMounted = true;
  return true;
}
