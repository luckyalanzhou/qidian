import type { NoteCardItem } from './types';

export type NoteCardSource = {
  id: string;
  title?: string;
  type: string;
  tags?: string[];
  body?: string;
  updated: number;
  pinned?: boolean;
};

export type NoteCardSnapshotDependencies = {
  typeName: (type: string) => string;
  bodyText: (body: string | undefined, title: string) => string;
  formatDate: (timestamp: number) => string;
};

export function createNoteCardSnapshot(dependencies: NoteCardSnapshotDependencies) {
  return (note: NoteCardSource): NoteCardItem => ({
    id: note.id,
    title: note.title || '',
    type: note.type,
    typeName: dependencies.typeName(note.type),
    tags: [...(note.tags || [])],
    description: dependencies.bodyText(note.body, note.title || ''),
    updatedLabel: dependencies.formatDate(note.updated),
    pinned: !!note.pinned
  });
}
