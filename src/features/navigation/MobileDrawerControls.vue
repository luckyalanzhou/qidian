<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue';
import { useWorkspaceShellStore } from './workspace-shell-store';
import { createMobileMenuFocusController } from './mobile-menu-focus-controller.ts';

const shell = useWorkspaceShellStore();
const focusController = createMobileMenuFocusController({
  document,
  isOpen: () => shell.mobileMenuOpen,
  close: () => shell.closeMobileMenu(),
  getSidebar: () => document.querySelector<HTMLElement>('#sidebar'),
  getMenuButton: () => document.querySelector<HTMLElement>('#menuBtn'),
  getMain: () => document.querySelector<HTMLElement>('#main'),
  scheduleFocus: callback => { void nextTick(callback); }
});

function closeDrawer() {
  focusController.close(true);
}

watch(() => shell.mobileMenuOpen, open => {
  document.body.classList.toggle('menu-open', open);
  if (open) void nextTick(() => document.querySelector<HTMLElement>('#sidebar .side-link.active, #sidebar .side-link, #newSide')?.focus({ preventScroll: true }));
}, { immediate: true });

onBeforeUnmount(() => document.body.classList.remove('menu-open'));
</script>

<template>
  <Teleport to="#sidebarBrandIsland">
    <button
      id="mobileDrawerClose"
      class="round-btn mobile-drawer-close"
      type="button"
      aria-label="关闭菜单"
      @click="closeDrawer"
    >
      <span class="ico"><svg aria-hidden="true"><use href="#i-close" /></svg></span>
    </button>
  </Teleport>

  <Teleport to="#mobileMenuButtonIsland">
    <button
      id="menuBtn"
      class="round-btn mobile-only"
      type="button"
      aria-controls="sidebar"
      :aria-expanded="shell.mobileMenuOpen"
      :aria-label="shell.mobileMenuOpen ? '关闭菜单' : '打开菜单'"
      @click="shell.toggleMobileMenu()"
    >
      <span class="ico"><svg aria-hidden="true"><use href="#i-menu" /></svg></span>
    </button>
  </Teleport>

  <Teleport to="#mobileShadeIsland">
    <div
      id="mobileShade"
      class="mobile-shade"
      :aria-hidden="!shell.mobileMenuOpen"
      @click="closeDrawer"
    />
  </Teleport>
</template>
