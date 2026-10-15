import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext, draftAnswer } from './qaService.js';

const slide = (id, order, ...texts) => ({ id, order, blocks: texts.map((text) => ({ text })) });

const deck = {
  slides: [
    slide('s1', 0, 'Intro'),
    slide('s2', 1, 'Revenue grew 20%', 'Driven by EMEA'),
    slide('s3', 2, 'Hiring plan'),
    slide('s4', 3, 'Appendix')
  ]
};

function anthropicReply(text, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => ({ content: text === undefined ? [] : [{ type: 'text', text }] })
  };
}

describe('buildContext', () => {
  it('includes only the current slide and its immediate neighbours', () => {
    const context = buildContext(deck, 's2');
    expect(context).toBe(
      'Slide 0:\nIntro\n\nSlide 1:\nRevenue grew 20%\nDriven by EMEA\n\nSlide 2:\nHiring plan'
    );
    expect(context).not.toContain('Appendix');
  });

  it('clips the window at the start of the deck', () => {
    expect(buildContext(deck, 's1')).toBe('Slide 0:\nIntro\n\nSlide 1:\nRevenue grew 20%\nDriven by EMEA');
  });

  it('skips empty text blocks', () => {
    const d = { slides: [{ id: 'a', order: 0, blocks: [{ text: '' }, { text: 'Only this' }, {}] }] };
    expect(buildContext(d, 'a')).toBe('Slide 0:\nOnly this');
  });

  it('returns nothing for an unknown slide', () => {
    expect(buildContext(deck, 'missing')).toBe('');
  });
});

describe('draftAnswer', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends the slide window and question to the Anthropic Messages API', async () => {
    fetchMock.mockResolvedValue(anthropicReply('  Revenue grew 20%, mostly from EMEA.  '));

    const answer = await draftAnswer({ deck, slideId: 's2', question: 'How much did revenue grow?' });

    expect(answer).toBe('Revenue grew 20%, mostly from EMEA.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(init.body);
    expect(body.system).toContain('Use ONLY the slide content');
    expect(body.system).toContain('NOT_IN_DECK');
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: `SLIDE CONTENT:\n${buildContext(deck, 's2')}\n\nQUESTION:\nHow much did revenue grow?`
      }
    ]);
  });

  it('passes NOT_IN_DECK through when the model says the deck does not cover it', async () => {
    fetchMock.mockResolvedValue(anthropicReply('NOT_IN_DECK'));
    expect(await draftAnswer({ deck, slideId: 's2', question: 'What is the CEO’s salary?' })).toBe(
      'NOT_IN_DECK'
    );
  });

  it('falls back to NOT_IN_DECK when the reply has no text block', async () => {
    fetchMock.mockResolvedValue(anthropicReply(undefined));
    expect(await draftAnswer({ deck, slideId: 's2', question: 'Why?' })).toBe('NOT_IN_DECK');
  });

  it('does not call the API without a key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(await draftAnswer({ deck, slideId: 's2', question: 'Why?' })).toBe('NOT_IN_DECK');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the API for a slide that is not in the deck', async () => {
    expect(await draftAnswer({ deck, slideId: 'missing', question: 'Why?' })).toBe('NOT_IN_DECK');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on an API error so the caller can report a failed draft', async () => {
    fetchMock.mockResolvedValue(anthropicReply(undefined, { ok: false, status: 529 }));
    await expect(draftAnswer({ deck, slideId: 's2', question: 'Why?' })).rejects.toThrow(
      'Anthropic API error: 529'
    );
  });
});
