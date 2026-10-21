<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue';
import { useWorkspaceShellStore } from './workspace-shell-store';

const shell = useWorkspaceShellStore();

function closeFromShade() {
  shell.closeMobileMenu();
  void nextTick(() => document.querySelector<HTMLElement>('#menuBtn')?.focus({ preventScroll: true }));
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
      @click="shell.closeMobileMenu()"
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
      @click="closeFromShade"
    />
  </Teleport>
</template>
