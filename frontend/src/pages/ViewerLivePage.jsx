import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { createSocket } from '../data/socket.js';
import { fetchNotes, saveNote } from '../data/notesApi.js';
import './ViewerLivePage.css';

const NOTE_SAVE_DEBOUNCE_MS = 600;

function ViewerLivePage() {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Router state doesn't survive a page refresh — this falls back to
  // whatever was last persisted for this room code rather than always
  // kicking back to /join.
  const storageKey = `presync:viewer:${roomCode}`;
  const [displayName] = useState(() => {
    if (location.state?.displayName) {
      sessionStorage.setItem(storageKey, JSON.stringify(location.state));
      return location.state.displayName;
    }
    try {
      return JSON.parse(sessionStorage.getItem(storageKey))?.displayName ?? 'Guest';
    } catch {
      return 'Guest';
    }
  });
  const [viewerId] = useState(() => {
    if (location.state?.viewerId) return location.state.viewerId;
    try {
      return JSON.parse(sessionStorage.getItem(storageKey))?.viewerId ?? null;
    } catch {
      return null;
    }
  });
  const noteSaveTimer = useRef(null);
  const socketRef = useRef(null);

  // The slide currently pinned on this viewer's screen — only moves when
  // the viewer clicks "Done", per the spec's note-reconciliation rule.
  // Both pinned/live are the full { slideId, blocks, backgroundImageUrl }
  // snapshot pushed over the broadcast channel, since a viewer never has
  // access to the deck's slide list (Yjs is editor-only).
  const [pinnedSlide, setPinnedSlide] = useState(null);
  const [liveSlide, setLiveSlide] = useState(null);
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState('');

  const [notes, setNotes] = useState({}); // { slideId: text }
  const [question, setQuestion] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [answeredQuestions, setAnsweredQuestions] = useState([]); // public feed for the room
  const [sessionEnded, setSessionEnded] = useState(false);

  // No account/join info to work with (e.g. a bare page reload landed
  // here with no router state) — send them back through the join flow
  // rather than connecting a socket with nothing to identify them.
  useEffect(() => {
    if (!viewerId) {
      navigate('/join', { replace: true });
    }
  }, [viewerId, navigate]);

  useEffect(() => {
    if (!viewerId) return;

    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setConnectError('');
      socket.emit('viewer:join', { code: roomCode, viewerId });
    });

    socket.on('viewer:joined', () => {
      // currentSlideId alone isn't enough to render anything — the
      // actual content snapshot follows right after as slide:sync.
    });

    socket.on('slide:sync', ({ slideId, blocks, backgroundImageUrl }) => {
      const slide = { slideId, blocks: blocks || [], backgroundImageUrl };
      setLiveSlide(slide);
      setPinnedSlide((prev) => (prev ? prev : slide)); // first snapshot pins immediately
    });

    socket.on('qa:answer', ({ id, question: q, answer }) => {
      setAnsweredQuestions((prev) => [{ id, question: q, answer }, ...prev]);
    });

    socket.on('room:ended', () => {
      setSessionEnded(true);
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('error', ({ message }) => setConnectError(message || 'Connection error'));

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, viewerId]);

  useEffect(() => {
    if (!viewerId) return;
    fetchNotes(roomCode, viewerId).then((loaded) => {
      setNotes((prev) => ({ ...loaded, ...prev }));
    });
  }, [roomCode, viewerId]);

  const hasMoved = liveSlide && pinnedSlide && liveSlide.slideId !== pinnedSlide.slideId;

  function handleDone() {
    setPinnedSlide(liveSlide);
  }

  function handleNoteChange(e) {
    const text = e.target.value;
    const slideId = pinnedSlide?.slideId;
    if (!slideId) return;
    setNotes((prev) => ({ ...prev, [slideId]: text }));

    if (!viewerId) return;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      saveNote(roomCode, viewerId, slideId, text);
    }, NOTE_SAVE_DEBOUNCE_MS);
  }

  function handleSubmitQuestion(e) {
    e.preventDefault();
    if (!question.trim() || !socketRef.current) return;
    socketRef.current.emit('question:submit', { text: question.trim() });
    setQuestion('');
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 2500);
  }

  function handleLeave() {
    sessionStorage.removeItem(storageKey);
    socketRef.current?.disconnect();
    navigate('/');
  }

  return (
    <div className="viewer-page">
      <header className="viewer-topbar">
        <span className="room-code-badge mono">{roomCode}</span>
        <span className="viewer-name mono">{displayName}</span>
        <span className={`connection-dot ${connected ? 'connected' : 'disconnected'}`}
              title={connected ? 'Connected' : connectError || 'Disconnected'} />
        {!connected && !connectError && <span className="viewer-status mono">Connecting…</span>}
        {connectError && <span className="viewer-status viewer-status-error mono">{connectError}</span>}
        <button className="btn btn-ghost" onClick={handleLeave}>Leave</button>
      </header>

      <div className="viewer-body">
        <main className="viewer-stage">
          {sessionEnded && (
            <div className="ended-banner">
              <span>The presenter ended this session.</span>
              <button className="btn btn-amber" onClick={() => navigate('/')}>Back home</button>
            </div>
          )}

          {hasMoved && !sessionEnded && (
            <div className="moved-banner">
              <span>Presenter moved to a new slide</span>
              <button className="btn btn-amber" onClick={handleDone}>Done</button>
            </div>
          )}

          {!pinnedSlide ? (
            <p className="viewer-slide-label mono">Waiting for the presenter to share a slide…</p>
          ) : (
            <>
              <div
                className="stage-slide"
                style={
                  pinnedSlide.backgroundImageUrl
                    ? { backgroundImage: `url(${pinnedSlide.backgroundImageUrl})`, backgroundSize: 'cover' }
                    : undefined
                }
              >
                {(() => {
                  const blocks = pinnedSlide.blocks || [];
                  let s = 1;
                  if (blocks.length > 0) {
                    let mX = 0, mY = 0;
                    blocks.forEach(b => {
                      mX = Math.max(mX, (b.x||0) + (b.width||300));
                      mY = Math.max(mY, (b.y||0) + (b.fontSize||16)*2);
                    });
                    if (mX > 960 || mY > 540) {
                      s = Math.min(mX > 960 ? 940/mX : 1, mY > 540 ? 520/mY : 1);
                    }
                  }
                  return blocks.map((b) => (
                    <div key={b.id} style={{ position: 'absolute', left: (b.x||0)*s, top: (b.y||0)*s, width: (b.width||300)*s, fontSize: Math.round((b.fontSize||16)*s), whiteSpace: 'pre-wrap', color: '#1a1a2e' }}>
                      {b.text}
                    </div>
                  ));
                })()}
              </div>
              <p className="viewer-slide-label mono">Following the live presentation</p>
            </>
          )}
        </main>

        <aside className="viewer-sidebar">
          <section className="notes-block">
            <h3>Your notes — this slide</h3>
            <textarea
              className="notes-textarea"
              placeholder="Private notes, tied to this slide..."
              value={pinnedSlide ? notes[pinnedSlide.slideId] ?? '' : ''}
              onChange={handleNoteChange}
              disabled={!pinnedSlide || sessionEnded}
            />
          </section>

          <section className="qa-block">
            <h3>Ask a question</h3>
            <form onSubmit={handleSubmitQuestion}>
              <textarea
                className="qa-textarea"
                placeholder="Answers are grounded in the deck only."
                value={question}
                maxLength={500}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button className="btn btn-solid qa-submit" type="submit" disabled={!connected || sessionEnded}>Submit</button>
            </form>
            {justSubmitted && <p className="qa-sent-note">Sent to the presenter for review.</p>}

            {answeredQuestions.length > 0 && (
              <div className="qa-feed">
                {answeredQuestions.map((a) => (
                  <div key={a.id} className="qa-feed-item">
                    <p className="qa-feed-q mono">Q: {a.question}</p>
                    <p className="qa-feed-a">{a.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default ViewerLivePage;