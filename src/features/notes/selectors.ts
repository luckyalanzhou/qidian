import type { VaultNote } from '../../../shared/api-contracts.js';

export type NoteListItem = VaultNote & { _hasUnpublished?: boolean };

export type NoteListOptions = {
  active: string;
  typeFilter: string;
  query?: string;
  hasDraftContent: (note: VaultNote) => boolean;
  bodyText: (body: string, title: string) => string;
};

export function isDraftNote(note: VaultNote | null | undefined): boolean {
  return note?.status === 'draft';
}

export function needsPublish(note: VaultNote | null | undefined): boolean {
  return isDraftNote(note) || !!note?.publishedSnapshot;
}

export function publishedNoteView(note: VaultNote): NoteListItem {
  return note.publishedSnapshot
    ? { ...note, ...note.publishedSnapshot, _hasUnpublished: true }
    : note;
}

export function selectNotes(notes: readonly VaultNote[], options: NoteListOptions): NoteListItem[] {
  const drafts = options.active === 'drafts';
  let result = notes
    .filter(note => drafts
      ? needsPublish(note) && options.hasDraftContent(note)
      : !isDraftNote(note))
    .map(note => drafts ? note : publishedNoteView(note));

  if (!drafts) {
    if (options.active === 'pinned') result = result.filter(note => note.pinned);
  }

  if (options.typeFilter !== 'all') {
    result = result.filter(note => note.type === options.typeFilter);
  }

  const query = options.query?.trim().toLowerCase() || '';
  if (query) {
    result = result.filter(note => [
      note.title,
      note.source,
      ...(note.tags || []),
      options.bodyText(note.body, note.title)
    ].join(' ').toLowerCase().includes(query));
  }

  return result.sort((left, right) => options.active === 'recent'
    ? right.updated - left.updated
    : Number(right.pinned) - Number(left.pinned) || right.updated - left.updated);
}
