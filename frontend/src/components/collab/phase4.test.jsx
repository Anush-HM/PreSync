import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { ToastProvider } from '../ui/Toast.jsx';
import ExportDialog from './ExportDialog.jsx';
import { exportQuery } from '../../data/decksApi.js';
import { replaceAllSlides } from '../../data/deckOps.js';
import { getSlidesArray, plainToSlideMap, slideMapToPlain } from '../../data/yjsClient.js';

vi.mock('../../data/collabApi.js', async (orig) => ({
  ...(await orig()),
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  saveVersion: vi.fn(),
  addComment: vi.fn(),
  replyToComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn()
}));
const api = await import('../../data/collabApi.js');
const { default: CommentsPanel } = await import('./CommentsPanel.jsx');
const { default: VersionHistoryPanel } = await import('./VersionHistoryPanel.jsx');

const slides = [
  { id: 's1', order: 0, blocks: [{ id: 'b1', type: 'textbox', x: 0, y: 0, width: 100, text: 'Quarterly results' }] },
  { id: 's2', order: 1, blocks: [] }
];
const person = (id, name) => ({ id, name, email: `${name.toLowerCase()}@example.com` });
const thread = (over = {}) => ({
  id: 'c1', slideId: 's1', blockId: 'b1', text: 'Tighten this', author: person('u2', 'Sam'), createdAt: new Date().toISOString(),
  resolved: false, replies: [], ...over
});
const wrap = (ui) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => vi.clearAllMocks());

describe('CommentsPanel', () => {
  it('comments on the selected element and refreshes', async () => {
    api.addComment.mockResolvedValue({});
    const onChanged = vi.fn();
    wrap(<CommentsPanel deckId="d1" threads={[]} slides={slides} activeSlide={slides[0]} selectedBlock={slides[0].blocks[0]} me="u1" onOpen={() => {}} onChanged={onChanged} onClose={() => {}} />);
    expect(screen.getByText('On slide 1 · “Quarterly results”')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Use the new number');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(api.addComment).toHaveBeenCalledWith('d1', { slideId: 's1', blockId: 'b1', text: 'Use the new number' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toHaveValue('');
  });

  it('shows where a thread is, replies, resolves, and hides resolved threads', async () => {
    api.replyToComment.mockResolvedValue({});
    api.updateComment.mockResolvedValue({});
    const onOpen = vi.fn();
    const onChanged = vi.fn();
    const { rerender } = wrap(<CommentsPanel deckId="d1" threads={[thread()]} slides={slides} activeSlide={slides[1]} me="u1" onOpen={onOpen} onChanged={onChanged} onClose={() => {}} />);
    const t = screen.getByRole('article', { name: 'Comment by Sam' });
    await userEvent.click(within(t).getByRole('button', { name: 'Slide 1 · “Quarterly results”' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(within(t).queryByRole('button', { name: 'Delete thread' })).not.toBeInTheDocument(); // not mine, not owner
    await userEvent.click(within(t).getByRole('button', { name: 'Reply' }));
    await userEvent.type(within(t).getByRole('textbox', { name: 'Reply' }), 'Done');
    await userEvent.click(within(t).getByRole('button', { name: 'Reply' }));
    expect(api.replyToComment).toHaveBeenCalledWith('d1', 'c1', 'Done');
    await userEvent.click(await within(t).findByRole('button', { name: 'Resolve' }));
    expect(api.updateComment).toHaveBeenCalledWith('d1', 'c1', { resolved: true });

    rerender(<ToastProvider><CommentsPanel deckId="d1" threads={[thread({ resolved: true })]} slides={slides} activeSlide={slides[1]} me="u1" isOwner onOpen={onOpen} onChanged={onChanged} onClose={() => {}} /></ToastProvider>);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show resolved (1)' }));
    expect(screen.getByRole('button', { name: 'Delete thread' })).toBeInTheDocument(); // the owner may delete
  });

  it('sorts open threads on this slide first', () => {
    const list = api.sortThreads([thread({ id: 'a', slideId: 's2' }), thread({ id: 'b', resolved: true }), thread({ id: 'c' })], slides, 's1', { showResolved: true });
    expect(list.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('VersionHistoryPanel', () => {
  it('saves a named version, previews one and restores it after saving what is there now', async () => {
    const v = { id: 'v1', label: 'Sent to client', kind: 'manual', createdAt: new Date().toISOString(), slideCount: 2, author: person('u1', 'Ana'), thumbnail: slides[0] };
    api.listVersions.mockResolvedValue([v]);
    api.saveVersion.mockResolvedValue({});
    api.getVersion.mockResolvedValue({ ...v, slides });
    const onRestore = vi.fn();
    wrap(<VersionHistoryPanel deckId="d1" onRestore={onRestore} onClose={() => {}} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Version name' }), 'Draft 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save version' }));
    expect(api.saveVersion).toHaveBeenCalledWith('d1', 'Draft 2');

    await userEvent.click(await screen.findByRole('button', { name: /Sent to client/ }));
    const preview = await screen.findByRole('region', { name: 'Preview of Sent to client' });
    expect(within(preview).getAllByRole('img')).toHaveLength(2);
    await userEvent.click(within(preview).getByRole('button', { name: 'Restore this version' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1', slides })));
    expect(api.saveVersion).toHaveBeenLastCalledWith('d1', 'Before restoring “Sent to client”', 'restore');
  });
});

describe('restoring slides', () => {
  it('replaces every slide in one undo step', () => {
    const doc = new Y.Doc();
    const arr = getSlidesArray(doc);
    arr.push([plainToSlideMap({ id: 'old', order: 0, blocks: [] })]);
    const undo = new Y.UndoManager(arr);
    replaceAllSlides(doc, [{ ...slides[1], order: 5 }, slides[0]]);
    expect(arr.toArray().map(slideMapToPlain).map((s) => [s.id, s.order])).toEqual([['s2', 0], ['s1', 1]]);
    undo.undo();
    expect(arr.toArray().map(slideMapToPlain).map((s) => s.id)).toEqual(['old']);
  });
});

describe('ExportDialog', () => {
  it('offers only working formats, with options where they apply', async () => {
    const onExport = vi.fn();
    render(<ExportDialog hiddenCount={2} onExport={onExport} onClose={() => {}} />);
    expect(screen.getAllByRole('radio').map((r) => r.value)).toEqual(['pdf', 'pptx', 'docx', 'png', 'jpeg']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include hidden slides (2)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download .pdf' }));
    expect(onExport).toHaveBeenLastCalledWith('pdf', { includeHidden: true, notes: false });

    await userEvent.click(screen.getByRole('radio', { name: /Word outline/ }));
    expect(screen.getByRole('checkbox', { name: 'Include speaker notes' })).toBeChecked();
    expect(screen.getByText(/Slide layout, positions and shapes are not kept/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download .docx' }));
    expect(onExport).toHaveBeenLastCalledWith('docx', { includeHidden: true, notes: true });

    await userEvent.click(screen.getByRole('radio', { name: /PowerPoint/ }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download .pptx' }));
    expect(onExport).toHaveBeenLastCalledWith('pptx', undefined);
  });

  it('builds the export query', () => {
    expect(exportQuery('docx')).toBe('format=docx');
    expect(exportQuery('pdf', { includeHidden: true, notes: false })).toBe('format=pdf&hidden=1&notes=0');
  });
});
