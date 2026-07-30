import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MOCK_SLIDES } from '../data/mockData.js';
import { publishSlide } from '../data/roomSync.js';
import './PresenterPage.css';

// Mock incoming Q&A — stands in for questions arriving over the Socket.io
// Q&A channel, and answers stand in for the LLM's grounded draft.
const MOCK_QUEUE = [
  {
    id: 'q1',
    from: 'Priya',
    question: 'Is Yjs already live for editors?',
    draft: 'Yes — concurrent editing via Yjs is listed as shipped on the "Where we are" slide.'
  },
  {
    id: 'q2',
    from: 'Sam',
    question: 'What database are we using?',
    draft: 'NOT_IN_DECK — this deck doesn\u2019t mention the specific database choice.'
  }
];

function PresenterPage() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [slideIdx, setSlideIdx] = useState(0);
  const [queue, setQueue] = useState(MOCK_QUEUE);

  useEffect(() => {
    publishSlide(roomCode, slideIdx);
  }, [roomCode, slideIdx]);

  const slide = MOCK_SLIDES[slideIdx];

  function goTo(i) {
    setSlideIdx(Math.max(0, Math.min(MOCK_SLIDES.length - 1, i)));
  }

  function dismissQuestion(id) {
    setQueue((q) => q.filter((item) => item.id !== id));
  }

  return (
    <div className="presenter-page">
      <header className="presenter-topbar">
        <div className="presenter-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Exit</button>
          <span className="room-code-badge mono">LIVE · {roomCode}</span>
        </div>
        <span className="presenter-hint mono">Share this code with your audience</span>
      </header>

      <div className="presenter-body">
        <main className="presenter-stage">
          <div className="stage-slide">
            {slide.blocks.map((b) => (
              <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y, width: b.width, fontSize: b.fontSize, whiteSpace: 'pre-wrap' }}>
                {b.text}
              </div>
            ))}
          </div>
          <div className="stage-nav">
            <button className="btn btn-ghost" onClick={() => goTo(slideIdx - 1)} disabled={slideIdx === 0}>← Prev</button>
            <span className="mono">{slideIdx + 1} / {MOCK_SLIDES.length}</span>
            <button className="btn btn-ghost" onClick={() => goTo(slideIdx + 1)} disabled={slideIdx === MOCK_SLIDES.length - 1}>Next →</button>
          </div>
        </main>

        <aside className="qa-panel">
          <h3>Live Q&A</h3>
          <p className="qa-sub">Drafted from deck content only. Nothing sends until you approve.</p>
          {queue.length === 0 && <p className="qa-empty">No questions waiting.</p>}
          {queue.map((q) => (
            <div className="qa-card" key={q.id}>
              <div className="qa-question"><span className="mono qa-from">{q.from}</span> {q.question}</div>
              <div className={`qa-draft ${q.draft.startsWith('NOT_IN_DECK') ? 'not-in-deck' : ''}`}>
                {q.draft}
              </div>
              <div className="qa-actions">
                <button className="btn btn-amber" onClick={() => dismissQuestion(q.id)}>Send</button>
                <button className="btn btn-ghost" onClick={() => dismissQuestion(q.id)}>Dismiss</button>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

export default PresenterPage;