import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { ImageFigure, ShapeFigure } from './FigureViews.jsx';
import { Pagination } from './pagination.js';

// The editor's document model. Node and mark names and attributes match
// what backend/src/services/documentContent.js accepts and what the
// .docx and PDF exporters read; keep the two in step.

export const CALLOUT_TONES = [
  { id: 'info', label: 'Info' },
  { id: 'success', label: 'Success' },
  { id: 'warning', label: 'Warning' },
  { id: 'danger', label: 'Important' }
];

// A length kept as a number, shown as this CSS property.
const pxAttr = (name, css) => ({
  default: null,
  parseHTML: (el) => {
    const value = el.getAttribute(`data-${name}`);
    return value === null ? null : Number(value);
  },
  renderHTML: (attrs) => (attrs[name] === null || attrs[name] === undefined ? {} : { [`data-${name}`]: attrs[name], style: `${css}: ${attrs[name]}px` })
});

const INDENT_PX = 48; // half an inch
const MAX_INDENT = 8;

export const BULLET_STYLES = [
  { id: 'disc', label: 'Standard bullet', sample: '•' },
  { id: 'circle', label: 'Hollow circle', sample: '○' },
  { id: 'square', label: 'Square', sample: '■' },
  { id: 'arrow', label: 'Arrow', sample: '➔' }
];
export const NUMBER_STYLES = [
  { id: 'decimal', label: 'Numeric', sample: '1. 2. 3.' },
  { id: 'lower-alpha', label: 'Lowercase letters', sample: 'a. b. c.' },
  { id: 'upper-alpha', label: 'Uppercase letters', sample: 'A. B. C.' },
  { id: 'lower-roman', label: 'Roman numerals', sample: 'i. ii. iii.' }
];
const LIST_CSS = { disc: 'disc', circle: 'circle', square: 'square', arrow: '"➔  "', decimal: 'decimal', 'lower-alpha': 'lower-alpha', 'upper-alpha': 'upper-alpha', 'lower-roman': 'lower-roman' };

// Paragraph looks: line spacing, and the named styles that are not headings.
const BlockFormat = Extension.create({
  name: 'blockFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => Number(el.style.lineHeight) || null,
            renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight * (attrs.lineScale || 1)}` } : {})
          },
          // Set on import: Word's own line height for the font, as a multiple.
          lineScale: { default: null, rendered: false },
          indentLeft: pxAttr('indentLeft', 'margin-left'),
          indentRight: pxAttr('indentRight', 'margin-right'),
          firstLine: pxAttr('firstLine', 'text-indent'),
          spaceBefore: pxAttr('spaceBefore', 'margin-top'),
          spaceAfter: pxAttr('spaceAfter', 'margin-bottom'),
          tabStops: { default: null, rendered: false },
          indent: {
            default: null,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || null,
            renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `margin-left: ${attrs.indent * INDENT_PX}px` } : {})
          }
        }
      },
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          listStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-list-style'),
            renderHTML: (attrs) => (attrs.listStyle ? { 'data-list-style': attrs.listStyle, style: `list-style-type: ${LIST_CSS[attrs.listStyle]}` } : {})
          }
        }
      },
      {
        types: ['paragraph'],
        attributes: {
          blockStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-block-style'),
            renderHTML: (attrs) => (attrs.blockStyle ? { 'data-block-style': attrs.blockStyle } : {})
          }
        }
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          background: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-background'),
            renderHTML: (attrs) => (attrs.background ? { 'data-background': attrs.background, style: `background-color: ${attrs.background}` } : {})
          }
        }
      }
    ];
  },
  addCommands() {
    return {
      setLineHeight: (lineHeight) => ({ commands }) => {
        const a = commands.updateAttributes('paragraph', { lineHeight });
        const b = commands.updateAttributes('heading', { lineHeight });
        return a || b;
      },
      // Turns the selection into this kind of list, in this marker style.
      setListStyle: (type, listStyle) => ({ editor, chain }) => {
        const steps = chain();
        if (!editor.isActive(type)) steps[type === 'bulletList' ? 'toggleBulletList' : 'toggleOrderedList']();
        return steps.updateAttributes(type, { listStyle }).run();
      },
      shiftIndent: (delta) => ({ editor, commands }) => {
        if (editor.isActive('listItem')) return delta > 0 ? commands.sinkListItem('listItem') : commands.liftListItem('listItem');
        const type = editor.isActive('heading') ? 'heading' : 'paragraph';
        const indent = Math.max(0, Math.min(MAX_INDENT, (editor.getAttributes(type).indent || 0) + delta));
        return commands.updateAttributes(type, { indent: indent || null });
      }
    };
  },
  addKeyboardShortcuts() {
    // In a table, Tab moves between cells instead.
    const shift = (delta) => () => {
      if (this.editor.isActive('table')) return false;
      this.editor.commands.shiftIndent(delta);
      return true;
    };
    return { Tab: shift(1), 'Shift-Tab': shift(-1) };
  },
  priority: 200
});

const Badge = Mark.create({
  name: 'badge',
  inclusive: false,
  addAttributes() {
    return { tone: { default: 'info', parseHTML: (el) => el.getAttribute('data-tone'), renderHTML: (a) => ({ 'data-tone': a.tone }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-badge]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-badge': '', class: 'doc-badge' }), 0];
  }
});

// Text a comment thread is about. The thread itself lives on the server
// (documentsApi comments); the mark only says where it is.
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return { commentId: { default: null, parseHTML: (el) => el.getAttribute('data-comment-id'), renderHTML: (a) => ({ 'data-comment-id': a.commentId }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'doc-comment' }), 0];
  },
  addCommands() {
    return {
      setComment: (commentId) => ({ commands }) => commands.setMark(this.name, { commentId }),
      // Takes one thread's mark off wherever it is in the document.
      unsetCommentEverywhere: (commentId) => ({ tr, state, dispatch }) => {
        const type = state.schema.marks.comment;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          const mark = node.marks.find((m) => m.type === type && m.attrs.commentId === commentId);
          if (mark) tr.removeMark(pos, pos + node.nodeSize, mark);
        });
        if (dispatch) dispatch(tr);
        return true;
      }
    };
  }
});

const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { tone: { default: 'info', parseHTML: (el) => el.getAttribute('data-tone'), renderHTML: (a) => ({ 'data-tone': a.tone }) } };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'doc-callout' }), 0];
  }
});

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': '', class: 'doc-page-break' }];
  },
  addCommands() {
    return {
      // Text after the cursor starts the next page, with no empty line above
      // it. Inside a list or table the break goes after the whole block.
      setPageBreak: () => ({ state, chain }) => {
        const { $from } = state.selection;
        const pageBreak = this.type.create();
        if ($from.depth > 1) return chain().command(({ tr }) => { tr.insert($from.after(1), pageBreak); return true; }).run();
        const steps = chain();
        if ($from.parentOffset > 0) steps.splitBlock();
        return steps.command(({ tr }) => { tr.insert(tr.selection.$from.before(), pageBreak); return true; }).run();
      }
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
  // Runs before the hard break that Mod-Enter otherwise inserts.
  priority: 1000
});

const figureAttrs = {
  width: { default: null, parseHTML: (el) => Number(el.getAttribute('data-width')) || null, renderHTML: (a) => (a.width ? { 'data-width': a.width } : {}) },
  height: { default: null, parseHTML: (el) => Number(el.getAttribute('data-height')) || null, renderHTML: (a) => (a.height ? { 'data-height': a.height } : {}) },
  align: { default: null, parseHTML: (el) => el.getAttribute('data-align'), renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}) }
};

const Shape = Node.create({
  name: 'shape',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      ...figureAttrs,
      shape: { default: 'rect', parseHTML: (el) => el.getAttribute('data-shape'), renderHTML: (a) => ({ 'data-shape': a.shape }) },
      color: { default: '#285c43', parseHTML: (el) => el.getAttribute('data-color'), renderHTML: (a) => ({ 'data-color': a.color }) }
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-shape]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ShapeFigure);
  }
});

// How a picture sits among the text: 'inline' (its own line, aligned),
// 'square' (text wraps beside it) or 'front' (placed freely over the
// text, offsetX/offsetY px from where it is anchored).
const numberAttr = (name, data) => ({
  default: null,
  parseHTML: (el) => (el.getAttribute(data) === null ? null : Number(el.getAttribute(data))),
  renderHTML: (a) => (a[name] === null || a[name] === undefined ? {} : { [data]: a[name] })
});
const placementAttrs = {
  wrap: { default: null, parseHTML: (el) => el.getAttribute('data-wrap'), renderHTML: (a) => (a.wrap ? { 'data-wrap': a.wrap } : {}) },
  offsetX: numberAttr('offsetX', 'data-offset-x'),
  offsetY: numberAttr('offsetY', 'data-offset-y')
};

const DocumentImage = Image.extend({
  // Moved with its own pointer handling in FigureViews, which also lets
  // a picture be placed anywhere on the page.
  draggable: false,
  addAttributes() {
    return { ...this.parent?.(), ...figureAttrs, ...placementAttrs };
  },
  // Arrow keys nudge a selected free picture (Shift for bigger steps).
  addKeyboardShortcuts() {
    const nudge = (dx, dy) => ({ editor }) => {
      const { selection } = editor.state;
      const node = selection.node;
      if (node?.type.name !== this.name || node.attrs.wrap !== 'front') return false;
      return editor.commands.updateAttributes(this.name, { offsetX: (node.attrs.offsetX || 0) + dx, offsetY: (node.attrs.offsetY || 0) + dy });
    };
    return {
      ArrowLeft: nudge(-1, 0),
      ArrowRight: nudge(1, 0),
      ArrowUp: nudge(0, -1),
      ArrowDown: nudge(0, 1),
      'Shift-ArrowLeft': nudge(-10, 0),
      'Shift-ArrowRight': nudge(10, 0),
      'Shift-ArrowUp': nudge(0, -10),
      'Shift-ArrowDown': nudge(0, 10)
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageFigure);
  }
});

const STARTER_KIT = {
  heading: { levels: [1, 2, 3, 4, 5, 6] },
  code: false,
  codeBlock: false,
  link: false
};

const sharedExtensions = [
  TextStyleKit.configure({ lineHeight: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit.configure({ table: { resizable: true } }),
  DocumentImage.configure({ allowBase64: true }),
  BlockFormat,
  Badge,
  Callout,
  PageBreak,
  Shape,
  CommentMark,
  Pagination
];

export const documentExtensions = [StarterKit.configure(STARTER_KIT), ...sharedExtensions];

// For showing a stored document read-only, off the page sheets.
export const previewExtensions = documentExtensions.filter((e) => e !== Pagination);

// With `collab` ({ doc, awareness } from connectDocumentDoc, plus `user`
// { name, color }), the editor works on the live shared copy: its own
// undo history replaces StarterKit's, and other people's cursors show.
export function buildDocumentExtensions(collab) {
  if (!collab) return documentExtensions;
  return [
    StarterKit.configure({ ...STARTER_KIT, undoRedo: false }),
    ...sharedExtensions,
    Collaboration.configure({ document: collab.doc, field: 'default' }),
    CollaborationCaret.configure({ provider: collab, user: collab.user })
  ];
}

const FALLBACK_SIZE = { paragraph: 11, title: 26, subtitle: 14, caption: 9, 1: 20, 2: 16, 3: 13, 4: 12, 5: 11, 6: 11 };

// The point size shown for the current selection when no run sets one.
export function blockFontSize(editor) {
  const heading = editor.getAttributes('heading');
  if (editor.isActive('heading')) return FALLBACK_SIZE[heading.level] || 11;
  return FALLBACK_SIZE[editor.getAttributes('paragraph').blockStyle] || FALLBACK_SIZE.paragraph;
}

// Every font named in a stored document, to load before it is shown.
export function fontsIn(node, out = new Set()) {
  for (const mark of node.marks || []) if (mark.attrs?.fontFamily) out.add(mark.attrs.fontFamily);
  for (const child of node.content || []) fontsIn(child, out);
  return out;
}
