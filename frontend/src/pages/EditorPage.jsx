import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fabric } from 'fabric';
import { MOCK_SLIDES } from '../data/mockData.js';
import { connectYjsDoc, getSlidesArray, slideMapToPlain, plainToSlideMap } from '../data/yjsClient.js';
import { goLive } from '../data/roomsApi.js';
import { getDeck, addCollaborator, removeCollaborator } from '../data/decksApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import './EditorPage.css';

// Real implementation: Fabric.js canvas + Yjs CRDT sync, replacing the
// earlier plain-div drag/resize stand-in. Every editor connected to this
// deck shares the same Y.Doc -- moving/resizing/retyping a block here
// writes straight into that block's Y.Map, and remote edits from other
// editors flow back in through the slidesArr.observeDeep subscription
// below, fully independent of presenter/viewer broadcast (that's
// Socket.io, over on the sockets/index.js + roomController.js side).

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 360;
const CURSOR_COLORS = ['#4FA8FF', '#FFB454', '#6EE7B7', '#F472B6', '#A78BFA', '#F87171'];

function colorForUser(id) {
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

function EditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();

  const [slides, setSlides] = useState([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [goLiveError, setGoLiveError] = useState('');

  const [deckMeta, setDeckMeta] = useState(null); // { title, isOwner, owner, collaborators }
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);

  // Other editors currently connected to this deck, from Yjs awareness —
  // e.g. [{ clientId, name, color, activeSlideIdx, cursor: {x,y}|null }].
  // Awareness itself is already relayed by the backend (see yjs/server.js)
  // and the frontend transport (yjsClient.js); this just renders it.
  const [peers, setPeers] = useState([]);

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const yjsRef = useRef(null); // { doc, awareness, disconnect }
  const blockMapsRef = useRef(new Map()); // blockId -> Y.Map, for the active slide only
  const applyingRemoteRef = useRef(false); // guards fabric -> Yjs -> fabric feedback loops

  useEffect(() => {
    getDeck(deckId)
      .then(setDeckMeta)
      .catch(() => {
        /* Non-fatal — the canvas still works purely off the Yjs doc even
           if this metadata fetch fails; only the title/collaborator UI
           degrades. */
      });
  }, [deckId]);

  // --- Connect Yjs, hydrate slides, observe remote changes ------------
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

    // If this deck genuinely has no slides yet (brand-new deck, nothing
    // imported), seed with placeholder content so the editor isn't
    // blank. Guarded so it only ever fires once, and only once we've
    // given the websocket a moment to sync down real content first --
    // otherwise every editor opening a deck before the initial sync
    // lands would race to seed it.
    let seeded = false;
    function maybeSeed() {
      if (seeded || slidesArr.length > 0) return;
      seeded = true;
      yjs.doc.transact(() => {
        slidesArr.push(MOCK_SLIDES.map((s, i) => plainToSlideMap({ ...s, order: i })));
      });
    }

    slidesArr.observeDeep(syncSlidesState);
    syncSlidesState();
    const seedTimer = setTimeout(maybeSeed, 800);

    return () => {
      clearTimeout(seedTimer);
      slidesArr.unobserveDeep(syncSlidesState);
      yjs.awareness.off('change', syncPeers);
      yjs.disconnect();
    };
  }, [deckId]);

  // Keep our own awareness state's activeSlideIdx current, so peers know
  // which slide we're on (used to filter whose cursor renders on top of
  // whichever slide is currently showing).
  useEffect(() => {
    const yjs = yjsRef.current;
    if (!yjs) return;
    yjs.awareness.setLocalStateField('activeSlideIdx', activeSlideIdx);
  }, [activeSlideIdx]);

  // --- Rebuild the blockId -> Y.Map lookup whenever the active slide's
  // block list changes shape, so fabric event handlers can write
  // straight into the right Y.Map without re-walking the tree each time.
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

  // --- Fabric canvas: created once per mount --------------------------
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: '#ffffff'
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
        blockMap.set('width', Math.round(obj.width * obj.scaleX));
        if (typeof obj.text === 'string') blockMap.set('text', obj.text);
      });
    }

    // Covers drag + resize (object:modified) and inline text edits
    // (Fabric fires 'changed' on the object, bubbled to the canvas as
    // 'text:changed').
    canvas.on('object:modified', (e) => writeBlockChange(e.target));
    canvas.on('text:changed', (e) => writeBlockChange(e.target));

    // Broadcast cursor position for the multi-cursor presence overlay.
    // Coordinates are canvas-space (0..CANVAS_WIDTH/HEIGHT) so peers can
    // render them regardless of any zoom/scroll on their own screen.
    let lastSent = 0;
    canvas.on('mouse:move', (e) => {
      const now = Date.now();
      if (now - lastSent < 50) return; // ~20fps is plenty for a cursor
      lastSent = now;
      yjsRef.current?.awareness.setLocalStateField('cursor', { x: Math.round(e.pointer.x), y: Math.round(e.pointer.y) });
    });
    canvas.on('mouse:out', () => {
      yjsRef.current?.awareness.setLocalStateField('cursor', null);
    });

    return () => canvas.dispose();
  }, [deckId]);

  // --- Render the active slide's blocks onto the Fabric canvas --------
  useEffect(() => {
    const canvas = fabricRef.current;
    const slide = slides[activeSlideIdx];
    if (!canvas || !slide) return;

    applyingRemoteRef.current = true;
    canvas.clear();
    canvas.backgroundColor = '#ffffff';

    if (slide.needsImageFallback && slide.backgroundImageUrl) {
      fabric.Image.fromURL(slide.backgroundImageUrl, (img) => {
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
      });
    }

    slide.blocks.forEach((block) => {
      const textbox = new fabric.Textbox(block.text, {
        left: block.x,
        top: block.y,
        width: block.width,
        fontSize: block.fontSize,
        editable: true
      });
      textbox.data = { blockId: block.id };
      canvas.add(textbox);
    });

    canvas.renderAll();
    applyingRemoteRef.current = false;
  }, [slides, activeSlideIdx]);

  async function handleGoLive() {
    setGoLiveError('');
    try {
      const data = await goLive(deckId); // { code, roomId }
      navigate(`/presenter/${data.code}`, { state: { deckId, roomId: data.roomId } });
    } catch (err) {
      setGoLiveError(err.message || 'Could not start the session');
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

  // Peers viewing whichever slide is currently on screen — only their
  // cursors are meaningful to render here; someone editing slide 4 while
  // we're on slide 1 shouldn't show a cursor floating over our canvas.
  const peersOnThisSlide = peers.filter((p) => p.activeSlideIdx === activeSlideIdx && p.cursor);

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Decks</button>
          <span className="editor-deck-title">{deckMeta?.title || deckId}</span>
        </div>

        <div className="presence-bar">
          {peers.map((p) => (
            <span key={p.clientId} className="presence-dot" style={{ background: p.color }} title={p.name}>
              {p.name?.[0]?.toUpperCase() || '?'}
            </span>
          ))}
          {peers.length > 0 && <span className="presence-label mono">{peers.length} editing now</span>}
        </div>

        {goLiveError && <span className="editor-golive-error">{goLiveError}</span>}
        <button className="btn btn-ghost" onClick={() => setShowCollaborators((v) => !v)}>
          Collaborators
        </button>
        <button className="btn btn-amber" onClick={handleGoLive}>Go Live</button>
      </header>

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
                  <button
                    className="collaborator-remove"
                    title="Remove collaborator"
                    onClick={() => handleRemoveCollaborator(c.id)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>

          {deckMeta?.isOwner ? (
            <form className="invite-form" onSubmit={handleInvite}>
              <input
                className="invite-input"
                type="email"
                placeholder="Invite by email…"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <button className="btn btn-solid" type="submit" disabled={inviteBusy}>
                {inviteBusy ? 'Adding…' : 'Invite'}
              </button>
            </form>
          ) : (
            <p className="invite-hint mono">Only the deck owner can invite collaborators.</p>
          )}
          {inviteError && <p className="invite-error">{inviteError}</p>}
        </div>
      )}

      <div className="editor-body">
        <aside className="slide-rail">
          {slides.map((s, i) => (
            <button
              key={s.id}
              className={`slide-thumb ${i === activeSlideIdx ? 'active' : ''}`}
              onClick={() => setActiveSlideIdx(i)}
            >
              <span className="slide-num mono">{i + 1}</span>
              <span className="slide-thumb-label">{s.id}</span>
            </button>
          ))}
        </aside>

        <main className="canvas-area">
          <div className="canvas-page" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
            <canvas ref={canvasElRef} />
            {peersOnThisSlide.map((p) => (
              <div
                key={p.clientId}
                className="peer-cursor"
                style={{ left: p.cursor.x, top: p.cursor.y, color: p.color }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill={p.color}>
                  <path d="M1 1 L1 14 L5 10.5 L7.5 15 L9.5 14 L7 9.5 L13 9.5 Z" />
                </svg>
                <span className="peer-cursor-label" style={{ background: p.color }}>{p.name}</span>
              </div>
            ))}
          </div>
          <p className="canvas-hint mono">
            Drag to move · corner handle to resize · double-click text to edit -- synced live via Yjs
          </p>
        </main>
      </div>
    </div>
  );
}

export default EditorPage;