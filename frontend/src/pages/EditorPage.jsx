import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fabric } from 'fabric';
import { MOCK_SLIDES } from '../data/mockData.js';
import { connectYjsDoc, getSlidesArray, slideMapToPlain, plainToSlideMap } from '../data/yjsClient.js';
import { goLive } from '../data/roomsApi.js';
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

function EditorPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();

  const [slides, setSlides] = useState([]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [goLiveError, setGoLiveError] = useState('');

  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const yjsRef = useRef(null); // { doc, awareness, disconnect }
  const blockMapsRef = useRef(new Map()); // blockId -> Y.Map, for the active slide only
  const applyingRemoteRef = useRef(false); // guards fabric -> Yjs -> fabric feedback loops

  // --- Connect Yjs, hydrate slides, observe remote changes ------------
  useEffect(() => {
    const yjs = connectYjsDoc(deckId);
    yjsRef.current = yjs;
    const slidesArr = getSlidesArray(yjs.doc);

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
      yjs.disconnect();
    };
  }, [deckId]);

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

  return (
    <div className="editor-page">
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          <button className="btn btn-ghost" onClick={() => navigate('/decks')}>← Decks</button>
          <span className="editor-deck-title">{deckId}</span>
        </div>
        {goLiveError && <span className="editor-golive-error">{goLiveError}</span>}
        <button className="btn btn-amber" onClick={handleGoLive}>Go Live</button>
      </header>

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