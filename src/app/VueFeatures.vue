<script setup lang="ts">
import ActionDialog from '../features/dialogs/ActionDialog.vue';
import SyncConflictDialog from '../features/sync/SyncConflictDialog.vue';
import ToastHost from '../features/notifications/ToastHost.vue';
import StorageCapacityWarning from '../features/storage/StorageCapacityWarning.vue';
import WorkspaceTopbarMenus from '../features/navigation/WorkspaceTopbarMenus.vue';
import WorkspaceBreadcrumb from '../features/navigation/WorkspaceBreadcrumb.vue';
import MobileDrawerControls from '../features/navigation/MobileDrawerControls.vue';
import CommandPalette from '../features/command-palette/CommandPalette.vue';
import GlobalSearchDialog from '../features/search/GlobalSearchDialog.vue';
import BookmarkPage from '../features/bookmarks/BookmarkPage.vue';
import DashboardPage from '../features/dashboard/DashboardPage.vue';
import EditorPage from '../features/editor/EditorPage.vue';
import SlashMenu from '../features/editor/SlashMenu.vue';
import NotesListPage from '../features/notes/NotesListPage.vue';
import NoteTypeDialog from '../features/notes/NoteTypeDialog.vue';
import CaptureDialog from '../features/capture/CaptureDialog.vue';
import CreateMenuDialog from '../features/create-menu/CreateMenuDialog.vue';
import RecycleBinPage from '../features/trash/RecycleBinPage.vue';
import ReaderPage from '../features/reader/ReaderPage.vue';
import SidebarNavigation from '../features/navigation/SidebarNavigation.vue';
import MobileNavigation from '../features/navigation/MobileNavigation.vue';
import AppSettings from '../features/settings/AppSettings.vue';
import ProfileSettings from '../features/account/ProfileSettings.vue';
import { useProfileSettingsStore } from '../features/account/profile-settings-store';
import BackupHistoryDialog from '../features/settings/BackupHistoryDialog.vue';
import { useBackupHistoryStore } from '../features/settings/backup-history-store';

const profileSettingsStore = useProfileSettingsStore();
const backupHistoryStore = useBackupHistoryStore();
</script>

<template>
  <ActionDialog />
  <SyncConflictDialog />
  <ToastHost />
  <StorageCapacityWarning />
  <WorkspaceTopbarMenus />
  <WorkspaceBreadcrumb />
  <MobileDrawerControls />
  <CommandPalette />
  <GlobalSearchDialog />
  <SidebarNavigation />
  <MobileNavigation />
  <BookmarkPage />
  <DashboardPage />
  <NotesListPage />
  <NoteTypeDialog />
  <CaptureDialog />
  <CreateMenuDialog />
  <RecycleBinPage />
  <ReaderPage />
  <EditorPage />
  <SlashMenu />
  <AppSettings />
  <ProfileSettings v-if="profileSettingsStore.controller" :key="profileSettingsStore.revision" :flow="profileSettingsStore.controller" :local="profileSettingsStore.local" />
  <BackupHistoryDialog v-if="backupHistoryStore.options" />
</template>
