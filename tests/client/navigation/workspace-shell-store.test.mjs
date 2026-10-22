import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useWorkspaceShellStore } from '../../../src/features/navigation/workspace-shell-store.ts';

test('workspace shell menu state keeps the account and theme popovers mutually exclusive', () => {
  const shell = useWorkspaceShellStore(createPinia());

  shell.toggleAccountMenu();
  assert.equal(shell.accountMenuOpen, true);
  shell.toggleThemeMenu();
  assert.equal(shell.themeMenuOpen, true);
  assert.equal(shell.accountMenuOpen, false);
  shell.toggleAccountMenu();
  assert.equal(shell.accountMenuOpen, true);
  assert.equal(shell.themeMenuOpen, false);
  shell.closeThemeMenu();
  assert.equal(shell.themeMenuOpen, false);
});

test('workspace shell owns the mobile drawer open state', () => {
  const shell = useWorkspaceShellStore(createPinia());

  shell.toggleMobileMenu();
  assert.equal(shell.mobileMenuOpen, true);
  shell.closeMobileMenu();
  assert.equal(shell.mobileMenuOpen, false);
  shell.setMobileMenuOpen(true);
  assert.equal(shell.mobileMenuOpen, true);
});

test('workspace shell owns the current breadcrumb title', () => {
  const shell = useWorkspaceShellStore(createPinia());

  assert.equal(shell.breadcrumbTitle, '全部笔记');
  shell.setBreadcrumbTitle('书签导航');
  assert.equal(shell.breadcrumbTitle, '书签导航');
});

test('workspace shell keeps theme resolution and temporary profile display state typed in Pinia', () => {
  const shell = useWorkspaceShellStore(createPinia());
  shell.setThemeState('system', true);
  shell.setIdentity('alan', false);
  shell.setAvatar('blob:avatar-preview');

  assert.equal(shell.themePreference, 'system');
  assert.equal(shell.resolvedDark, true);
  assert.equal(shell.username, 'alan');
  assert.equal(shell.localPreview, false);
  assert.equal(shell.workspaceReady, true);
  assert.equal(shell.avatarUrl, 'blob:avatar-preview');

  shell.setIdentity('', true);
  shell.setAvatar(null);
  assert.equal(shell.username, '我的账号');
  assert.equal(shell.localPreview, true);
  assert.equal(shell.avatarUrl, null);
});
