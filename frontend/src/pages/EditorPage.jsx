import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as fabric from 'fabric';
import { connectYjsDoc, getSlidesArray, slideMapToPlain, plainToSlideMap, plainToBlockMap } from '../data/yjsClient.js';
import { goLive } from '../data/roomsApi.js';
import { getDeck, addCollaborator, removeCollaborator } from '../data/decksApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import './EditorPage.css';

// Canvas dimensions — 16:9 aspect ratio, sized generously so imported
// PDF content (which sits in pdfjs user-space, typically ~720×540 for
// landscape or ~612×792 for portrait) renders without clipping.
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540;
const CURSOR_COLORS = ['#4FA8FF', '#FFB454', '#6EE7B7', '#F472B6', '#A78BFA', '#F87171'];

function colorForUser(id) {
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

function makeBlankSlide(order) {
  return {
    id: `slide-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    order,
    backgroundImageUrl: null,
    needsImageFallback: false,
    blocks: [
      { id: `b-${Date.now()}-t`, type: 'textbox', x: 80, y: 60, width: 700, fontSize: 36, text: 'New slide' },
      { id: `b-${Date.now()}-s`, type: 'textbox', x: 80, y: 130, width: 700, fontSize: 18, text: 'Click to add text' }
    ]
  };
}

function EditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();

  const [slides, setSlides] = useState([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [goLiveError, setGoLiveError] = useState('');
  const [goingLive, setGoingLive] = useState(false);

  const [deckMeta, setDeckMeta] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [peers, setPeers] = useState([]);

  // Toolbar state
  const [selectedObj, setSelectedObj] = useState(null);
  const [zoom, setZoom] = useState(1);

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const yjsRef = useRef(null);
  const blockMapsRef = useRef(new Map());
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    getDeck(deckId)
      .then(setDeckMeta)
      .catch(() => {});
  }, [deckId]);

  // --- Connect Yjs, hydrate slides, observe remote changes
  useEffect(() => {
    const yjs = connectYjsDoc(deckId);
    yjsRef.current = yjs;
    const slidesArr = getSlidesArray(yjs.doc);

    const me = getCurrentUser();
    const myClientId = yjs.doc.clientID;
    yjs.awareness.setLocalState({
      name: me?.name || me?.email || 'Editor',
      color: colorForUser(me?.id || me?.email || myClientId),
      activeSlideIdx: 0,
      cursor: null
    });

    function syncPeers() {
      const states = [];
      yjs.awareness.getStates().forEach((state, clientId) => {
        if (clientId === myClientId || !state?.name) return;
        states.push({ clientId, ...state });
      });
      setPeers(states);
    }
    yjs.awareness.on('change', syncPeers);
    syncPeers();

    function syncSlidesState() {
      setSlides(slidesArr.toArray().map(slideMapToPlain));
    }

    slidesArr.observeDeep(syncSlidesState);
    syncSlidesState();

    // If the Yjs doc is still empty after the backend has had time to
    // hydrate it, seed with a single blank slide so the editor isn't
    // empty. Only fires for brand-new decks with no content.
    const seedTimer = setTimeout(() => {
      if (slidesArr.length === 0) {
        yjs.doc.transact(() => {
          slidesArr.push([plainToSlideMap(makeBlankSlide(0))]);
        });
      }
    }, 1200);

    return () => {
      clearTimeout(seedTimer);
      slidesArr.unobserveDeep(syncSlidesState);
      yjs.awareness.off('change', syncPeers);
      yjs.disconnect();
    };
  }, [deckId]);

  useEffect(() => {
    const yjs = yjsRef.current;
    if (!yjs) return;
    yjs.awareness.setLocalStateField('activeSlideIdx', activeSlideIdx);
  }, [activeSlideIdx]);

  // Rebuild block ID -> Y.Map lookup
  useEffect(() => {
    const yjs = yjsRef.current;
    if (!yjs) return;
    const slidesArr = getSlidesArray(yjs.doc);
    const slideMap = slidesArr.get(activeSlideIdx);
    if (!slideMap) return;
    const blocksArr = slideMap.get('blocks');
    const map = new Map();
    blocksArr.toArray().forEach((blockMap) => map.set(blockMap.get('id'), blockMap));
    blockMapsRef.current = map;
  }, [slides, activeSlideIdx]);

  // --- Fabric canvas init
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;

    function writeBlockChange(obj) {
      if (applyingRemoteRef.current || !obj?.data?.blockId) return;
      const blockMap = blockMapsRef.current.get(obj.data.blockId);
      const doc = yjsRef.current?.doc;
      if (!blockMap || !doc) return;
      doc.transact(() => {
        blockMap.set('x', Math.round(obj.left));
        blockMap.set('y', Math.round(obj.top));
        blockMap.set('width', Math.round(obj.width * (obj.scaleX || 1)));
        if (typeof obj.text === 'string') blockMap.set('text', obj.text);
      });
    }

    canvas.on('object:modified', (e) => writeBlockChange(e.target));
    canvas.on('text:changed', (e) => writeBlockChange(e.target));

    // Track selection for the toolbar
    canvas.on('selection:created', (e) => setSelectedObj(e.selected?.[0] || null));
    canvas.on('selection:updated', (e) => setSelectedObj(e.selected?.[0] || null));
    canvas.on('selection:cleared', () => setSelectedObj(null));

    // Cursor broadcast
    let lastSent = 0;
    canvas.on('mouse:move', (e) => {
      const now = Date.now();
      if (now - lastSent < 50) return;
      lastSent = now;
      const pt = e.viewportPoint || e.pointer;
      if (pt) yjsRef.current?.awareness.setLocalStateField('cursor', { x: Math.round(pt.x), y: Math.round(pt.y) });
    });
    canvas.on('mouse:out', () => {
      yjsRef.current?.awareness.setLocalStateField('cursor', null);
    });

    return () => canvas.dispose();
  }, [deckId]);

  // --- Render the active slide's blocks onto the Fabric canvas
  useEffect(() => {
    const canvas = fabricRef.current;
    const slide = slides[activeSlideIdx];
    if (!canvas || !slide) return;

    applyingRemoteRef.current = true;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';
    setSelectedObj(null);

    if (slide.needsImageFallback && slide.backgroundImageUrl) {
      fabric.FabricImage.fromURL(slide.backgroundImageUrl).then((img) => {
        canvas.backgroundImage = img;
        canvas.renderAll();
      }).catch(() => {});
    }

    // Auto-scale: if any block coordinates exceed the canvas bounds
    // (old decks imported before the PDF coordinate normalization fix),
    // compute a uniform scale factor to fit all content inside the canvas.
    let scale = 1;
    if (slide.blocks.length > 0) {
      let maxX = 0, maxY = 0;
      slide.blocks.forEach((b) => {
        maxX = Math.max(maxX, (b.x || 0) + (b.width || 300));
        maxY = Math.max(maxY, (b.y || 0) + (b.fontSize || 16) * 2);
      });
      if (maxX > CANVAS_WIDTH || maxY > CANVAS_HEIGHT) {
        const sx = maxX > CANVAS_WIDTH ? (CANVAS_WIDTH - 20) / maxX : 1;
        const sy = maxY > CANVAS_HEIGHT ? (CANVAS_HEIGHT - 20) / maxY : 1;
        scale = Math.min(sx, sy);
      }
    }

    slide.blocks.forEach((block) => {
      const textbox = new fabric.Textbox(block.text || '', {
        left: (block.x || 0) * scale,
        top: (block.y || 0) * scale,
        width: (block.width || 300) * scale,
        fontSize: Math.round((block.fontSize || 16) * scale),
        editable: true,
        fill: '#1a1a2e',
        fontFamily: 'Public Sans, sans-serif',
        splitByGrapheme: false,
      });
      textbox.data = { blockId: block.id };
      canvas.add(textbox);
    });

    canvas.renderAll();
    applyingRemoteRef.current = false;
  }, [slides, activeSlideIdx]);

  // --- Toolbar actions ---

  function handleAddTextBlock() {
    const yjs = yjsRef.current;
    if (!yjs) return;
    const slidesArr = getSlidesArray(yjs.doc);
    const slideMap = slidesArr.get(activeSlideIdx);
    if (!slideMap) return;
    const blocksArr = slideMap.get('blocks');
    const newBlock = {
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: 'textbox',
      x: 100 + Math.random() * 80,
      y: 100 + Math.random() * 80,
      width: 300,
      fontSize: 18,
      text: 'New text'
    };
    yjs.doc.transact(() => {
      blocksArr.push([plainToBlockMap(newBlock)]);
    });
  }

  function handleBold() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || obj.type !== 'textbox') return;
    obj.set('fontWeight', obj.fontWeight === 'bold' ? 'normal' : 'bold');
    canvas.renderAll();
  }

  function handleItalic() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || obj.type !== 'textbox') return;
    obj.set('fontStyle', obj.fontStyle === 'italic' ? 'normal' : 'italic');
    canvas.renderAll();
  }

  function handleUnderline() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || obj.type !== 'textbox') return;
    obj.set('underline', !obj.underline);
    canvas.renderAll();
  }

  function handleFontSizeChange(e) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || obj.type !== 'textbox') return;
    const size = parseInt(e.target.value, 10);
    if (size > 0 && size < 200) {
      obj.set('fontSize', size);
      canvas.renderAll();
      // Write to Yjs
      if (obj.data?.blockId) {
        const blockMap = blockMapsRef.current.get(obj.data.blockId);
        if (blockMap) {
          yjsRef.current?.doc.transact(() => { blockMap.set('fontSize', size); });
        }
      }
    }
  }

  function handleTextColor(color) {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || obj.type !== 'textbox') return;
    obj.set('fill', color);
    canvas.renderAll();
  }

  function handleDeleteSelected() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj || !obj.data?.blockId) return;
    const yjs = yjsRef.current;
    if (!yjs) return;
    const slidesArr = getSlidesArray(yjs.doc);
    const slideMap = slidesArr.get(activeSlideIdx);
    if (!slideMap) return;
    const blocksArr = slideMap.get('blocks');
    // Find and remove the block
    for (let i = 0; i < blocksArr.length; i++) {
      if (blocksArr.get(i).get('id') === obj.data.blockId) {
        yjs.doc.transact(() => { blocksArr.delete(i, 1); });
        break;
      }
    }
  }

  function handleBringForward() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    canvas.bringObjectForward(obj);
    canvas.renderAll();
  }

  function handleSendBackward() {
    const canvas = fabricRef.current;
    const obj = canvas?.getActiveObject();
    if (!obj) return;
    canvas.sendObjectBackwards(obj);
    canvas.renderAll();
  }

  function handleZoom(delta) {
    const newZoom = Math.max(0.5, Math.min(2, zoom + delta));
    setZoom(newZoom);
  }

  // --- Slide ops ---
  function handleAddSlide() {
    const yjs = yjsRef.current;
    if (!yjs) return;
    const slidesArr = getSlidesArray(yjs.doc);
    const newSlide = makeBlankSlide(slidesArr.length);
    yjs.doc.transact(() => {
      slidesArr.push([plainToSlideMap(newSlide)]);
    });
    setTimeout(() => setActiveSlideIdx(slidesArr.length - 1), 50);
  }

  function handleDeleteSlide() {
    const yjs = yjsRef.current;
    if (!yjs) return;
    const slidesArr = getSlidesArray(yjs.doc);
    if (slidesArr.length <= 1) return;
    yjs.doc.transact(() => { slidesArr.delete(activeSlideIdx, 1); });
    setActiveSlideIdx((prev) => Math.max(0, prev - 1));
  }

  async function handleGoLive() {
    if (goingLive) return;
    setGoLiveError('');
    setGoingLive(true);
    try {
      const data = await goLive(deckId);
      navigate(`/presenter/${data.code}`, { state: { deckId, roomId: data.roomId } });
    } catch (err) {
      setGoLiveError(err.message || 'Could not start the session');
      setGoingLive(false);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    setInviteError('');
    try {
      const updated = await addCollaborator(deckId, inviteEmail.trim());
      setDeckMeta(updated);
      setInviteEmail('');
    } catch (err) {
      setInviteError(err.message || 'Could not add that collaborator');
    } finally {
      setInviteBusy(false);
    }
  }

  async function handleRemoveCollaborator(userId) {
    try {
      const updated = await removeCollaborator(deckId, userId);
      setDeckMeta(updated);
    } catch (err) {
      setInviteError(err.message || 'Could not remove that collaborator');
    }
  }

  const peersOnThisSlide = peers.filter((p) => p.activeSlideIdx === activeSlideIdx && p.cursor);

  const TEXT_COLORS = ['#1a1a2e', '#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ffffff'];

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Decks</button>
          <span className="editor-deck-title">{deckMeta?.title || 'Untitled deck'}</span>
        </div>

        <div className="presence-bar">
          {peers.map((p) => (
            <span key={p.clientId} className="presence-dot" style={{ background: p.color }} title={p.name}>
              {p.name?.[0]?.toUpperCase() || '?'}
            </span>
          ))}
          {peers.length > 0 && <span className="presence-label mono">{peers.length} editing</span>}
        </div>

        {goLiveError && <span className="editor-golive-error">{goLiveError}</span>}
        <button className="btn btn-ghost" onClick={() => setShowCollaborators((v) => !v)}>Collaborators</button>
        <button className="btn btn-amber" onClick={handleGoLive} disabled={goingLive}>
          {goingLive ? 'Starting…' : 'Go Live'}
        </button>
      </header>

      <div className="desktop-banner">
        💻 For the best editing experience, use a desktop browser.
      </div>

      {showCollaborators && (
        <div className="collaborators-panel">
          <div className="collaborators-list">
            {deckMeta?.owner && (
              <span className="collaborator-chip owner-chip">
                {deckMeta.owner.name || deckMeta.owner.email} · Owner
              </span>
            )}
            {deckMeta?.collaborators?.map((c) => (
              <span key={c.id} className="collaborator-chip">
                {c.name || c.email}
                {deckMeta.isOwner && (
                  <button className="collaborator-remove" title="Remove" onClick={() => handleRemoveCollaborator(c.id)}>×</button>
                )}
              </span>
            ))}
          </div>
          {deckMeta?.isOwner ? (
            <form className="invite-form" onSubmit={handleInvite}>
              <input className="invite-input" type="email" placeholder="Invite by email…" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <button className="btn btn-solid" type="submit" disabled={inviteBusy}>{inviteBusy ? 'Adding…' : 'Invite'}</button>
            </form>
          ) : (
            <p className="invite-hint mono">Only the deck owner can invite collaborators.</p>
          )}
          {inviteError && <p className="invite-error">{inviteError}</p>}
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="editor-toolbar">
        <div className="toolbar-group">
          <button className="toolbar-btn" onClick={handleAddTextBlock} title="Add text block">
            <span className="toolbar-icon">T+</span>
          </button>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          <button className={`toolbar-btn ${selectedObj?.fontWeight === 'bold' ? 'active' : ''}`} onClick={handleBold} title="Bold" disabled={!selectedObj}>
            <strong>B</strong>
          </button>
          <button className={`toolbar-btn ${selectedObj?.fontStyle === 'italic' ? 'active' : ''}`} onClick={handleItalic} title="Italic" disabled={!selectedObj}>
            <em>I</em>
          </button>
          <button className={`toolbar-btn ${selectedObj?.underline ? 'active' : ''}`} onClick={handleUnderline} title="Underline" disabled={!selectedObj}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          <label className="toolbar-label mono" title="Font size">
            <input
              className="toolbar-font-input mono"
              type="number"
              min={8}
              max={120}
              value={selectedObj?.fontSize ?? ''}
              onChange={handleFontSizeChange}
              disabled={!selectedObj}
              placeholder="--"
            />
            <span>px</span>
          </label>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group toolbar-colors">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${selectedObj?.fill === c ? 'active' : ''}`}
              style={{ background: c, border: c === '#ffffff' ? '1px solid var(--hairline)' : 'none' }}
              onClick={() => handleTextColor(c)}
              title={c}
              disabled={!selectedObj}
            />
          ))}
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          <button className="toolbar-btn" onClick={handleBringForward} title="Bring forward" disabled={!selectedObj}>↑</button>
          <button className="toolbar-btn" onClick={handleSendBackward} title="Send backward" disabled={!selectedObj}>↓</button>
          <button className="toolbar-btn toolbar-btn-danger" onClick={handleDeleteSelected} title="Delete selected" disabled={!selectedObj}>🗑</button>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group toolbar-right">
          <button className="toolbar-btn" onClick={() => handleZoom(-0.1)} title="Zoom out">−</button>
          <span className="toolbar-zoom mono">{Math.round(zoom * 100)}%</span>
          <button className="toolbar-btn" onClick={() => handleZoom(0.1)} title="Zoom in">+</button>
        </div>
      </div>

      <div className="editor-body">
        <aside className="slide-rail">
          <div className="slide-rail-list">
            {slides.map((s, i) => (
              <button
                key={s.id}
                className={`slide-thumb ${i === activeSlideIdx ? 'active' : ''}`}
                onClick={() => setActiveSlideIdx(i)}
              >
                <span className="slide-num mono">{i + 1}</span>
                <span className="slide-thumb-label">
                  {s.blocks?.[0]?.text?.split('\n')[0]?.slice(0, 20) || `Slide ${i + 1}`}
                </span>
              </button>
            ))}
          </div>
          <div className="slide-rail-actions">
            <button className="btn btn-ghost slide-action-btn" onClick={handleAddSlide}>+ Add slide</button>
            {slides.length > 1 && (
              <button className="btn btn-ghost slide-action-btn slide-delete-btn" onClick={handleDeleteSlide}>Delete slide</button>
            )}
          </div>
        </aside>

        <main className="canvas-area">
          <div
            className="canvas-wrapper"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center top' }}
          >
            <div className="canvas-page" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
              <canvas ref={canvasElRef} />
              {peersOnThisSlide.map((p) => (
                <div key={p.clientId} className="peer-cursor" style={{ left: p.cursor.x, top: p.cursor.y, color: p.color }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill={p.color}>
                    <path d="M1 1 L1 14 L5 10.5 L7.5 15 L9.5 14 L7 9.5 L13 9.5 Z" />
                  </svg>
                  <span className="peer-cursor-label" style={{ background: p.color }}>{p.name}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="canvas-hint mono">
            Slide {activeSlideIdx + 1} of {slides.length} · drag to move · double-click to edit
          </p>
        </main>
      </div>
    </div>
  );
}

export default EditorPage;