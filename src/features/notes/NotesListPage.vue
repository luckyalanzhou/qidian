<script setup lang="ts">
import { useNoteListStore } from './store';
import { useNavigationStore } from '../navigation/store';
import { useNavigationActionsStore } from '../navigation/navigation-actions-store';
import NoteCard from './NoteCard.vue';

const notesPage = useNoteListStore();
const navigation = useNavigationStore();
const navigationActions = useNavigationActionsStore();

function filterNotes(event: Event) {
  navigation.noteQuery = (event.target as HTMLInputElement).value;
}

function icon(name: string) {
  return `#i-${name}`;
}
</script>

<template>
  <Teleport to="#dashboardHost">
    <div v-if="notesPage.active" class="note-page-layout">
      <div class="section-head workspace-page-head">
        <div>
          <h1>{{ notesPage.snapshot.heading }}</h1>
          <p class="muted">{{ notesPage.snapshot.resultCount }} 篇笔记</p>
        </div>
        <div class="section-right">
          <button class="secondary-btn" type="button" data-new="note" @click.stop="navigationActions.execute({ type: 'create-note', kind: 'note' })"><span class="ico"><svg aria-hidden="true"><use :href="icon('plus')" /></svg></span>新建笔记</button>
        </div>
      </div>

      <label class="workspace-search note-page-search">
        <span class="ico"><svg aria-hidden="true"><use :href="icon('search')" /></svg></span>
        <input id="notePageSearch" type="search" aria-label="筛选当前笔记标题、正文和标签" placeholder="筛选本页笔记标题、正文和标签" :value="notesPage.snapshot.query" @input="filterNotes">
      </label>

      <div class="filter-tabs home-type-tabs" aria-label="笔记类型">
        <button type="button" data-type="all" :class="{ selected: notesPage.snapshot.typeFilter === 'all' }" @click.stop="navigationActions.execute({ type: 'filter-home', typeFilter: 'all' })">全部类型</button>
        <button v-for="type in notesPage.snapshot.noteTypes" :key="type.id" type="button" :data-type="type.id" :class="{ selected: notesPage.snapshot.typeFilter === type.id }" @click.stop="navigationActions.execute({ type: 'filter-home', typeFilter: type.id })">{{ type.name }}</button>
      </div>

      <div v-if="notesPage.snapshot.notes.length" class="notes note-list">
        <NoteCard v-for="note in notesPage.snapshot.notes" :key="note.id" :note="note" />
      </div>
      <div v-else-if="notesPage.snapshot.query" class="notes note-list">
        <div class="empty">没有找到匹配的笔记</div>
      </div>
      <div v-else class="empty">{{ notesPage.snapshot.emptyMessage }}</div>
    </div>
  </Teleport>
</template>
