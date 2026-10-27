import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { getSlidesArray, plainToSlideMap, slideMapToPlain } from '../../data/yjsClient.js';

vi.mock('../../data/copilotApi.js', () => ({
  getCopilotStatus: vi.fn(),
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversations: vi.fn(),
  askCopilot: vi.fn(),
  setActionStatus: vi.fn()
}));

const api = await import('../../data/copilotApi.js');
const { default: CopilotPanel } = await import('./CopilotPanel.jsx');

const BODY = 'We grew revenue a lot in the last quarter thanks to many things.';
const seed = () => [
  {
    id: 's1',
    order: 0,
    notes: '',
    blocks: [
      { id: 't1', type: 'textbox', role: 'title', x: 80, y: 50, width: 800, fontSize: 36, text: 'Results' },
      { id: 'b1', type: 'textbox', x: 80, y: 140, width: 800, fontSize: 18, text: BODY }
    ]
  }
];

// The editor around the panel: a real Y.Doc with the editor's undo
// manager, and a bridge like EditorPage's.
function setup({ selectedIds = [] } = {}) {
  const doc = new Y.Doc();
  getSlidesArray(doc).push(seed().map(plainToSlideMap));
  const undoManager = new Y.UndoManager(getSlidesArray(doc), { captureTimeout: 0 });
  const bridge = {
    getDoc: () => doc,
    getUndoManager: () => undoManager,
    releaseCanvas: vi.fn(),
    measureBlocks: () => new Map([['t1', { height: 44 }], ['b1', { height: 50 }]]),
    textSelection: () => null,
    subscribe: () => () => {}
  };
  const onClose = vi.fn();
  function Harness() {
    const [slides, setSlides] = useState(() => getSlidesArray(doc).toArray().map(slideMapToPlain));
    const [active, setActive] = useState(0);
    useEffect(() => {
      const arr = getSlidesArray(doc);
      const sync = () => setSlides(arr.toArray().map(slideMapToPlain));
      arr.observeDeep(sync);
      return () => arr.unobserveDeep(sync);
    }, []);
    return <CopilotPanel deckId="d1" deckTitle="Q3 review" slides={slides} activeSlideIdx={active} selectedIds={selectedIds} bridge={bridge} onSelectSlide={setActive} onClose={onClose} />;
  }
  render(<Harness />);
  const slides = () => getSlidesArray(doc).toArray().map(slideMapToPlain);
  return { doc, undoManager, slides, onClose };
}

const reply = (actions, extra = {}) => ({
  conversation: { id: 'c1', title: 'x' },
  userMessage: { id: 'u1', role: 'user', content: 'req', contextLabel: 'Slide 1: Results' },
  assistantMessage: { id: 'a1', role: 'assistant', content: 'Here you go.', grounding: 'document', slideRefs: [0], actions, ...extra },
  rejectedActions: 0
});

beforeEach(() => {
  localStorage.clear();
  api.getCopilotStatus.mockResolvedValue({ configured: true, provider: 'Anthropic', model: 'claude-opus-5-5', storesHistory: true, setup: null });
  api.listConversations.mockResolvedValue([]);
  api.setActionStatus.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

async function consent() {
  await userEvent.click(await screen.findByRole('button', { name: 'I understand, continue' }));
}

describe('CopilotPanel', () => {
  it('explains the setup when no AI provider is configured and keeps the design check available', async () => {
    api.getCopilotStatus.mockResolvedValue({ configured: false, provider: 'Anthropic', setup: 'Set ANTHROPIC_API_KEY in backend/.env and restart the backend to enable AI Copilot.' });
    const { onClose } = setup();
    expect(await screen.findByText(/isn’t set up yet/)).toBeInTheDocument();
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message AI Copilot' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Check this slide’s design/ }));
    expect(screen.getByText(/Editor check · no AI/)).toBeInTheDocument();
    expect(api.askCopilot).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close AI Copilot' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before sending document content, then shows the context it will use', async () => {
    setup();
    expect(await screen.findByText(/sends the parts of this presentation/)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument();
    await consent();
    expect(screen.getByText('Using Slide 1: Results')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Slide' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Selection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Suggest a title for this slide' })).toBeInTheDocument();
  });

  it('rewrites the selected text after preview and confirmation, and undoes it', async () => {
    api.askCopilot.mockResolvedValue(reply([{ type: 'replace_selected_text', summary: 'More concise', slideIndex: 0, blockId: 'b1', text: 'Revenue grew strongly last quarter.', status: 'proposed' }]));
    const { slides } = setup({ selectedIds: ['b1'] });
    await consent();
    expect(screen.getByRole('radio', { name: 'Selection' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Shorten this' }));

    const [deckId, body] = api.askCopilot.mock.calls[0];
    expect(deckId).toBe('d1');
    expect(body.message).toBe('Shorten this');
    expect(body.context.selection).toMatchObject({ blockId: 'b1', text: BODY });
    expect(body.context.activeSlide.blocks[1].measuredHeight).toBe(50);

    const card = await screen.findByRole('article', { name: 'Replace selection' });
    expect(within(card).getByText(BODY)).toBeInTheDocument();
    expect(within(card).getByText('Revenue grew strongly last quarter.')).toBeInTheDocument();
    expect(screen.getByText('From your presentation')).toBeInTheDocument();
    // Nothing changes until the user applies it.
    expect(slides()[0].blocks[1].text).toBe(BODY);

    await userEvent.click(within(card).getByRole('button', { name: 'Replace text' }));
    expect(slides()[0].blocks[1].text).toBe('Revenue grew strongly last quarter.');
    expect(api.setActionStatus).toHaveBeenCalledWith('c1', 'a1', 0, 'applied');

    await userEvent.click(within(card).getByRole('button', { name: 'Undo' }));
    expect(slides()[0].blocks[1].text).toBe(BODY);
    expect(within(card).getByText('Undone')).toBeInTheDocument();
  });

  it('keeps AI edits on the editor undo stack too', async () => {
    api.askCopilot.mockResolvedValue(reply([{ type: 'generate_speaker_notes', summary: 'Notes', slideIndex: 0, notes: 'Open with the headline number.', notesMode: 'replace' }]));
    const { slides, undoManager } = setup();
    await consent();
    await userEvent.click(screen.getByRole('button', { name: 'Write speaker notes for this slide' }));
    const card = await screen.findByRole('article', { name: 'Speaker notes' });
    await userEvent.click(within(card).getByRole('button', { name: 'Use these notes' }));
    expect(slides()[0].notes).toBe('Open with the headline number.');
    act(() => undoManager.undo()); // Ctrl+Z in the editor
    expect(slides()[0].notes).toBe('');
  });

  it('inserts a recommended sticker from the library', async () => {
    api.askCopilot.mockResolvedValue(reply([{ type: 'suggest_asset', summary: 'Celebrate the result', slideIndex: 0, assetIds: ['emoji-party', 'emoji-trophy'] }]));
    const { slides } = setup();
    await consent();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message AI Copilot' }), 'Suggest celebration stickers{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Insert Trophy on slide 1' }));
    expect(slides()[0].blocks.at(-1)).toMatchObject({ type: 'textbox', text: '🏆' });
  });

  it('shows rate-limit and provider errors with a retry, keeping the typed request', async () => {
    const err = Object.assign(new Error('You’ve reached the Copilot limit of 10 requests a minute. Try again in 20s.'), { code: 'RATE_LIMITED', retryAfter: 20 });
    api.askCopilot.mockRejectedValueOnce(err).mockResolvedValueOnce(reply([]));
    setup();
    await consent();
    const box = screen.getByRole('textbox', { name: 'Message AI Copilot' });
    await userEvent.type(box, 'Summarize this slide{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('limit of 10 requests');
    expect(box).toHaveValue('Summarize this slide');
    await userEvent.click(screen.getByRole('button', { name: 'Retry (wait 20s)' }));
    expect(await screen.findByText('Here you go.')).toBeInTheDocument();
    expect(api.askCopilot).toHaveBeenCalledTimes(2);
  });

  it('switches to the setup message if the server reports Copilot is not configured', async () => {
    api.askCopilot.mockRejectedValue(Object.assign(new Error('Set ANTHROPIC_API_KEY in backend/.env'), { code: 'AI_NOT_CONFIGURED' }));
    setup();
    await consent();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message AI Copilot' }), 'Hello{Enter}');
    expect(await screen.findByText(/isn’t set up yet/)).toBeInTheDocument();
  });

  it('drafts an outline from a brief, lets the user edit it, then adds slides without replacing existing ones', async () => {
    api.askCopilot.mockResolvedValue(
      reply([
        {
          type: 'create_outline',
          summary: 'Outline',
          title: 'Solar',
          slides: [
            { title: 'Why solar', bullets: ['Cheap', 'Clean'], notes: 'Hook', layoutId: 'title' },
            { title: 'Costs', bullets: ['Panels'], notes: '', layoutId: null },
            { title: 'Drop me', bullets: [], notes: '', layoutId: null }
          ]
        }
      ])
    );
    const { slides } = setup();
    await consent();
    await userEvent.click(screen.getByRole('tab', { name: 'Create deck' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Topic' }), 'Solar power for schools');
    await userEvent.type(screen.getByRole('textbox', { name: 'Audience' }), 'Parents');
    await userEvent.click(screen.getByRole('button', { name: 'Draft outline' }));

    const body = api.askCopilot.mock.calls[0][1];
    expect(body).toMatchObject({ mode: 'outline', brief: { topic: 'Solar power for schools', audience: 'Parents', slideCount: 8 } });

    const title = await screen.findByRole('textbox', { name: 'Slide 2 title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'What it costs');
    await userEvent.click(screen.getByRole('button', { name: 'Remove slide 3' }));
    expect(slides()).toHaveLength(1); // still nothing created
    await userEvent.click(screen.getByRole('radio', { name: /At the end/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create 2 slides' }));

    await waitFor(() => expect(slides()).toHaveLength(3));
    expect(slides()[0].id).toBe('s1');
    expect(slides().slice(1).map((s) => s.blocks[0].text)).toEqual(['Why solar', 'What it costs']);
    expect(slides()[1].notes).toBe('Hook');
  });

  it('starts a new conversation and clears history after confirmation', async () => {
    api.listConversations.mockResolvedValue([{ id: 'c1', title: 'Earlier', updatedAt: new Date().toISOString(), messageCount: 2 }]);
    api.getConversation.mockResolvedValue({ id: 'c1', messages: [{ id: 'm1', role: 'user', content: 'Earlier question' }, { id: 'm2', role: 'assistant', content: 'Earlier answer', actions: [] }] });
    api.clearConversations.mockResolvedValue(null);
    setup();
    await consent();
    expect(await screen.findByText('Earlier answer')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear conversation history' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear history' }));
    expect(api.clearConversations).toHaveBeenCalledWith('d1');
  });

  it('runs the editor design check locally and applies its fixes', async () => {
    const { doc, slides } = setup();
    await consent();
    // Nudge the body 4px off the title's left edge.
    act(() => {
      getSlidesArray(doc).get(0).get('blocks').get(1).set('x', 84);
    });
    await userEvent.click(screen.getByRole('button', { name: /Check design/ }));
    expect(screen.getByText(/a few pixels off the left edge/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Apply fixes' }));
    expect(slides()[0].blocks[1].x).toBe(80);
    expect(api.askCopilot).not.toHaveBeenCalled();
  });
});
