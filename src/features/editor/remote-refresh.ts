type RemoteEditorNote = {
  id: string;
  title?: string;
  type?: string;
  category?: string;
  tags?: string[];
  source?: string;
  body?: string;
  [key: string]: unknown;
};

type RemoteEditor = {
  getHTML: () => string;
  state: { selection: { from: number }; doc: { content: { size: number } } };
  commands: {
    setContent: (html: string, options: { emitUpdate: false }) => void;
    setTextSelection: (position: number) => void;
  };
};

type RemoteEditorRefreshDependencies = {
  document: Document;
  setEditingDraft: (note: RemoteEditorNote) => void;
  setBaseline: (snapshot: unknown) => void;
  snapshot: (note: RemoteEditorNote) => unknown;
  cleanBody: (body: string) => string;
  getEditor: () => RemoteEditor | null;
  syncToolbarState: (editor: RemoteEditor) => void;
};

export function createRemoteEditorRefresh(dependencies: RemoteEditorRefreshDependencies) {
  function refresh(note: RemoteEditorNote, preserveLocalBaseline: boolean) {
    dependencies.setEditingDraft(structuredClone(note));
    if (!preserveLocalBaseline) dependencies.setBaseline(dependencies.snapshot(note));

    const fields: [string, string][] = [
      ['editTitle', note.title || ''],
      ['editType', note.type || 'note'],
      ['editTags', (note.tags || []).join(', ')],
      ['editSource', note.source || '']
    ];
    for (const [id, value] of fields) {
      const field = dependencies.document.getElementById(id) as HTMLInputElement | null;
      if (field) field.value = value;
    }

    const category = dependencies.document.getElementById('editCategory') as HTMLInputElement | null;
    if (category) category.value = note.category || '未分类';

    const editor = dependencies.getEditor();
    const html = dependencies.cleanBody(note.body || '');
    if (editor && editor.getHTML() !== html) {
      const selection = editor.state.selection.from;
      editor.commands.setContent(html, { emitUpdate: false });
      editor.commands.setTextSelection(Math.max(1, Math.min(selection, editor.state.doc.content.size - 1)));
      dependencies.syncToolbarState(editor);
    }
  }

  return { refresh };
}
