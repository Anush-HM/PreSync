import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as fabric from 'fabric';
import * as Y from 'yjs';
import {
  AlertCircle, ArrowLeft, Check, CloudOff, Download, Image as ImageIcon, Maximize, Minus, PanelLeft, PanelRight,
  Play, Plus, Redo2, Sparkles, StickyNote, Undo2, Users, ChevronDown, MoreHorizontal, Command, Keyboard, LayoutTemplate,
  Magnet, Smile, Type, Shapes, Table2, BarChart3, Copy, Trash2, Group, Ungroup, AlignLeft, AlignCenter, AlignRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, Palette, LayoutGrid, Save, Presentation
} from 'lucide-react';
import { connectYjsDoc, getSlidesArray, slideMapToPlain, plainToSlideMap } from '../data/yjsClient.js';
import {
  applyInteraction,
  BASE_OBJECT_PROPS,
  blockGeometry,
  chartKey,
  createChart,
  createShape,
  createTable,
  fontFamiliesOf,
  placeGroup,
  placeImage,
  placeText,
  scaledTable,
  SlideTextbox,
  shapeKey,
  slideBackgroundFill,
  stylesOf,
  tableKey,
  textboxProps,
  updateShape
} from '../components/editor/fabricBlocks.js';
import {
  addBlock,
  deleteBlocks,
  deleteSlide,
  duplicateBlocks,
  duplicateSlide,
  formatBlocks,
  insertSlide,
  makeBlankSlide,
  moveSlide,
  newId,
  patchBlocks,
  replaceSlideContent,
  restackBlock,
  updateBlocks,
  updateSlide
} from '../data/deckOps.js';
import { alignBoxes, distributeBoxes, expandToGroups, nudgeBoxes } from '../data/arrange.js';
import { applyLayout, layoutById, slideFromLayout } from '../data/layouts.js';
import { applyTheme, themeById } from '../data/themes.js';
import { CLEAR_FORMAT_PATCH, formatOf, indentLines, linesInSelection, paintPatch, toggleList } from '../data/textOps.js';
import { cropPatch, keepsAspect, replaceImagePatch, resetAspectPatch } from '../data/imageOps.js';
import { defaultChart, setChartField } from '../data/chartOps.js';
import { makeTable, tableSize, tableText } from '../data/tableOps.js';
import { shapeFields } from '../data/shapes.js';
import { loadFont } from '../data/fonts.js';
import { assetToBlock } from '../data/assetLibrary.js';
import { snapBox, SNAP_THRESHOLD } from '../data/snapping.js';
import { keyParts, shortcutFor } from '../data/shortcuts.js';
import { LAYOUTS } from '../data/layouts.js';
import { THEMES } from '../data/themes.js';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_SLIDE_BACKGROUND,
  legacyFitScale,
  LIST_PREFIX
} from '../data/slideFormat.js';
import { goLive } from '../data/roomsApi.js';
import { getDeck, renameDeck, saveDeck, downloadDeckExport, EXPORT_FORMATS } from '../data/decksApi.js';
import { getCurrentUser } from '../data/apiConfig.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import SlideRail from '../components/editor/SlideRail.jsx';
import PropertiesPanel from '../components/editor/PropertiesPanel.jsx';
import ContextToolbar from '../components/editor/ContextToolbar.jsx';
import InsertMenu from '../components/editor/InsertMenu.jsx';
import CommandPalette from '../components/editor/CommandPalette.jsx';
import ShortcutsDialog from '../components/editor/ShortcutsDialog.jsx';
import SaveTemplateDialog from '../components/templates/SaveTemplateDialog.jsx';
import CopilotPanel from '../components/copilot/CopilotPanel.jsx';
import { createEditorBridge } from '../components/copilot/editorBridge.js';
import ShareDeckDialog from '../components/decks/ShareDeckDialog.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import Menu from '../components/ui/Menu.jsx';
import { AvatarStack } from '../components/ui/Avatar.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import '../components/editor/editor.css';
import '../components/editor/toolbar.css';
import './EditorPage.css';

// Light, earthy tints that read on both the dark chrome and white slides.
const CURSOR_COLORS = ['#A3D4B2', '#D6C48F', '#8FB8A8', '#C9B79C', '#B5C98A', '#D4A794'];
// Origin for seeding a brand-new deck — kept out of the undo history.
const SEED_ORIGIN = 'seed';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MIN_ZOOM = 0.25;
// Formatting Fabric can hold per character (the rest is per text box).
const CHAR_STYLE_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'linethrough', 'fill', 'textBackgroundColor'];
// Where new elements land: the middle of the slide.
const centred = (w, h) => ({ x: Math.round((CANVAS_WIDTH - w) / 2), y: Math.round((CANVAS_HEIGHT - h) / 2) });
// Font families this page has already asked the browser to load.
const requestedFonts = new Set();
const MAX_ZOOM = 2;
const SNAP_KEY = 'presync.snapToGuides';
const GUIDE_COLOR = '#d6455d';
// Pictures offered again under Insert › Elements.
const MAX_DECK_IMAGES = 24;

function readSnapSetting() {
  try {
    return localStorage.getItem(SNAP_KEY) !== 'off';
  } catch {
    return true;
  }
}

function colorForUser(id) {
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
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
  // Character formatting at the caret or text selection while editing.
  const [selection, setSelection] = useState({});
  const [painter, setPainter] = useState(null); // formatting the format painter carries
  const [focusSection, setFocusSection] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [zoom, setZoom] = useState(null); // null = fit the slide to the stage
  const [snapOn, setSnapOn] = useState(readSnapSetting);
  const [dialog, setDialog] = useState(null); // 'palette' | 'shortcuts' | 'template'
  const [insertRequest, setInsertRequest] = useState(null); // opens Insert on a tab
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
  const replaceInputRef = useRef(null);
  const slidesRef = useRef([]);
  const quietSelectionRef = useRef(false); // set while an object is swapped for a rebuilt one
  const applyingRemoteRef = useRef(false);
  const renderedSlideIdRef = useRef(null);
  const scaleRef = useRef(1);
  const relayoutRef = useRef(null); // re-places anchored text after fonts load
  const writeTextRef = useRef(null); // writes a text object's text and styles to the doc
  const [fontsReady, setFontsReady] = useState(0);
  const activeSlideIdxRef = useRef(0);
  activeSlideIdxRef.current = activeSlideIdx;
  const snapRef = useRef(snapOn);
  snapRef.current = snapOn;
  const viewScaleRef = useRef(1); // on-screen pixels per slide pixel

  // AI Copilot sidebar: inline on wide screens, an overlay otherwise.
  const [copilotOpen, setCopilotOpen] = useState(false);
  const copilotOverlay = useMediaQuery('(max-width: 1399px)');
  const copilotBridge = useMemo(() => createEditorBridge({ fabricRef, yjsRef, undoRef, scaleRef }), []);

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
      const plain = slidesArr.toArray().map(slideMapToPlain);
      slidesRef.current = plain;
      setSlides(plain);
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
          const { tableScale, ...geometry } = blockGeometry(obj, scaleRef.current);
          if (tableScale && (Math.abs(tableScale.x - 1) > 0.001 || Math.abs(tableScale.y - 1) > 0.001)) {
            const table = scaledTable(blockMap.get('table'), tableScale.x, tableScale.y);
            blockMap.set('table', table);
            geometry.width = Math.round(table.columns.reduce((a, w) => a + w, 0) * 10) / 10;
          }
          Object.entries(geometry).forEach(([k, v]) => {
            if (v === null || v === undefined) blockMap.delete(k);
            else blockMap.set(k, v);
          });
          if (obj.type === 'textbox' && obj.data?.kind !== 'table') writeTextInto(blockMap, obj);
        });
      });
    }

    // Text and its mixed formatting travel together, so typing into a
    // bold word keeps it bold for collaborators too.
    function writeTextInto(blockMap, obj) {
      if (blockMap.get('text') !== obj.text) blockMap.set('text', obj.text);
      const styles = stylesOf(obj, scaleRef.current);
      const before = blockMap.get('styles');
      if (JSON.stringify(styles) !== JSON.stringify(before ?? null)) {
        if (styles) blockMap.set('styles', styles);
        else blockMap.delete('styles');
      }
    }

    function writeText(obj) {
      const doc = yjsRef.current?.doc;
      if (applyingRemoteRef.current || !doc || !obj?.data?.blockId) return;
      const blocksArr = getSlidesArray(doc).get(activeSlideIdxRef.current)?.get('blocks');
      const blockMap = blocksArr?.toArray().find((m) => m.get('id') === obj.data.blockId);
      if (blockMap) doc.transact(() => writeTextInto(blockMap, obj));
    }

    writeTextRef.current = writeText;

    // Web fonts arrive after first paint; re-measure text once they do so
    // line breaks match the font actually drawn.
    const relayout = () => {
      fabric.cache.clearFontCache();
      canvas.getObjects().forEach((o) => {
        if (o.type === 'textbox') {
          o.initDimensions();
          o.setCoords();
        }
      });
      relayoutRef.current?.();
      canvas.requestRenderAll();
    };
    document.fonts?.addEventListener?.('loadingdone', relayout);

    canvas.on('object:modified', (e) => {
      const target = e.target;
      if (!target) return;
      writeObjects(target.type === 'activeselection' ? target.getObjects() : [target]);
    });
    canvas.on('text:changed', (e) => writeText(e.target));
    canvas.on('text:editing:exited', (e) => writeText(e.target));

    const syncSelection = () => {
      if (quietSelectionRef.current) return;
      const ids = canvas.getActiveObjects().map((o) => o.data?.blockId).filter(Boolean);
      // Grouped elements select together.
      const blocks = slidesRef.current[activeSlideIdxRef.current]?.blocks || [];
      const all = expandToGroups(blocks, ids);
      if (all.length > ids.length && !canvas.getActiveObject()?.isEditing) {
        const objs = canvas.getObjects().filter((o) => all.includes(o.data?.blockId));
        canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
        canvas.requestRenderAll();
      }
      setSelectedIds(all);
      setSelection({});
    };
    canvas.on('selection:created', syncSelection);
    canvas.on('selection:updated', syncSelection);
    canvas.on('selection:cleared', syncSelection);

    // The formatting under the caret, so the format bar shows what
    // typing will produce.
    const syncCharStyle = (e) => {
      const t = e.target;
      if (!t?.isEditing) return;
      const start = t.selectionStart;
      const end = Math.max(start + 1, t.selectionEnd);
      const styles = t.getSelectionStyles(start === t.selectionEnd && start > 0 ? start - 1 : start, start === t.selectionEnd && start > 0 ? start : end);
      const out = {};
      if (styles.length) {
        for (const k of [...CHAR_STYLE_KEYS, 'deltaY']) {
          const v = styles[0][k];
          if (v !== undefined && styles.every((st) => st[k] === v)) out[k] = k === 'fontSize' ? v / scaleRef.current : v;
        }
      }
      setSelection(out);
    };
    canvas.on('text:selection:changed', syncCharStyle);
    canvas.on('text:editing:entered', syncCharStyle);

    // Smart guides: a dragged element snaps to the slide's and the other
    // elements' edges and centres. Hold Alt to move freely.
    let guides = [];
    const boxOf = (o) => {
      const r = o.getBoundingRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };
    canvas.on('object:moving', (e) => {
      const t = e.target;
      guides = [];
      if (!t || !snapRef.current || e.e?.altKey) return;
      // Fabric doesn't refresh an object's corners while it is dragged.
      t.setCoords();
      const moving = new Set(t.type === 'activeselection' ? t.getObjects() : [t]);
      const others = canvas.getObjects().filter((o) => o.data?.blockId && !moving.has(o) && o.visible !== false).map(boxOf);
      const frame = { left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
      const snap = snapBox(boxOf(t), others, frame, SNAP_THRESHOLD / (viewScaleRef.current || 1));
      if (snap.dx || snap.dy) {
        t.set({ left: t.left + snap.dx, top: t.top + snap.dy });
        t.setCoords();
      }
      guides = snap.guides;
    });
    const clearGuides = () => {
      if (!guides.length) return;
      guides = [];
      canvas.requestRenderAll();
    };
    canvas.on('mouse:up', clearGuides);
    canvas.on('after:render', ({ ctx }) => {
      if (!guides.length || !ctx) return;
      const r = canvas.getRetinaScaling();
      ctx.save();
      ctx.setTransform(r, 0, 0, r, 0, 0);
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = 1 / (viewScaleRef.current || 1);
      ctx.beginPath();
      for (const g of guides) {
        if (g.axis === 'x') { ctx.moveTo(g.at, g.from); ctx.lineTo(g.at, g.to); }
        else { ctx.moveTo(g.from, g.at); ctx.lineTo(g.to, g.at); }
      }
      ctx.stroke();
      ctx.restore();
    });

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

    return () => {
      document.fonts?.removeEventListener?.('loadingdone', relayout);
      canvas.dispose();
    };
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

    canvas.backgroundColor = slideBackgroundFill(slide, DEFAULT_SLIDE_BACKGROUND);
    if (slide.backgroundImageUrl) {
      if (canvas.backgroundImage?.data?.src !== slide.backgroundImageUrl) {
        const slideId = slide.id;
        fabric.FabricImage.fromURL(slide.backgroundImageUrl).then((img) => {
          if (renderedSlideIdRef.current !== slideId) return;
          if (slide.backgroundRepeat) {
            canvas.backgroundImage = undefined;
            canvas.backgroundColor = new fabric.Pattern({ source: img.getElement(), repeat: 'repeat' });
          } else {
            img.set({ ...BASE_OBJECT_PROPS, scaleX: CANVAS_WIDTH / img.width, scaleY: CANVAS_HEIGHT / img.height });
            img.data = { src: slide.backgroundImageUrl };
            canvas.backgroundImage = img;
          }
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
    // A rebuilt object (a table or chart after an edit) stays selected,
    // so the panel editing it doesn't close under the author.
    const replace = (oldObj, obj, blockId) => {
      const wasActive = !!oldObj && canvas.getActiveObject() === oldObj;
      quietSelectionRef.current = wasActive;
      if (oldObj) canvas.remove(oldObj);
      canvas.add(obj);
      placeAt(obj, blockId);
      if (wasActive) canvas.setActiveObject(obj);
      quietSelectionRef.current = false;
    };

    slide.blocks.forEach((block) => {
      let obj = existing.get(block.id);
      // Inside a multi-selection, positions are relative to the group;
      // leave geometry alone until the selection is released.
      const inGroup = !!obj?.group;

      if (block.type === 'image') {
        if (!block.imageUrl) return;
        if (obj && obj.data?.src === block.imageUrl) {
          if (!inGroup) placeImage(obj, block, scale);
          obj.setCoords();
          placeAt(obj, block.id);
          return;
        }
        const slideId = slide.id;
        fabric.FabricImage.fromURL(block.imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
          if (renderedSlideIdRef.current !== slideId) return;
          placeImage(img, block, scale);
          img.data = { blockId: block.id, src: block.imageUrl };
          applyingRemoteRef.current = true;
          replace(canvas.getObjects().find((o) => o.data?.blockId === block.id), img, block.id);
          applyingRemoteRef.current = false;
          canvas.requestRenderAll();
        }).catch(() => {});
        return;
      }

      if (block.type === 'shape') {
        if (obj && obj.data?.key === shapeKey(block)) {
          if (!inGroup) updateShape(obj, block, scale);
          obj.setCoords();
          placeAt(obj, block.id);
        } else if (!inGroup) {
          replace(obj, createShape(block, scale), block.id);
        }
        return;
      }

      if (block.type === 'table') {
        if (obj && obj.data?.key === tableKey(block)) {
          if (!inGroup) {
            obj.set({ scaleX: 1, scaleY: 1, angle: block.rotation || 0 });
            const w = obj.data.layoutWidth * scale;
            const h = obj.data.layoutHeight * scale;
            obj.setPositionByOrigin(new fabric.Point(block.x * scale + w / 2, block.y * scale + h / 2), 'center', 'center');
          }
          obj.setCoords();
          placeAt(obj, block.id);
        } else if (!inGroup) {
          replace(obj, createTable(block, scale), block.id);
        }
        return;
      }

      if (block.type === 'chart') {
        if (obj && obj.data?.key === chartKey(block)) {
          if (!inGroup) placeGroup(obj, block, scale);
          obj.setCoords();
          placeAt(obj, block.id);
        } else if (!inGroup) {
          replace(obj, createChart(block, scale), block.id);
        }
        return;
      }

      const props = textboxProps(block, scale);
      if (obj) {
        // Don't fight the user's own typing: Fabric already holds the
        // newest text (and its styles) for a block being edited right now.
        if (obj.isEditing) {
          delete props.text;
          delete props.styles;
        }
        if (inGroup) ['left', 'top', 'width', 'scaleX', 'scaleY', 'angle'].forEach((k) => delete props[k]);
        obj.set(props);
        if (!inGroup) placeText(obj, block, scale);
        obj.setCoords();
      } else {
        obj = new SlideTextbox(props.text, { ...props, editable: true, splitByGrapheme: false });
        obj.data = { blockId: block.id, kind: 'text' };
        placeText(obj, block, scale);
        canvas.add(obj);
      }
      placeAt(obj, block.id);
    });

    // Locks and keep-proportions settings, for every block on the slide.
    canvas.getObjects().forEach((o) => {
      const block = slide.blocks.find((b) => b.id === o.data?.blockId);
      if (block) applyInteraction(o, block, keepsAspect(block));
    });

    // Once web fonts land, text heights change: re-anchor text boxes.
    relayoutRef.current = () => {
      slide.blocks.forEach((block) => {
        const o = canvas.getObjects().find((x) => x.data?.blockId === block.id);
        if (o && o.type === 'textbox' && o.data?.kind === 'text' && !o.group) {
          placeText(o, block, scale);
          o.setCoords();
        }
      });
    };
    // Web fonts from the font menu are fetched on first use.
    slide.blocks.forEach((b) => {
      if (b.fontFamily) loadFont(b.fontFamily);
      (b.styles || []).forEach((r) => r.style?.fontFamily && loadFont(r.style.fontFamily));
    });
    const families = fontFamiliesOf(slide.blocks).filter((f) => !requestedFonts.has(f));
    if (families.length && document.fonts?.load) {
      families.forEach((f) => requestedFonts.add(f));
      const variants = ['400 16px', '700 16px', 'italic 400 16px', 'italic 700 16px'];
      Promise.all(families.flatMap((f) => variants.map((v) => document.fonts.load(`${v} "${f}"`).catch(() => null)))).then(() => {
        if (renderedSlideIdRef.current !== slide.id) return;
        fabric.cache.clearFontCache();
        canvas.getObjects().forEach((o) => o.type === 'textbox' && o.initDimensions());
        // Tables and charts measured with fallback fonts are rebuilt.
        canvas.getObjects().forEach((o) => {
          if (o.data?.kind === 'table' || o.data?.kind === 'chart') o.data.key = 'stale';
        });
        relayoutRef.current?.();
        canvas.requestRenderAll();
        setFontsReady((n) => n + 1);
      });
    }

    canvas.requestRenderAll();
    applyingRemoteRef.current = false;
  }, [slides, activeSlideIdx, fontsReady]);

  const activeSlide = slides[activeSlideIdx];
  const selectedBlocks = (activeSlide?.blocks || []).filter((b) => selectedIds.includes(b.id));
  const selectedText = selectedBlocks.filter((b) => (b.type || 'textbox') === 'textbox');
  const primary = selectedText[0];

  // --- Toolbar actions ---

  // Text formatting: applies to the characters selected while editing a
  // text box, otherwise to every selected text box as a whole.
  const formatSelected = useCallback((patch) => {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    const charLevel = Object.keys(patch).every((k) => CHAR_STYLE_KEYS.includes(k));
    if (active?.type === 'textbox' && active.isEditing && charLevel && active.selectionStart !== active.selectionEnd) {
      const s = scaleRef.current;
      active.setSelectionStyles(patch.fontSize ? { ...patch, fontSize: patch.fontSize * s } : patch);
      active.initDimensions();
      canvas.requestRenderAll();
      writeTextRef.current?.(active);
      return;
    }
    const ids = selectedText.map((b) => b.id);
    if (ids.length) formatBlocks(doc, activeSlideIdx, ids, patch);
  }, [selectedText, activeSlideIdx]);

  function handleShapeStyle(patch) {
    const doc = yjsRef.current?.doc;
    const ids = selectedBlocks.filter((b) => b.type === 'shape').map((b) => b.id);
    if (doc && ids.length) updateBlocks(doc, activeSlideIdx, ids, patch);
  }

  function toggleFormat(key, onValue, offValue) {
    if (!primary) return;
    const current = selection[key] ?? primary[key];
    const isOn = typeof onValue === 'boolean' ? !!current : current === onValue;
    formatSelected({ [key]: isOn ? offValue : onValue });
  }

  const doc = () => yjsRef.current?.doc;
  const theme = themeById(activeSlide?.theme);

  // Adds a block to the current slide and selects it once it is drawn.
  function insertBlock(block) {
    const d = doc();
    if (!d || !activeSlide) return;
    addBlock(d, activeSlideIdxRef.current, block);
    selectIds([block.id]);
  }

  // Selects blocks' objects, waiting a little for ones still being drawn
  // (pictures load asynchronously).
  function selectIds(ids, tries = 40) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const objs = canvas.getObjects().filter((o) => ids.includes(o.data?.blockId));
    if (objs.length < ids.length && tries > 0) {
      requestAnimationFrame(() => selectIds(ids, tries - 1));
      return;
    }
    if (!objs.length) return;
    canvas.discardActiveObject();
    canvas.setActiveObject(objs.length === 1 ? objs[0] : new fabric.ActiveSelection(objs, { canvas }));
    canvas.requestRenderAll();
    setSelectedIds(ids);
  }

  function handleInsertText(preset) {
    const width = preset.width || 400;
    const pos = centred(width, preset.fontSize * 1.4);
    const block = { id: newId('b'), type: 'textbox', ...pos, width, fontSize: preset.fontSize, text: preset.sample };
    for (const k of ['fontWeight', 'fontStyle', 'textAlign', 'lineHeight', 'role']) if (preset[k]) block[k] = preset[k];
    block.fill = preset.fill || (preset.role === 'title' ? theme?.title : theme?.text) || undefined;
    const font = preset.role === 'title' ? theme?.titleFont : theme?.bodyFont;
    if (font) block.fontFamily = font;
    insertBlock(block);
  }

  function handleInsertShape(preset) {
    const line = preset.shape === 'line';
    const w = line ? 240 : preset.id.startsWith('arrow') || preset.id === 'thinArrow' ? 220 : 180;
    const h = line ? 120 : preset.id.startsWith('arrow') || preset.id === 'thinArrow' ? 110 : 180;
    const block = { id: newId('b'), type: 'shape', ...shapeFields(preset), ...centred(w, h), width: w, height: h, fontSize: 16, text: '' };
    if (line) Object.assign(block, { stroke: theme?.accent || '#285c43', strokeWidth: 3 });
    else block.background = theme?.accent || '#347653';
    insertBlock(block);
  }

  function handleInsertTable(rows, cols) {
    const width = Math.min(840, cols * 140);
    const table = makeTable(rows, cols, { width });
    const { height } = tableSize(table);
    insertBlock({ id: newId('b'), type: 'table', ...centred(width, height), width, height, fontSize: 16, text: tableText(table), table });
  }

  function handleInsertChart(kind) {
    const chart = defaultChart(kind);
    if (theme) chart.textColor = theme.text;
    insertBlock({ id: newId('b'), type: 'chart', ...centred(560, 320), width: 560, height: 320, fontSize: 16, text: '', chart });
  }

  function handleInsertDivider() {
    insertBlock({ id: newId('b'), type: 'shape', shape: 'rect', ...centred(600, 3), width: 600, height: 3, background: theme?.accent || '#c9cec9', fontSize: 16, text: '' });
  }

  // A sticker, icon or emoji from Insert › Elements, in the middle of the slide.
  async function handleInsertAsset(asset, color) {
    const size = asset.kind === 'emoji' ? 120 : 160;
    const w = asset.kind === 'emoji' ? Math.round(size * 1.2) : size;
    const block = await assetToBlock(asset, { id: newId('b'), size, color, ...centred(w, size) });
    insertBlock(block);
  }

  // Pictures already in this presentation, newest slide last, each once.
  const deckImages = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const sl of slides) {
      for (const b of sl.blocks || []) {
        if (b.type !== 'image' || !b.imageUrl || seen.has(b.imageUrl)) continue;
        seen.add(b.imageUrl);
        out.push({ key: `${sl.id}:${b.id}`, url: b.imageUrl, alt: b.alt || '', width: b.width, height: b.height });
      }
    }
    return out.slice(-MAX_DECK_IMAGES);
  }, [slides]);

  function handleInsertDeckImage(img) {
    const ratio = img.width && img.height ? img.height / img.width : 0.75;
    const width = Math.min(360, img.width || 360);
    const height = Math.round(width * ratio);
    const block = { id: newId('b'), type: 'image', ...centred(width, height), width, height, fontSize: 16, text: '', imageUrl: img.url };
    if (img.alt) block.alt = img.alt;
    insertBlock(block);
  }

  function handleToggleSnap() {
    setSnapOn((on) => {
      try {
        localStorage.setItem(SNAP_KEY, on ? 'off' : 'on');
      } catch {
        // the setting just won't persist
      }
      return !on;
    });
  }

  function handleSlideFromLayout(layoutId) {
    const d = doc();
    const layout = layoutById(layoutId);
    if (!d || !layout) return;
    const at = activeSlideIdx + 1;
    insertSlide(d, at, slideFromLayout(layout, at, theme));
    setActiveSlideIdx(at);
  }

  function handleApplyLayout(layoutId) {
    const d = doc();
    const layout = layoutById(layoutId);
    if (!d || !layout || !activeSlide) return;
    fabricRef.current?.discardActiveObject();
    const { blocks, added, moved } = applyLayout(activeSlide, layout, theme);
    replaceSlideContent(d, activeSlideIdx, blocks, { layout: layout.id });
    toast.success?.(`${layout.name} layout applied${moved ? `: ${moved} element${moved === 1 ? '' : 's'} moved` : ''}${added ? `, ${added} placeholder${added === 1 ? '' : 's'} added` : ''}.`);
  }

  function handleApplyTheme(themeId, all) {
    const d = doc();
    const next = themeById(themeId);
    if (!d || !next) return;
    loadFont(next.titleFont);
    loadFont(next.bodyFont);
    fabricRef.current?.discardActiveObject();
    d.transact(() => {
      slides.forEach((sl, i) => {
        if (!all && i !== activeSlideIdx) return;
        const out = applyTheme(sl, next);
        replaceSlideContent(d, i, out.blocks, { backgroundColor: out.backgroundColor, backgroundGradient: out.backgroundGradient, theme: out.theme });
      });
    });
  }

  function handleSlidePatch(patch, idx = activeSlideIdx) {
    const d = doc();
    if (d) updateSlide(d, idx, patch);
  }

  // Patches every selected block (or the given ids).
  function handleBlockPatch(patch, ids = selectedIds) {
    const d = doc();
    if (d && ids.length) updateBlocks(d, activeSlideIdx, ids, patch);
  }

  function handleGeometry(patch) {
    if (selectedIds.length !== 1) return;
    const block = selectedBlocks[0];
    if (block?.locked) return;
    fabricRef.current?.discardActiveObject();
    handleBlockPatch(patch);
    requestAnimationFrame(() => selectIds([block.id]));
  }

  // Selected elements' boxes on the slide, measured on the canvas (a text
  // box's height comes from its text). Locked elements stay put.
  function measuredBoxes(ids) {
    const canvas = fabricRef.current;
    const s = scaleRef.current;
    const out = [];
    canvas?.getObjects().forEach((o) => {
      const id = o.data?.blockId;
      const block = activeSlide?.blocks.find((b) => b.id === id);
      if (!ids.includes(id) || !block || block.locked) return;
      if (block.rotation) {
        // A turned element aligns by the box around it as drawn.
        const r = o.getBoundingRect();
        out.push({ id, x: r.left / s, y: r.top / s, w: r.width / s, h: r.height / s, block });
        return;
      }
      // Otherwise by its own box (chart labels and table borders that
      // overhang it don't count); text boxes are as tall as their text.
      const kind = o.data?.kind;
      const h = kind === 'text' ? (block.verticalAlign && block.height ? block.height : (o.height * o.scaleY) / s)
        : kind === 'table' || kind === 'chart' ? o.data.layoutHeight : block.height || (o.height * o.scaleY) / s;
      const w = kind === 'table' ? o.data.layoutWidth : block.width;
      out.push({ id, x: block.x || 0, y: block.y || 0, w, h, block });
    });
    return out;
  }

  function moveTo(moves, boxes) {
    const d = doc();
    if (!d) return;
    const patches = {};
    for (const b of boxes) {
      const m = moves[b.id];
      if (!m) continue;
      patches[b.id] = { x: Math.round(((b.block.x || 0) + m.x - b.x) * 10) / 10, y: Math.round(((b.block.y || 0) + m.y - b.y) * 10) / 10 };
    }
    patchBlocks(d, activeSlideIdx, patches);
  }

  function withSelectionReleased(fn) {
    const ids = selectedIds;
    fabricRef.current?.discardActiveObject();
    fn(ids);
    requestAnimationFrame(() => selectIds(ids));
  }

  const handleAlign = (mode) => withSelectionReleased((ids) => {
    const boxes = measuredBoxes(ids);
    moveTo(alignBoxes(boxes, mode), boxes);
  });
  const handleDistribute = (axis) => withSelectionReleased((ids) => {
    const boxes = measuredBoxes(ids);
    moveTo(distributeBoxes(boxes, axis), boxes);
  });
  const handleNudge = useCallback((dx, dy) => {
    const canvas = fabricRef.current;
    if (!canvas || !selectedIds.length) return;
    const ids = selectedIds;
    canvas.discardActiveObject();
    const boxes = measuredBoxes(ids);
    moveTo(nudgeBoxes(boxes, dx, dy), boxes);
    requestAnimationFrame(() => selectIds(ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, activeSlideIdx, activeSlide]);

  function handleGroup() {
    if (selectedIds.length < 2) return;
    handleBlockPatch({ groupId: newId('g') });
  }
  function handleUngroup() {
    handleBlockPatch({ groupId: null });
  }
  function handleLock(locked) {
    handleBlockPatch({ locked: locked ? true : null });
  }

  // Paragraph edits (lists, indents) on the text box being edited or the
  // selected ones. Editing ends first so the text written is the latest.
  function editParagraphs(fn) {
    const d = doc();
    const canvas = fabricRef.current;
    if (!d || !selectedText.length) return;
    const active = canvas?.getActiveObject();
    let lines = null;
    if (active?.type === 'textbox' && active.isEditing) {
      lines = linesInSelection(active.text, active.selectionStart, active.selectionEnd);
      active.exitEditing();
    }
    const patches = {};
    for (const b of selectedText) {
      const fresh = getSlidesArray(d).get(activeSlideIdx)?.get('blocks').toArray().find((m) => m.get('id') === b.id);
      const text = fresh?.get('text') ?? b.text;
      const styles = fresh?.get('styles') ?? b.styles;
      const out = fn(text, styles, selectedText.length === 1 ? lines : null);
      patches[b.id] = { text: out.text, styles: out.styles };
    }
    patchBlocks(d, activeSlideIdx, patches);
  }
  const handleList = (kind) => editParagraphs((text, styles, lines) => toggleList(text, styles, kind, lines));
  const handleIndent = (delta) => editParagraphs((text, styles, lines) => indentLines(text, styles, delta, lines));

  function handleScript(which) {
    const canvas = fabricRef.current;
    const active = canvas?.getActiveObject();
    const targets = active?.type === 'textbox' && active.data?.kind === 'text' ? [active] : canvas?.getActiveObjects().filter((o) => o.type === 'textbox' && o.data?.kind === 'text') || [];
    for (const o of targets) {
      const ranged = o.isEditing && o.selectionStart !== o.selectionEnd;
      const start = ranged ? o.selectionStart : 0;
      const end = ranged ? o.selectionEnd : o.text.length;
      const on = which === 'super' ? selection.deltaY < 0 : selection.deltaY > 0;
      if (on) o.setSelectionStyles({ deltaY: 0, fontSize: o.fontSize }, start, end);
      else if (which === 'super') o.setSuperscript(start, end);
      else o.setSubscript(start, end);
      o.initDimensions();
      writeTextRef.current?.(o);
    }
    canvas?.requestRenderAll();
    setSelection((sel) => ({ ...sel, deltaY: which === 'super' ? (sel.deltaY < 0 ? 0 : -1) : sel.deltaY > 0 ? 0 : 1 }));
  }

  function handleClearFormat() {
    const active = fabricRef.current?.getActiveObject();
    if (active?.isEditing) active.exitEditing();
    const d = doc();
    if (d && selectedText.length) formatBlocks(d, activeSlideIdx, selectedText.map((b) => b.id), CLEAR_FORMAT_PATCH);
  }

  function handleTogglePainter() {
    if (painter) setPainter(null);
    else if (primary) setPainter(formatOf(primary));
  }

  // The format painter paints the next text box selected.
  useEffect(() => {
    if (!painter) return;
    const targets = selectedText.filter((b) => b.id !== painter.sourceId);
    if (!targets.length || !selectedIds.length) return;
    const d = yjsRef.current?.doc;
    if (d) formatBlocks(d, activeSlideIdx, targets.map((b) => b.id), paintPatch(painter));
    setPainter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  function handleShapeOrImageStyle(patch) {
    const ids = selectedBlocks.filter((b) => b.type === 'shape' || b.type === 'image').map((b) => b.id);
    handleBlockPatch(patch, ids);
  }

  function handleTableChange(table) {
    const block = selectedBlocks.find((b) => b.type === 'table');
    if (block) handleBlockPatch({ table, text: tableText(table) }, [block.id]);
  }
  function handleChartChange(chart) {
    const block = selectedBlocks.find((b) => b.type === 'chart');
    if (block) handleBlockPatch({ chart }, [block.id]);
  }
  function handleChartPatch(patch) {
    const block = selectedBlocks.find((b) => b.type === 'chart');
    if (block) handleChartChange(Object.entries(patch).reduce((c, [k, v]) => setChartField(c, k, v), block.chart));
  }

  function handleCrop(insets) {
    const block = selectedBlocks.find((b) => b.type === 'image');
    if (block) handleBlockPatch(cropPatch(block, insets), [block.id]);
  }
  function handleResetAspect() {
    const block = selectedBlocks.find((b) => b.type === 'image');
    const obj = fabricRef.current?.getObjects().find((o) => o.data?.blockId === block?.id);
    const el = obj?.getElement?.();
    if (block && el?.naturalWidth) handleBlockPatch(resetAspectPatch(block, { width: el.naturalWidth, height: el.naturalHeight }), [block.id]);
  }

  function openPanel(name) {
    setPanelOpen(true);
    setFocusSection({ name, at: Date.now() });
  }

  async function readCheckedImage(file) {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPEG or GIF image.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Images can be up to 1.5 MB. Try a smaller or compressed version.');
    return readImageFile(file);
  }

  async function handleReplaceImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const block = selectedBlocks.find((b) => b.type === 'image');
    if (!file || !block) return;
    try {
      handleBlockPatch(replaceImagePatch(block, await readCheckedImage(file)), [block.id]);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function addImageFile(file, at) {
    const d = doc();
    if (!d) return;
    try {
      const { dataUrl, width, height } = await readCheckedImage(file);
      const fit = Math.min(1, 640 / width, 360 / height);
      const w = Math.max(1, Math.round(width * fit));
      const h = Math.max(1, Math.round(height * fit));
      const pos = at ? { x: Math.round(Math.max(0, Math.min(CANVAS_WIDTH - w, at.x - w / 2))), y: Math.round(Math.max(0, Math.min(CANVAS_HEIGHT - h, at.y - h / 2))) } : centred(w, h);
      insertBlock({ id: newId('b'), type: 'image', ...pos, width: w, height: h, fontSize: 16, text: '', imageUrl: dataUrl });
    } catch (err) {
      toast.error(err.message);
    }
  }

  function onStageDragOver(e) {
    if (![...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) return;
    e.preventDefault();
    setDropActive(true);
  }
  function onStageDrop(e) {
    setDropActive(false);
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const rect = canvasElRef.current?.getBoundingClientRect();
    const at = rect ? { x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH, y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT } : null;
    addImageFile(file, at);
  }

  async function handleExportSlideImage(type) {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    try {
      // Images from other sites can't be read back from the canvas.
      const url = canvas.toDataURL({ format: type, quality: 0.92, multiplier: 2 });
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(deckMeta?.title || 'slide').replace(/[^\w\- ]+/g, '').trim() || 'slide'} - slide ${activeSlideIdx + 1}.${type === 'jpeg' ? 'jpg' : 'png'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error('This slide has a picture from another website, so it can’t be saved as an image. Export as PDF instead.');
    }
  }

  const handleDeleteSelected = useCallback(() => {
    const doc = yjsRef.current?.doc;
    // Locked elements survive Delete until they're unlocked.
    const ids = selectedIds.filter((id) => !activeSlide?.blocks.find((b) => b.id === id)?.locked);
    if (!doc || ids.length === 0) return;
    fabricRef.current?.discardActiveObject();
    deleteBlocks(doc, activeSlideIdx, ids);
    setSelectedIds([]);
  }, [selectedIds, activeSlideIdx, activeSlide]);

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
    updateSlide(doc, activeSlideIdx, { backgroundColor: color, backgroundGradient: null });
  }

  function handleNotesChange(e) {
    const doc = yjsRef.current?.doc;
    if (!doc) return;
    updateSlide(doc, activeSlideIdx, { notes: e.target.value });
  }

  function handleInsertImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) addImageFile(file);
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

  // --- Keyboard shortcuts (skipped while typing in a panel field)
  const keyRef = useRef(null);
  keyRef.current = { formatToggle: toggleFormat, list: handleList, indent: handleIndent, group: handleGroup, ungroup: handleUngroup, painter, setPainter, setDialog };
  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const k = keyRef.current;
      if (mod && key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }
      // Palette and shortcuts help, unless another dialog is open.
      if (mod && !e.altKey && (key === 'k' || key === '/') && !document.querySelector('.dialog-backdrop')) {
        e.preventDefault();
        k.setDialog(key === 'k' ? 'palette' : 'shortcuts');
        return;
      }
      const active = fabricRef.current?.getActiveObject();
      const editingText = active?.type === 'textbox' && active.isEditing && document.activeElement === active.hiddenTextarea;
      const textSelected = active?.type === 'textbox' && active.data?.kind === 'text';
      // Text shortcuts work while typing in a text box and on a selected one.
      if (mod && !e.shiftKey && !e.altKey && textSelected && (editingText || !isTypingInField()) && ['b', 'i', 'u'].includes(key)) {
        e.preventDefault();
        if (key === 'b') k.formatToggle('fontWeight', 'bold', 'normal');
        if (key === 'i') k.formatToggle('fontStyle', 'italic', 'normal');
        if (key === 'u') k.formatToggle('underline', true, false);
        return;
      }
      if (editingText && e.key === 'Tab' && LIST_PREFIX.test(active.text.split('\n')[linesInSelection(active.text, active.selectionStart, active.selectionStart)[0]] || '')) {
        // Tab in a list item indents it, as in a word processor.
        e.preventDefault();
        k.indent(e.shiftKey ? -1 : 1);
        return;
      }
      if (mod && e.shiftKey && (key === '7' || key === '8') && textSelected) {
        e.preventDefault();
        k.list(key === '7' ? 'number' : 'bullet');
        return;
      }
      if (isTypingInField()) return;
      if (e.key === 'Escape' && k.painter) {
        k.setPainter(null);
        return;
      }
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
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) k.ungroup();
        else k.group();
      } else if (!mod && e.key.startsWith('Arrow') && selectedIds.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        handleNudge(d[0], d[1]);
      } else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }
    }
    // Pasting a picture from the clipboard adds it to the slide.
    function onPaste(e) {
      if (isTypingInField()) return;
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      addImageRef.current?.(file);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [handleSave, handleUndo, handleRedo, handleDuplicateSelected, handleDeleteSelected, handleNudge, selectedIds.length]);
  const addImageRef = useRef(null);
  addImageRef.current = addImageFile;

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
  viewScaleRef.current = scale;

  let status;
  if (syncStatus === 'offline') status = { tone: 'warn', icon: CloudOff, label: 'Offline', detail: 'Reconnecting. Your edits sync when the connection is back.' };
  else if (syncStatus === 'connecting') status = { tone: 'muted', icon: null, label: 'Connecting…', detail: 'Connecting to the collaboration server' };
  else if (saving) status = { tone: 'muted', icon: null, label: 'Saving…', detail: 'Saving a snapshot' };
  else if (saveError) status = { tone: 'error', icon: AlertCircle, label: 'Save failed', detail: saveError };
  else if (savedAt) status = { tone: 'ok', icon: Check, label: `Saved ${formatTime(savedAt)}`, detail: 'Edits also sync live to everyone in this presentation' };
  else status = { tone: 'ok', icon: Check, label: 'Synced', detail: 'Edits sync live and are saved automatically' };
  const StatusIcon = status.icon;

  const exportItems = [
    ...Object.entries(EXPORT_FORMATS).map(([format, { label }]) => ({
      label, icon: Download, onSelect: () => handleExport(format), disabled: !!exporting
    })),
    'separator',
    { label: 'This slide as PNG', icon: ImageIcon, onSelect: () => handleExportSlideImage('png'), disabled: !activeSlide },
    { label: 'This slide as JPEG', icon: ImageIcon, onSelect: () => handleExportSlideImage('jpeg'), disabled: !activeSlide }
  ];
  const hasSlide = !!activeSlide;
  const some = selectedIds.length > 0;
  const many = selectedIds.length > 1;
  const insertTab = (tab) => () => setInsertRequest({ tab });
  const commands = [
    { id: 'insert-text', group: 'Insert', label: 'Insert text box', icon: Type, run: insertTab('text'), disabled: !hasSlide },
    { id: 'insert-elements', group: 'Insert', label: 'Insert sticker, icon or emoji', icon: Smile, keywords: 'elements emoji sticker icon decoration', run: insertTab('elements'), disabled: !hasSlide },
    { id: 'insert-shape', group: 'Insert', label: 'Insert shape', icon: Shapes, run: insertTab('shapes'), disabled: !hasSlide },
    { id: 'insert-table', group: 'Insert', label: 'Insert table', icon: Table2, run: insertTab('table'), disabled: !hasSlide },
    { id: 'insert-chart', group: 'Insert', label: 'Insert chart', icon: BarChart3, run: insertTab('chart'), disabled: !hasSlide },
    { id: 'insert-image', group: 'Insert', label: 'Upload a picture', icon: ImageIcon, keywords: 'image photo', run: () => imageInputRef.current?.click(), disabled: !hasSlide },
    { id: 'new-slide', group: 'Slides', label: 'New slide', icon: Plus, run: handleAddSlide },
    { id: 'new-slide-layout', group: 'Slides', label: 'New slide from a layout', icon: LayoutGrid, run: insertTab('slide') },
    { id: 'duplicate-slide', group: 'Slides', label: 'Duplicate slide', icon: Copy, run: () => handleDuplicateSlide(activeSlideIdx), disabled: !hasSlide },
    { id: 'hide-slide', group: 'Slides', label: activeSlide?.hidden ? 'Show slide' : 'Hide slide', icon: StickyNote, keywords: 'skip', run: () => handleSlidePatch({ hidden: activeSlide?.hidden ? null : true }), disabled: !hasSlide },
    ...LAYOUTS.map((l) => ({ id: `layout-${l.id}`, group: 'Layouts', label: `Layout: ${l.name}`, icon: LayoutGrid, run: () => handleApplyLayout(l.id), disabled: !hasSlide })),
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, group: 'Themes', label: `Theme: ${t.name} (all slides)`, icon: Palette, run: () => handleApplyTheme(t.id, true), disabled: !hasSlide })),
    { id: 'duplicate', group: 'Arrange', label: 'Duplicate selection', icon: Copy, keys: shortcutFor('duplicate'), run: handleDuplicateSelected, disabled: !some },
    { id: 'delete', group: 'Arrange', label: 'Delete selection', icon: Trash2, keys: shortcutFor('delete'), run: handleDeleteSelected, disabled: !some },
    { id: 'group', group: 'Arrange', label: 'Group', icon: Group, keys: shortcutFor('group'), run: handleGroup, disabled: !many },
    { id: 'ungroup', group: 'Arrange', label: 'Ungroup', icon: Ungroup, keys: shortcutFor('ungroup'), run: handleUngroup, disabled: !some },
    { id: 'align-left', group: 'Arrange', label: 'Align left', icon: AlignLeft, run: () => handleAlign('left'), disabled: !some },
    { id: 'align-center', group: 'Arrange', label: 'Align centre', icon: AlignCenter, keywords: 'center', run: () => handleAlign('centre'), disabled: !some },
    { id: 'align-right', group: 'Arrange', label: 'Align right', icon: AlignRight, run: () => handleAlign('right'), disabled: !some },
    { id: 'align-top', group: 'Arrange', label: 'Align top', icon: AlignStartVertical, run: () => handleAlign('top'), disabled: !some },
    { id: 'align-middle', group: 'Arrange', label: 'Align middle', icon: AlignCenterVertical, run: () => handleAlign('middle'), disabled: !some },
    { id: 'align-bottom', group: 'Arrange', label: 'Align bottom', icon: AlignEndVertical, run: () => handleAlign('bottom'), disabled: !some },
    { id: 'snap', group: 'View', label: snapOn ? 'Turn off snapping to guides' : 'Turn on snapping to guides', icon: Magnet, keywords: 'smart guides align', run: handleToggleSnap },
    { id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', icon: Keyboard, keys: shortcutFor('shortcuts'), run: () => setDialog('shortcuts') },
    { id: 'undo', group: 'Edit', label: 'Undo', icon: Undo2, keys: shortcutFor('undo'), run: handleUndo, disabled: !undoState.canUndo },
    { id: 'redo', group: 'Edit', label: 'Redo', icon: Redo2, keys: shortcutFor('redo'), run: handleRedo, disabled: !undoState.canRedo },
    { id: 'save', group: 'File', label: 'Save a snapshot', icon: Save, keys: shortcutFor('save'), run: handleSave },
    { id: 'template', group: 'File', label: 'Save as template', icon: LayoutTemplate, run: () => setDialog('template'), disabled: !deckMeta || slides.length === 0 },
    ...Object.entries(EXPORT_FORMATS).map(([format, { label }]) => ({ id: `export-${format}`, group: 'File', label: `Export as ${label}`, icon: Download, run: () => handleExport(format), disabled: !!exporting })),
    { id: 'present', group: 'File', label: 'Present', icon: Presentation, keywords: 'go live start', run: handleGoLive, disabled: goingLive || !deckMeta || slides.length === 0 }
  ];
  const moreItems = [
    { label: 'Command palette', icon: Command, shortcut: keyParts('Mod+K').join(' '), onSelect: () => setDialog('palette') },
    { label: 'Keyboard shortcuts', icon: Keyboard, shortcut: keyParts('Mod+/').join(' '), onSelect: () => setDialog('shortcuts') },
    'separator',
    { label: 'Snap to guides', icon: Magnet, checked: snapOn, onSelect: handleToggleSnap },
    'separator',
    { label: 'Save as template…', icon: LayoutTemplate, onSelect: () => setDialog('template'), disabled: !deckMeta || slides.length === 0 }
  ];
  const toolbarActions = {
    format: formatSelected,
    toggle: toggleFormat,
    list: handleList,
    indent: handleIndent,
    script: handleScript,
    clearFormat: handleClearFormat,
    togglePainter: handleTogglePainter,
    shapeStyle: handleShapeOrImageStyle,
    blockPatch: (patch) => handleBlockPatch(patch),
    chartPatch: handleChartPatch,
    replaceImage: () => replaceInputRef.current?.click(),
    openPanel,
    restack: handleRestack,
    align: handleAlign,
    distribute: handleDistribute,
    group: handleGroup,
    ungroup: handleUngroup,
    lock: handleLock,
    applyLayout: handleApplyLayout,
    applyTheme: handleApplyTheme,
    background: handleSlideBackground
  };
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
          <InsertMenu
            disabled={!activeSlide}
            onText={handleInsertText}
            onShape={handleInsertShape}
            onTable={handleInsertTable}
            onChart={handleInsertChart}
            onImage={() => imageInputRef.current?.click()}
            onDivider={handleInsertDivider}
            onSlide={handleSlideFromLayout}
            onAsset={handleInsertAsset}
            deckImages={deckImages}
            onDeckImage={handleInsertDeckImage}
            request={insertRequest}
          />
          <input ref={imageInputRef} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={handleInsertImage} />
          <input ref={replaceInputRef} type="file" accept={IMAGE_TYPES.join(',')} hidden onChange={handleReplaceImage} aria-label="Replacement picture" />

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
          <Menu label="More" icon={MoreHorizontal} items={moreItems} />
          <span className="ed-sep" aria-hidden="true" />
          <button
            type="button"
            className="icon-btn"
            aria-label={panelOpen ? 'Hide formatting panel' : 'Show formatting panel'}
            aria-pressed={panelOpen}
            data-tip="Format"
            onClick={() => {
              setPanelOpen((o) => !o);
              if (copilotOverlay) setCopilotOpen(false);
            }}
          >
            <PanelRight />
            {!panelOpen && selectedIds.length > 0 && <span className="ed-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm ed-copilot-toggle"
            aria-pressed={copilotOpen}
            aria-controls="ai-copilot"
            onClick={() => {
              setCopilotOpen((o) => !o);
              if (panelOverlay) setPanelOpen(false);
            }}
          >
            <Sparkles aria-hidden="true" /><span className="ed-hide-sm">Copilot</span>
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
        {(railOverlay && railOpen) || (panelOverlay && panelOpen) || (copilotOverlay && copilotOpen) ? (
          <div
            className="ed-scrim"
            aria-hidden="true"
            onClick={() => {
              if (railOverlay) setRailOpen(false);
              if (panelOverlay) setPanelOpen(false);
              if (copilotOverlay) setCopilotOpen(false);
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
            onRename={(i, name) => handleSlidePatch({ name: name || null }, i)}
            onToggleHidden={(i) => handleSlidePatch({ hidden: slides[i]?.hidden ? null : true }, i)}
          />
        </aside>

        <main className="ed-center" id="main">
          <ContextToolbar
            slide={activeSlide}
            selectedBlocks={selectedBlocks}
            primary={primary}
            selection={selection}
            actions={toolbarActions}
            painting={!!painter}
          />
          <div
            className={`ed-stage${dropActive ? ' is-drop' : ''}${painter ? ' is-painting' : ''}`}
            ref={stageRef}
            onDragOver={onStageDragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDropActive(false);
            }}
            onDrop={onStageDrop}
          >
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
            onShapeStyle={handleShapeStyle}
            onClose={panelOverlay ? () => setPanelOpen(false) : undefined}
            onGeometry={handleGeometry}
            onBlockPatch={(patch) => handleBlockPatch(patch)}
            onTableChange={handleTableChange}
            onChartChange={handleChartChange}
            onCrop={handleCrop}
            onReplaceImage={() => replaceInputRef.current?.click()}
            onResetAspect={handleResetAspect}
            onSlidePatch={(patch) => handleSlidePatch(patch)}
            onApplyLayout={handleApplyLayout}
            onApplyTheme={handleApplyTheme}
            onLock={handleLock}
            focusSection={focusSection}
          />
        </aside>

        {copilotOpen && (
          <aside id="ai-copilot" className={`ed-copilot${copilotOverlay ? ' is-overlay' : ''}`} aria-label="AI Copilot">
            <CopilotPanel
              deckId={deckId}
              deckTitle={deckMeta?.title || ''}
              slides={slides}
              activeSlideIdx={activeSlideIdx}
              selectedIds={selectedIds}
              bridge={copilotBridge}
              onSelectSlide={setActiveSlideIdx}
              onClose={() => setCopilotOpen(false)}
            />
          </aside>
        )}
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

      {dialog === 'palette' && <CommandPalette commands={commands} onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'template' && (
        <SaveTemplateDialog
          deckId={deckId}
          defaultName={deckMeta?.title}
          onClose={() => setDialog(null)}
          onSaved={(t) => {
            setDialog(null);
            toast.success(`Saved “${t.name}” to your templates`);
          }}
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
