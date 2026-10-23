import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeController } from '../../../src/features/appearance/theme-controller.ts';

function harness({ preference = 'system', dark = false } = {}) {
  const calls = [];
  const root = { dataset: {} };
  const themeColor = { setAttribute: (...args) => calls.push(['theme-color', ...args]) };
  const listeners = new Set();
  const media = {
    matches: dark,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener)
  };
  const controller = createThemeController({
    document: { documentElement: root, querySelector: () => themeColor },
    media,
    getPreference: () => preference,
    setPreference: value => { preference = value; calls.push(['preference', value]); },
    persist: () => calls.push(['persist']),
    setResolvedState: (value, isDark) => calls.push(['resolved', value, isDark])
  });
  return {
    controller,
    calls,
    root,
    listeners,
    setPreference: value => { preference = value; },
    setSystemDark: value => { media.matches = value; for (const listener of listeners) listener({ matches: value }); }
  };
}

test('system theme follows OS changes and does not persist those display-only updates', () => {
  const h = harness({ preference: 'system' });
  const unmount = h.controller.mount();
  assert.equal(h.root.dataset.theme, 'light');
  h.setSystemDark(true);
  assert.equal(h.root.dataset.theme, 'dark');
  assert.equal(h.root.dataset.themePreference, 'system');
  assert.equal(h.calls.some(call => call[0] === 'persist'), false);
  unmount();
  assert.equal(h.listeners.size, 0);
});

test('manual theme choice persists once and updates the document and Pinia projection', () => {
  const h = harness({ preference: 'light' });
  h.controller.apply('dark', { save: true });
  assert.deepEqual(h.calls, [
    ['preference', 'dark'],
    ['theme-color', 'content', '#141b18'],
    ['resolved', 'dark', true],
    ['persist']
  ]);
  assert.deepEqual(h.root.dataset, { theme: 'dark', themePreference: 'dark' });
});

test('OS theme changes do not override an explicit preference and invalid values normalize to light', () => {
  const h = harness({ preference: 'dark', dark: false });
  const unmount = h.controller.mount();
  h.setSystemDark(true);
  assert.equal(h.root.dataset.theme, 'dark');
  h.setPreference('unknown');
  h.controller.sync();
  assert.deepEqual(h.root.dataset, { theme: 'light', themePreference: 'light' });
  unmount();
});
