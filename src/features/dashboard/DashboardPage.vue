<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore } from './store';
import { useNavigationActionsStore } from '../navigation/navigation-actions-store';
import DashboardBookmarkTree from './DashboardBookmarkTree.vue';
import NoteCard from '../notes/NoteCard.vue';

const dashboard = useDashboardStore();
const navigationActions = useNavigationActionsStore();
const layoutClass = computed(() => dashboard.snapshot.layout === 'double' ? 'is-double' : '');

function icon(name: string) {
  return `#i-${name}`;
}

function chooseLayout(layout: 'single' | 'double') {
  dashboard.setLayout(layout);
}

function setAllFolders(open: boolean) {
  const ids: string[] = [];
  const visit = (nodes: typeof dashboard.snapshot.groups) => nodes.forEach((node) => {
    if (node.kind !== 'folder') return;
    ids.push(node.id);
    visit(node.children);
  });
  visit(dashboard.snapshot.groups);
  dashboard.setAllFolders(ids, open);
}
</script>

<template>
  <Teleport to="#dashboardHost">
    <div v-if="dashboard.active" class="dashboard-page">
      <header class="dashboard-intro">
        <div class="dashboard-intro-copy">
          <span class="workspace-eyebrow">个人知识库</span>
          <h1>我的空间</h1>
          <p>笔记保存内容；书签保存网址。</p>
        </div>
        <button id="quickCapture" class="secondary-btn" type="button" @click.stop="navigationActions.execute({ type: 'create-from-menu', kind: 'capture' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('clip')" /></svg></span>网页摘录</button>
      </header>

      <div class="dashboard-workspaces">
        <section class="dashboard-section dashboard-note-workspace" aria-labelledby="dashboardNotesTitle">
          <div class="dashboard-section-head">
            <div class="dashboard-section-title">
              <span class="workspace-section-icon"><span class="ico"><svg aria-hidden="true"><use :href="icon('book')" /></svg></span></span>
              <div>
                <h2 id="dashboardNotesTitle">笔记</h2>
                <p>最近笔记 · {{ dashboard.snapshot.noteCount }} 篇</p>
              </div>
            </div>
            <div class="dashboard-section-actions">
              <button class="secondary-btn" type="button" data-new="note" @click.stop="navigationActions.execute({ type: 'create-note', kind: 'note' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('plus')" /></svg></span>新建笔记</button>
            </div>
          </div>
          <div v-if="dashboard.snapshot.notes.length" class="notes dashboard-notes">
            <NoteCard v-for="note in dashboard.snapshot.notes" :key="note.id" :note="note" />
          </div>
          <div v-else class="dashboard-empty">
            <span class="empty-symbol"><span class="ico"><svg aria-hidden="true"><use :href="icon('note')" /></svg></span></span>
            <span>还没有笔记</span>
            <button type="button" data-new="note" @click.stop="navigationActions.execute({ type: 'create-note', kind: 'note' })">写下第一篇 <span class="ico"><svg aria-hidden="true"><use :href="icon('chevron')" /></svg></span></button>
          </div>
          <footer class="dashboard-section-foot"><button type="button" class="dashboard-view-all" data-nav="all" @click.stop="navigationActions.execute({ type: 'home', category: 'all' })">全部笔记 <span class="ico"><svg aria-hidden="true"><use :href="icon('chevron')" /></svg></span></button></footer>
        </section>

        <section class="dashboard-section dashboard-bookmarks" aria-labelledby="dashboardBookmarksTitle">
          <div class="dashboard-section-head">
            <div class="dashboard-section-title">
              <span class="workspace-section-icon is-bookmark"><span class="ico"><svg aria-hidden="true"><use :href="icon('link')" /></svg></span></span>
              <div>
                <h2 id="dashboardBookmarksTitle">书签</h2>
                <p>{{ dashboard.snapshot.bookmarkCount }} 个网址 · {{ dashboard.snapshot.folderCount }} 个顶层分组</p>
              </div>
            </div>
            <div class="dashboard-section-actions">
              <button class="secondary-btn" type="button" data-dashboard-add-bookmark @click.stop="navigationActions.execute({ type: 'add-bookmark' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('plus')" /></svg></span>添加书签</button>
            </div>
          </div>

          <div v-if="dashboard.snapshot.pinnedLinks.length" class="dashboard-pinned-bookmarks">
            <h3>常用书签</h3>
            <DashboardBookmarkTree v-for="item in dashboard.snapshot.pinnedLinks" :key="item.id" :item="item" :depth="1" />
          </div>

          <template v-if="dashboard.snapshot.groups.length">
            <div class="dashboard-bookmark-controls">
              <span class="dashboard-layout-switch" role="group" aria-label="书签分组排列">
                <button type="button" data-dashboard-layout="single" :aria-pressed="dashboard.snapshot.layout === 'single'" @click.stop="chooseLayout('single')">单列</button>
                <button type="button" data-dashboard-layout="double" :aria-pressed="dashboard.snapshot.layout === 'double'" @click.stop="chooseLayout('double')">双列</button>
              </span>
              <span class="dashboard-folder-actions">
                <button type="button" data-dashboard-folders="expand" @click.stop="setAllFolders(true)">展开全部</button>
                <button type="button" data-dashboard-folders="collapse" @click.stop="setAllFolders(false)">收起全部</button>
              </span>
            </div>
            <div class="dashboard-bookmark-groups" :class="layoutClass" :data-dashboard-layout="dashboard.snapshot.layout" :data-dashboard-folders="JSON.stringify(dashboard.snapshot.folderStates)">
              <DashboardBookmarkTree v-for="item in dashboard.snapshot.groups" :key="item.id" :item="item" :depth="0" />
            </div>
          </template>
          <div v-else class="dashboard-empty">
            <span class="empty-symbol"><span class="ico"><svg aria-hidden="true"><use :href="icon('link')" /></svg></span></span>
            <span>还没有书签</span>
            <button type="button" data-dashboard-add-bookmark @click.stop="navigationActions.execute({ type: 'add-bookmark' })">添加第一个网址 <span class="ico"><svg aria-hidden="true"><use :href="icon('chevron')" /></svg></span></button>
          </div>
          <footer class="dashboard-section-foot"><button type="button" class="dashboard-view-all" data-open-bookmarks @click.stop="navigationActions.execute({ type: 'bookmarks' })">全部书签 <span class="ico"><svg aria-hidden="true"><use :href="icon('chevron')" /></svg></span></button></footer>
        </section>
      </div>
    </div>
  </Teleport>
</template>
