import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import DecksPage from './DecksPage.jsx';
import { listDecks, deleteDeck, duplicateDeck } from '../data/decksApi.js';
import { createDocument } from '../data/documentsApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/decksApi.js', () => ({
  listDecks: vi.fn(),
  createDeck: vi.fn(),
  importDeckFile: vi.fn(),
  deleteDeck: vi.fn(),
  duplicateDeck: vi.fn(),
  renameDeck: vi.fn(),
  getDeck: vi.fn(),
  addCollaborator: vi.fn(),
  removeCollaborator: vi.fn(),
  IMPORT_ACCEPT: '.pdf,.pptx'
}));

vi.mock('../data/importsApi.js', () => ({
  listImports: vi.fn().mockResolvedValue([]),
  uploadImport: vi.fn(),
  validateImportFile: vi.fn(),
  IMPORT_ACCEPT_ALL: '.docx',
  MAX_IMPORT_MB: 25
}));

vi.mock('../data/documentsApi.js', () => ({ createDocument: vi.fn(), uploadDocx: vi.fn() }));

const ME = { id: 'u1', name: 'Leo Grant', email: 'leo@example.com' };
const OTHER = { id: 'u2', name: 'Maya Ross', email: 'maya@example.com' };

const DECKS = [
  { id: 'd1', title: 'Roadmap', updatedAt: '2026-05-02T10:00:00Z', createdAt: '2026-05-01T10:00:00Z', slideCount: 3, isOwner: true, owner: ME, collaborators: [OTHER], thumbnail: null },
  { id: 'd2', title: 'Budget review', updatedAt: '2026-05-01T10:00:00Z', createdAt: '2026-04-01T10:00:00Z', slideCount: 1, isOwner: false, owner: OTHER, collaborators: [ME], thumbnail: null }
];

function renderDecks(view = 'home') {
  localStorage.setItem('presync:user', JSON.stringify(ME));
  renderAt('/decks', <Route path="/decks" element={<DecksPage view={view} />} />);
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DecksPage', () => {
  it('shows the three getting-started actions to a new user', async () => {
    listDecks.mockResolvedValue([]);
    renderDecks();
    expect(await screen.findByRole('heading', { name: 'Create your first presentation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create from scratch/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import a Word document/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import a PowerPoint/ })).toBeInTheDocument();
  });

  it('opens the import dialog for Word from the header', async () => {
    listDecks.mockResolvedValue(DECKS);
    const user = renderDecks();
    await screen.findByText('Roadmap');
    await user.click(screen.getByRole('button', { name: 'Import Word document' }));
    expect(screen.getByRole('dialog', { name: 'Import a Word document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse files' })).toBeInTheDocument();
  });

  it('creates a blank Word document and opens it', async () => {
    listDecks.mockResolvedValue(DECKS);
    createDocument.mockResolvedValue({ id: 'doc-1' });
    const user = renderDecks();
    await screen.findByText('Roadmap');
    await user.click(screen.getByRole('button', { name: 'New Word document' }));
    expect(createDocument).toHaveBeenCalled();
    expect(await screen.findByTestId('location')).toHaveTextContent('/documents/doc-1');
  });

  it('greets the user and lists recent and shared presentations', async () => {
    listDecks.mockResolvedValue(DECKS);
    renderDecks();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/, Leo$/);
    const recent = screen.getByRole('region', { name: 'Recent presentations' });
    expect(within(recent).getByText('Roadmap')).toBeInTheDocument();
    const shared = screen.getByRole('region', { name: 'Shared with you' });
    expect(within(shared).getByText('Budget review')).toBeInTheDocument();
    expect(within(shared).getByText(/Shared by Maya Ross/)).toBeInTheDocument();
  });

  it('filters by search text', async () => {
    listDecks.mockResolvedValue(DECKS);
    const user = renderDecks();
    await screen.findByText('Roadmap');
    await user.type(screen.getByLabelText('Search presentations'), 'budget');
    expect(screen.queryByText('Roadmap')).not.toBeInTheDocument();
    expect(screen.getByText('Budget review')).toBeInTheDocument();
    expect(screen.getByText('1 presentation')).toBeInTheDocument();
  });

  it('only shows decks the user owns on My Presentations', async () => {
    listDecks.mockResolvedValue(DECKS);
    renderDecks('mine');
    expect(await screen.findByText('Roadmap')).toBeInTheDocument();
    expect(screen.queryByText('Budget review')).not.toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and only offers delete to the owner', async () => {
    listDecks.mockResolvedValue(DECKS);
    deleteDeck.mockResolvedValue(null);
    const user = renderDecks();
    await screen.findByText('Roadmap');

    await user.click(screen.getAllByRole('button', { name: 'Actions for Budget review' })[0]);
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for Roadmap' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(deleteDeck).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete presentation?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete presentation' }));
    expect(deleteDeck).toHaveBeenCalledWith('d1');
    expect(screen.queryByText('Roadmap')).not.toBeInTheDocument();
  });

  it('duplicates a deck and reloads the list', async () => {
    listDecks.mockResolvedValueOnce(DECKS).mockResolvedValueOnce([...DECKS, { ...DECKS[0], id: 'd3', title: 'Roadmap (copy)' }]);
    duplicateDeck.mockResolvedValue({ id: 'd3', title: 'Roadmap (copy)', slideCount: 3 });
    const user = renderDecks();
    await screen.findByText('Roadmap');
    await user.click(screen.getByRole('button', { name: 'Actions for Roadmap' }));
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(duplicateDeck).toHaveBeenCalledWith('d1');
    expect(await screen.findByText('Roadmap (copy)')).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', async () => {
    listDecks.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(DECKS);
    const user = renderDecks();
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Roadmap')).toBeInTheDocument();
  });
});
