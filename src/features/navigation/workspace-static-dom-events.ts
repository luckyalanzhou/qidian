export type WorkspaceStaticDomEventsDependencies = {
  closeCapture: () => void;
  closeCreateMenu: () => void;
  handleCapturePaste: (event: ClipboardEvent) => unknown;
  saveNoteType: () => unknown;
};

function element(target: EventTarget | null): Element | null {
  return target && typeof (target as Element).matches === 'function' ? target as Element : null;
}

export function mountWorkspaceStaticDomEvents(
  document: Document,
  dependencies: WorkspaceStaticDomEventsDependencies
): () => void {
  const slashMenu = document.querySelector('#slashMenu');
  const capturePad = document.querySelector('#capturePad');
  const typeDialogBody = document.querySelector('#typeDialogBody');
  const captureOverlay = document.querySelector('#captureOverlay');
  const typeOverlay = document.querySelector('#typeOverlay');

  const preventSlashMenuBlur = (event: Event) => event.preventDefault();
  const closeCreateOverlay = (event: Event) => {
    if (element(event.target)?.id === 'createOverlay') dependencies.closeCreateMenu();
  };
  const handleTypeDialogKeydown = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Enter' && element(keyboard.target)?.id === 'typeNameInput') {
      keyboard.preventDefault();
      dependencies.saveNoteType();
    }
  };
  const handleCapturePaste = (event: Event) => dependencies.handleCapturePaste(event as ClipboardEvent);
  const closeCaptureOverlay = (event: Event) => {
    if (element(event.target)?.id === 'captureOverlay') dependencies.closeCapture();
  };
  const closeTypeOverlay = (event: Event) => {
    if (element(event.target)?.id === 'typeOverlay') element(event.target)?.classList.remove('open');
  };

  slashMenu?.addEventListener('mousedown', preventSlashMenuBlur);
  document.addEventListener('click', closeCreateOverlay);
  typeDialogBody?.addEventListener('keydown', handleTypeDialogKeydown);
  capturePad?.addEventListener('paste', handleCapturePaste);
  captureOverlay?.addEventListener('click', closeCaptureOverlay);
  typeOverlay?.addEventListener('click', closeTypeOverlay);

  return () => {
    slashMenu?.removeEventListener('mousedown', preventSlashMenuBlur);
    document.removeEventListener('click', closeCreateOverlay);
    typeDialogBody?.removeEventListener('keydown', handleTypeDialogKeydown);
    capturePad?.removeEventListener('paste', handleCapturePaste);
    captureOverlay?.removeEventListener('click', closeCaptureOverlay);
    typeOverlay?.removeEventListener('click', closeTypeOverlay);
  };
}
