/**
 * Compatibility renderer used by migration tests. Production mounts Vue before
 * the workspace starts and never calls these imperative page renderers.
 */
export function createLegacyWorkspaceRenderer(dependencies) {
  const {
    document, window, main, getData, navigation, icons, escapeHtml, displayTypeName,
    typeLabel, noteBodyText, nowString, fullDate, isDraft, needsPublish,
    hasDraftContent, publishedView, listNotes, readerSnapshot, safeUrl,
    dashboardStore, destroyRichEditor, setBreadcrumb, openHome,
    organizeDocumentActions, mountCodeCopyButtons, mountHeadingObserver,
    noteTypesExpanded, enabled, notify
  } = dependencies;
  const $ = selector => document.querySelector(selector);

  function ensureSidebar() {
    const scroll = $('.sidebar-scroll');
    if (!scroll || $('#sideCore')) return;
    scroll.innerHTML = '<div class="side-label">导航</div><div id="sideCore"></div><div class="side-section"><div class="side-label side-heading"><button type="button" class="side-heading-toggle" id="toggleNoteTypes" aria-expanded="true" aria-controls="sideTypes" title="折叠笔记类型"><span>笔记类型</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button type="button" class="side-add" id="addNoteType" title="新增笔记类型" aria-label="新增笔记类型">＋</button></div><div id="sideTypes"></div></div>';
  }

  function renderSidebar() {
    if (enabled) return;
    const data = getData();
    ensureSidebar();
    const count = id => id === 'drafts'
      ? data.notes.filter(note => needsPublish(note) && hasDraftContent(note)).length
      : data.notes.filter(note => !isDraft(note) && (id === 'all' || (id === 'pinned' && note.pinned) || id === 'recent')).length;
    const notesContext = navigation.page === 'home' || navigation.page === 'note';
    $('#sideCore').innerHTML = `<button class="side-link ${navigation.page === 'dashboard' ? 'active' : ''}" data-dashboard>${icons('home')} 首页</button><button class="side-link ${notesContext ? 'active' : ''}" data-nav="all">${icons('book')} 笔记<span class="count">${count('all')}</span></button><button class="side-link ${navigation.page === 'bookmarks' ? 'active' : ''}" id="openBookmarks">${icons('link')} 书签<span class="count">${countLinks(data.bookmarks || [])}</span></button>` + (notesContext ? `<div class="side-label side-nav-caption">笔记视图</div>` + [['recent', 'note', '最近编辑'], ['pinned', 'heart', '重要收藏'], ['drafts', 'edit', '草稿箱']].map(([id, icon, label]) => `<button class="side-link ${navigation.active === id && navigation.page === 'home' ? 'active' : ''}" data-nav="${escapeHtml(id)}">${icons(icon)} ${label}<span class="count">${count(id)}</span></button>`).join('') : '');
    $('#sideCore').insertAdjacentHTML('beforeend', `<button class="side-link ${navigation.page === 'trash' ? 'active' : ''}" data-trash-nav>${icons('trash')} 回收站<span class="count">${(data.trash || []).length}</span></button>`);
    $('#sideTypes').closest('.side-section').hidden = !notesContext;
    const typeCount = id => data.notes.filter(note => !isDraft(note) && note.type === id).length;
    $('#sideTypes').innerHTML = `<button class="side-link type-all ${navigation.typeFilter === 'all' && navigation.page === 'home' ? 'active' : ''}" data-type-nav="all">${icons('book')} 全部类型<span class="count">${data.notes.filter(note => !isDraft(note)).length}</span></button>` + data.noteTypes.map(type => {
      const label = displayTypeName(type);
      return `<div class="type-nav-row ${navigation.typeFilter === type.id && navigation.page === 'home' ? 'active' : ''}"><button class="type-nav-link" data-type-nav="${escapeHtml(type.id)}"><span class="type-dot ${escapeHtml(type.id)}"></span><span class="type-nav-name">${escapeHtml(label)}</span><span class="count">${typeCount(type.id)}</span></button><div class="type-nav-actions"><button type="button" data-type-edit="${escapeHtml(type.id)}" title="编辑${escapeHtml(label)}" aria-label="编辑${escapeHtml(label)}">${icons('edit')}</button><button type="button" data-type-delete="${escapeHtml(type.id)}" title="删除${escapeHtml(label)}" aria-label="删除${escapeHtml(label)}" ${data.noteTypes.length === 1 && type.id === 'note' ? 'disabled' : ''}>${icons('trash')}</button></div></div>`;
    }).join('');
    const expanded = noteTypesExpanded();
    $('#sideTypes').hidden = !expanded;
    const toggle = $('#toggleNoteTypes');
    toggle?.setAttribute('aria-expanded', String(expanded));
    toggle?.setAttribute('aria-label', expanded ? '折叠笔记类型' : '展开笔记类型');
    toggle?.setAttribute('title', expanded ? '折叠笔记类型' : '展开笔记类型');
  }

  function noteCard(note) {
    const description = noteBodyText(note.body, note.title);
    return `<article class="note-card"><div class="note-card-open" data-open="${escapeHtml(note.id)}" role="button" tabindex="0" aria-label="打开笔记：${escapeHtml(note.title || '无标题笔记')}"><div class="note-kicker"><span class="type-dot ${escapeHtml(note.type)}"></span>${escapeHtml(typeLabel(note.type))}</div>${note.pinned ? '<span class="pin-top" title="已收藏">★</span>' : ''}<h3>${escapeHtml(note.title || '无标题笔记')}</h3><p>${escapeHtml(description || '空白笔记，点击开始编辑。')}</p><div class="note-foot">${(note.tags || []).slice(0, 2).map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}<span class="date">${nowString(note.updated)}</span></div></div><details class="item-menu note-item-menu"><summary aria-label="更多：${escapeHtml(note.title || '无标题笔记')}">···</summary><div class="item-menu-panel"><button data-note-edit="${escapeHtml(note.id)}">编辑</button><button class="danger-btn" data-note-delete="${escapeHtml(note.id)}">删除</button></div></details></article>`;
  }

  function countLinks(entries = []) {
    return entries.reduce((total, item) => total + (item.kind === 'link' ? 1 : countLinks(item.children || [])), 0);
  }

  function dashboardBookmarkTree(entries, folderPath = [], depth = 0, expandRoots = true, data = getData()) {
    return entries.map(item => {
      if (item.kind === 'folder') {
        const path = [...folderPath, item.title];
        const open = data.dashboardBookmarkFolders?.[item.id] ?? (depth === 0 && expandRoots);
        return `<details class="${depth ? 'dashboard-bookmark-branch' : 'dashboard-bookmark-card'}" data-dashboard-folder="${escapeHtml(item.id)}" ${open ? 'open' : ''}><summary class="dashboard-bookmark-group" data-dashboard-bookmark-folder="${escapeHtml(item.id)}" aria-expanded="${open}"><span class="dashboard-group-icon">${icons('folder')}</span><span class="dashboard-group-copy"><strong>${escapeHtml(item.title)}</strong><small>${countLinks(item.children || [])} 个网址</small></span>${icons('chevron')}</summary><div class="dashboard-bookmark-children">${item.children?.length ? dashboardBookmarkTree(item.children, path, depth + 1, expandRoots, data) : '<p class="dashboard-folder-empty">暂无书签</p>'}</div></details>`;
      }
      if (!safeUrl(item.url)) return '';
      return `<a class="dashboard-bookmark-preview-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(item.url)}"><span class="dashboard-preview-icon">${icons('link')}</span><span class="dashboard-preview-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(folderPath.join(' / '))}</small></span></a>`;
    }).join('');
  }

  function dashboardLayout() {
    return getData().dashboardBookmarkLayout === 'double' ? 'double' : 'single';
  }

  function saveFolderState(folder) {
    const data = getData();
    const id = folder.dataset.dashboardFolder;
    folder.querySelector(':scope > summary')?.setAttribute('aria-expanded', String(folder.open));
    if ((data.dashboardBookmarkFolders || {})[id] === folder.open) return false;
    dashboardStore.saveFolder(id, folder.open);
    return true;
  }

  if (!enabled) main.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof window.Element)) return;
    const layout = target.closest('[data-dashboard-layout]');
    if (layout) {
      const next = layout.dataset.dashboardLayout === 'double' ? 'double' : 'single';
      dashboardStore.setLayout(next);
      main.querySelector('.dashboard-bookmark-groups')?.classList.toggle('is-double', next === 'double');
      main.querySelectorAll('button[data-dashboard-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dashboardLayout === next)));
      return;
    }
    const bulk = target.closest('[data-dashboard-folders]');
    if (bulk) {
      const open = bulk.dataset.dashboardFolders === 'expand';
      const folders = [...main.querySelectorAll('details[data-dashboard-folder]')];
      folders.forEach(folder => {
        folder.open = open;
        folder.querySelector(':scope > summary')?.setAttribute('aria-expanded', String(open));
      });
      dashboardStore.setAllFolders(folders.map(folder => folder.dataset.dashboardFolder), open);
      return;
    }
    const summary = target.closest('summary[data-dashboard-bookmark-folder]');
    if (!summary) return;
    event.preventDefault();
    const folder = summary.parentElement;
    folder.open = !folder.open;
    saveFolderState(folder);
  });

  function renderDashboard() {
    const data = getData();
    destroyRichEditor();
    setBreadcrumb('首页');
    const published = data.notes.filter(note => !isDraft(note)).sort((a, b) => b.updated - a.updated).map(publishedView);
    const recent = published.slice(0, 4);
    const folders = (data.bookmarks || []).filter(item => item.kind === 'folder');
    const rootLinks = (data.bookmarks || []).filter(item => item.kind === 'link');
    const groups = [...folders, ...(rootLinks.length ? [{ id: '', kind: 'folder', title: '未分组', children: rootLinks }] : [])];
    const bookmarkTotal = countLinks(data.bookmarks || []);
    const folderTotal = (data.bookmarks || []).filter(item => item.kind === 'folder').length;
    const featured = [...published.filter(note => note.pinned).slice(0, 2), ...recent].filter((note, index, all) => all.findIndex(item => item.id === note.id) === index).slice(0, 6);
    const noteCards = featured.map(noteCard).join('');
    const groupCards = dashboardBookmarkTree(groups, [], 0, groups.length <= 4, data);
    const pinnedLinks = [];
    const collectPinned = (items, path = []) => items.forEach(item => {
      if (item.kind === 'folder') collectPinned(item.children, [...path, item.title]);
      else if (item.pinned) pinnedLinks.push({ item, path });
    });
    collectPinned(data.bookmarks || []);
    const pinnedHtml = pinnedLinks.slice(0, 8).map(({ item, path }) => dashboardBookmarkTree([item], path, 0, true, data)).join('');
    const layout = dashboardLayout();
    main.innerHTML = `<div class="dashboard-page"><header class="dashboard-intro"><div class="dashboard-intro-copy"><h1>我的空间</h1><p>笔记保存内容；书签保存网址。</p></div><button class="secondary-btn" id="quickCapture" type="button">${icons('clip')} 网页摘录</button></header><div class="dashboard-workspaces"><section class="dashboard-section dashboard-note-workspace" aria-labelledby="dashboardNotesTitle"><div class="dashboard-section-head"><div><h2 id="dashboardNotesTitle">笔记</h2><p>最近笔记 · ${published.length} 篇</p></div><div class="dashboard-section-actions"><button class="secondary-btn" type="button" data-new="note">${icons('plus')} 新建笔记</button><button type="button" class="dashboard-view-all" data-nav="all">全部笔记 ${icons('chevron')}</button></div></div>${featured.length ? `<div class="notes dashboard-notes">${noteCards}</div>` : `<div class="dashboard-empty"><span>还没有笔记</span><button type="button" data-new="note">写下第一篇 ${icons('chevron')}</button></div>`}</section><section class="dashboard-section dashboard-bookmarks" aria-labelledby="dashboardBookmarksTitle"><div class="dashboard-section-head"><div><h2 id="dashboardBookmarksTitle">书签</h2><p>${bookmarkTotal} 个网址 · ${folderTotal} 个顶层分组</p></div><div class="dashboard-section-actions"><button class="secondary-btn" type="button" data-dashboard-add-bookmark>${icons('plus')} 添加书签</button><button type="button" class="dashboard-view-all" data-open-bookmarks>全部书签 ${icons('chevron')}</button></div></div>${pinnedHtml ? `<div class="dashboard-pinned-bookmarks"><h3>常用书签</h3>${pinnedHtml}</div>` : ''}${groupCards ? `<div class="dashboard-bookmark-controls"><span class="dashboard-layout-switch" role="group" aria-label="书签分组排列"><button type="button" data-dashboard-layout="single" aria-pressed="${layout === 'single'}">单列</button><button type="button" data-dashboard-layout="double" aria-pressed="${layout === 'double'}">双列</button></span><span class="dashboard-folder-actions"><button type="button" data-dashboard-folders="expand">展开全部</button><button type="button" data-dashboard-folders="collapse">收起全部</button></span></div><div class="dashboard-bookmark-groups ${layout === 'double' ? 'is-double' : ''}">${groupCards}</div>` : `<div class="dashboard-empty"><span>还没有书签</span><button type="button" data-dashboard-add-bookmark>添加第一个网址 ${icons('chevron')}</button></div>`}</section></div></div>`;
  }

  function renderHome() {
    const data = getData();
    destroyRichEditor();
    const heading = navigation.typeFilter !== 'all' ? typeLabel(navigation.typeFilter) : navigation.active === 'all' ? '全部笔记' : navigation.active === 'recent' ? '最近编辑' : navigation.active === 'pinned' ? '重要收藏' : navigation.active === 'drafts' ? '草稿箱' : navigation.active;
    setBreadcrumb(heading);
    const filtered = listNotes(navigation.noteQuery);
    main.innerHTML = `<div class="note-page-layout"><div class="section-head workspace-page-head"><div><h1>${escapeHtml(heading)}</h1><p class="muted">${filtered.length} 篇笔记</p></div><div class="section-right"><button class="secondary-btn" data-new="note">${icons('plus')} 新建笔记</button></div></div><label class="workspace-search note-page-search">${icons('search')}<input id="notePageSearch" type="search" aria-label="筛选当前笔记标题、正文和标签" placeholder="筛选本页笔记标题、正文和标签" value="${escapeHtml(navigation.noteQuery)}"></label><div class="filter-tabs home-type-tabs"><button data-type="all" class="${navigation.typeFilter === 'all' ? 'selected' : ''}">全部类型</button>${data.noteTypes.map(type => `<button data-type="${escapeHtml(type.id)}" class="${navigation.typeFilter === type.id ? 'selected' : ''}">${escapeHtml(displayTypeName(type))}</button>`).join('')}</div><div class="notes note-list">${filtered.map(noteCard).join('')}</div>${!filtered.length ? `<div class="empty">${navigation.active === 'drafts' ? '暂无草稿。可以创建一条笔记。' : '还没有笔记，先写下第一条。'}</div>` : ''}</div>`;
    $('#notePageSearch').oninput = event => {
      navigation.noteQuery = event.target.value;
      const notes = listNotes(navigation.noteQuery);
      main.querySelector('.note-list').innerHTML = notes.map(noteCard).join('') || '<div class="empty">没有找到匹配的笔记</div>';
      main.querySelector('.workspace-page-head .muted').textContent = `${notes.length} 篇笔记`;
    };
  }

  function renderReader() {
    main.__readerHeadingCleanup?.();
    destroyRichEditor();
    const data = getData();
    const stored = data.notes.find(note => note.id === navigation.noteId);
    if (!stored) {
      openHome();
      return;
    }
    const working = navigation.previewing || isDraft(stored);
    const note = working ? stored : publishedView(stored);
    setBreadcrumb(note.title);
    const snapshot = readerSnapshot(stored, working, note);
    const outline = snapshot.outline;
    const toc = outline.map(item => `<a href="#${escapeHtml(item.id)}" class="${item.level > 2 ? 'sub ' : ''}toc-level-${item.level}">${escapeHtml(item.name)}</a>`).join('');
    const primary = snapshot.publishLabel ? `<button class="primary-btn" id="publishDoc">${icons('check')} ${snapshot.publishLabel}</button><button class="secondary-btn" id="editDoc">${icons('edit')} 编辑笔记</button>` : `<button class="primary-btn" id="editDoc">${icons('edit')} ${snapshot.editLabel}</button>`;
    main.innerHTML = `<div class="note-shell reader-shell"><section><div class="doc-head"><button class="doc-back" id="backDoc">${icons('back')} 返回笔记列表</button><div class="doc-meta"><span class="pill">${escapeHtml(snapshot.typeLabel)}</span><span class="doc-date">更新于 ${escapeHtml(snapshot.updatedLabel)} · 阅读约 ${snapshot.readingMinutes} 分钟</span></div><h1 class="doc-title">${escapeHtml(snapshot.title)}</h1><div class="doc-desc">${snapshot.tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join(' ')} ${snapshot.source ? `<span class="reader-source">来源：<a href="${snapshot.sourceUrl ? escapeHtml(snapshot.sourceUrl) : '#'}" target="_blank" rel="noopener noreferrer">原始网页 ↗</a></span>` : ''}</div><div class="doc-action-row">${primary}${snapshot.showPendingChanges ? '<button class="secondary-btn" id="showDraftView">查看待发布修改</button>' : ''}<button class="secondary-btn" id="pinDoc">${icons('heart')} ${snapshot.pinned ? '取消收藏' : '收藏'}</button><button class="secondary-btn" id="duplicateDoc">${icons('clip')} 创建副本</button><button class="secondary-btn danger-btn" id="deleteDoc">${icons('trash')} 删除</button></div></div>${outline.length ? `<details class="mobile-toc"><summary>本文目录 <span>${outline.length} 个章节</span></summary><nav class="outline">${toc}</nav></details>` : ''}<article class="read-paper"><div class="doc-content" id="docRead">${snapshot.bodyHtml || '<p class="hint">这里还没有内容。点击“编辑笔记”开始。</p>'}</div></article></section><aside class="right-rail"><h3>本文目录</h3><nav class="outline">${toc || '<span class="hint">暂无标题</span>'}</nav><div class="rail-rule"></div><h3>笔记信息</h3><div class="rail-source">创建：${escapeHtml(snapshot.createdLabel)}<br>类型：${escapeHtml(snapshot.typeLabel)}<br>来源：${snapshot.source ? `<a href="${snapshot.sourceUrl ? escapeHtml(snapshot.sourceUrl) : '#'}" target="_blank" rel="noopener noreferrer">${escapeHtml(snapshot.source)}</a>` : '自己记录'}</div></aside></div>`;
    organizeDocumentActions();
    const codeRoot = $('#docRead');
    if (codeRoot) mountCodeCopyButtons(codeRoot, notify);
    const headings = [...main.querySelectorAll('#docRead h1, #docRead h2, #docRead h3, #docRead h4, #docRead h5, #docRead h6')];
    const links = [...main.querySelectorAll('.reader-shell .outline a')];
    const createObserver = typeof window.IntersectionObserver === 'function'
      ? (callback, options) => new window.IntersectionObserver(callback, options)
      : null;
    main.__readerHeadingCleanup = mountHeadingObserver(headings, links, undefined, createObserver);
  }

  return { renderSidebar, renderDashboard, renderHome, renderReader };
}
