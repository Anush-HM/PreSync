// Temporary in-memory/mock data layer.
// Stands in for MongoDB (deck metadata) + Yjs (live slide content) until
// the backend + real-time layer are wired up. Shape matches the spec's
// data model so swapping this out later is mostly a find/replace.

export const MOCK_DECKS = [
  {
    id: 'deck-1',
    title: 'Q3 Product Roadmap',
    updatedAt: '2026-07-28T10:20:00Z',
    slideCount: 4,
    thumbnailColor: 'blue'
  },
  {
    id: 'deck-2',
    title: 'Investor Update — July',
    updatedAt: '2026-07-25T14:00:00Z',
    slideCount: 3,
    thumbnailColor: 'amber'
  }
];

// Slides for deck-1, used by the editor, presenter, and viewer mock views.
export const MOCK_SLIDES = [
  {
    id: 'slide-1',
    title: 'Q3 Product Roadmap',
    blocks: [
      { id: 'b1', type: 'textbox', x: 60, y: 50, width: 520, fontSize: 32, text: 'Q3 Product Roadmap' },
      { id: 'b2', type: 'textbox', x: 60, y: 110, width: 520, fontSize: 16, text: 'Team sync — July 2026' }
    ]
  },
  {
    id: 'slide-2',
    title: 'Where we are',
    blocks: [
      { id: 'b3', type: 'textbox', x: 60, y: 40, width: 520, fontSize: 24, text: 'Where we are' },
      { id: 'b4', type: 'textbox', x: 60, y: 90, width: 520, fontSize: 15, text: '• Editor and viewer roles shipped\n• PDF ingestion pipeline in progress\n• Live broadcast sync not yet started' }
    ]
  },
  {
    id: 'slide-3',
    title: 'What ships next',
    blocks: [
      { id: 'b5', type: 'textbox', x: 60, y: 40, width: 520, fontSize: 24, text: 'What ships next' },
      { id: 'b6', type: 'textbox', x: 60, y: 90, width: 520, fontSize: 15, text: '• Yjs concurrent editing\n• Socket.io presenter broadcast\n• Grounded AI Q&A' }
    ]
  },
  {
    id: 'slide-4',
    title: 'Questions',
    blocks: [
      { id: 'b7', type: 'textbox', x: 60, y: 40, width: 520, fontSize: 24, text: 'Questions?' },
      { id: 'b8', type: 'textbox', x: 60, y: 90, width: 520, fontSize: 15, text: 'Ask below — answers are drafted from this deck only.' }
    ]
  }
];

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}