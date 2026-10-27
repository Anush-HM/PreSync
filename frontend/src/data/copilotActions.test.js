import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getSlidesArray, plainToSlideMap, slideMapToPlain } from './yjsClient.js';
import { updateBlocks, moveSlide } from './deckOps.js';
import { ActionError, applyAction, COPILOT_ORIGIN, isBlankStarterDeck, previewAction, spliceStyles } from './copilotActions.js';

function makeDoc(slides) {
  const doc = new Y.Doc();
  getSlidesArray(doc).push(slides.map(plainToSlideMap));
  return doc;
}

const plain = (doc) => getSlidesArray(doc).toArray().map(slideMapToPlain);

const deck = () => [
  {
    id: 's1',
    order: 0,
    notes: '',
    blocks: [
      { id: 't1', type: 'textbox', role: 'title', x: 80, y: 50, width: 800, fontSize: 36, text: 'Welcome' },
      { id: 'b1', type: 'textbox', x: 80, y: 140, width: 800, fontSize: 18, text: 'We grew revenue a lot in the last quarter thanks to many things.' }
    ]
  },
  {
    id: 's2',
    order: 1,
    notes: 'Existing notes',
    blocks: [
      { id: 't2', type: 'textbox', role: 'title', x: 80, y: 50, width: 800, fontSize: 36, text: 'Plan' },
      { id: 'b2', type: 'textbox', x: 82, y: 140, width: 800, fontSize: 18, text: 'Line one\nLine two', styles: [{ start: 0, end: 4, style: { fontWeight: 'bold' } }, { start: 8, end: 11, style: { fill: '#e74c3c' } }] },
      { id: 'img', type: 'image', x: 600, y: 300, width: 200, height: 150, fontSize: 16, text: '', imageUrl: 'data:image/png;base64,AAAA' }
    ]
  }
];

const snap = (doc, extra = {}) => ({ slideIds: plain(doc).map((s) => s.id), ...extra });

describe('replace_selected_text', () => {
  it('replaces a whole text box and is one undoable step', async () => {
    const doc = makeDoc(deck());
    const undo = new Y.UndoManager(getSlidesArray(doc), { trackedOrigins: new Set([null, COPILOT_ORIGIN]) });
    const action = { type: 'replace_selected_text', blockId: 'b1', slideIndex: 0, text: 'Revenue grew strongly last quarter.' };
    const snapshot = snap(doc, { selection: { slideId: 's1', blockId: 'b1', fullText: deck()[0].blocks[1].text, start: null, end: null } });

    const preview = previewAction(action, { slides: plain(doc), activeIdx: 0, snapshot });
    expect(preview).toMatchObject({ kind: 'text', before: deck()[0].blocks[1].text, after: action.text });

    await applyAction(doc, action, { snapshot, activeIdx: 0 });
    expect(plain(doc)[0].blocks[1].text).toBe('Revenue grew strongly last quarter.');
    expect(undo.undoStack).toHaveLength(1);
    undo.undo();
    expect(plain(doc)[0].blocks[1].text).toBe(deck()[0].blocks[1].text);
  });

  it('replaces only the selected characters and keeps formatting around them', async () => {
    const doc = makeDoc(deck());
    // "Line one\nLine two": select "two" (characters 14–17 counting the line break).
    const snapshot = snap(doc, { selection: { slideId: 's2', blockId: 'b2', fullText: 'Line one\nLine two', start: 14, end: 17 } });
    await applyAction(doc, { type: 'replace_selected_text', blockId: 'b2', text: 'number two' }, { snapshot, activeIdx: 1 });
    const block = plain(doc)[1].blocks[1];
    expect(block.text).toBe('Line one\nLine number two');
    // Bold "Line" survives; the red range that covered "Lin" of line two stays put.
    expect(block.styles).toEqual([{ start: 0, end: 4, style: { fontWeight: 'bold' } }, { start: 8, end: 11, style: { fill: '#e74c3c' } }]);
  });

  it('refuses to overwrite text that changed after the request', async () => {
    const doc = makeDoc(deck());
    const snapshot = snap(doc, { selection: { slideId: 's1', blockId: 'b1', fullText: deck()[0].blocks[1].text } });
    updateBlocks(doc, 0, ['b1'], { text: 'A collaborator rewrote this.' });
    const action = { type: 'replace_selected_text', blockId: 'b1', text: 'AI text' };
    expect(previewAction(action, { slides: plain(doc), activeIdx: 0, snapshot }).error).toMatch(/edited after you asked/);
    await expect(applyAction(doc, action, { snapshot, activeIdx: 0 })).rejects.toBeInstanceOf(ActionError);
    expect(plain(doc)[0].blocks[1].text).toBe('A collaborator rewrote this.');
  });

  it('needs the selection snapshot (history reloaded later cannot replace blindly)', () => {
    const doc = makeDoc(deck());
    expect(previewAction({ type: 'replace_selected_text', blockId: 'b1', text: 'x' }, { slides: plain(doc), activeIdx: 0, snapshot: null }).error).toMatch(/Select the text again/);
  });
});

describe('spliceStyles', () => {
  it('shifts ranges after the edit and clips ranges that overlap it', () => {
    const styles = [{ start: 0, end: 10, style: { fontWeight: 'bold' } }];
    expect(spliceStyles(styles, 'abcdefghij', 2, 5, 'XY')).toEqual([
      { start: 0, end: 2, style: { fontWeight: 'bold' } },
      { start: 4, end: 9, style: { fontWeight: 'bold' } }
    ]);
  });
});

describe('slide-level actions', () => {
  it('writes speaker notes, replacing or appending', async () => {
    const doc = makeDoc(deck());
    await applyAction(doc, { type: 'generate_speaker_notes', slideIndex: 1, notes: 'Mention the timeline.', notesMode: 'append' }, { snapshot: snap(doc), activeIdx: 1 });
    expect(plain(doc)[1].notes).toBe('Existing notes\n\nMention the timeline.');
    await applyAction(doc, { type: 'generate_speaker_notes', slideIndex: 0, notes: 'Open with a story.', notesMode: 'replace' }, { snapshot: snap(doc), activeIdx: 0 });
    expect(plain(doc)[0].notes).toBe('Open with a story.');
  });

  it('sets the title of the slide the request was about, even after slides moved', async () => {
    const doc = makeDoc(deck());
    const snapshot = snap(doc);
    moveSlide(doc, 1, -1); // s2 is now first
    const result = await applyAction(doc, { type: 'suggest_title', slideIndex: 1, title: 'Our 2025 plan' }, { snapshot, activeIdx: 0 });
    expect(result.slideIndex).toBe(0);
    expect(plain(doc)[0].blocks.find((b) => b.role === 'title').text).toBe('Our 2025 plan');
  });

  it('inserts a structured table block', async () => {
    const doc = makeDoc(deck());
    await applyAction(doc, { type: 'create_table', slideIndex: 0, table: { headerRow: true, rows: [['Quarter', 'Revenue'], ['Q1', '$1M']] } }, { snapshot: snap(doc), activeIdx: 0 });
    const table = plain(doc)[0].blocks.at(-1);
    expect(table.type).toBe('table');
    expect(table.table.columns).toHaveLength(2);
    expect(table.table.rows[0].cells[0]).toMatchObject({ text: 'Quarter', fontWeight: 'bold' });
    expect(table.text).toBe('Quarter\tRevenue\nQ1\t$1M');
    expect(table.y + table.height).toBeLessThanOrEqual(540);
  });

  it('moves blocks into a layout', async () => {
    const doc = makeDoc(deck());
    const preview = previewAction({ type: 'suggest_layout', slideIndex: 1, layoutId: 'visual-right' }, { slides: plain(doc), activeIdx: 1, snapshot: snap(doc) });
    expect(preview.after.blocks.find((b) => b.id === 'img').x).toBeGreaterThanOrEqual(580);
    await applyAction(doc, { type: 'suggest_layout', slideIndex: 1, layoutId: 'visual-right' }, { snapshot: snap(doc), activeIdx: 1 });
    const s = plain(doc)[1];
    expect(s.blocks.find((b) => b.id === 't2')).toMatchObject({ x: 60, y: 50, width: 480 });
    expect(s.blocks.find((b) => b.id === 'b2')).toMatchObject({ x: 60, width: 460 });
  });

  it('applies geometry fixes from a design check', async () => {
    const doc = makeDoc(deck());
    await applyAction(doc, { type: 'analyze_layout', slideIndex: 1, fixes: [{ blockId: 'b2', x: 80 }, { blockId: 'ghost', x: 1 }] }, { snapshot: snap(doc, { activeSlideId: 's2' }), activeIdx: 1 });
    expect(plain(doc)[1].blocks[1].x).toBe(80);
  });

  it('inserts emoji from the library and refuses anything else', async () => {
    const doc = makeDoc(deck());
    const action = { type: 'suggest_asset', slideIndex: 0, assetIds: ['emoji-party'] };
    await applyAction(doc, action, { snapshot: snap(doc), activeIdx: 0, assetId: 'emoji-party' });
    expect(plain(doc)[0].blocks.at(-1)).toMatchObject({ type: 'textbox', text: '🎉' });
    await expect(applyAction(doc, { ...action, assetIds: ['made-up'] }, { snapshot: snap(doc), activeIdx: 0 })).rejects.toBeInstanceOf(ActionError);
    await expect(applyAction(doc, action, { snapshot: snap(doc), activeIdx: 0, assetId: 'emoji-rocket' })).rejects.toBeInstanceOf(ActionError);
  });
});

describe('create_outline', () => {
  const outline = [
    { title: 'Why solar', bullets: ['Cheap', 'Clean'], notes: 'Open with the bill', layoutId: 'title-bullets' },
    { title: 'Costs', bullets: ['Panels', 'Install', 'Upkeep'], notes: '', layoutId: 'two-column' }
  ];

  it('adds slides after the current one without touching existing slides', async () => {
    const doc = makeDoc(deck());
    const before = plain(doc);
    const result = await applyAction(doc, { type: 'create_outline', slides: outline }, { activeIdx: 0, insertAt: 1, themeId: 'midnight' });
    const after = plain(doc);
    expect(result).toMatchObject({ slideIndex: 1, created: 2 });
    expect(after.map((s) => s.id)).toEqual([before[0].id, after[1].id, after[2].id, before[1].id]);
    expect(after[0]).toEqual(before[0]);
    expect(after[1].notes).toBe('Open with the bill');
    expect(after[1].backgroundColor).toBe('#0f3460');
    expect(after[1].blocks[0]).toMatchObject({ role: 'title', text: 'Why solar' });
    expect(after[2].blocks.filter((b) => b.role !== 'title')).toHaveLength(2); // two columns
  });

  it('only replaces the untouched blank starter slide when asked', async () => {
    const blank = [{ id: 'b', order: 0, notes: '', blocks: [{ id: 'x', type: 'textbox', x: 80, y: 60, width: 700, fontSize: 36, text: 'New slide', role: 'title' }, { id: 'y', type: 'textbox', x: 80, y: 130, width: 700, fontSize: 18, text: 'Click to add text' }] }];
    expect(isBlankStarterDeck(blank)).toBe(true);
    expect(isBlankStarterDeck(deck())).toBe(false);
    const doc = makeDoc(blank);
    await applyAction(doc, { type: 'create_outline', slides: outline }, { replaceBlank: true });
    expect(plain(doc).map((s) => s.blocks[0].text)).toEqual(['Why solar', 'Costs']);

    // A real deck is never replaced, even if asked.
    const real = makeDoc(deck());
    await applyAction(real, { type: 'create_outline', slides: outline }, { replaceBlank: true, insertAt: 2 });
    expect(plain(real)).toHaveLength(4);
  });
});

describe('collaboration and persistence', () => {
  it('reaches a collaborator through Yjs updates and survives a save/reopen round trip', async () => {
    const a = makeDoc(deck());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.on('update', (u, origin) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'));

    await applyAction(a, { type: 'generate_speaker_notes', slideIndex: 0, notes: 'Shared notes', notesMode: 'replace' }, { snapshot: snap(a), activeIdx: 0 });
    await applyAction(a, { type: 'create_table', slideIndex: 1, table: { headerRow: false, rows: [['a', 'b']] } }, { snapshot: snap(a), activeIdx: 1 });
    expect(plain(b)[0].notes).toBe('Shared notes');
    expect(plain(b)[1].blocks.at(-1).type).toBe('table');

    // Reopening from a stored snapshot gives back the same slides.
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Y.encodeStateAsUpdate(a));
    expect(plain(reopened)).toEqual(plain(a));
  });

  it("an AI edit is undone without reverting a collaborator's concurrent edit", async () => {
    const a = makeDoc(deck());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const sync = () => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    };
    const undo = new Y.UndoManager(getSlidesArray(a), { trackedOrigins: new Set([COPILOT_ORIGIN]) });
    await applyAction(a, { type: 'generate_speaker_notes', slideIndex: 0, notes: 'AI notes' }, { snapshot: snap(a), activeIdx: 0 });
    updateBlocks(b, 1, ['t2'], { text: 'Plan (edited by a collaborator)' });
    sync();
    undo.undo();
    sync();
    expect(plain(b)[0].notes).toBe('');
    expect(plain(b)[1].blocks[0].text).toBe('Plan (edited by a collaborator)');
  });
});
