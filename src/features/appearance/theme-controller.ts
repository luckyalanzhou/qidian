export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeControllerDependencies = {
  document: Pick<Document, 'documentElement' | 'querySelector'>;
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'> & {
    addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  } | null;
  getPreference: () => string | undefined;
  setPreference: (preference: ThemePreference) => void;
  persist: () => unknown;
  setResolvedState: (preference: ThemePreference, resolvedDark: boolean) => void;
};

const normalizePreference = (value: string | undefined): ThemePreference =>
  value === 'system' || value === 'dark' ? value : 'light';

export function createThemeController(dependencies: ThemeControllerDependencies) {
  const { document, media } = dependencies;

  function sync() {
    const preference = normalizePreference(dependencies.getPreference());
    const resolvedDark = preference === 'system' ? !!media?.matches : preference === 'dark';
    document.documentElement.dataset.theme = resolvedDark ? 'dark' : 'light';
    document.documentElement.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedDark ? '#141b18' : '#f8f9f7');
    dependencies.setResolvedState(preference, resolvedDark);
  }

  function apply(value: string, { save = false }: { save?: boolean } = {}) {
    const preference = normalizePreference(value);
    if (dependencies.getPreference() !== preference) dependencies.setPreference(preference);
    sync();
    if (save) dependencies.persist();
  }

  function handleSystemThemeChange() {
    if (normalizePreference(dependencies.getPreference()) === 'system') sync();
  }

  function mount() {
    if (media?.addEventListener) media.addEventListener('change', handleSystemThemeChange);
    else media?.addListener?.(handleSystemThemeChange);
    sync();
    return unmount;
  }

  function unmount() {
    if (media?.removeEventListener) media.removeEventListener('change', handleSystemThemeChange);
    else media?.removeListener?.(handleSystemThemeChange);
  }

  return { apply, sync, mount, unmount };
}
