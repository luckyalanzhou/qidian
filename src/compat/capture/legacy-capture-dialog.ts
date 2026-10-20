export type CaptureDialogTypeOption = { id: string; name: string };
export type CaptureDialogInput = {
  title: string;
  type: string;
  source: string;
  body: string;
};

type LegacyCaptureDialogDependencies = {
  document: Document;
  escapeHtml: (value: string) => string;
};

type LegacyCaptureDialogConfiguration = {
  types: CaptureDialogTypeOption[];
  defaultType: string;
  pasteMode: string;
};

export function createLegacyCaptureDialog({ document, escapeHtml }: LegacyCaptureDialogDependencies) {
  const query = <T extends Element>(selector: string): T | null => document.querySelector<T>(selector);

  function open(configuration: LegacyCaptureDialogConfiguration): void {
    const overlay = query<HTMLElement>('#captureOverlay');
    const type = query<HTMLSelectElement>('#captureType');
    const title = query<HTMLInputElement>('#captureName');
    const source = query<HTMLInputElement>('#captureSource');
    const pad = query<HTMLElement>('#capturePad');
    const pasteMode = query<HTMLSelectElement>('#capturePasteMode');
    if (!overlay || !type || !title || !source || !pad || !pasteMode) {
      throw new Error('快速收集表单结构不完整');
    }

    type.innerHTML = configuration.types
      .map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
      .join('');
    type.value = configuration.defaultType;
    title.value = '';
    source.value = '';
    pad.innerHTML = '';
    pasteMode.value = configuration.pasteMode;
    overlay.classList.add('open');
    setTimeout(() => pad.focus(), 100);
  }

  function readInput(): CaptureDialogInput {
    return {
      title: query<HTMLInputElement>('#captureName')?.value || '',
      type: query<HTMLSelectElement>('#captureType')?.value || '',
      source: query<HTMLInputElement>('#captureSource')?.value || '',
      body: query<HTMLElement>('#capturePad')?.innerHTML || '',
    };
  }

  function close(): void {
    query<HTMLElement>('#captureOverlay')?.classList.remove('open');
  }

  return { open, readInput, close };
}
