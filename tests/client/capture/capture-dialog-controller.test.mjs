import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureDialogController } from '../../../src/features/capture/capture-dialog-controller.ts';

function createHarness({ saveError = null, legacyDialog = true } = {}) {
  const calls = [];
  const controller = createCaptureDialogController({
    save: async input => {
      calls.push(['save', input]);
      if (saveError) throw new Error(saveError);
      return { id: 'capture-1' };
    },
    openNote: id => calls.push(['open-note', id]),
    legacyDialog: legacyDialog ? {
      readInput: () => ({ title: '网页资料', type: 'clip', source: '', body: '<p>正文</p>' }),
      close: () => calls.push('legacy-close')
    } : null,
    notify: message => calls.push(['notify', message])
  });
  return { calls, controller };
}

test('Vue capture opens the saved note only after the Vault flow succeeds', async () => {
  const { calls, controller } = createHarness();
  const input = { title: '网页资料', type: 'clip', source: '', body: '<p>正文</p>' };

  await controller.saveVue(input);

  assert.deepEqual(calls, [['save', input], ['open-note', 'capture-1']]);
});

test('legacy capture closes and navigates after persistence, but stays open and reports a failed write', async () => {
  const success = createHarness();
  await success.controller.saveLegacy();
  assert.deepEqual(success.calls, [
    ['save', { title: '网页资料', type: 'clip', source: '', body: '<p>正文</p>' }],
    'legacy-close', ['open-note', 'capture-1']
  ]);

  const failure = createHarness({ saveError: 'SQLite 提交失败' });
  await failure.controller.saveLegacy();
  assert.deepEqual(failure.calls, [
    ['save', { title: '网页资料', type: 'clip', source: '', body: '<p>正文</p>' }],
    ['notify', 'SQLite 提交失败']
  ]);
});

test('capture controller rejects Vue errors for the store and safely ignores absent legacy dialogs', async () => {
  const vueFailure = createHarness({ saveError: '标题或正文不能为空' });
  const input = { title: '', type: 'clip', source: '', body: '' };
  await assert.rejects(vueFailure.controller.saveVue(input), /标题或正文不能为空/);
  assert.deepEqual(vueFailure.calls, [['save', input]]);

  const absentLegacy = createHarness({ legacyDialog: false });
  await absentLegacy.controller.saveLegacy();
  assert.deepEqual(absentLegacy.calls, []);
});
