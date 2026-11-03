import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import DocumentsPage from './DocumentsPage.jsx';
import { createDocument, deleteDocument, downloadDocument, listDocuments, updateDocument } from '../data/documentsApi.js';
import { listImports } from '../data/importsApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/documentsApi.js', () => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  downloadDocument: vi.fn(),
  updateDocument: vi.fn(),
  uploadDocx: vi.fn()
}));

vi.mock('../data/importsApi.js', () => ({
  listImports: vi.fn(),
  deleteImport: vi.fn(),
  uploadImport: vi.fn(),
  validateImportFile: vi.fn(),
  IMPORT_ACCEPT_ALL: '.docx',
  MAX_IMPORT_MB: 25
}));

const DOC = { id: 'doc-1', title: 'Annual plan', wordCount: 120, isOwner: true, updatedAt: '2026-05-01T00:00:00Z' };
const SHARED = { ...DOC, id: 'doc-2', title: 'Their notes', isOwner: false };
const PPTX = { id: 'imp-1', title: 'Kickoff', format: 'pptx', fileSize: 2048, slideCount: 4, createdAt: '2026-05-01T00:00:00Z', deckIds: [], warningCount: 0 };

function renderPage() {
  renderAt('/documents', <Route path="/documents" element={<DocumentsPage />} />);
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  listDocuments.mockResolvedValue([DOC, SHARED]);
  listImports.mockResolvedValue([PPTX]);
});

describe('DocumentsPage', () => {
  it('lists documents shared with the user on their own, with who shared them', async () => {
    listDocuments.mockResolvedValue([DOC, { ...SHARED, role: 'viewer', owner: { id: 'u9', name: 'Olu', email: 'olu@example.com' } }]);
    const user = renderPage();
    const mine = await screen.findByRole('list', { name: 'Word documents' });
    expect(within(mine).queryByText('Their notes')).not.toBeInTheDocument();
    const shared = screen.getByRole('list', { name: 'Word documents shared with you' });
    expect(within(shared).getByText(/shared by Olu · view only/)).toBeInTheDocument();
    await user.click(within(shared).getByRole('button', { name: 'Actions for Their notes' }));
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toBeInTheDocument();
  });

  it('lists Word documents, and keeps other imports apart', async () => {
    renderPage();
    const docs = await screen.findByRole('list', { name: 'Word documents' });
    expect(within(docs).getByRole('link', { name: 'Annual plan' })).toHaveAttribute('href', '/documents/doc-1');
    const files = screen.getByRole('region', { name: 'Imported files' });
    expect(within(files).getByText('Kickoff')).toBeInTheDocument();
  });

  it('creates a blank document and opens it', async () => {
    createDocument.mockResolvedValue({ id: 'doc-9' });
    const user = renderPage();
    await screen.findByRole('list', { name: 'Word documents' });
    await user.click(screen.getByRole('button', { name: 'New Word document' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/documents/doc-9');
  });

  it('offers an import made for Word', async () => {
    const user = renderPage();
    await screen.findByRole('list', { name: 'Word documents' });
    await user.click(screen.getByRole('button', { name: 'Import Word document' }));
    expect(screen.getByRole('dialog', { name: 'Import a Word document' })).toBeInTheDocument();
  });

  it('renames a document', async () => {
    updateDocument.mockResolvedValue({ id: 'doc-1', title: 'Renamed', wordCount: 120 });
    const user = renderPage();
    await screen.findByRole('list', { name: 'Word documents' });
    await user.click(screen.getByRole('button', { name: 'Actions for Annual plan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Renamed{Enter}');
    expect(updateDocument).toHaveBeenCalledWith('doc-1', { title: 'Renamed' });
    expect(await screen.findByRole('link', { name: 'Renamed' })).toBeInTheDocument();
  });

  it('downloads both formats', async () => {
    const user = renderPage();
    await screen.findByRole('list', { name: 'Word documents' });
    await user.click(screen.getByRole('button', { name: 'Actions for Annual plan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download as .docx' }));
    expect(downloadDocument).toHaveBeenCalledWith('doc-1', 'docx', 'Annual plan');
    await user.click(screen.getByRole('button', { name: 'Actions for Annual plan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Download as PDF' }));
    expect(downloadDocument).toHaveBeenCalledWith('doc-1', 'pdf', 'Annual plan');
  });

  it('confirms before deleting, and only owners can delete', async () => {
    deleteDocument.mockResolvedValue(null);
    const user = renderPage();
    await screen.findByRole('list', { name: 'Word documents' });
    await user.click(screen.getByRole('button', { name: 'Actions for Their notes' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for Annual plan' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(deleteDocument).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog', { name: 'Delete document?' })).getByRole('button', { name: 'Delete document' }));
    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(screen.queryByRole('link', { name: 'Annual plan' })).not.toBeInTheDocument();
  });

  it('shows an empty state with a way to start', async () => {
    listDocuments.mockResolvedValue([]);
    listImports.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'No Word documents yet' })).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    listDocuments.mockRejectedValueOnce(new Error('Network down'));
    const user = renderPage();
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Word documents' })).toBeInTheDocument();
  });
});
