type WorkspaceContentDependencies = {
  openCreateMenu: () => void;
  openCapture: () => void;
  beginEdit: () => void;
  showDraftPreview: () => void;
  publishNote: () => void;
  togglePinned: () => Promise<void> | void;
  duplicateNote: () => void;
  deleteEditorNote: () => Promise<void> | void;
  deleteCurrentNote: () => Promise<void> | void;
  saveEditor: () => void;
  chooseAttachment: () => void;
  exportCurrentNote: () => void;
  chooseImage: () => void;
  saveCapture: () => Promise<void> | void;
  addNoteType: () => void;
  saveNoteType: () => Promise<void> | void;
  downloadBackup: (revision: string) => void;
  restoreBackup: (revision: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  searchOpen: () => boolean;
};

function closest(target: EventTarget | null, selector: string): Element | null {
  if (!target || typeof (target as Element).closest !== 'function') return null;
  return (target as Element).closest(selector);
}

function attribute(element: Element, name: string): string {
  return element.getAttribute(name) || '';
}

export function createWorkspaceContentEvents(dependencies: WorkspaceContentDependencies) {
  function handleClick(target: EventTarget | null): boolean | Promise<boolean> {
    if (closest(target, '#newSide')) dependencies.openCreateMenu();
    else if (closest(target, '#quickCapture')) dependencies.openCapture();
    else if (closest(target, '#editDoc')) dependencies.beginEdit();
    else if (closest(target, '#showDraftView')) dependencies.showDraftPreview();
    else if (closest(target, '#publishDoc')) dependencies.publishNote();
    else if (closest(target, '#pinDoc')) return Promise.resolve(dependencies.togglePinned()).then(() => true);
    else if (closest(target, '#duplicateDoc')) dependencies.duplicateNote();
    else if (closest(target, '#deleteEditorNote')) return Promise.resolve(dependencies.deleteEditorNote()).then(() => true);
    else if (closest(target, '#deleteDoc')) return Promise.resolve(dependencies.deleteCurrentNote()).then(() => true);
    else if (closest(target, '#saveEditor')) dependencies.saveEditor();
    else if (closest(target, '#addAttachment')) dependencies.chooseAttachment();
    else if (closest(target, '#exportHtml')) dependencies.exportCurrentNote();
    else if (closest(target, '#addImgButton')) dependencies.chooseImage();
    else if (closest(target, '#captureSave')) return Promise.resolve(dependencies.saveCapture()).then(() => true);
    else if (closest(target, '#addNoteType')) dependencies.addNoteType();
    else if (closest(target, '#typeDialogConfirm')) return Promise.resolve(dependencies.saveNoteType()).then(() => true);
    else {
      const download = closest(target, '[data-backup-download]');
      if (download) dependencies.downloadBackup(attribute(download, 'data-backup-download'));
      else {
        const restore = closest(target, '[data-backup-restore]');
        if (restore) dependencies.restoreBackup(attribute(restore, 'data-backup-restore'));
        else if (closest(target, '#searchTop,#mobileSearch')) dependencies.openSearch();
        else if (!closest(target, '#switcher') && dependencies.searchOpen()) dependencies.closeSearch();
        else return false;
      }
    }
    return true;
  }

  return { handleClick };
}
