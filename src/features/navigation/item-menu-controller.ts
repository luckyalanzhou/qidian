type ItemMenuWindow = Window & typeof globalThis;

export function mountItemMenuController(document: Document, window: ItemMenuWindow) {
  let frame = 0;

  function positionOpenMenus() {
    frame = 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const compact = window.matchMedia?.('(max-width: 720px)').matches ?? window.innerWidth <= 720;

    document.querySelectorAll<HTMLDetailsElement>('.item-menu[open]').forEach((menu) => {
      const panel = menu.querySelector<HTMLElement>(':scope > .item-menu-panel');
      if (!panel) return;

      menu.classList.remove('opens-left');
      panel.style.translate = '';
      const rect = menu.getBoundingClientRect();
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - (compact ? 84 : 8));
      const spaceAbove = Math.max(0, rect.top - 8);
      const heightLimit = viewportHeight * (compact ? 0.55 : 0.65);
      const naturalHeight = Math.min(panel.scrollHeight, heightLimit);
      const opensUp = spaceBelow < naturalHeight + 8 && spaceAbove > spaceBelow;

      menu.classList.toggle('opens-up', opensUp);
      panel.style.maxHeight = `${Math.max(0, Math.min(heightLimit, (opensUp ? spaceAbove : spaceBelow) - 8))}px`;
      menu.classList.toggle('opens-left', panel.getBoundingClientRect().left < 8);
      const bounds = panel.getBoundingClientRect();
      const shift = bounds.left < 8 ? 8 - bounds.left
        : bounds.right > viewportWidth - 8 ? viewportWidth - 8 - bounds.right : 0;
      if (shift) panel.style.translate = `${shift}px 0`;
    });
  }

  function schedulePosition() {
    if (frame || !window.requestAnimationFrame) return;
    frame = window.requestAnimationFrame(positionOpenMenus);
  }

  function onSummaryClick(event: Event) {
    const target = event.target as Element | null;
    if (target?.closest?.('.item-menu > summary')) schedulePosition();
  }

  function onToggle(event: Event) {
    const menu = event.target as HTMLDetailsElement | null;
    if (!menu?.matches?.('.item-menu')) return;
    if (!menu.open) {
      menu.classList.remove('opens-up');
      const panel = menu.querySelector<HTMLElement>(':scope > .item-menu-panel');
      if (panel) {
        panel.style.maxHeight = '';
        panel.style.translate = '';
      }
    } else {
      schedulePosition();
    }
  }

  function closeMenusOutside(event: Event) {
    const target = event.target as Node | null;
    document.querySelectorAll<HTMLDetailsElement>('.item-menu[open]').forEach((menu) => {
      if (target && !menu.contains(target)) menu.open = false;
    });
  }

  document.addEventListener('click', onSummaryClick, true);
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('scroll', schedulePosition, true);
  window.addEventListener('resize', schedulePosition);
  document.addEventListener('click', closeMenusOutside);

  return {
    schedulePosition,
    destroy() {
      document.removeEventListener('click', onSummaryClick, true);
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('scroll', schedulePosition, true);
      window.removeEventListener('resize', schedulePosition);
      document.removeEventListener('click', closeMenusOutside);
      if (frame && window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
