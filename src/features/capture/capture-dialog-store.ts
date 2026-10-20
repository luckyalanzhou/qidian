import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CaptureInput } from './capture-flow.ts';

export type CaptureTypeOption = { id: string; name: string };
type CaptureDialogOptions = {
  types: CaptureTypeOption[];
  pasteMode: string;
  restoreFocusOnClose?: boolean;
};
type SaveHandler = (input: CaptureInput) => Promise<void> | void;
type PasteHandler = (event: ClipboardEvent) => unknown;

const pasteModes = new Set(['rich', 'match', 'markdown', 'plain']);

export const useCaptureDialogStore = defineStore('capture-dialog', () => {
  const visible = ref(false);
  const saving = ref(false);
  const restoreFocusOnClose = ref(true);
  const message = ref('');
  const title = ref('');
  const type = ref('clip');
  const source = ref('');
  const pasteMode = ref('rich');
  const types = ref<CaptureTypeOption[]>([]);
  let saveHandler: SaveHandler = () => undefined;
  let pasteHandler: PasteHandler = () => undefined;

  function open(options: CaptureDialogOptions) {
    title.value = '';
    source.value = '';
    message.value = '';
    types.value = [...options.types];
    type.value = options.types.find(item => item.id === 'clip')?.id || options.types[0]?.id || 'note';
    pasteMode.value = pasteModes.has(options.pasteMode) ? options.pasteMode : 'rich';
    restoreFocusOnClose.value = options.restoreFocusOnClose !== false;
    visible.value = true;
  }

  function close() {
    if (saving.value) return;
    visible.value = false;
    message.value = '';
  }

  function bindSave(handler: SaveHandler) {
    saveHandler = handler;
  }

  function bindPasteHandler(handler: PasteHandler) {
    pasteHandler = handler;
  }

  function handlePaste(event: ClipboardEvent) {
    return pasteHandler(event);
  }

  async function submit(body: string) {
    if (saving.value) return false;
    saving.value = true;
    message.value = '';
    try {
      await saveHandler({
        title: title.value,
        type: type.value,
        source: source.value,
        body
      });
      visible.value = false;
      return true;
    } catch (error) {
      message.value = error instanceof Error ? error.message : '网页摘录尚未保存';
      return false;
    } finally {
      saving.value = false;
    }
  }

  return { visible, saving, restoreFocusOnClose, message, title, type, source, pasteMode, types, open, close, bindSave, bindPasteHandler, handlePaste, submit };
});
