import { useState, useEffect, useRef } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, LogOut, MessageSquareText, NotebookPen, Send } from 'lucide-react';
import { createSocket } from '../data/socket.js';
import { fetchNotes, saveNote } from '../data/notesApi.js';
import ScaledSlide from '../components/ScaledSlide.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';
import ConnectionPill from '../components/live/ConnectionPill.jsx';
import '../components/live/live.css';
import './ViewerLivePage.css';

const NOTE_SAVE_DEBOUNCE_MS = 600;
// Socket errors that mean there is nothing left to follow.
const ENDED_ERRORS = ['No active session with that code'];

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
  // the viewer catches up, so notes being typed stay with their slide.
  // Both pinned/live are the full { slideId, blocks, backgroundImageUrl }
  // snapshot pushed over the broadcast channel, since a viewer never has
  // access to the deck's slide list (Yjs is editor-only).
  const [pinnedSlide, setPinnedSlide] = useState(null);
  const [liveSlide, setLiveSlide] = useState(null);
  // 'connecting' until the first connect, then 'live' / 'reconnecting'.
  const [connState, setConnState] = useState('connecting');
  const [connectError, setConnectError] = useState('');

  const [notes, setNotes] = useState({}); // { slideId: text }
  const [notesLoaded, setNotesLoaded] = useState(false); // gate: prevent typing before server data arrives
  const [noteState, setNoteState] = useState('idle'); // idle | saving | saved | error
  const [question, setQuestion] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [answeredQuestions, setAnsweredQuestions] = useState([]); // public feed for the room
  const [sessionEnded, setSessionEnded] = useState(false);
  const [tab, setTab] = useState('notes');

  // No account/join info to work with (e.g. a bare page reload landed
  // here with no router state) — send them back through the join flow
  // rather than connecting a socket with nothing to identify them.
  useEffect(() => {
    if (!viewerId) {
      navigate(`/join?code=${encodeURIComponent(roomCode)}`, { replace: true });
    }
  }, [viewerId, roomCode, navigate]);

  useEffect(() => {
    if (!viewerId) return;

    const socket = createSocket();
    socketRef.current = socket;

    // socket.io reconnects on its own; every (re)connect rejoins the room.
    socket.on('connect', () => {
      setConnState('live');
      setConnectError('');
      socket.emit('viewer:join', { code: roomCode, viewerId });
    });

    socket.on('slide:sync', ({ slideId, blocks, backgroundImageUrl, backgroundColor, canvasWidth, canvasHeight }) => {
      const slide = { id: slideId, slideId, blocks: blocks || [], backgroundImageUrl, backgroundColor, canvasWidth, canvasHeight };
      setLiveSlide(slide);
      setPinnedSlide((prev) => (prev ? prev : slide)); // first snapshot pins immediately
    });

    // Sent on every (re)join, newest first, so the feed survives a refresh.
    socket.on('qa:history', ({ items }) => {
      setAnsweredQuestions(items);
    });

    socket.on('qa:answer', ({ id, question: q, answer }) => {
      setAnsweredQuestions((prev) => [{ id, question: q, answer, dismissed: false }, ...prev]);
    });

    socket.on('question:dismissed', ({ questionId, text }) => {
      // Only this viewer's socket receives this event (targeted by backend).
      // Add a dismissed entry to the feed so they know it was seen but skipped.
      setAnsweredQuestions((prev) => [
        { id: questionId, question: text, answer: null, dismissed: true },
        ...prev
      ]);
    });

    socket.on('room:ended', () => {
      setSessionEnded(true);
    });

    socket.on('disconnect', () => setConnState((s) => (s === 'connecting' ? s : 'reconnecting')));
    socket.on('error', ({ message } = {}) => {
      if (ENDED_ERRORS.includes(message)) setSessionEnded(true);
      else setConnectError(message || 'Connection error');
    });

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, viewerId]);

  useEffect(() => {
    if (!viewerId) return;
    fetchNotes(roomCode, viewerId).then((loaded) => {
      // Server data wins for any existing keys — local prev only wins for
      // keys the user has typed in THIS session that the server doesn't know
      // about yet (new slides not yet saved). This prevents a refresh from
      // wiping saved notes when the fetch resolves after the user starts typing.
      setNotes((prev) => ({ ...prev, ...loaded }));
      setNotesLoaded(true);
    }).catch(() => {
      // Fetch failed (e.g. offline) — still unlock so the user can type.
      setNotesLoaded(true);
    });
  }, [roomCode, viewerId]);

  const hasMoved = liveSlide && pinnedSlide && liveSlide.slideId !== pinnedSlide.slideId;

  function handleCatchUp() {
    setPinnedSlide(liveSlide);
  }

  function handleNoteChange(e) {
    const text = e.target.value;
    const slideId = pinnedSlide?.slideId;
    if (!slideId) return;
    setNotes((prev) => ({ ...prev, [slideId]: text }));

    if (!viewerId) return;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    setNoteState('saving');
    noteSaveTimer.current = setTimeout(() => {
      saveNote(roomCode, viewerId, slideId, text)
        .then(() => setNoteState('saved'))
        .catch(() => setNoteState('error'));
    }, NOTE_SAVE_DEBOUNCE_MS);
  }

  function handleSubmitQuestion(e) {
    e.preventDefault();
    if (!question.trim() || !socketRef.current) return;
    socketRef.current.emit('question:submit', { text: question.trim() });
    setQuestion('');
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 3000);
  }

  function handleLeave() {
    sessionStorage.removeItem(storageKey);
    socketRef.current?.disconnect();
    navigate('/');
  }

  const connLabel = sessionEnded ? 'ended' : connState;
  const live = connState === 'live' && !sessionEnded;

  if (sessionEnded) {
    return (
      <div className="viewer viewer-ended">
        <div className="card viewer-ended-card" role="status">
          <LogoMark size={36} />
          <h1>This session has ended</h1>
          <p>The presenter closed session <span className="mono">{roomCode}</span>. Thanks for following along, {displayName}.</p>
          <div className="viewer-ended-actions">
            <Link to="/join" className="btn btn-secondary" onClick={() => sessionStorage.removeItem(storageKey)}>Join another session</Link>
            <Link to="/" className="btn btn-primary" onClick={() => sessionStorage.removeItem(storageKey)}>Go to PreSync</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer">
      <header className="viewer-top">
        <LogoMark size={24} />
        <div className="viewer-id">
          <span className="viewer-code mono" aria-label={`Session ${roomCode}`}>{roomCode}</span>
          <span className="viewer-name">Watching as {displayName}</span>
        </div>
        <ConnectionPill state={connLabel} />
        <button type="button" className="btn btn-ghost btn-sm viewer-leave" onClick={handleLeave} aria-label="Leave session">
          <LogOut aria-hidden="true" /><span>Leave</span>
        </button>
      </header>

      {connState === 'reconnecting' && (
        <div className="alert alert-warning viewer-alert" role="alert">Connection lost. Reconnecting…</div>
      )}
      {connectError && <div className="alert alert-error viewer-alert" role="alert">{connectError}</div>}

      <div className="viewer-body">
        <main className="viewer-main" id="main">
          {hasMoved && (
            <div className="viewer-moved" role="status">
              <span>The presenter has moved on.</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleCatchUp}>
                Catch up<ArrowRight aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="viewer-stage">
            {pinnedSlide ? (
              <ScaledSlide slide={pinnedSlide} className="viewer-slide" label="Current slide" canvasWidth={pinnedSlide.canvasWidth} canvasHeight={pinnedSlide.canvasHeight} />
            ) : (
              <div className="viewer-waiting" role="status">
                {connState === 'connecting'
                  ? <><span className="spinner" aria-hidden="true" /><p>Connecting to the session…</p></>
                  : <><span className="live-dot" aria-hidden="true" /><p>Waiting for the presenter to show a slide…</p></>}
              </div>
            )}
          </div>
          <p className="viewer-follow">
            {hasMoved
              ? 'Showing the slide you were on, so your notes stay with it.'
              : pinnedSlide ? 'Following the presenter live.' : ''}
          </p>
        </main>

        <aside className="viewer-side">
          <div className="segmented viewer-tabs" role="tablist" aria-label="Viewer tools">
            <button type="button" role="tab" id="tab-notes" aria-controls="panel-notes" className="segmented-item" aria-selected={tab === 'notes'} aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>
              <NotebookPen aria-hidden="true" />My notes
            </button>
            <button type="button" role="tab" id="tab-qa" aria-controls="panel-qa" className="segmented-item" aria-selected={tab === 'qa'} aria-pressed={tab === 'qa'} onClick={() => setTab('qa')}>
              <MessageSquareText aria-hidden="true" />Q&amp;A{answeredQuestions.length ? ` (${answeredQuestions.length})` : ''}
            </button>
          </div>

          <section id="panel-notes" role="tabpanel" aria-labelledby="tab-notes" className="viewer-panel" hidden={tab !== 'notes'}>
            <label className="field-label" htmlFor="viewer-notes">Private notes for this slide</label>
            {!notesLoaded ? (
              <div className="skeleton viewer-notes-skel" aria-label="Loading notes" />
            ) : (
              <textarea
                id="viewer-notes"
                className="textarea viewer-notes"
                placeholder={pinnedSlide ? 'Only you can see these. They are saved per slide.' : 'Notes open once the first slide arrives.'}
                value={pinnedSlide ? notes[pinnedSlide.slideId] ?? '' : ''}
                onChange={handleNoteChange}
                disabled={!pinnedSlide}
              />
            )}
            <p className="field-hint viewer-note-state" aria-live="polite">
              {noteState === 'saving' && 'Saving…'}
              {noteState === 'saved' && 'Saved'}
              {noteState === 'error' && <span className="is-error">Couldn&apos;t save. Keep this tab open and try typing again.</span>}
            </p>
          </section>

          <section id="panel-qa" role="tabpanel" aria-labelledby="tab-qa" className="viewer-panel" hidden={tab !== 'qa'}>
            <form onSubmit={handleSubmitQuestion} className="viewer-ask">
              <label className="field-label" htmlFor="viewer-question">Ask the presenter</label>
              <textarea
                id="viewer-question"
                className="textarea"
                placeholder="Answers are based on this presentation's content."
                value={question}
                maxLength={500}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <div className="viewer-ask-row">
                <span className="field-hint mono">{question.length}/500</span>
                <button className="btn btn-primary btn-sm" type="submit" disabled={!live || !question.trim()}>
                  <Send aria-hidden="true" />Send question
                </button>
              </div>
              <p className="field-hint" aria-live="polite">{justSubmitted ? 'Sent. The presenter reviews every answer before it appears.' : ''}</p>
            </form>

            {answeredQuestions.length > 0 ? (
              <ul className="viewer-feed">
                {answeredQuestions.map((a) => (
                  <li key={a.id} className={`viewer-feed-item${a.dismissed ? ' is-dismissed' : ''}`}>
                    <p className="viewer-feed-q">{a.question}</p>
                    {a.dismissed
                      ? <p className="viewer-feed-a is-muted">The presenter saw your question but didn&apos;t answer it.</p>
                      : <p className="viewer-feed-a">{a.answer}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Answered questions from everyone appear here.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default ViewerLivePage;
