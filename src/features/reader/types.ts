export type ReaderOutlineItem = {
  id: string;
  name: string;
  level: number;
};
export type ReaderSnapshot = {
  noteId: string;
  title: string;
  typeLabel: string;
  updatedLabel: string;
  createdLabel: string;
  readingMinutes: number;
  tags: string[];
  source: string;
  sourceUrl: string;
  bodyHtml: string;
  outline: ReaderOutlineItem[];
  working: boolean;
  publishLabel: string | null;
  editLabel: string;
  showPendingChanges: boolean;
  pinned: boolean;
};
