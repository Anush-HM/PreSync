import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MOCK_SLIDES, generateRoomCode } from '../data/mockData.js';
import './EditorPage.css';

// NOTE: this is a plain-div drag/resize stand-in for the real Fabric.js
// canvas described in the spec. It mimics the target interaction (select,
// drag, resize, inline edit) so the editor flow can be built and tested
// end-to-end before Fabric.js + Yjs are wired in underneath it.

function EditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const [slides, setSlides] = useState(MOCK_SLIDES);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const dragState = useRef(null);

  const slide = slides[activeSlideIdx];

  function updateBlock(blockId, patch) {
    setSlides((prev) =>
      prev.map((s, i) =>
        i !== activeSlideIdx
          ? s
          : { ...s, blocks: s.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
      )
    );
  }

  function onPointerDownBlock(e, block) {
    e.stopPropagation();
    setSelectedBlockId(block.id);
    dragState.current = {
      id: block.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: block.x,
      origY: block.y
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    const d = dragState.current;
    if (!d) return;
    updateBlock(d.id, { x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
  }

  function onPointerUp() {
    dragState.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }

  function handleGoLive() {
    const code = generateRoomCode();
    navigate(`/presenter/${code}`, { state: { deckId } });
  }

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Decks</button>
          <span className="editor-deck-title">{deckId}</span>
        </div>
        <button className="btn btn-amber" onClick={handleGoLive}>Go Live</button>
      </header>

      <div className="editor-body">
        <aside className="slide-rail">
          {slides.map((s, i) => (
            <button
              key={s.id}
              className={`slide-thumb ${i === activeSlideIdx ? 'active' : ''}`}
              onClick={() => { setActiveSlideIdx(i); setSelectedBlockId(null); }}
            >
              <span className="slide-num mono">{i + 1}</span>
              <span className="slide-thumb-label">{s.title}</span>
            </button>
          ))}
        </aside>

        <main className="canvas-area" onPointerDown={() => setSelectedBlockId(null)}>
          <div className="canvas-page">
            {slide.blocks.map((b) => (
              <div
                key={b.id}
                className={`text-block ${selectedBlockId === b.id ? 'selected' : ''}`}
                style={{ left: b.x, top: b.y, width: b.width, fontSize: b.fontSize }}
                onPointerDown={(e) => onPointerDownBlock(e, b)}
              >
                <div
                  className="text-block-content"
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => updateBlock(b.id, { text: e.currentTarget.innerText })}
                >
                  {b.text}
                </div>
                {selectedBlockId === b.id && (
                  <div
                    className="resize-handle"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const startX = e.clientX;
                      const origWidth = b.width;
                      function onMove(ev) {
                        updateBlock(b.id, { width: Math.max(80, origWidth + (ev.clientX - startX)) });
                      }
                      function onUp() {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                      }
                      window.addEventListener('pointermove', onMove);
                      window.addEventListener('pointerup', onUp);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="canvas-hint mono">Drag to move · corner handle to resize · click text to edit</p>
        </main>
      </div>
    </div>
  );
}

export default EditorPage;