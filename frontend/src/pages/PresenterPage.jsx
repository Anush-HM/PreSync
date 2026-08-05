import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { getDeck } from '../data/decksApi.js';
import { endRoom } from '../data/roomsApi.js';
import { createSocket } from '../data/socket.js';
import { getAuthToken } from '../data/apiConfig.js';
import './PresenterPage.css';

function PresenterPage() {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const deckId = location.state?.deckId;
  const roomId = location.state?.roomId;

  const [slides, setSlides] = useState([]);
  const [slideIdx, setSlideIdx] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [connected, setConnected] = useState(false);
  const [ending, setEnding] = useState(false);

  // Each item: { id, question, draft, status: 'pending'|'drafted'|'failed', error? }
  const [queue, setQueue] = useState([]);
  const socketRef = useRef(null);

  // Presenter arrived here without a deck to load (e.g. a raw URL visit
  // rather than clicking Go Live) — nothing useful to present.
  useEffect(() => {
    if (!deckId) {
      navigate('/decks', { replace: true });
    }
  }, [deckId, navigate]);

  useEffect(() => {
    if (!deckId) return;
    getDeck(deckId)
      .then((deck) => setSlides(deck.slides || []))
      .catch((err) => setLoadError(err.message || 'Could not load this deck'));
  }, [deckId]);

  const broadcastSlide = useCallback((slide) => {
    if (!slide || socketRef.current?.connected !== true) return;
    socketRef.current.emit('presenter:slide-change', { slideId: slide.id });
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('presenter:join', { token, code: roomCode });
    });

    socket.on('presenter:joined', () => {
      // Push whatever slide is currently selected the moment we're
      // recognized as this room's presenter, so the broadcast channel
      // has real content even before the first manual navigation.
      broadcastSlide(slides[slideIdx]);
    });

    socket.on('question:new', ({ id, text }) => {
      setQueue((q) => [...q, { id, question: text, draft: '', status: 'pending' }]);
    });

    socket.on('question:drafted', ({ id, draftAnswer }) => {
      setQueue((q) => q.map((item) => (item.id === id ? { ...item, draft: draftAnswer, status: 'drafted' } : item)));
    });

    socket.on('question:draft-failed', ({ id, error }) => {
      setQueue((q) => q.map((item) => (item.id === id ? { ...item, status: 'failed', error } : item)));
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('error', ({ message }) => setLoadError(message || 'Connection error'));

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // Deliberately reconnect only on roomCode change — slides/slideIdx are
    // read via refs at broadcast time through broadcastSlide's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // Re-broadcast whenever the presenter navigates. Skipped until slides
  // have actually loaded so we don't push an empty slide on mount.
  useEffect(() => {
    if (slides.length === 0) return;
    broadcastSlide(slides[slideIdx]);
  }, [slideIdx, slides, broadcastSlide]);

  const slide = slides[slideIdx];

  function goTo(i) {
    setSlideIdx(Math.max(0, Math.min(slides.length - 1, i)));
  }

  function updateDraft(id, text) {
    setQueue((q) => q.map((item) => (item.id === id ? { ...item, draft: text } : item)));
  }

  function sendAnswer(id) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    socketRef.current?.emit('question:send', { questionId: id, answer: item.draft });
    setQueue((q) => q.filter((q2) => q2.id !== id));
  }

  function dismissQuestion(id) {
    socketRef.current?.emit('question:dismiss', { questionId: id });
    setQueue((q) => q.filter((item) => item.id !== id));
  }

  async function handleEndSession() {
    if (!roomId) {
      navigate('/decks');
      return;
    }
    setEnding(true);
    try {
      await endRoom(roomId);
    } catch {
      // Even if the request fails (e.g. already ended), leaving the
      // presenter view is still the right move — there's nothing more
      // to broadcast either way.
    } finally {
      socketRef.current?.disconnect();
      navigate('/decks');
    }
  }

  return (
    <div className="presenter-page">
      <header className="presenter-topbar">
        <div className="presenter-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Exit</button>
          <span className="room-code-badge mono">LIVE · {roomCode}</span>
          {!connected && <span className="presenter-status mono">Connecting…</span>}
        </div>
        <span className="presenter-hint mono">Share this code with your audience</span>
        <button className="btn btn-amber" onClick={handleEndSession} disabled={ending}>
          {ending ? 'Ending…' : 'End session'}
        </button>
      </header>

      {loadError && <p className="presenter-error">{loadError}</p>}

      <div className="presenter-body">
        <main className="presenter-stage">
          {!slide ? (
            <p className="mono">Loading slides…</p>
          ) : (
            <>
              <div
                className="stage-slide"
                style={
                  slide.backgroundImageUrl
                    ? { backgroundImage: `url(${slide.backgroundImageUrl})`, backgroundSize: 'cover' }
                    : undefined
                }
              >
                {(slide.blocks || []).map((b) => (
                  <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y, width: b.width, fontSize: b.fontSize, whiteSpace: 'pre-wrap' }}>
                    {b.text}
                  </div>
                ))}
              </div>
              <div className="stage-nav">
                <button className="btn btn-ghost" onClick={() => goTo(slideIdx - 1)} disabled={slideIdx === 0}>← Prev</button>
                <span className="mono">{slideIdx + 1} / {slides.length}</span>
                <button className="btn btn-ghost" onClick={() => goTo(slideIdx + 1)} disabled={slideIdx === slides.length - 1}>Next →</button>
              </div>
            </>
          )}
        </main>

        <aside className="qa-panel">
          <h3>Live Q&A</h3>
          <p className="qa-sub">Drafted from deck content only. Nothing sends until you approve.</p>
          {queue.length === 0 && <p className="qa-empty">No questions waiting.</p>}
          {queue.map((q) => (
            <div className="qa-card" key={q.id}>
              <div className="qa-question">{q.question}</div>

              {q.status === 'pending' && <div className="qa-draft qa-draft-pending mono">Drafting an answer…</div>}
              {q.status === 'failed' && <div className="qa-draft not-in-deck">Couldn't draft an answer: {q.error}</div>}
              {q.status === 'drafted' && (
                <textarea
                  className={`qa-draft-input ${q.draft.startsWith('NOT_IN_DECK') ? 'not-in-deck' : ''}`}
                  value={q.draft}
                  onChange={(e) => updateDraft(q.id, e.target.value)}
                />
              )}

              <div className="qa-actions">
                <button className="btn btn-amber" onClick={() => sendAnswer(q.id)} disabled={q.status !== 'drafted'}>Send</button>
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