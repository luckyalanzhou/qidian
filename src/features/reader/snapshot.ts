import type { VaultNote } from '../../../shared/api-contracts.js';
import type { ReaderSnapshot } from './types';

export type ReaderSnapshotOptions = {
  document: Document;
  stored: VaultNote;
  note: VaultNote;
  working: boolean;
  previewing: boolean;
  readableNoteBody: (body: unknown, title?: string) => { html: string };
  typeLabel: (type: string) => string;
  formatDate: (timestamp: number) => string;
  safeUrl: (value: string) => boolean;
  isDraft: (note: VaultNote) => boolean;
  needsPublish: (note: VaultNote) => boolean;
};

export function createReaderSnapshot(options: ReaderSnapshotOptions): ReaderSnapshot {
  const { document, stored, note, working } = options;
  const bodyView = options.readableNoteBody(note.body, note.title);
  const body = document.createElement('div');
  body.innerHTML = bodyView.html;

  const outline = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].flatMap((heading, index) => {
    const name = (heading.textContent || '').replace(/\s+/g, ' ').trim();
    if (!name) return [];
    heading.id = `sec-${index}`;
    return [{ name, id: heading.id, level: Number(heading.tagName.slice(1)) }];
  });
  const text = (body.textContent || '').replace(/\s+/g, ' ').trim();
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWordCount = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  const source = note.source || '';

  return {
    noteId: note.id,
    title: note.title || '',
    typeLabel: options.typeLabel(note.type),
    updatedLabel: options.formatDate(note.updated),
    createdLabel: options.formatDate(note.created),
    readingMinutes: Math.max(1, Math.ceil((cjkCount + latinWordCount * 5) / 350)),
    tags: [...(note.tags || [])],
    source,
    sourceUrl: options.safeUrl(source) ? source : '',
    bodyHtml: body.innerHTML,
    outline,
    working,
    publishLabel: options.needsPublish(stored) && working
      ? options.isDraft(stored) ? '发布笔记' : '保存笔记'
      : null,
    editLabel: options.previewing ? '继续编辑' : '编辑笔记',
    showPendingChanges: !working && !!stored.publishedSnapshot,
    pinned: !!note.pinned
  };
}
