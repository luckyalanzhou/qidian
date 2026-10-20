import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { useVaultStore } from '../vault/store';
import type { BookmarkItem, NoteType, VaultNote } from '../../../shared/api-contracts.js';

export type SidebarSnapshot = {
  counts: {
    all: number;
    recent: number;
    pinned: number;
    drafts: number;
    bookmarks: number;
    trash: number;
  };
  noteTypes: Array<{ id: string; name: string; count: number }>;
  typesExpanded: boolean;
};

export type SidebarSnapshotDependencies = {
  isDraft: (note: VaultNote) => boolean;
  needsPublish: (note: VaultNote) => boolean;
  hasDraftContent: (note: VaultNote) => boolean;
  displayTypeName: (type: NoteType) => string;
};

const emptySnapshot = (): SidebarSnapshot => ({
  counts: { all: 0, recent: 0, pinned: 0, drafts: 0, bookmarks: 0, trash: 0 },
  noteTypes: [],
  typesExpanded: true
});

function bookmarkLinkCount(items: readonly BookmarkItem[] = []): number {
  return items.reduce((total, item) => total + (item.kind === 'link' ? 1 : bookmarkLinkCount(item.children || [])), 0);
}

export const useSidebarStore = defineStore('sidebar', () => {
  const vault = useVaultStore();
  const dependencyRevision = ref(0);
  let dependencies: SidebarSnapshotDependencies | null = null;

  const snapshot = computed(() => {
    // The vault is raw during the staged migration; generation is the
    // invalidation boundary for every count and navigation facet.
    void vault.generation;
    void dependencyRevision.value;
    const value = vault.value;
    const configured = dependencies;
    if (!vault.ready || !value || !configured) return emptySnapshot();

    const notes = value.notes || [];
    const publishedNotes = notes.filter(note => !configured.isDraft(note));
    const types = value.noteTypes || [];
    return {
      counts: {
        all: publishedNotes.length,
        recent: publishedNotes.length,
        pinned: publishedNotes.filter(note => note.pinned).length,
        drafts: notes.filter(note => configured.needsPublish(note) && configured.hasDraftContent(note)).length,
        bookmarks: bookmarkLinkCount(value.bookmarks || []),
        trash: (value.trash || []).length
      },
      noteTypes: types.map((type: NoteType) => ({
        id: type.id,
        name: configured.displayTypeName(type),
        count: publishedNotes.filter(note => note.type === type.id).length
      })),
      typesExpanded: value.noteTypesExpanded !== false
    };
  });

  function configure(next: SidebarSnapshotDependencies) {
    dependencies = next;
    dependencyRevision.value += 1;
  }

  return { snapshot, configure };
});
