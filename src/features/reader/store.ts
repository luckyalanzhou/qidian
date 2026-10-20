import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { useNavigationStore } from '../navigation/store';
import { useVaultStore } from '../vault/store';
import { createReaderSnapshot } from './snapshot';
import type { ReaderSnapshot } from './types';
import type { VaultNote } from '../../../shared/api-contracts.js';

const emptySnapshot = (): ReaderSnapshot => ({
  noteId: '',
  title: '',
  typeLabel: '',
  updatedLabel: '',
  createdLabel: '',
  readingMinutes: 1,
  tags: [],
  source: '',
  sourceUrl: '',
  bodyHtml: '',
  outline: [],
  working: false,
  publishLabel: null,
  editLabel: '编辑笔记',
  showPendingChanges: false,
  pinned: false
});

export type ReaderSnapshotDependencies = {
  document: Document;
  readableNoteBody: (body: unknown, title?: string) => { html: string };
  typeLabel: (type: string) => string;
  formatDate: (timestamp: number) => string;
  safeUrl: (value: string) => boolean;
  isDraft: (note: VaultNote) => boolean;
  needsPublish: (note: VaultNote) => boolean;
  publishedView: (note: VaultNote) => VaultNote;
};

export const useReaderStore = defineStore('reader', () => {
  const vault = useVaultStore();
  const navigation = useNavigationStore();
  const dependencyRevision = ref(0);
  let dependencies: ReaderSnapshotDependencies | null = null;

  const active = computed(() => vault.ready && navigation.page === 'note' && !navigation.editing && !!navigation.noteId);
  const snapshot = computed(() => {
    // The vault is raw during the staged migration; its generation is the
    // invalidation boundary for the selected note and navigation context.
    void vault.generation;
    void navigation.noteId;
    void navigation.previewing;
    void navigation.editing;
    void dependencyRevision.value;
    const value = vault.value;
    const configured = dependencies;
    if (!vault.ready || !value || !configured || !navigation.noteId) return emptySnapshot();
    const stored = (value.notes || []).find(note => note.id === navigation.noteId);
    if (!stored) return emptySnapshot();
    const working = navigation.previewing || configured.isDraft(stored);
    return createReaderSnapshot({
      ...configured,
      stored,
      note: working ? stored : configured.publishedView(stored),
      working,
      previewing: navigation.previewing
    });
  });

  function configure(next: ReaderSnapshotDependencies) {
    dependencies = next;
    dependencyRevision.value += 1;
  }

  return { active, snapshot, configure };
});
