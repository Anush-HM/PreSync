import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import ImportReviewPage from './ImportReviewPage.jsx';
import { createDeckFromImport, getImport } from '../data/importsApi.js';
import { renderAt } from '../test/renderAt.jsx';

vi.mock('../data/importsApi.js', () => ({
  getImport: vi.fn(),
  saveImportOutline: vi.fn(),
  createDeckFromImport: vi.fn()
}));

const DOCX = {
  id: 'imp-1', format: 'docx', fileName: 'plan.docx', fileSize: 2048, title: 'Annual plan', createdAt: '2026-05-01T00:00:00Z', deckIds: [],
  analysis: {
    kind: 'docx', title: 'Annual plan', pageCount: 4, slideCount: null, suggestedSlides: 2,
    stats: { headings: 1, paragraphs: 2, listItems: 0, tables: 1, images: 0, words: 120 },
    headings: [{ level: 1, text: 'Goals', blockIndex: 1, startsSlide: true }],
    majorTopics: ['Goals'], keyPoints: ['Grow revenue.'],
    warnings: ['1 table was converted to text bullets; PreSync slides do not support tables yet.']
  },
  outline: [
    { id: 'o1', layout: 'title', title: 'Annual plan', subtitle: '', bullets: [], notes: '', imageId: null },
    { id: 'o2', layout: 'content', title: 'Goals', subtitle: '', bullets: [{ text: 'Grow revenue.', level: 0 }], notes: '', imageId: null }
  ],
  blocks: [{ type: 'title', text: 'Annual plan' }, { type: 'heading', level: 1, text: 'Goals' }, { type: 'paragraph', text: 'Grow revenue.' }],
  images: [], slides: []
};

const PPTX = {
  ...DOCX, id: 'imp-2', format: 'pptx', fileName: 'deck.pptx', title: 'Kickoff',
  analysis: {
    kind: 'pptx', title: 'Kickoff', pageCount: null, slideCount: 1, suggestedSlides: 1,
    stats: { slides: 1, textBoxes: 1, images: 0, notes: 0, tables: 1, charts: 0 },
    headings: [{ level: 1, text: 'Kickoff', slideIndex: 0, startsSlide: true }], majorTopics: ['Kickoff'], keyPoints: [],
    slides: [{ index: 0, title: 'Kickoff', textBlocks: 1, images: 0, hasNotes: false, empty: false, notSupported: ['1 table'] }],
    warnings: ['Some content is not imported: slide 1 (1 table).']
  },
  slides: [{ id: 'slide-1', order: 0, blocks: [{ id: 'b', type: 'textbox', x: 0, y: 0, width: 300, text: 'Kickoff' }] }]
};

function renderReview(id) {
  renderAt(`/imports/${id}`, <Route path="/imports/:importId" element={<ImportReviewPage />} />);
  return userEvent.setup();
}

beforeEach(() => vi.clearAllMocks());

describe('ImportReviewPage', () => {
  it('shows the Word analysis, outline and conversion notes', async () => {
    getImport.mockResolvedValue(DOCX);
    renderReview('imp-1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Annual plan' })).toBeInTheDocument();
    expect(screen.getByLabelText('Slide 2 title')).toHaveValue('Goals');
    const analysis = screen.getByRole('complementary', { name: 'Structure analysis' });
    expect(within(analysis).getByText(/1 table was converted/)).toBeInTheDocument();
    expect(within(analysis).getByText('Grow revenue.')).toBeInTheDocument();
  });

  it('generates a presentation from the edited outline and opens the editor', async () => {
    getImport.mockResolvedValue(DOCX);
    createDeckFromImport.mockResolvedValue({ id: 'deck-9', title: 'Annual plan', slideCount: 2 });
    const user = renderReview('imp-1');
    const title = await screen.findByLabelText('Slide 2 title');
    await user.clear(title);
    await user.type(title, 'Our goals');
    await user.click(screen.getByRole('button', { name: /Generate presentation/ }));

    expect(createDeckFromImport).toHaveBeenCalledWith('imp-1', expect.objectContaining({ mode: 'outline' }));
    const sent = createDeckFromImport.mock.calls[0][1].outline;
    expect(sent[1].title).toBe('Our goals');
    expect(await screen.findByTestId('location')).toHaveTextContent('/editor/deck-9');
  });

  it('previews PowerPoint slides with what was not imported, and opens them as-is', async () => {
    getImport.mockResolvedValue(PPTX);
    createDeckFromImport.mockResolvedValue({ id: 'deck-3', title: 'Kickoff', slideCount: 1 });
    const user = renderReview('imp-2');
    expect(await screen.findByText('Not imported: 1 table')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open in editor/ }));
    expect(createDeckFromImport).toHaveBeenCalledWith('imp-2', { mode: 'original' });
  });

  it('offers a retry when the import cannot be loaded', async () => {
    getImport.mockRejectedValueOnce(new Error('Import not found')).mockResolvedValueOnce(DOCX);
    const user = renderReview('imp-1');
    expect(await screen.findByText('Import not found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Annual plan' })).toBeInTheDocument();
  });
});
