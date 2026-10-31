import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import DocumentEditorPage from './DocumentEditorPage.jsx';
import { downloadDocument, getDocument, updateDocument } from '../data/documentsApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/documentsApi.js', () => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
  downloadDocument: vi.fn()
}));

const PAGE = { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } };
const LAYOUT = { header: { left: '{title}', center: '', right: '' }, footer: { left: '', center: '', right: '' }, differentFirstPage: false, pageNumbers: null, pageBorder: null };
const DOC = {
  id: 'doc-1',
  title: 'Annual plan',
  wordCount: 2,
  page: PAGE,
  importNotes: [],
  layout: LAYOUT,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello there' }] }] }
};

// ProseMirror asks for geometry jsdom does not have.
beforeAll(() => {
  const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [rect];
  Range.prototype.getBoundingClientRect = () => rect;
  Element.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => null;
});

function renderEditor() {
  renderAt('/documents/doc-1', <Route path="/documents/:id" element={<DocumentEditorPage />} />);
  return userEvent.setup();
}

const prose = () => document.querySelector('.ProseMirror');
const lastEditor = () => prose().editor;

beforeEach(() => {
  vi.clearAllMocks();
  getDocument.mockResolvedValue(DOC);
  updateDocument.mockResolvedValue({ id: 'doc-1', title: 'Annual plan', wordCount: 3 });
});

async function open() {
  const user = renderEditor();
  await screen.findByLabelText('Document title');
  await waitFor(() => expect(prose()).toHaveTextContent('Hello there'));
  return user;
}

describe('DocumentEditorPage', () => {
  it('opens the document with its title, toolbar and export menu', async () => {
    const user = await open();
    expect(screen.getByLabelText('Document title')).toHaveValue('Annual plan');
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Align left', 'Align centre', 'Align right', 'Justify']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /Generate presentation/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menuitem', { name: 'Download as .docx' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toBeInTheDocument();
  });

  it('applies formatting and saves it with the Save button', async () => {
    const user = await open();
    act(() => { lastEditor().commands.selectAll(); });
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalled());
    const { content } = updateDocument.mock.calls[0][1];
    expect(content.content[0].content[0].marks).toEqual([{ type: 'bold' }]);
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    expect(await screen.findByText('3 words')).toBeInTheDocument();
  });

  it('saves on its own after a change', async () => {
    await open();
    act(() => { lastEditor().commands.insertContent('More '); });
    await waitFor(() => expect(updateDocument).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it('keeps changes that fail to save and sends them again', async () => {
    updateDocument.mockRejectedValueOnce(new Error('Offline'));
    const user = await open();
    act(() => { lastEditor().commands.insertContent('More '); });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Could not save')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    expect(updateDocument).toHaveBeenCalledTimes(2);
  });

  it('renames inline, and restores the title when it is cleared', async () => {
    const user = await open();
    const title = screen.getByLabelText('Document title');
    await user.clear(title);
    await user.tab();
    expect(title).toHaveValue('Annual plan');
    await user.clear(title);
    await user.type(title, 'Plan B{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument).toHaveBeenCalledWith('doc-1', { title: 'Plan B' }));
  });

  it('saves before downloading', async () => {
    const user = await open();
    act(() => { lastEditor().commands.insertContent('More '); });
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download as PDF' }));
    await waitFor(() => expect(downloadDocument).toHaveBeenCalledWith('doc-1', 'pdf', 'Annual plan'));
    expect(updateDocument.mock.invocationCallOrder[0]).toBeLessThan(downloadDocument.mock.invocationCallOrder[0]);
  });

  it('inserts a table with exact rows and columns', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    await user.click(screen.getByRole('tab', { name: 'Table' }));
    const rows = screen.getByLabelText('Rows');
    await user.clear(rows);
    await user.type(rows, '4');
    await user.click(screen.getAllByRole('button', { name: 'Insert' })[1]);
    const table = lastEditor().getJSON().content.find((n) => n.type === 'table');
    expect(table.content).toHaveLength(4);
    expect(table.content[0].content).toHaveLength(3);
    expect(await screen.findByRole('toolbar', { name: 'Table' })).toBeInTheDocument();
  });

  it('inserts text styles, a callout, a badge and a shape', async () => {
    const user = await open();
    const insert = async (tab, name) => {
      await user.click(screen.getByRole('button', { name: 'Insert' }));
      await user.click(screen.getByRole('tab', { name: tab }));
      await user.click(screen.getByRole('button', { name }));
    };
    await insert('Text', 'Heading 1');
    expect(lastEditor().getJSON().content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    await insert('Text', 'Title');
    expect(lastEditor().getJSON().content[0].attrs.blockStyle).toBe('title');
    await insert('Elements', 'Success callout');
    await insert('Elements', 'Star');
    await insert('Elements', 'Important badge');
    const json = JSON.stringify(lastEditor().getJSON());
    expect(json).toContain('"callout"');
    expect(json).toContain('"star5"');
    expect(json).toContain('"badge"');
  });

  it('sets the line spacing of the current paragraph', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /^Line spacing/ }));
    await user.click(screen.getByRole('button', { name: '1.5' }));
    expect(lastEditor().getJSON().content[0].attrs.lineHeight).toBe(1.5);
  });

  it('changes the font size in points', async () => {
    const user = await open();
    act(() => { lastEditor().commands.selectAll(); });
    await user.click(screen.getByRole('button', { name: 'Increase font size' }));
    const mark = lastEditor().getJSON().content[0].content[0].marks[0];
    expect(mark.attrs.fontSize).toBe('12pt');
  });

  it('saves a change of page size', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Page size'), 'a4');
    expect(document.querySelector('.doc-sheets').style.width).toBe('794px');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument.mock.calls[0][1].page).toMatchObject({ width: 794, height: 1123 }));
  });

  it('shows what an import left out, until dismissed', async () => {
    getDocument.mockResolvedValue({ ...DOC, importNotes: ['Text boxes were not imported.'] });
    const user = await open();
    expect(screen.getByText('Text boxes were not imported.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss import notes' }));
    expect(screen.queryByText('Text boxes were not imported.')).not.toBeInTheDocument();
  });

  it('starts typing when the page margin is clicked', async () => {
    await open();
    fireEvent.mouseDown(document.querySelector('.doc-sheet'));
    await waitFor(() => expect(document.activeElement).toBe(prose()));
  });

  it('saves on Ctrl+S', async () => {
    await open();
    act(() => { lastEditor().commands.insertContent('More '); });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(updateDocument).toHaveBeenCalledTimes(1));
  });

  it('draws a page with its header, and edits it on double click', async () => {
    const user = await open();
    expect(screen.getByRole('region', { name: 'Page 1 of 1' })).toHaveTextContent('Annual plan');
    fireEvent.doubleClick(document.querySelector('.doc-sheets'), { clientY: 10 });
    const left = await screen.findByLabelText('Header left');
    await user.clear(left);
    await user.type(left, 'Cover');
    await user.click(screen.getByLabelText('Different first page'));
    await user.click(screen.getByRole('button', { name: 'Close Header & Footer' }));
    expect(screen.queryByLabelText('Header left')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument.mock.calls.at(-1)[1].layout).toMatchObject({ header: { left: 'Cover' }, differentFirstPage: true }));
  });

  it('applies header and footer presets, and removes them', async () => {
    const user = await open();
    fireEvent.doubleClick(document.querySelector('.doc-sheets'), { clientY: 10 });
    await user.click(await screen.findByRole('button', { name: 'Header styles' }));
    await user.click(screen.getByRole('menuitem', { name: 'Three-column (academic)' }));
    expect(screen.getByLabelText('Header centre')).toHaveValue('Department / College Name');
    await user.click(screen.getByRole('button', { name: 'Footer styles' }));
    await user.click(screen.getByRole('menuitem', { name: 'Split academic' }));
    expect(screen.getByLabelText('Footer right')).toHaveValue('Page {page} of {pages}');
    await user.click(screen.getByRole('button', { name: 'Header styles' }));
    await user.click(screen.getByRole('menuitem', { name: 'Accent line' }));
    expect(document.querySelector('.doc-zone.is-header')).toHaveClass('has-rule');
    await user.click(screen.getByRole('button', { name: 'Remove Header' }));
    expect(screen.getByLabelText('Header left')).toHaveValue('');
    expect(document.querySelector('.doc-zone.is-header')).not.toHaveClass('has-rule');
  });

  it('inserts page numbers and dates at the cursor', async () => {
    const user = await open();
    fireEvent.doubleClick(document.querySelector('.doc-sheets'), { clientY: 10 });
    await user.click(await screen.findByLabelText('Footer right'));
    await user.click(screen.getByRole('button', { name: 'Insert Page Number' }));
    await user.click(screen.getByRole('menuitem', { name: 'Page 1 of 5' }));
    expect(screen.getByLabelText('Footer right')).toHaveValue('Page {page} of {pages}');
    await user.click(screen.getByLabelText('Footer left'));
    await user.click(screen.getByRole('button', { name: 'Insert Date' }));
    await user.click(screen.getByRole('menuitem', { name: 'DD/MM/YYYY' }));
    expect(screen.getByLabelText('Footer left').value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('turns text into a styled list, and indents paragraphs and list items', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Increase indent' }));
    expect(lastEditor().getJSON().content[0].attrs.indent).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Decrease indent' }));
    expect(lastEditor().getJSON().content[0].attrs.indent).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Numbered list' }));
    await user.click(screen.getByRole('button', { name: 'Roman numerals' }));
    expect(lastEditor().getJSON().content[0]).toMatchObject({ type: 'orderedList', attrs: { listStyle: 'lower-roman' } });
    await user.click(screen.getByRole('button', { name: 'Bulleted list' }));
    await user.click(screen.getByRole('button', { name: 'Arrow' }));
    expect(lastEditor().getJSON().content[0]).toMatchObject({ type: 'bulletList', attrs: { listStyle: 'arrow' } });
    expect(prose().querySelector('ul').style.listStyleType).toContain('➔');
  });

  it('shows header navigation, with nothing to link on the first page', async () => {
    await open();
    fireEvent.doubleClick(document.querySelector('.doc-sheets'), { clientY: 10 });
    await screen.findByLabelText('Header left');
    for (const name of ['Previous', 'Next', 'Link to Previous']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.queryByText('[ Same as Previous ]')).not.toBeInTheDocument();
  });

  it('sets where numbering starts and how it reads', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    await user.click(screen.getByRole('tab', { name: 'Page' }));
    await user.click(screen.getByRole('button', { name: /Page numbers/ }));
    const start = screen.getByLabelText('Start at page');
    await user.clear(start);
    await user.type(start, '3');
    await user.click(screen.getByRole('button', { name: 'i, ii, iii' }));
    await user.click(screen.getByLabelText('Start at'));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument.mock.calls.at(-1)[1].layout.pageNumbers).toMatchObject({ startPage: 3, restartAt: 1, format: 'roman' }));
    expect(screen.getByRole('region', { name: 'Page 1 of 1' })).not.toHaveTextContent('i');
  });

  it('saves "current page only" as that one page', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Page border' }));
    await user.click(screen.getByRole('button', { name: 'Box' }));
    await user.selectOptions(screen.getByLabelText('Apply to'), 'current');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument.mock.calls.at(-1)[1].layout.pageBorder).toMatchObject({ scope: 'pages', pages: '1' }));
  });

  it('picks border pages with pills and keeps the typed list in step', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Page border' }));
    await user.click(screen.getByRole('button', { name: 'Box' }));
    await user.selectOptions(screen.getByLabelText('Apply to'), 'pages');
    await user.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(screen.getByLabelText('Pages')).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Page 1' }));
    expect(screen.getByLabelText('Pages')).toHaveValue('');
  });

  it('closes header editing on a click outside', async () => {
    await open();
    fireEvent.doubleClick(document.querySelector('.doc-sheets'), { clientY: 10 });
    await screen.findByLabelText('Footer right');
    fireEvent.mouseDown(document.querySelector('.doc-header'));
    await waitFor(() => expect(screen.queryByLabelText('Footer right')).not.toBeInTheDocument());
  });

  it('adds page numbers from the Insert menu', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    await user.click(screen.getByRole('tab', { name: 'Page' }));
    await user.click(screen.getByRole('button', { name: /Page numbers/ }));
    await user.click(screen.getByRole('button', { name: 'Page 1 of 5' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('region', { name: 'Page 1 of 1' })).toHaveTextContent('Page 1 of 1');
  });

  it('inserts a page break with Ctrl+Enter', async () => {
    await open();
    act(() => { lastEditor().commands.focus('end'); });
    fireEvent.keyDown(prose(), { key: 'Enter', ctrlKey: true });
    expect(lastEditor().getJSON().content.map((n) => n.type)).toContain('pageBreak');
  });

  it('splits text at a page break without leaving an empty line', async () => {
    await open();
    act(() => { lastEditor().chain().focus(6).setPageBreak().run(); });
    const { content } = lastEditor().getJSON();
    expect(content.map((n) => n.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(content[2].content[0].text).toBe(' there');
    act(() => { lastEditor().chain().focus('start').setPageBreak().run(); });
    expect(lastEditor().getJSON().content.map((n) => n.type)).toEqual(['pageBreak', 'paragraph', 'pageBreak', 'paragraph']);
  });

  it('applies a page border', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Page border' }));
    await user.click(screen.getByRole('button', { name: 'Box' }));
    await user.selectOptions(screen.getByLabelText('Style'), 'double');
    await user.click(screen.getByRole('button', { name: 'Forest green' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(document.querySelector('.doc-sheet .doc-sheet-border')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateDocument.mock.calls.at(-1)[1].layout.pageBorder).toMatchObject({ style: 'double', color: '#2e5e4e', scope: 'all' }));
  });

  it('offers a retry when the document cannot load', async () => {
    getDocument.mockRejectedValueOnce(new Error('Document not found'));
    const user = renderEditor();
    expect(await screen.findByText('Document not found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByLabelText('Document title')).toBeInTheDocument();
  });
});
