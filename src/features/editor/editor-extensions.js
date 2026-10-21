import { Extension, Mark, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import Image from '@tiptap/extension-image';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from '@tiptap/pm/schema-list';

const allowedStyle = (element, names) => names.map(name => {
  const value = element.style.getPropertyValue(name).trim();
  return value && value.length <= 40 && !/url\s*\(|expression|[<>]/i.test(value) ? [name, value] : null;
}).filter(Boolean);

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      class: {
        default: 'callout',
        parseHTML: element => ['callout', ...['warn', 'good'].filter(name => element.classList.contains(name))].join(' '),
        renderHTML: attributes => ({ class: attributes.class || 'callout' }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div.callout' }],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes, 0],
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: source => {
      const match = /^ {0,3}(?:(?:>\s*)?\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|:::(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\b)/im.exec(source);
      return match ? match.index : -1;
    },
    tokenize: (source, _tokens, lexer) => {
      const fenced = /^ {0,3}:::(NOTE|TIP|IMPORTANT|WARNING|CAUTION)(?:[ \t]+([^\n]*))?\n([\s\S]*?)\n {0,3}:::\s*(?:\n|$)/i.exec(source);
      if (fenced) return {
        type: 'callout', raw: fenced[0], alertType: fenced[1].toUpperCase(), title: fenced[2]?.trim() || '',
        tokens: lexer.blockTokens(fenced[3]),
      };
      const lines = source.split('\n');
      const marker = lines[0]?.match(/^ {0,3}>?\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
      if (!marker) return undefined;
      const body = [];
      let consumed = 1;
      while (consumed < lines.length && lines[consumed].trim()) {
        body.push(lines[consumed++].replace(/^ {0,3}>\s?/, ''));
      }
      const raw = lines.slice(0, consumed).join('\n') + (consumed < lines.length ? '\n' : '');
      return {
        type: 'callout', raw, alertType: marker[1].toUpperCase(), title: marker[2].trim(),
        tokens: lexer.blockTokens(body.join('\n')),
      };
    },
  },
  parseMarkdown: (token, helpers) => {
    const className = ['WARNING', 'CAUTION'].includes(token.alertType) ? 'callout warn' : token.alertType === 'TIP' ? 'callout good' : 'callout';
    const content = helpers.parseChildren(token.tokens || []);
    if (token.title) content.unshift({ type: 'paragraph', content: [{ type: 'text', text: token.title, marks: [{ type: 'bold' }] }] });
    if (!content.length) content.push({ type: 'paragraph' });
    return { type: 'callout', attrs: { class: className }, content };
  },
  renderMarkdown: (node, helpers) => {
    const className = String(node.attrs?.class || '');
    const kind = className.includes('warn') ? 'warning' : className.includes('good') ? 'tip' : 'note';
    const body = helpers.renderChildren(node.content || []).trimEnd();
    return `:::${kind}\n${body}\n:::\n\n`;
  },
});

const LegacyContainer = Node.create({
  name: 'legacyContainer',
  group: 'block',
  content: 'block*',
  defining: true,
  addAttributes() {
    return {
      tag: { default: 'div', parseHTML: element => ['section', 'article'].includes(element.tagName.toLowerCase()) ? element.tagName.toLowerCase() : 'div' },
      style: { default: null, parseHTML: element => allowedStyle(element, ['background-color', 'color', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'font-size', 'margin-left', 'vertical-align']).map(([key, value]) => `${key}: ${value}`).join('; ') || null },
    };
  },
  parseHTML: () => [
    { tag: 'div:not(.callout)' },
    { tag: 'section' },
    { tag: 'article' },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [node.attrs.tag, HTMLAttributes, 0],
});

const FigureCaption = Node.create({
  name: 'figureCaption',
  inline: true,
  group: 'inline',
  content: 'inline*',
  defining: true,
  parseHTML: () => [{ tag: 'figcaption' }],
  renderHTML: ({ HTMLAttributes }) => ['figcaption', HTMLAttributes, 0],
});

const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML: () => [{ tag: 'figure' }],
  renderHTML: ({ HTMLAttributes }) => ['figure', HTMLAttributes, 0],
});

const SmallText = Mark.create({
  name: 'smallText',
  parseHTML: () => [{ tag: 'small' }],
  renderHTML: ({ HTMLAttributes }) => ['small', HTMLAttributes, 0],
});

const safeLink = value => /^(?:https?:\/\/|mailto:|#|\/(?!\/))/i.test(String(value || '').trim());

const Link = Mark.create({
  name: 'link',
  inclusive: false,
  parseMarkdown: (token, helpers) => ({
    mark: 'link',
    attrs: { href: safeLink(token.href) ? String(token.href).trim() : null },
    content: helpers.parseInline(token.tokens || []),
  }),
  renderMarkdown: (node, helpers) => {
    const href = safeLink(node.attrs?.href) ? String(node.attrs.href).trim() : '';
    const label = helpers.renderChildren(node.content || []);
    if (!href) return label;
    return `[${label.replaceAll(']', '\\]')}](${href.replaceAll(' ', '%20').replaceAll(')', '%29')})`;
  },
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: element => safeLink(element.getAttribute('href')) ? element.getAttribute('href').trim() : null,
        renderHTML: attributes => safeLink(attributes.href) ? { href: attributes.href.trim() } : {},
      },
    };
  },
  parseHTML: () => [{ tag: 'a[href]', getAttrs: element => safeLink(element.getAttribute('href')) ? null : false }],
  renderHTML: ({ HTMLAttributes }) => ['a', { ...HTMLAttributes, target: '_blank', rel: 'noopener noreferrer' }, 0],
});

const QidianTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: element => element.style.fontSize || null,
        renderHTML: attributes => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
      },
      backgroundColor: {
        default: null,
        parseHTML: element => element.style.backgroundColor || null,
        renderHTML: attributes => attributes.backgroundColor ? { style: `background-color: ${attributes.backgroundColor}` } : {},
      },
    };
  },
});

const QidianImage = Image.extend({
  inline: true,
  group: 'inline',
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: element => {
          const width = element.style.width || element.getAttribute('width');
          return /^(?:25|50|75|100)%$|^\d{1,4}px$/.test(String(width || '')) ? width : null;
        },
        renderHTML: attributes => attributes.width ? { style: `width: ${attributes.width}; max-width: 100%` } : { style: 'max-width: 100%' },
      },
    };
  },
});

const QidianTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: element => allowedStyle(element, ['background-color', 'color', 'text-align']).map(([key, value]) => `${key}: ${value}`).join('; ') || null,
        renderHTML: attributes => attributes.style ? { style: attributes.style } : {},
      },
    };
  },
});

const TaskList = Node.create({
  name: 'taskList',
  group: 'block',
  content: 'taskItem+',
  defining: true,
  parseHTML: () => [{ tag: 'ul[data-type="taskList"]' }],
  renderHTML: ({ HTMLAttributes }) => ['ul', { ...HTMLAttributes, 'data-type': 'taskList', class: 'task-list' }, 0],
  markdownTokenizer: {
    name: 'taskList',
    level: 'block',
    start: source => /^ {0,3}[-+*]\s+\[[ xX]\]/m.exec(source)?.index ?? -1,
    tokenize: (source, _tokens, lexer) => {
      const lines = source.split('\n'), items = [];
      let consumed = 0;
      while (consumed < lines.length) {
        const match = lines[consumed].match(/^ {0,3}[-+*]\s+\[([ xX])\]\s*(.*)$/);
        if (!match) break;
        items.push({ checked: match[1].toLowerCase() === 'x', tokens: lexer.inlineTokens(match[2]) });
        consumed++;
      }
      if (!items.length) return undefined;
      const raw = lines.slice(0, consumed).join('\n') + (consumed < lines.length ? '\n' : '');
      return { type: 'taskList', raw, items };
    },
  },
  parseMarkdown: (token, helpers) => ({
    type: 'taskList',
    content: token.items.map(item => ({
      type: 'taskItem',
      attrs: { checked: !!item.checked },
      content: helpers.parseChildren([{ type: 'paragraph', tokens: item.tokens || [] }]),
    })),
  }),
  renderMarkdown: (node, helpers) => `${(node.content || []).map(item => `- [${item.attrs?.checked ? 'x' : ' '}] ${(helpers.renderChildren(item.content || []) || '').trim().replace(/\n+/g, ' ')}`).join('\n')}\n\n`,
  addCommands() {
    return {
      toggleTaskList: () => ({ state, dispatch }) => {
        const taskListType = state.schema.nodes.taskList;
        const taskItemType = state.schema.nodes.taskItem;
        const {$from} = state.selection;
        let depth = $from.depth;
        while (depth > 0 && $from.node(depth).type !== taskListType) depth--;
        const command = depth > 0 ? liftListItem(taskItemType) : wrapInList(taskListType);
        if (!dispatch) return command(state);
        return command(state, transaction => dispatch(transaction.setMeta('scrollIntoView', false)));
      },
    };
  },
});

const TaskItem = Node.create({
  name: 'taskItem',
  content: 'paragraph block*',
  defining: true,
  addAttributes() {
    return { checked: { default: false, parseHTML: element => element.getAttribute('data-checked') === 'true', renderHTML: attributes => ({ 'data-checked': String(!!attributes.checked) }) } };
  },
  parseHTML: () => [{ tag: 'li[data-type="taskItem"]' }],
  renderHTML: ({ HTMLAttributes }) => ['li', { ...HTMLAttributes, 'data-type': 'taskItem' }, 0],
  addKeyboardShortcuts() {
    return {
      Enter: () => splitListItem(this.type)(this.editor.state, transaction => this.editor.view.dispatch(transaction)),
      Tab: () => sinkListItem(this.type)(this.editor.state, transaction => this.editor.view.dispatch(transaction)),
      'Shift-Tab': () => liftListItem(this.type)(this.editor.state, transaction => this.editor.view.dispatch(transaction)),
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const document = editor.view.dom.ownerDocument;
      const dom = document.createElement('li');
      dom.className = 'task-item';
      dom.setAttribute('data-type', 'taskItem');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.setAttribute('aria-label', '标记任务完成');
      checkbox.contentEditable = 'false';
      const contentDOM = document.createElement('div');
      contentDOM.className = 'task-item-content';
      dom.append(checkbox, contentDOM);
      checkbox.addEventListener('change', () => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: checkbox.checked }));
      });
      return {
        dom,
        contentDOM,
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          checkbox.checked = !!updated.attrs.checked;
          dom.dataset.checked = String(!!updated.attrs.checked);
          return true;
        },
        stopEvent: event => event.target === checkbox,
        ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === checkbox,
      };
    };
  },
});

const TextIndent = Extension.create({
  name: 'qidianTextIndent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'blockquote'],
      attributes: {
        indent: {
          default: null,
          parseHTML: element => {
            const value = element.style.marginLeft;
            return /^\d{1,3}(?:px|em|rem|%)$/.test(value || '') ? value : null;
          },
          renderHTML: attributes => attributes.indent ? { style: `margin-left: ${attributes.indent}` } : {},
        },
      },
    }];
  },
});

export const qidianEditorExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false }),
  Details.configure({ persist: true }),
  DetailsSummary,
  DetailsContent,
  Callout,
  LegacyContainer,
  Figure,
  FigureCaption,
  QidianImage,
  SmallText,
  Link,
  QidianTextStyle,
  Color.configure({ types: ['textStyle'] }),
  Highlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TextIndent,
  Table.configure({ resizable: true, HTMLAttributes: { class: 'note-table' } }),
  TableRow,
  TableHeader,
  QidianTableCell,
  TaskList,
  TaskItem,
];

