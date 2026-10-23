import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as fabric from 'fabric';
import * as Y from 'yjs';
import { connectYjsDoc, getSlidesArray, slideMapToPlain, plainToSlideMap } from '../data/yjsClient.js';
import {
  addBlock,
  deleteBlocks,
  deleteSlide,
  duplicateBlocks,
  duplicateSlide,
  insertSlide,
  makeBlankSlide,
  moveSlide,
  newId,
  restackBlock,
  updateBlocks,
  updateSlide
} from '../data/deckOps.js';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_SLIDE_BACKGROUND,
  DEFAULT_TEXT_COLOR,
  FONT_FAMILIES,
  SLIDE_BACKGROUNDS,
  TEXT_ALIGNMENTS,
  TEXT_COLORS,
  legacyFitScale
} from '../data/slideFormat.js';
import { goLive } from '../data/roomsApi.js';
import { getDeck, addCollaborator, removeCollaborator, renameDeck, saveDeck } from '../data/decksApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import './EditorPage.css';

const CURSOR_COLORS = ['#4FA8FF', '#FFB454', '#6EE7B7', '#F472B6', '#A78BFA', '#F87171'];
const ALIGN_ICONS = { left: '⇤', center: '↔', right: '⇥', justify: '☰' };
const LINE_HEIGHTS = [1, 1.16, 1.5, 2];
// Origin for seeding a brand-new deck — kept out of the undo history.
const SEED_ORIGIN = 'seed';

function colorForUser(id) {
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// Fabric 7 positions objects by their centre by default; blocks are
// stored by their top-left corner, so every object is pinned to that.
const BASE_OBJECT_PROPS = { originX: 'left', originY: 'top', strokeWidth: 0 };

function textboxProps(block, scale) {
  return {
    ...BASE_OBJECT_PROPS,
    left: (block.x || 0) * scale,
    top: (block.y || 0) * scale,
    width: (block.width || 300) * scale,
    scaleX: 1,
    scaleY: 1,
    fontSize: (block.fontSize || 16) * scale,
    text: block.text || '',
    fill: block.fill || DEFAULT_TEXT_COLOR,
    fontFamily: block.fontFamily || DEFAULT_FONT_FAMILY,
    fontWeight: block.fontWeight || 'normal',
    fontStyle: block.fontStyle || 'normal',
    underline: !!block.underline,
    textAlign: block.textAlign || 'left',
    lineHeight: block.lineHeight || DEFAULT_LINE_HEIGHT
  };
}

function imageProps(block, img, scale) {
  const width = (block.width || img.width) * scale;
  const height = block.height ? block.height * scale : (img.height * width) / img.width;
  return {
    ...BASE_OBJECT_PROPS,
    left: (block.x || 0) * scale,
    top: (block.y || 0) * scale,
    scaleX: width / img.width,
    scaleY: height / img.height
  };
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function EditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();

  const [slides, setSlides] = useState([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [goLiveError, setGoLiveError] = useState('');
  const [goingLive, setGoingLive] = useState(false);

  const [deckMeta, setDeckMeta] = useState(null);
  const [titleDraft, setTitleDraft] = useState(null); // non-null while renaming
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [peers, setPeers] = useState([]);

  // Sync/save state
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });

  // Toolbar state: ids of the selected blocks on the active slide. Their
  // formatting is read from `slides`, so it always reflects Yjs.
  const [selectedIds, setSelectedIds] = useState([]);
  const [zoom, setZoom] = useState(1);

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const yjsRef = useRef(null);
  const undoRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const renderedSlideIdRef = useRef(null);
  const scaleRef = useRef(1);
  const activeSlideIdxRef = useRef(0);
  activeSlideIdxRef.current = activeSlideIdx;

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

    // Only local edits are undoable; remote ones arrive with the socket
    // as their transaction origin and are left alone.
    const undoManager = new Y.UndoManager(slidesArr, { captureTimeout: 500 });
    undoRef.current = undoManager;
    const syncHistory = () =>
      setUndoState({ canUndo: undoManager.undoStack.length > 0, canRedo: undoManager.redoStack.length > 0 });
    undoManager.on('stack-item-added', syncHistory);
    undoManager.on('stack-item-popped', syncHistory);
    undoManager.on('stack-cleared', syncHistory);

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

    // Seed a brand-new, empty deck with one blank slide — but only once
    // the server has sent its copy, so we never race real content.
    const offStatus = yjs.onStatus((status) => {
      setSyncStatus(status);
      if (status === 'synced' && slidesArr.length === 0) {
        yjs.doc.transact(() => {
          slidesArr.push([plainToSlideMap(makeBlankSlide(0))]);
        }, SEED_ORIGIN);
      }
    });

    return () => {
      offStatus();
      undoManager.destroy();
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

  // Keep the active index valid when slides are removed (locally or by a peer).
  useEffect(() => {
    if (slides.length > 0 && activeSlideIdx > slides.length - 1) setActiveSlideIdx(slides.length - 1);
  }, [slides.length, activeSlideIdx]);

  // --- Fabric canvas init
  useEffect(() => {
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: DEFAULT_SLIDE_BACKGROUND,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;
    renderedSlideIdRef.current = null;

    // Reads an object's geometry back into slide coordinates. Works for
    // objects inside a multi-selection too, whose own left/top are
    // relative to the selection group.
    function blockGeometry(obj) {
      const s = scaleRef.current;
      const rect = obj.getBoundingRect();
      const scaling = obj.getObjectScaling();
      const geometry = { x: Math.round(rect.left / s), y: Math.round(rect.top / s) };
      if (obj.type === 'image') {
        geometry.width = Math.round(rect.width / s);
        geometry.height = Math.round(rect.height / s);
      } else {
        geometry.width = Math.round((obj.width * scaling.x) / s);
        geometry.fontSize = Math.max(4, Math.round((obj.fontSize * scaling.y) / s));
      }
      return geometry;
    }

    function writeObjects(objects) {
      const doc = yjsRef.current?.doc;
      if (applyingRemoteRef.current || !doc) return;
      const blocksArr = getSlidesArray(doc).get(activeSlideIdxRef.current)?.get('blocks');
      if (!blocksArr) return;
      const byId = new Map(blocksArr.toArray().map((m) => [m.get('id'), m]));
      doc.transact(() => {
        objects.forEach((obj) => {
          const blockMap = byId.get(obj.data?.blockId);
          if (!blockMap) return;
          Object.entries(blockGeometry(obj)).forEach(([k, v]) => blockMap.set(k, v));
          if (typeof obj.text === 'string') blockMap.set('text', obj.text);
        });
      });
    }

    function writeText(obj) {
      const doc = yjsRef.current?.doc;
      if (applyingRemoteRef.current || !doc || !obj?.data?.blockId) return;
      const blocksArr = getSlidesArray(doc).get(activeSlideIdxRef.current)?.get('blocks');
      const blockMap = blocksArr?.toArray().find((m) => m.get('id') === obj.data.blockId);
      if (blockMap && blockMap.get('text') !== obj.text) {
        doc.transact(() => blockMap.set('text', obj.text));
      }
    }

    canvas.on('object:modified', (e) => {
      const target = e.target;
      if (!target) return;
      writeObjects(target.type === 'activeselection' ? target.getObjects() : [target]);
    });
    canvas.on('text:changed', (e) => writeText(e.target));
    canvas.on('text:editing:exited', (e) => writeText(e.target));

    const syncSelection = () => {
      setSelectedIds(canvas.getActiveObjects().map((o) => o.data?.blockId).filter(Boolean));
    };
    canvas.on('selection:created', syncSelection);
    canvas.on('selection:updated', syncSelection);
    canvas.on('selection:cleared', syncSelection);

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

  // --- Reconcile the active slide's blocks onto the Fabric canvas.
  // Objects are updated in place rather than rebuilt, so a block being
  // typed into keeps its caret while edits (local or remote) land.
  useEffect(() => {
    const canvas = fabricRef.current;
    const slide = slides[activeSlideIdx];
    if (!canvas || !slide) return;

    applyingRemoteRef.current = true;

    if (renderedSlideIdRef.current !== slide.id) {
      canvas.discardActiveObject();
      canvas.clear();
      canvas.backgroundImage = undefined;
      renderedSlideIdRef.current = slide.id;
      setSelectedIds([]);
    }

    canvas.backgroundColor = slide.backgroundColor || DEFAULT_SLIDE_BACKGROUND;
    if (slide.backgroundImageUrl) {
      if (canvas.backgroundImage?.data?.src !== slide.backgroundImageUrl) {
        const slideId = slide.id;
        fabric.FabricImage.fromURL(slide.backgroundImageUrl).then((img) => {
          if (renderedSlideIdRef.current !== slideId) return;
          img.set({ ...BASE_OBJECT_PROPS, scaleX: CANVAS_WIDTH / img.width, scaleY: CANVAS_HEIGHT / img.height });
          img.data = { src: slide.backgroundImageUrl };
          canvas.backgroundImage = img;
          canvas.requestRenderAll();
        }).catch(() => {});
      }
    } else {
      canvas.backgroundImage = undefined;
    }

    const scale = legacyFitScale(slide.blocks);
    scaleRef.current = scale;

    const existing = new Map();
    canvas.getObjects().forEach((o) => {
      if (o.data?.blockId) existing.set(o.data.blockId, o);
    });
    const wanted = new Set(slide.blocks.map((b) => b.id));
    existing.forEach((obj, id) => {
      if (!wanted.has(id)) canvas.remove(obj);
    });

    const placeAt = (obj, blockId) => {
      const idx = slide.blocks.findIndex((b) => b.id === blockId);
      if (idx >= 0 && canvas.getObjects().indexOf(obj) !== idx) canvas.moveObjectTo(obj, idx);
    };

    slide.blocks.forEach((block) => {
      let obj = existing.get(block.id);

      if (block.type === 'image') {
        if (!block.imageUrl) return;
        if (obj) {
          if (!obj.group) obj.set(imageProps(block, { width: obj.width, height: obj.height }, scale));
          obj.setCoords();
          placeAt(obj, block.id);
          return;
        }
        const slideId = slide.id;
        fabric.FabricImage.fromURL(block.imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
          if (renderedSlideIdRef.current !== slideId) return;
          img.set(imageProps(block, img, scale));
          img.data = { blockId: block.id };
          applyingRemoteRef.current = true;
          canvas.add(img);
          placeAt(img, block.id);
          applyingRemoteRef.current = false;
          canvas.requestRenderAll();
        }).catch(() => {});
        return;
      }

      const props = textboxProps(block, scale);
      if (obj) {
        // Don't fight the user's own typing: Fabric already holds the
        // newest text for a block that is being edited right now.
        if (obj.isEditing) delete props.text;
        // Inside a multi-selection, left/top are relative to the group;
        // leave geometry alone until the selection is released.
        if (obj.group) ['left', 'top', 'width', 'scaleX', 'scaleY'].forEach((k) => delete props[k]);
        obj.set(props);
        obj.setCoords();
      } else {
        obj = new fabric.Textbox(props.text, { ...props, editable: true, splitByGrapheme: false });
        obj.data = { blockId: block.id };
        canvas.add(obj);
      }
      placeAt(obj, block.id);
    });

    canvas.requestRenderAll();
    applyingRemoteRef.current = false;
  }, [slides, activeSlideIdx]);

  const activeSlide = slides[activeSlideIdx];
  const selectedBlocks = (activeSlide?.blocks || []).filter((b) => selectedIds.includes(b.id));
  const selectedText = selectedBlocks.filter((b) => b.type !== 'image');
  const primary = selectedText[0];
  const hasSelection = selectedBlocks.length > 0;
  const hasTextSelection = selectedText.length > 0;

  // --- Toolbar actions ---

  const formatSelected = useCallback((patch) => {
    const doc = yjsRef.current?.doc;
    if (!doc || selectedIds.length === 0) return;
    updateBlocks(doc, activeSlideIdx, selectedIds, patch);
  }, [selectedIds, activeSlideIdx]);

  function toggleFormat(key, onValue, offValue) {
    if (!primary) return;
    const isOn = key === 'underline' ? !!primary.underline : primary[key] === onValue;
    formatSelected({ [key]: isOn ? offValue : onValue });
  }

  function handleAddTextBlock() {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    addBlock(doc, activeSlideIdx, {
      id: newId('b'),
      type: 'textbox',
      x: Math.round(100 + Math.random() * 80),
      y: Math.round(100 + Math.random() * 80),
      width: 300,
      fontSize: 18,
      text: 'New text'
    });
  }

  function handleFontSizeChange(e) {
    const size = parseInt(e.target.value, 10);
    if (size >= 8 && size <= 200) formatSelected({ fontSize: size });
  }

  const handleDeleteSelected = useCallback(() => {
    const doc = yjsRef.current?.doc;
    if (!doc || selectedIds.length === 0) return;
    fabricRef.current?.discardActiveObject();
    deleteBlocks(doc, activeSlideIdx, selectedIds);
    setSelectedIds([]);
  }, [selectedIds, activeSlideIdx]);

  const handleDuplicateSelected = useCallback(() => {
    const doc = yjsRef.current?.doc;
    if (!doc || selectedIds.length === 0) return;
    duplicateBlocks(doc, activeSlideIdx, selectedIds);
  }, [selectedIds, activeSlideIdx]);

  function handleRestack(to) {
    const doc = yjsRef.current?.doc;
    if (!doc || selectedIds.length !== 1) return;
    restackBlock(doc, activeSlideIdx, selectedIds[0], to);
  }

  function handleZoom(delta) {
    setZoom((z) => Math.round(Math.max(0.5, Math.min(2, z + delta)) * 10) / 10);
  }

  const handleUndo = useCallback(() => {
    fabricRef.current?.discardActiveObject();
    undoRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    fabricRef.current?.discardActiveObject();
    undoRef.current?.redo();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    try {
      const { savedAt: at } = await saveDeck(deckId);
      setSavedAt(at);
    } catch (err) {
      setSaveError(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [deckId]);

  // --- Slide ops ---
  function handleAddSlide() {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    const at = activeSlideIdx + 1;
    insertSlide(doc, at, makeBlankSlide(at));
    setActiveSlideIdx(at);
  }

  function handleDuplicateSlide() {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    setActiveSlideIdx(duplicateSlide(doc, activeSlideIdx));
  }

  function handleMoveSlide(delta) {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    setActiveSlideIdx(moveSlide(doc, activeSlideIdx, delta));
  }

  function handleDeleteSlide() {
    const doc = yjsRef.current?.doc;
    if (!doc || slides.length <= 1) return;
    if (!window.confirm(`Delete slide ${activeSlideIdx + 1}?`)) return;
    deleteSlide(doc, activeSlideIdx);
    setActiveSlideIdx((prev) => Math.max(0, prev - 1));
  }

  function handleSlideBackground(color) {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    updateSlide(doc, activeSlideIdx, { backgroundColor: color });
  }

  function handleNotesChange(e) {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    updateSlide(doc, activeSlideIdx, { notes: e.target.value });
  }

  async function commitTitle() {
    const title = titleDraft?.trim();
    setTitleDraft(null);
    if (!title || title === deckMeta?.title) return;
    try {
      setDeckMeta(await renameDeck(deckId, title));
    } catch (err) {
      setSaveError(err.message || 'Could not rename the deck');
    }
  }

  // --- Keyboard shortcuts (skipped while typing in a text block/field)
  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      if (isTypingInField()) return;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        handleDuplicateSelected();
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, handleUndo, handleRedo, handleDuplicateSelected, handleDeleteSelected, selectedIds.length]);

  async function handleGoLive() {
    if (goingLive) return;
    setGoLiveError('');
    setGoingLive(true);
    try {
      // Make sure the presenter sees the very latest edits.
      await saveDeck(deckId).catch(() => {});
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

  let saveLabel;
  if (syncStatus === 'offline') saveLabel = 'Offline · reconnecting';
  else if (syncStatus === 'connecting') saveLabel = 'Connecting…';
  else if (saving) saveLabel = 'Saving…';
  else if (savedAt) saveLabel = `Saved ${formatTime(savedAt)}`;
  else saveLabel = 'Autosave on';

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Decks</button>
          {titleDraft !== null ? (
            <input
              className="editor-title-input"
              aria-label="Deck title"
              value={titleDraft}
              autoFocus
              maxLength={200}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setTitleDraft(null);
              }}
            />
          ) : (
            <button
              className="editor-deck-title"
              title="Rename deck"
              onClick={() => setTitleDraft(deckMeta?.title || '')}
            >
              {deckMeta?.title || 'Untitled deck'}
            </button>
          )}
          <span className={`editor-save-status mono status-${syncStatus}`} role="status">{saveLabel}</span>
        </div>

        <div className="presence-bar">
          {peers.map((p) => (
            <span key={p.clientId} className="presence-dot" style={{ background: p.color }} title={p.name}>
              {p.name?.[0]?.toUpperCase() || '?'}
            </span>
          ))}
          {peers.length > 0 && <span className="presence-label mono">{peers.length} editing</span>}
        </div>

        {saveError && <span className="editor-golive-error">{saveError}</span>}
        {goLiveError && <span className="editor-golive-error">{goLiveError}</span>}
        <button className="btn btn-ghost" onClick={handleSave} disabled={saving} title="Save now (Ctrl+S)">
          {saving ? 'Saving…' : 'Save'}
        </button>
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
          <button className="toolbar-btn" onClick={handleUndo} title="Undo (Ctrl+Z)" disabled={!undoState.canUndo}>↶</button>
          <button className="toolbar-btn" onClick={handleRedo} title="Redo (Ctrl+Shift+Z)" disabled={!undoState.canRedo}>↷</button>
          <span className="toolbar-divider" />
          <button className="toolbar-btn" onClick={handleAddTextBlock} title="Add text block">
            <span className="toolbar-icon">T+</span>
          </button>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          <select
            className="toolbar-select"
            aria-label="Font"
            title="Font"
            value={primary?.fontFamily || DEFAULT_FONT_FAMILY}
            onChange={(e) => formatSelected({ fontFamily: e.target.value })}
            disabled={!hasTextSelection}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <label className="toolbar-label mono" title="Font size">
            <input
              className="toolbar-font-input mono"
              type="number"
              aria-label="Font size"
              min={8}
              max={200}
              value={primary ? Math.round(primary.fontSize) : ''}
              onChange={handleFontSizeChange}
              disabled={!hasTextSelection}
              placeholder="--"
            />
            <span>px</span>
          </label>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          <button className={`toolbar-btn ${primary?.fontWeight === 'bold' ? 'active' : ''}`} onClick={() => toggleFormat('fontWeight', 'bold', 'normal')} title="Bold" disabled={!hasTextSelection}>
            <strong>B</strong>
          </button>
          <button className={`toolbar-btn ${primary?.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => toggleFormat('fontStyle', 'italic', 'normal')} title="Italic" disabled={!hasTextSelection}>
            <em>I</em>
          </button>
          <button className={`toolbar-btn ${primary?.underline ? 'active' : ''}`} onClick={() => toggleFormat('underline', true, false)} title="Underline" disabled={!hasTextSelection}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          {TEXT_ALIGNMENTS.map((align) => (
            <button
              key={align}
              className={`toolbar-btn ${(primary?.textAlign || 'left') === align && hasTextSelection ? 'active' : ''}`}
              onClick={() => formatSelected({ textAlign: align })}
              title={`Align ${align}`}
              disabled={!hasTextSelection}
            >
              {ALIGN_ICONS[align]}
            </button>
          ))}
          <select
            className="toolbar-select toolbar-select-narrow"
            aria-label="Line spacing"
            title="Line spacing"
            value={primary?.lineHeight || DEFAULT_LINE_HEIGHT}
            onChange={(e) => formatSelected({ lineHeight: Number(e.target.value) })}
            disabled={!hasTextSelection}
          >
            {LINE_HEIGHTS.map((lh) => (
              <option key={lh} value={lh}>{lh === DEFAULT_LINE_HEIGHT ? '1.15' : lh.toFixed(1)}×</option>
            ))}
          </select>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group toolbar-colors">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${(primary?.fill || DEFAULT_TEXT_COLOR) === c && hasTextSelection ? 'active' : ''}`}
              style={{ background: c, border: c === '#ffffff' ? '1px solid var(--hairline)' : 'none' }}
              onClick={() => formatSelected({ fill: c })}
              title={c}
              disabled={!hasTextSelection}
            />
          ))}
          <input
            type="color"
            className="toolbar-color-input"
            aria-label="Custom text colour"
            title="Custom text colour"
            value={primary?.fill || DEFAULT_TEXT_COLOR}
            onChange={(e) => formatSelected({ fill: e.target.value })}
            disabled={!hasTextSelection}
          />
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group">
          <button className="toolbar-btn" onClick={() => handleRestack('front')} title="Bring to front" disabled={selectedIds.length !== 1}>⤒</button>
          <button className="toolbar-btn" onClick={() => handleRestack('forward')} title="Bring forward" disabled={selectedIds.length !== 1}>↑</button>
          <button className="toolbar-btn" onClick={() => handleRestack('backward')} title="Send backward" disabled={selectedIds.length !== 1}>↓</button>
          <button className="toolbar-btn" onClick={() => handleRestack('back')} title="Send to back" disabled={selectedIds.length !== 1}>⤓</button>
          <button className="toolbar-btn" onClick={handleDuplicateSelected} title="Duplicate (Ctrl+D)" disabled={!hasSelection}>⧉</button>
          <button className="toolbar-btn toolbar-btn-danger" onClick={handleDeleteSelected} title="Delete selected (Del)" disabled={!hasSelection}>🗑</button>
          <span className="toolbar-divider" />
        </div>

        <div className="toolbar-group toolbar-colors" title="Slide background">
          <span className="toolbar-label mono">Slide</span>
          {SLIDE_BACKGROUNDS.map((c) => (
            <button
              key={c}
              className={`color-swatch color-swatch-square ${(activeSlide?.backgroundColor || DEFAULT_SLIDE_BACKGROUND) === c ? 'active' : ''}`}
              style={{ background: c, border: '1px solid var(--hairline)' }}
              onClick={() => handleSlideBackground(c)}
              title={`Slide background ${c}`}
              disabled={!activeSlide}
            />
          ))}
          <input
            type="color"
            className="toolbar-color-input"
            aria-label="Custom slide background"
            title="Custom slide background"
            value={activeSlide?.backgroundColor || DEFAULT_SLIDE_BACKGROUND}
            onChange={(e) => handleSlideBackground(e.target.value)}
            disabled={!activeSlide}
          />
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
                  {s.blocks?.find((b) => b.text)?.text?.split('\n')[0]?.slice(0, 20) || `Slide ${i + 1}`}
                </span>
              </button>
            ))}
          </div>
          <div className="slide-rail-actions">
            <button className="btn btn-ghost slide-action-btn" onClick={handleAddSlide}>+ Add slide</button>
            <button className="btn btn-ghost slide-action-btn" onClick={handleDuplicateSlide} disabled={!activeSlide}>Duplicate</button>
            <div className="slide-move-row">
              <button className="btn btn-ghost slide-action-btn" onClick={() => handleMoveSlide(-1)} disabled={activeSlideIdx === 0} title="Move slide up">↑ Up</button>
              <button className="btn btn-ghost slide-action-btn" onClick={() => handleMoveSlide(1)} disabled={activeSlideIdx >= slides.length - 1} title="Move slide down">↓ Down</button>
            </div>
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
            Slide {activeSlideIdx + 1} of {slides.length} · drag to move · double-click to edit · Ctrl+S saves
          </p>
          <section className="notes-panel" style={{ width: CANVAS_WIDTH }}>
            <button className="notes-toggle mono" onClick={() => setShowNotes((v) => !v)}>
              {showNotes ? '▾' : '▸'} Speaker notes
            </button>
            {showNotes && (
              <textarea
                className="notes-input"
                aria-label="Speaker notes"
                placeholder="Notes for this slide — only you and co-editors see these, viewers never do."
                value={activeSlide?.notes || ''}
                onChange={handleNotesChange}
                disabled={!activeSlide}
              />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

export default EditorPage;
