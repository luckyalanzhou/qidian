import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureDialogPresenter } from '../../../src/features/capture/capture-dialog-presenter.ts';

function harness({ vueMounted = true, types = [{ id: 'clip', name: '网页摘录' }, { id: 'note', name: '普通笔记' }] } = {}) {
  const events = [];
  const presenter = createCaptureDialogPresenter({
    closeMenu: () => events.push('close-menu'),
    vueMounted,
    getTypes: () => types,
    getPasteMode: () => 'markdown',
    vueDialog: {
      open: configuration => events.push(['vue-open', configuration]),
      close: () => events.push('vue-close'),
    },
    legacyDialog: {
      open: configuration => events.push(['legacy-open', configuration]),
      close: () => events.push('legacy-close'),
    },
  });
  return { presenter, events };
}

test('capture presenter closes the mobile menu and opens the Vue dialog with current options', () => {
  const h = harness();

  h.presenter.open({ restoreFocusOnClose: false });

  assert.deepEqual(h.events, [
    'close-menu',
    ['vue-open', {
      types: [{ id: 'clip', name: '网页摘录' }, { id: 'note', name: '普通笔记' }],
      pasteMode: 'markdown',
      restoreFocusOnClose: false,
    }],
  ]);
});

test('capture presenter configures the legacy dialog with the clip type and closes its menu first', () => {
  const h = harness({ vueMounted: false });

  h.presenter.open();

  assert.deepEqual(h.events, [
    'close-menu',
    ['legacy-open', {
      types: [{ id: 'clip', name: '网页摘录' }, { id: 'note', name: '普通笔记' }],
      defaultType: 'clip',
      pasteMode: 'markdown',
    }],
  ]);
});

test('capture presenter falls back to the first available type and routes close to the active dialog', () => {
  const h = harness({ vueMounted: false, types: [{ id: 'note', name: '普通笔记' }] });

  h.presenter.open();
  h.presenter.close();

  assert.deepEqual(h.events, [
    'close-menu',
    ['legacy-open', {
      types: [{ id: 'note', name: '普通笔记' }],
      defaultType: 'note',
      pasteMode: 'markdown',
    }],
    'legacy-close',
  ]);
});
