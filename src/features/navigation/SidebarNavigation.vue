<script setup lang="ts">
import { computed, onBeforeMount } from 'vue';
import { useNavigationActionsStore } from './navigation-actions-store';
import { useNavigationStore } from './store';
import { useWorkspaceShellActionsStore } from './workspace-shell-actions-store';
import { useSidebarStore } from './sidebar-store';

const navigation = useNavigationStore();
const navigationActions = useNavigationActionsStore();
const shellActions = useWorkspaceShellActionsStore();
const sidebar = useSidebarStore();
const notesContext = computed(() => navigation.page === 'home' || navigation.page === 'note');

onBeforeMount(() => {
  document.querySelector('#sidebarBrandIsland [data-legacy-fallback]')?.remove();
  document.querySelector('#sidebarCreateIsland [data-legacy-fallback]')?.remove();
});

function icon(name: string) {
  return `#i-${name}`;
}
</script>

<template>
  <Teleport to="#sidebarBrandIsland">
    <button class="brand home-brand" id="brandHome" type="button" aria-label="栖点，返回首页" @click.stop="navigationActions.execute({ type: 'dashboard' })"><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><use href="#i-book" /></svg></span><span class="brand-copy"><strong>栖点</strong><small>私人知识库</small></span></button>
  </Teleport>
  <Teleport to="#sidebarCreateIsland">
    <button class="new-note" id="newSide" type="button" @click.stop="navigationActions.execute({ type: 'open-create-menu' })">
      <span class="ico"><svg aria-hidden="true"><use href="#i-plus" /></svg></span>新建笔记
    </button>
  </Teleport>
  <Teleport to="#qidianSidebarIsland">
    <div class="side-label">工作区</div>
    <div id="sideCore">
      <button class="side-link" :class="{ active: navigation.page === 'dashboard' }" data-dashboard @click.stop="navigationActions.execute({ type: 'dashboard' })">
        <span class="ico"><svg aria-hidden="true"><use :href="icon('home')" /></svg></span>首页
      </button>
      <button class="side-link" :class="{ active: notesContext }" data-nav="all" @click.stop="navigationActions.execute({ type: 'home', category: 'all' })">
        <span class="ico"><svg aria-hidden="true"><use :href="icon('book')" /></svg></span>笔记
        <span class="count">{{ sidebar.snapshot.counts.all }}</span>
      </button>
      <button id="openBookmarks" class="side-link" :class="{ active: navigation.page === 'bookmarks' }" @click.stop="navigationActions.execute({ type: 'bookmarks' })">
        <span class="ico"><svg aria-hidden="true"><use :href="icon('link')" /></svg></span>书签
        <span class="count">{{ sidebar.snapshot.counts.bookmarks }}</span>
      </button>
      <div class="sidebar-note-views">
        <div class="side-label side-nav-caption">笔记视图</div>
        <button class="side-link" :class="{ active: navigation.page === 'home' && navigation.active === 'recent' }" data-nav="recent" @click.stop="navigationActions.execute({ type: 'home', category: 'recent' })">
          <span class="ico"><svg aria-hidden="true"><use :href="icon('note')" /></svg></span>最近编辑
          <span class="count">{{ sidebar.snapshot.counts.recent }}</span>
        </button>
        <button class="side-link" :class="{ active: navigation.page === 'home' && navigation.active === 'pinned' }" data-nav="pinned" @click.stop="navigationActions.execute({ type: 'home', category: 'pinned' })">
          <span class="ico"><svg aria-hidden="true"><use :href="icon('heart')" /></svg></span>重要收藏
          <span class="count">{{ sidebar.snapshot.counts.pinned }}</span>
        </button>
        <button class="side-link" :class="{ active: navigation.page === 'home' && navigation.active === 'drafts' }" data-nav="drafts" @click.stop="navigationActions.execute({ type: 'home', category: 'drafts' })">
          <span class="ico"><svg aria-hidden="true"><use :href="icon('edit')" /></svg></span>草稿箱
          <span class="count">{{ sidebar.snapshot.counts.drafts }}</span>
        </button>
      </div>
      <button class="side-link" :class="{ active: navigation.page === 'trash' }" data-trash-nav @click.stop="navigationActions.execute({ type: 'trash' })">
        <span class="ico"><svg aria-hidden="true"><use :href="icon('trash')" /></svg></span>回收站
        <span class="count">{{ sidebar.snapshot.counts.trash }}</span>
      </button>
    </div>

    <section class="side-section">
      <div class="side-label side-heading">
        <button
          id="toggleNoteTypes"
          class="side-heading-toggle"
          type="button"
          :aria-expanded="sidebar.snapshot.typesExpanded"
          aria-controls="sideTypes"
          :aria-label="sidebar.snapshot.typesExpanded ? '折叠笔记类型' : '展开笔记类型'"
          :title="sidebar.snapshot.typesExpanded ? '折叠笔记类型' : '展开笔记类型'"
          @click.stop="shellActions.execute({ type: 'toggle-note-types' })"
        >
          <span>笔记类型</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <button id="addNoteType" class="side-add" type="button" title="新增笔记类型" aria-label="新增笔记类型" @click.stop="shellActions.execute({ type: 'add-note-type' })">＋</button>
      </div>
      <div id="sideTypes" :hidden="!sidebar.snapshot.typesExpanded">
        <button class="side-link type-all" :class="{ active: navigation.typeFilter === 'all' && navigation.page === 'home' }" data-type-nav="all" @click.stop="navigationActions.execute({ type: 'note-type', id: 'all' })">
          <span class="ico"><svg aria-hidden="true"><use :href="icon('book')" /></svg></span>全部类型
          <span class="count">{{ sidebar.snapshot.counts.all }}</span>
        </button>
        <div v-for="type in sidebar.snapshot.noteTypes" :key="type.id" class="type-nav-row" :class="{ active: navigation.typeFilter === type.id && navigation.page === 'home' }">
          <button class="type-nav-link" :data-type-nav="type.id" @click.stop="navigationActions.execute({ type: 'note-type', id: type.id })">
            <span class="type-dot" :class="type.id" />
            <span class="type-nav-name">{{ type.name }}</span>
            <span class="count">{{ type.count }}</span>
          </button>
          <div class="type-nav-actions">
            <button type="button" :data-type-edit="type.id" :title="`编辑${type.name}`" :aria-label="`编辑${type.name}`" @click.stop="shellActions.execute({ type: 'edit-note-type', id: type.id })">
              <span class="ico"><svg aria-hidden="true"><use :href="icon('edit')" /></svg></span>
            </button>
            <button type="button" :data-type-delete="type.id" :title="`删除${type.name}`" :aria-label="`删除${type.name}`" :disabled="sidebar.snapshot.noteTypes.length === 1 && type.id === 'note'" @click.stop="shellActions.execute({ type: 'delete-note-type', id: type.id })">
              <span class="ico"><svg aria-hidden="true"><use :href="icon('trash')" /></svg></span>
            </button>
          </div>
        </div>
      </div>
    </section>

  </Teleport>
</template>
