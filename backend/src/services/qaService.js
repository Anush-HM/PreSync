// Drafts an answer to a viewer's question using ONLY the extracted text
// of the current slide plus its neighbors — never the model's general
// knowledge, and never the whole deck every time (retrieval, not a full
// context dump). If the deck doesn't cover it, the model is instructed
// to return the literal string "NOT_IN_DECK" and we pass that through
// as-is rather than ever guessing on the presenter's behalf.

export function buildContext(deck, slideId) {
  const slides = deck.slides;
  const idx = slides.findIndex((s) => s.id === slideId);
  if (idx === -1) return '';

  // current slide + one neighbor on each side, in reading order
  const window = slides.slice(Math.max(0, idx - 1), idx + 2);
  const texts = window.map((s) => s.blocks.map((b) => b.text?.trim()).filter(Boolean).join('\n'));
  // Nothing to ground an answer in — return no context so draftAnswer
  // short-circuits to NOT_IN_DECK instead of calling the API with only
  // "Slide N:" headers.
  if (!texts.some(Boolean)) return '';

  return window
    .map((s, i) => `Slide ${s.order ?? idx - 1 + i}:\n${texts[i]}`)
    .join('\n\n');
}

const SYSTEM_PROMPT = `You are answering an audience question during a live presentation.
Use ONLY the slide content provided below. Do not use outside knowledge.
If the answer is not covered by the provided slides, respond with exactly: NOT_IN_DECK
Keep answers to 1-2 sentences.`;

export async function draftAnswer({ deck, slideId, question }) {
  const context = buildContext(deck, slideId);
  if (!context.trim()) return 'NOT_IN_DECK';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No key configured yet — fail safe rather than fabricate an answer.
    return 'NOT_IN_DECK';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `SLIDE CONTENT:\n${context}\n\nQUESTION:\n${question}` }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.find((block) => block.type === 'text')?.text ?? 'NOT_IN_DECK';
  return text.trim();
}