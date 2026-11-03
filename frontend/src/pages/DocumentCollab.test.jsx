import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import DocumentEditorPage from './DocumentEditorPage.jsx';
import { documentExtensions } from '../components/documents/documentExtensions.js';
import { addDocumentComment, getDocument, listDocumentComments, saveDocument, updateDocument } from '../data/documentsApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/documentsApi.js', () => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
  downloadDocument: vi.fn(),
  saveDocument: vi.fn(),
  listDocumentComments: vi.fn(),
  addDocumentComment: vi.fn(),
  replyToDocumentComment: vi.fn(),
  updateDocumentComment: vi.fn(),
  deleteDocumentComment: vi.fn(),
  listDocumentVersions: vi.fn(),
  getDocumentVersion: vi.fn(),
  saveDocumentVersion: vi.fn(),
  restoreDocumentVersion: vi.fn(),
  shareDocument: vi.fn(),
  updateDocumentShare: vi.fn(),
  removeDocumentShare: vi.fn()
}));

// The live copy as the server hands it over: a Y.Doc already holding the
// document, and presence. Tests change it the way other people would.
let live;
vi.mock('../data/yjsClient.js', () => ({
  connectDocumentDoc: () => ({
    doc: live.doc,
    awareness: live.awareness,
    onStatus: (cb) => { cb('synced'); return () => {}; },
    disconnect: vi.fn()
  })
}));

const PAGE = { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96 } };
const LAYOUT = { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' }, differentFirstPage: false, pageNumbers: null, pageBorder: null };
const CONTENT = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shared words' }] }] };
const DOC = { id: 'doc-1', title: 'Team plan', wordCount: 2, page: PAGE, layout: LAYOUT, importNotes: [], content: CONTENT, role: 'editor', isOwner: false, owner: { id: 'u1', name: 'Olu', email: 'olu@example.com' }, people: [] };
const schema = getSchema(documentExtensions);

function makeLive(content = CONTENT) {
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(schema, content, doc.getXmlFragment('default'));
  const meta = doc.getMap('meta');
  meta.set('title', DOC.title);
  meta.set('page', PAGE);
  meta.set('layout', LAYOUT);
  meta.set('commentsRev', 0);
  return { doc, awareness: new Awareness(doc) };
}

const fragmentJSON = () => yXmlFragmentToProsemirrorJSON(live.doc.getXmlFragment('default'));
const prose = () => document.querySelector('.ProseMirror');

beforeAll(() => {
  const rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => [rect];
  Range.prototype.getBoundingClientRect = () => rect;
  Element.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => null;
});

beforeEach(() => {
  vi.clearAllMocks();
  live = makeLive();
  getDocument.mockResolvedValue(DOC);
  listDocumentComments.mockResolvedValue([]);
  saveDocument.mockResolvedValue({ versionId: null });
});

async function open(doc = DOC) {
  getDocument.mockResolvedValue(doc);
  renderAt('/documents/doc-1', <Route path="/documents/:id" element={<DocumentEditorPage />} />);
  await waitFor(() => expect(prose()).toHaveTextContent('Shared words'));
  return userEvent.setup();
}

describe('co-editing a Word document', () => {
  it('edits the shared copy instead of saving over the API, and shows others’ changes', async () => {
    await open();
    act(() => { prose().editor.chain().focus('end').insertContent(' and more').run(); });
    expect(fragmentJSON().content[0].content[0].text).toBe('Shared words and more');

    // Someone else adds a paragraph and renames the document.
    act(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'From a colleague');
      p.insert(0, [t]);
      live.doc.transact(() => {
        live.doc.getXmlFragment('default').push([p]);
        live.doc.getMap('meta').set('title', 'Renamed by Pat');
      }, 'remote');
    });
    await waitFor(() => expect(prose()).toHaveTextContent('From a colleague'));
    expect(screen.getByLabelText('Document title')).toHaveValue('Renamed by Pat');
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved');
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('keeps title, page and layout changes in the shared copy', async () => {
    const user = await open();
    const titleInput = screen.getByLabelText('Document title');
    await user.clear(titleInput);
    await user.type(titleInput, 'New name{Enter}');
    expect(live.doc.getMap('meta').get('title')).toBe('New name');
    await user.selectOptions(screen.getByLabelText('Page size'), 'a4');
    expect(live.doc.getMap('meta').get('page')).toMatchObject({ width: 794 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveDocument).toHaveBeenCalledWith('doc-1');
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('shows who else is in the document', async () => {
    await open();
    act(() => {
      live.awareness.states.set(4242, { user: { id: 'u2', name: 'Pat', color: '#3A6EA5', role: 'viewer' } });
      live.awareness.emit('change', [{ added: [4242], updated: [], removed: [] }, 'remote']);
    });
    expect(await screen.findByText(/Pat is here/)).toBeInTheDocument();
    expect(screen.getByText(/1 viewing/)).toBeInTheDocument();
  });

  it('starts a comment thread on the selected text and marks that text for everyone', async () => {
    const user = await open();
    addDocumentComment.mockResolvedValue({ id: 'c'.repeat(24), text: 'Is this right?', quote: 'Shared', replies: [], createdAt: new Date().toISOString() });
    act(() => { prose().editor.commands.setTextSelection({ from: 1, to: 7 }); });
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    const panel = screen.getByRole('complementary', { name: 'Comments' });
    expect(within(panel).getByText('On “Shared”')).toBeInTheDocument();
    await user.type(within(panel).getByLabelText('Add a comment'), 'Is this right?');
    await user.click(within(panel).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(addDocumentComment).toHaveBeenCalledWith('doc-1', { text: 'Is this right?', quote: 'Shared' }));
    await waitFor(() => expect(fragmentJSON().content[0].content[0].marks).toEqual([{ type: 'comment', attrs: { commentId: 'c'.repeat(24) } }]));
  });
});

describe('a document shared to view', () => {
  it('follows along read-only, without tools, but can still download and read comments', async () => {
    const user = await open({ ...DOC, role: 'viewer' });
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(prose()).toHaveAttribute('contenteditable', 'false');
    expect(prose().editor.isEditable).toBe(false);
    expect(screen.getByLabelText('Document title')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Page size')).toBeDisabled();

    act(() => {
      live.doc.transact(() => {
        const t = live.doc.getXmlFragment('default').get(0).get(0);
        t.insert(t.length, ' (edited live)');
      }, 'remote');
    });
    await waitFor(() => expect(prose()).toHaveTextContent('Shared words (edited live)'));

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    expect(screen.getByText(/read comments but not add them/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument();
  });
});
