import { defineStore } from 'pinia';

export type ThemePreference = 'system' | 'light' | 'dark';

export const useWorkspaceShellStore = defineStore('workspace-shell', {
  state: () => ({
    themeMenuOpen: false,
    accountMenuOpen: false,
    mobileMenuOpen: false,
    breadcrumbTitle: '全部笔记',
    themePreference: 'light' as ThemePreference,
    resolvedDark: false,
    username: '我的账号',
    avatarUrl: null as string | null,
    localPreview: false,
    workspaceReady: false
  }),
  actions: {
    setBreadcrumbTitle(title: string) {
      this.breadcrumbTitle = title;
    },
    setMobileMenuOpen(open: boolean) {
      this.mobileMenuOpen = open;
    },
    toggleMobileMenu() {
      this.mobileMenuOpen = !this.mobileMenuOpen;
    },
    closeMobileMenu() {
      this.mobileMenuOpen = false;
    },
    closeThemeMenu() {
      this.themeMenuOpen = false;
    },
    toggleThemeMenu() {
      this.themeMenuOpen = !this.themeMenuOpen;
      if (this.themeMenuOpen) this.accountMenuOpen = false;
    },
    closeAccountMenu() {
      this.accountMenuOpen = false;
    },
    toggleAccountMenu() {
      this.accountMenuOpen = !this.accountMenuOpen;
      if (this.accountMenuOpen) this.themeMenuOpen = false;
    },
    setThemeState(preference: ThemePreference, resolvedDark: boolean) {
      this.themePreference = preference;
      this.resolvedDark = resolvedDark;
    },
    setIdentity(username: string, localPreview?: boolean) {
      this.username = username || '我的账号';
      if (localPreview !== undefined) this.localPreview = localPreview;
      this.workspaceReady = true;
    },
    setAvatar(avatarUrl: string | null) {
      this.avatarUrl = avatarUrl;
    }
  }
});
