import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { MOCK_SLIDES } from '../data/mockData.js';
import { readSlide, subscribeToRoom } from '../data/roomSync.js';
import { fetchNotes, saveNote } from '../data/notesApi.js';
import './ViewerLivePage.css';

const NOTE_SAVE_DEBOUNCE_MS = 600;

function ViewerLivePage() {
  const { roomCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const displayName = location.state?.displayName ?? 'Guest';
  const viewerId = location.state?.viewerId;
  const noteSaveTimer = useRef(null);

  // The slide currently pinned on this viewer's screen — only moves when
  // the viewer clicks "Done", per the spec's note-reconciliation rule.
  const [pinnedIdx, setPinnedIdx] = useState(0);
  // The presenter's actual current slide, which may run ahead of pinnedIdx.
  const [liveIdx, setLiveIdx] = useState(0);
  const [notes, setNotes] = useState({}); // { slideId: text }
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const noteRef = useRef(null);

  useEffect(() => {
    const existing = readSlide(roomCode);
    if (existing) {
      setPinnedIdx(existing.slideIndex);
      setLiveIdx(existing.slideIndex);
    }
    return subscribeToRoom(roomCode, (payload) => {
      setLiveIdx(payload.slideIndex);
    });
  }, [roomCode]);

  useEffect(() => {
    if (!viewerId) return;
    fetchNotes(roomCode, viewerId).then((loaded) => {
      setNotes((prev) => ({ ...loaded, ...prev }));
    });
  }, [roomCode, viewerId]);

  const pinnedSlide = MOCK_SLIDES[pinnedIdx];
  const hasMoved = liveIdx !== pinnedIdx;

  function handleDone() {
    setPinnedIdx(liveIdx);
  }

  function handleNoteChange(e) {
    const text = e.target.value;
    const slideId = pinnedSlide.id;
    setNotes((prev) => ({ ...prev, [slideId]: text }));

    if (!viewerId) return;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      saveNote(roomCode, viewerId, slideId, text);
    }, NOTE_SAVE_DEBOUNCE_MS);
  }

  function handleSubmitQuestion(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setSubmitted(true);
    setQuestion('');
    setTimeout(() => setSubmitted(false), 2500);
  }

  return (
    <div className="viewer-page">
      <header className="viewer-topbar">
        <span className="room-code-badge mono">{roomCode}</span>
        <span className="viewer-name mono">{displayName}</span>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>Leave</button>
      </header>

      <div className="viewer-body">
        <main className="viewer-stage">
          {hasMoved && (
            <div className="moved-banner">
              <span>Presenter moved to Slide {liveIdx + 1}</span>
              <button className="btn btn-amber" onClick={handleDone}>Done</button>
            </div>
          )}
          <div className="stage-slide">
            {pinnedSlide.blocks.map((b) => (
              <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y, width: b.width, fontSize: b.fontSize, whiteSpace: 'pre-wrap' }}>
                {b.text}
              </div>
            ))}
          </div>
          <p className="viewer-slide-label mono">Slide {pinnedIdx + 1} of {MOCK_SLIDES.length}</p>
        </main>

        <aside className="viewer-sidebar">
          <section className="notes-block">
            <h3>Your notes — this slide</h3>
            <textarea
              ref={noteRef}
              className="notes-textarea"
              placeholder="Private notes, tied to this slide..."
              value={notes[pinnedSlide.id] ?? ''}
              onChange={handleNoteChange}
            />
          </section>

          <section className="qa-block">
            <h3>Ask a question</h3>
            <form onSubmit={handleSubmitQuestion}>
              <textarea
                className="qa-textarea"
                placeholder="Answers are grounded in the deck only."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button className="btn btn-solid qa-submit" type="submit">Submit</button>
            </form>
            {submitted && <p className="qa-sent-note">Sent to the presenter for review.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

export default ViewerLivePage;