<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useGlobalSearchStore } from './store';
import { useNavigationActionsStore } from '../navigation/navigation-actions-store';

const store = useGlobalSearchStore();
const navigationActions = useNavigationActionsStore();
const input = ref<HTMLInputElement | null>(null);
const returnFocus = ref<HTMLElement | null>(null);
let restoreFocusOnClose = false;

watch(() => store.open, async open => {
  if (open) {
    returnFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    input.value?.focus();
    return;
  }

  if (restoreFocusOnClose && returnFocus.value?.isConnected) returnFocus.value.focus();
  restoreFocusOnClose = false;
});

function closeFromEscape() {
  restoreFocusOnClose = true;
  store.close();
}

function closeFromOutside() {
  restoreFocusOnClose = false;
  store.close();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFromEscape();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    store.close();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="store.open" class="search-dismiss-layer" @click.self="closeFromOutside">
      <section
        id="switcher"
        class="switcher open"
        role="dialog"
        aria-label="搜索笔记和书签"
        @keydown="handleKeydown"
      >
        <input
          id="globalSearch"
          ref="input"
          :value="store.query"
          type="search"
          placeholder="搜索笔记和书签..."
          aria-label="搜索笔记和书签"
          autocomplete="off"
          @input="store.setQuery(($event.target as HTMLInputElement).value)"
        >
        <div id="switcherList" class="switcher-list" role="list" aria-live="polite">
          <button
            v-for="note in store.snapshot.notes"
            :key="`note-${note.id}`"
            class="switcher-item"
            type="button"
            :data-search-id="note.id"
            @click.stop="navigationActions.execute({ type: 'search-result', id: note.id })"
          >
            <span class="search-kind">笔记</span>{{ note.title }}
            <small>{{ note.typeLabel }} · {{ note.updatedLabel }}</small>
          </button>
          <a
            v-for="bookmark in store.snapshot.bookmarks"
            :key="`bookmark-${bookmark.id}`"
            class="switcher-item"
            :href="bookmark.url"
            target="_blank"
            rel="noopener noreferrer"
            data-search-bookmark
            @click.stop="store.close()"
          >
            <span class="search-kind">书签</span>{{ bookmark.title }}
            <small>{{ bookmark.path || '未分组' }} · {{ bookmark.hostname }}</small>
          </a>
          <div v-if="!store.snapshot.notes.length && !store.snapshot.bookmarks.length" class="empty" style="padding:25px">
            没有找到匹配的内容
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
