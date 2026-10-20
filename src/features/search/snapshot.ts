import type { BookmarkItem, VaultNote } from '../../../shared/api-contracts.js';

export type GlobalSearchNoteResult = {
  id: string;
  title: string;
  typeLabel: string;
  updatedLabel: string;
};

export type GlobalSearchBookmarkResult = {
  id: string;
  title: string;
  url: string;
  path: string;
  hostname: string;
};

export type GlobalSearchSnapshot = {
  notes: GlobalSearchNoteResult[];
  bookmarks: GlobalSearchBookmarkResult[];
};

export type GlobalSearchSnapshotOptions = {
  notes: readonly VaultNote[];
  bookmarks: readonly BookmarkItem[];
  query: string;
  bodyText: (body: string) => string;
  typeLabel: (id: string) => string;
  formatDate: (timestamp: number) => string;
  isSafeUrl: (url: string) => boolean;
};

const matches = (values: readonly string[], query: string) =>
  values.join(' ').toLocaleLowerCase().includes(query);

export function createGlobalSearchSnapshot(options: GlobalSearchSnapshotOptions): GlobalSearchSnapshot {
  const query = options.query.trim().toLocaleLowerCase();
  const notes = options.notes
    .filter(note => matches([
      note.title,
      note.source,
      ...(note.tags || []),
      options.bodyText(note.body)
    ], query))
    .slice()
    .sort((left, right) => right.updated - left.updated)
    .slice(0, 12)
    .map(note => ({
      id: note.id,
      title: note.title || '无标题笔记',
      typeLabel: options.typeLabel(note.type),
      updatedLabel: options.formatDate(note.updated)
    }));

  const bookmarks: GlobalSearchBookmarkResult[] = [];
  const visit = (items: readonly BookmarkItem[], path: readonly string[] = []) => {
    for (const item of items) {
      if (item.kind === 'folder') {
        visit(item.children || [], [...path, item.title]);
        continue;
      }

      if (!options.isSafeUrl(item.url) || !matches([item.title, item.url, ...path], query)) continue;
      try {
        bookmarks.push({
          id: item.id,
          title: item.title,
          url: item.url,
          path: path.join(' / '),
          hostname: new URL(item.url).hostname
        });
      } catch {
        // A safe-URL policy may be broader than URL parsing; malformed values are
        // omitted from results rather than breaking the search dialog.
      }
    }
  };
  visit(options.bookmarks);

  return { notes, bookmarks: bookmarks.slice(0, 12) };
}
