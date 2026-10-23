<script setup lang="ts">
import type { NoteCardItem } from './types';
import { useNavigationActionsStore } from '../navigation/navigation-actions-store';
import { useWorkspaceShellActionsStore } from '../navigation/workspace-shell-actions-store';

defineProps<{ note: NoteCardItem }>();
const navigationActions = useNavigationActionsStore();
const shellActions = useWorkspaceShellActionsStore();
</script>

<template>
  <article class="note-card">
    <div class="note-card-open" :data-open="note.id" role="button" tabindex="0" :aria-label="`打开笔记：${note.title || '无标题笔记'}`" @click.stop="navigationActions.execute({ type: 'open-note', id: note.id })">
      <span class="note-card-symbol" aria-hidden="true"><span class="ico"><svg><use href="#i-note" /></svg></span></span>
      <div class="note-card-copy">
        <div class="note-kicker"><span class="type-dot" :class="note.type" />{{ note.typeName }}</div>
        <span v-if="note.pinned" class="pin-top" title="已收藏">★</span>
        <h3>{{ note.title || '无标题笔记' }}</h3>
        <p>{{ note.description || '空白笔记，点击开始编辑。' }}</p>
        <div class="note-foot">
          <span v-for="tag in note.tags.slice(0, 2)" :key="tag" class="tag">#{{ tag }}</span>
          <span class="date">{{ note.updatedLabel }}</span>
        </div>
      </div>
    </div>
    <details class="item-menu note-item-menu">
      <summary :aria-label="`更多：${note.title || '无标题笔记'}`">···</summary>
      <div class="item-menu-panel">
        <button type="button" :data-note-edit="note.id" @click.stop="navigationActions.execute({ type: 'open-note', id: note.id, forceEdit: true })">编辑</button>
        <button type="button" class="danger-btn" :data-note-delete="note.id" @click.stop="shellActions.execute({ type: 'delete-note', id: note.id })">删除</button>
      </div>
    </details>
  </article>
</template>
