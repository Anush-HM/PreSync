import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { documentExtensions } from './documentExtensions.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let editor;
afterEach(() => editor?.destroy());

function make(attrs) {
  editor = new Editor({
    extensions: documentExtensions,
    content: { type: 'doc', content: [{ type: 'image', attrs: { src: PNG, width: 50, height: 50, ...attrs } }, { type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] }
  });
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
  return editor;
}

const press = (key, shiftKey = false) => editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key, shiftKey })));

describe('picture placement', () => {
  it('keeps wrap and offsets in the document', () => {
    make({ wrap: 'front', offsetX: 12, offsetY: -4 });
    expect(editor.getJSON().content[0].attrs).toMatchObject({ wrap: 'front', offsetX: 12, offsetY: -4 });
  });

  it('nudges a free picture with the arrow keys', () => {
    make({ wrap: 'front', offsetX: 10, offsetY: 10 });
    press('ArrowRight');
    press('ArrowDown', true);
    expect(editor.getJSON().content[0].attrs).toMatchObject({ offsetX: 11, offsetY: 20 });
  });

  it('leaves the arrow keys alone for a picture in line with the text', () => {
    make({});
    press('ArrowRight');
    expect(editor.getJSON().content[0].attrs).toMatchObject({ wrap: null, offsetX: null });
  });
});
