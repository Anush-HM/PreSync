import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as fabric from 'fabric';
import * as Y from 'yjs';
import {
  AlertCircle, ArrowLeft, Check, CloudOff, Download, ImagePlus, Maximize, Minus, PanelLeft, PanelRight,
  Play, Plus, Redo2, StickyNote, Type, Undo2, Users, ChevronDown
} from 'lucide-react';
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
  legacyFitScale
} from '../data/slideFormat.js';
import { goLive } from '../data/roomsApi.js';
import { getDeck, renameDeck, saveDeck, downloadDeckExport, EXPORT_FORMATS } from '../data/decksApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import SlideRail from '../components/editor/SlideRail.jsx';
import PropertiesPanel from '../components/editor/PropertiesPanel.jsx';
import ShareDeckDialog from '../components/decks/ShareDeckDialog.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import Menu from '../components/ui/Menu.jsx';
import { AvatarStack } from '../components/ui/Avatar.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import '../components/editor/editor.css';
import './EditorPage.css';

// Light, earthy tints that read on both the dark chrome and white slides.
const CURSOR_COLORS = ['#A3D4B2', '#D6C48F', '#8FB8A8', '#C9B79C', '#B5C98A', '#D4A794'];
// Origin for seeding a brand-new deck — kept out of the undo history.
const SEED_ORIGIN = 'seed';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;

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

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl: reader.result, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('That file is not a readable image'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function EditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isCompact = useMediaQuery('(max-width: 1099px)');
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [slides, setSlides] = useState([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [goingLive, setGoingLive] = useState(false);

  const [deckMeta, setDeckMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [titleDraft, setTitleDraft] = useState(null); // non-null while renaming
  const [showShare, setShowShare] = useState(false);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState(null);
  const [showNotes, setShowNotes] = useState(!isMobile);
  const [peers, setPeers] = useState([]);

  // Sync/save state
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [exporting, setExporting] = useState(null); // format being exported
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });

  // Toolbar state: ids of the selected blocks on the active slide. Their
  // formatting is read from `slides`, so it always reflects Yjs.
  const [selectedIds, setSelectedIds] = useState([]);
  const [zoom, setZoom] = useState(null); // null = fit the slide to the stage
  const [fitScale, setFitScale] = useState(1);

  // Panels start open where there is room for them; on smaller screens
  // they open as overlays on demand.
  const layout = isMobile ? 'mobile' : isCompact ? 'compact' : 'wide';
  const [railOpen, setRailOpen] = useState(layout !== 'mobile');
  const [panelOpen, setPanelOpen] = useState(layout === 'wide');
  const [lastLayout, setLastLayout] = useState(layout);
  if (lastLayout !== layout) {
    setLastLayout(layout);
    setRailOpen(layout !== 'mobile');
    setPanelOpen(layout === 'wide');
    setShowNotes(layout !== 'mobile');
  }
  const railOverlay = layout === 'mobile';
  const panelOverlay = layout !== 'wide';

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const yjsRef = useRef(null);
  const undoRef = useRef(null);
  const stageRef = useRef(null);
  const imageInputRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const renderedSlideIdRef = useRef(null);
  const scaleRef = useRef(1);
  const activeSlideIdxRef = useRef(0);
  activeSlideIdxRef.current = activeSlideIdx;

  useEffect(() => {
    getDeck(deckId)
      .then(setDeckMeta)
      .catch((err) => setMetaError(err.message || 'This presentation could not be opened'));
  }, [deckId]);

  // Largest zoom at which the whole slide fits the stage.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => {
      const pad = el.clientWidth < 600 ? 24 : 64;
      const s = Math.min((el.clientWidth - pad) / CANVAS_WIDTH, (el.clientHeight - pad) / CANVAS_HEIGHT);
      if (s > 0) setFitScale(Math.max(0.1, Math.min(MAX_ZOOM, Math.floor(s * 100) / 100)));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    setZoom((z) => Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (z ?? fitScale) + delta)) * 10) / 10);
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

  // --- Slide ops (by index, so the rail can act on any slide) ---
  function handleAddSlide() {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    const at = activeSlideIdx + 1;
    insertSlide(doc, at, makeBlankSlide(at));
    setActiveSlideIdx(at);
  }

  function handleDuplicateSlide(idx) {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    setActiveSlideIdx(duplicateSlide(doc, idx));
  }

  function handleMoveSlide(idx, delta) {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    setActiveSlideIdx(moveSlide(doc, idx, delta));
  }

  function confirmDeleteSlide() {
    const doc = yjsRef.current?.doc;
    const idx = confirmDeleteIdx;
    setConfirmDeleteIdx(null);
    if (!doc || idx === null || slides.length <= 1) return;
    deleteSlide(doc, idx);
    setActiveSlideIdx((prev) => (prev > idx ? prev - 1 : prev));
  }

  function handleSelectSlide(idx) {
    setActiveSlideIdx(idx);
    if (railOverlay) setRailOpen(false);
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

  async function handleInsertImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const doc = yjsRef.current?.doc;
    if (!file || !doc) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error('Choose a PNG, JPEG or GIF image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('Images can be up to 1.5 MB. Try a smaller or compressed version.');
      return;
    }
    try {
      const { dataUrl, width, height } = await readImageFile(file);
      const fit = Math.min(1, 640 / width, 360 / height);
      const w = Math.max(1, Math.round(width * fit));
      const h = Math.max(1, Math.round(height * fit));
      addBlock(doc, activeSlideIdxRef.current, {
        id: newId('b'),
        type: 'image',
        x: Math.round((CANVAS_WIDTH - w) / 2),
        y: Math.round((CANVAS_HEIGHT - h) / 2),
        width: w,
        height: h,
        fontSize: 16,
        text: '',
        imageUrl: dataUrl
      });
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleExport(format) {
    setExporting(format);
    try {
      await downloadDeckExport(deckId, format);
    } catch (err) {
      toast.error(err.message || 'Could not export the presentation');
    } finally {
      setExporting(null);
    }
  }

  async function commitTitle() {
    const title = titleDraft?.trim();
    setTitleDraft(null);
    if (!title || title === deckMeta?.title) return;
    try {
      setDeckMeta(await renameDeck(deckId, title));
    } catch (err) {
      toast.error(err.message || 'Could not rename the presentation');
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
    setGoingLive(true);
    try {
      // Make sure the presenter sees the very latest edits.
      await saveDeck(deckId).catch(() => {});
      const data = await goLive(deckId);
      navigate(`/presenter/${data.code}`, { state: { deckId, roomId: data.roomId } });
    } catch (err) {
      toast.error(err.message || 'Could not start the session');
      setGoingLive(false);
    }
  }

  const peersOnThisSlide = peers.filter((p) => p.activeSlideIdx === activeSlideIdx && p.cursor);
  const scale = zoom ?? fitScale;

  let status;
  if (syncStatus === 'offline') status = { tone: 'warn', icon: CloudOff, label: 'Offline', detail: 'Reconnecting. Your edits sync when the connection is back.' };
  else if (syncStatus === 'connecting') status = { tone: 'muted', icon: null, label: 'Connecting…', detail: 'Connecting to the collaboration server' };
  else if (saving) status = { tone: 'muted', icon: null, label: 'Saving…', detail: 'Saving a snapshot' };
  else if (saveError) status = { tone: 'error', icon: AlertCircle, label: 'Save failed', detail: saveError };
  else if (savedAt) status = { tone: 'ok', icon: Check, label: `Saved ${formatTime(savedAt)}`, detail: 'Edits also sync live to everyone in this presentation' };
  else status = { tone: 'ok', icon: Check, label: 'Synced', detail: 'Edits sync live and are saved automatically' };
  const StatusIcon = status.icon;

  const exportItems = Object.entries(EXPORT_FORMATS).map(([format, { label }]) => ({
    label, icon: Download, onSelect: () => handleExport(format), disabled: !!exporting
  }));
  const insertItems = [
    { label: 'Text box', icon: Type, onSelect: handleAddTextBlock, disabled: !activeSlide },
    { label: 'Image…', icon: ImagePlus, onSelect: () => imageInputRef.current?.click(), disabled: !activeSlide },
    'separator',
    { label: 'New slide', icon: Plus, onSelect: handleAddSlide, disabled: syncStatus === 'connecting' && slides.length === 0 }
  ];
  const loading = syncStatus === 'connecting' && slides.length === 0;
  const peerPeople = peers.map((p) => ({ id: p.clientId, name: p.name, color: p.color }));

  return (
    <div
      className={`editor${railOpen ? ' rail-open' : ''}${panelOpen ? ' panel-open' : ''}${railOverlay ? ' rail-overlay' : ''}${panelOverlay ? ' panel-overlay' : ''}`}
    >
      <header className="ed-top">
        <div className="ed-top-left">
          <Link to="/decks" className="icon-btn" aria-label="Back to dashboard" data-tip="Dashboard">
            <ArrowLeft />
          </Link>
          <div className="ed-title-wrap">
            {titleDraft !== null ? (
              <input
                className="input ed-title-input"
                aria-label="Presentation title"
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
                type="button"
                className="ed-title"
                aria-label={`Rename presentation, currently ${deckMeta?.title || 'Untitled presentation'}`}
                onClick={() => setTitleDraft(deckMeta?.title || '')}
                disabled={!deckMeta}
              >
                {deckMeta?.title || (metaError ? 'Unavailable' : 'Loading…')}
              </button>
            )}
            <span className={`ed-status is-${status.tone}`} role="status" title={status.detail}>
              {StatusIcon ? <StatusIcon aria-hidden="true" /> : <span className="spinner" aria-hidden="true" />}
              <span className="ed-status-label">{status.label}</span>
            </span>
          </div>
        </div>

        <div className="ed-top-tools" role="toolbar" aria-label="Editor tools">
          <button
            type="button"
            className="icon-btn"
            aria-label={railOpen ? 'Hide slides' : 'Show slides'}
            aria-pressed={railOpen}
            data-tip="Slides"
            onClick={() => setRailOpen((o) => !o)}
          >
            <PanelLeft />
          </button>
          <span className="ed-sep" aria-hidden="true" />
          <button type="button" className="icon-btn" aria-label="Undo" data-tip="Undo (Ctrl+Z)" onClick={handleUndo} disabled={!undoState.canUndo}>
            <Undo2 />
          </button>
          <button type="button" className="icon-btn" aria-label="Redo" data-tip="Redo (Ctrl+Shift+Z)" onClick={handleRedo} disabled={!undoState.canRedo}>
            <Redo2 />
          </button>
          <span className="ed-sep" aria-hidden="true" />
          <Menu label="Insert" icon={Plus} text="Insert" items={insertItems} align="start" triggerClassName="btn btn-ghost btn-sm" />
          <input ref={imageInputRef} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={handleInsertImage} />

          <span className="ed-tools-spacer" />

          {peerPeople.length > 0 && (
            <div className="ed-presence" title={peers.map((p) => p.name).join(', ')}>
              <AvatarStack people={peerPeople} max={3} size={26} />
              <span className="ed-presence-label">{peers.length} editing</span>
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowShare(true)} disabled={!deckMeta}>
            <Users aria-hidden="true" /><span className="ed-hide-sm">Share</span>
          </button>
          <Menu
            label={exporting ? 'Exporting…' : 'Export'}
            icon={exporting ? ChevronDown : Download}
            text={exporting ? 'Exporting…' : 'Export'}
            items={exportItems}
            triggerClassName="btn btn-ghost btn-sm ed-export"
          />
          <button type="button" className="btn btn-ghost btn-sm ed-save" onClick={handleSave} disabled={saving} title="Save a snapshot now (Ctrl+S)">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <span className="ed-sep" aria-hidden="true" />
          <button
            type="button"
            className="icon-btn"
            aria-label={panelOpen ? 'Hide formatting panel' : 'Show formatting panel'}
            aria-pressed={panelOpen}
            data-tip="Format"
            onClick={() => setPanelOpen((o) => !o)}
          >
            <PanelRight />
            {!panelOpen && selectedIds.length > 0 && <span className="ed-dot" aria-hidden="true" />}
          </button>
        </div>

        <div className="ed-top-right">
          <button type="button" className="btn btn-primary btn-sm ed-present" onClick={handleGoLive} disabled={goingLive || !deckMeta || slides.length === 0}>
            {goingLive ? <span className="spinner" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {goingLive ? 'Starting…' : 'Present'}
          </button>
        </div>
      </header>

      <div className="ed-body">
        {(railOverlay && railOpen) || (panelOverlay && panelOpen) ? (
          <div
            className="ed-scrim"
            aria-hidden="true"
            onClick={() => {
              if (railOverlay) setRailOpen(false);
              if (panelOverlay) setPanelOpen(false);
            }}
          />
        ) : null}

        <aside className="ed-rail" aria-label="Slides" hidden={!railOpen}>
          <SlideRail
            slides={slides}
            activeIdx={activeSlideIdx}
            peers={peers}
            onSelect={handleSelectSlide}
            onAdd={handleAddSlide}
            onDuplicate={handleDuplicateSlide}
            onMove={handleMoveSlide}
            onDelete={(i) => setConfirmDeleteIdx(i)}
          />
        </aside>

        <main className="ed-center" id="main">
          <div className="ed-stage" ref={stageRef}>
            <div className="canvas-frame" style={{ width: CANVAS_WIDTH * scale, height: CANVAS_HEIGHT * scale }}>
              <div className="canvas-page" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: `scale(${scale})` }}>
                <canvas ref={canvasElRef} aria-label={`Slide ${activeSlideIdx + 1} canvas`} />
                {peersOnThisSlide.map((p) => (
                  <div key={p.clientId} className="peer-cursor" style={{ left: p.cursor.x, top: p.cursor.y }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill={p.color} aria-hidden="true">
                      <path d="M1 1 L1 14 L5 10.5 L7.5 15 L9.5 14 L7 9.5 L13 9.5 Z" />
                    </svg>
                    <span className="peer-cursor-label" style={{ background: p.color }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {(loading || metaError) && (
              <div className="ed-stage-state" role={metaError ? 'alert' : 'status'}>
                {metaError ? (
                  <>
                    <AlertCircle aria-hidden="true" className="is-error" />
                    <h1>This presentation could not be opened</h1>
                    <p>{metaError}</p>
                    <Link to="/decks" className="btn btn-secondary">Back to dashboard</Link>
                  </>
                ) : (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    <p>Loading presentation…</p>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="ed-stagebar">
            <span className="ed-slide-pos mono">
              Slide {slides.length ? activeSlideIdx + 1 : 0} of {slides.length}
            </span>
            <button
              type="button"
              className="btn btn-quiet btn-sm ed-notes-toggle"
              aria-expanded={showNotes}
              aria-controls="speaker-notes"
              onClick={() => setShowNotes((v) => !v)}
            >
              <StickyNote aria-hidden="true" />Notes
            </button>
            <div className="ed-zoom" role="group" aria-label="Zoom">
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Zoom out" onClick={() => handleZoom(-0.1)} disabled={scale <= MIN_ZOOM}>
                <Minus />
              </button>
              <span className="ed-zoom-val mono" aria-live="polite">{Math.round(scale * 100)}%</span>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Zoom in" onClick={() => handleZoom(0.1)} disabled={scale >= MAX_ZOOM}>
                <Plus />
              </button>
              <button type="button" className="btn btn-quiet btn-sm" aria-pressed={zoom === null} onClick={() => setZoom(null)}>
                <Maximize aria-hidden="true" />Fit
              </button>
            </div>
          </div>

          {showNotes && (
            <section className="ed-notes" id="speaker-notes">
              <label htmlFor="notes-input" className="ed-notes-label">Speaker notes</label>
              <textarea
                id="notes-input"
                className="textarea ed-notes-input"
                placeholder="Notes for this slide. Only editors see these; the audience never does."
                value={activeSlide?.notes || ''}
                onChange={handleNotesChange}
                disabled={!activeSlide}
              />
            </section>
          )}
        </main>

        <aside className="ed-panel" aria-label="Formatting" hidden={!panelOpen}>
          <PropertiesPanel
            slide={activeSlide}
            slideIndex={activeSlideIdx}
            selectedBlocks={selectedBlocks}
            primary={primary}
            onFormat={formatSelected}
            onToggle={toggleFormat}
            onRestack={handleRestack}
            onDuplicate={handleDuplicateSelected}
            onDelete={handleDeleteSelected}
            onBackground={handleSlideBackground}
            onClose={panelOverlay ? () => setPanelOpen(false) : undefined}
          />
        </aside>
      </div>

      {showShare && deckMeta && (
        <ShareDeckDialog
          deckId={deckId}
          deckTitle={deckMeta.title}
          initialMeta={deckMeta}
          onChanged={setDeckMeta}
          onClose={() => setShowShare(false)}
        />
      )}

      {confirmDeleteIdx !== null && (
        <ConfirmDialog
          title={`Delete slide ${confirmDeleteIdx + 1}?`}
          message="The slide and its speaker notes are removed for everyone editing. You can bring it back with Undo."
          confirmLabel="Delete slide"
          destructive
          onConfirm={confirmDeleteSlide}
          onCancel={() => setConfirmDeleteIdx(null)}
        />
      )}
    </div>
  );
}

export default EditorPage;
