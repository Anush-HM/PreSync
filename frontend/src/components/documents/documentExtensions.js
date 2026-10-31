import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
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
            renderHTML: (attrs) => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {})
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
      }
    };
  }
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
      setPageBreak: () => ({ chain }) => chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run()
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

const Picture = Image.extend({
  draggable: true,
  addAttributes() {
    return { ...this.parent?.(), ...figureAttrs };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageFigure);
  }
});

export const documentExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    code: false,
    codeBlock: false,
    link: false
  }),
  TextStyleKit.configure({ lineHeight: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit.configure({ table: { resizable: true } }),
  Picture.configure({ allowBase64: true }),
  BlockFormat,
  Badge,
  Callout,
  PageBreak,
  Shape,
  Pagination
];

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
