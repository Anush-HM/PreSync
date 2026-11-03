import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { runCss } from '../../data/slideFormat.js';
import { ChartSvg, Runs, TableBlock } from '../SlideView.jsx';
import { CHART_FONT, chartSummary } from '../../data/chartLayout.js';
import './review.css';

// Read-only rendering of the Word document as PreSync parsed it: pages
// at the document's own size and margins, with its headers and footers,
// fonts, paragraph spacing, list markers and tables. Markers show where
// the suggested outline starts a new slide.

const DEFAULT_PAGE = { width: 816, height: 1056, margins: { top: 96, right: 96, bottom: 96, left: 96, header: 48, footer: 48 } };

function paragraphCss(layout = {}) {
  const css = {};
  if (layout.align) css.textAlign = layout.align === 'justify' ? 'justify' : layout.align;
  if (layout.spaceBefore) css.marginTop = layout.spaceBefore;
  if (layout.spaceAfter) css.marginBottom = layout.spaceAfter;
  if (layout.lineHeightPx) css.lineHeight = `${layout.lineHeightPx}px`;
  else if (layout.lineHeight) css.lineHeight = layout.lineHeight * 1.17;
  if (layout.indentLeft) css.paddingLeft = layout.indentLeft;
  if (layout.indentRight) css.paddingRight = layout.indentRight;
  if (layout.indentFirst) css.textIndent = layout.indentFirst;
  if (layout.background) css.background = layout.background;
  return css;
}

// Runs from the parser, with PAGE / NUMPAGES fields filled in.
function fieldRuns(runs, pageNo, pageCount) {
  return (runs || []).map((r) => {
    if (r.field === 'PAGE') return { ...r, text: String(pageNo) };
    if (r.field === 'NUMPAGES') return { ...r, text: String(pageCount) };
    return r;
  });
}

// Runs split at their tabs: each tab becomes a box that layoutTabs()
// sizes to reach the paragraph's next tab stop, and the text between
// tabs is wrapped so its width can be measured.
function TabbedRuns({ runs }) {
  if (!runs.some((r) => r.text.includes('\t'))) return <Runs runs={runs} scale={1} />;
  const segments = [[]];
  const tabs = [];
  for (const run of runs) {
    run.text.split('\t').forEach((part, i) => {
      if (i > 0) {
        tabs.push(run.style);
        segments.push([]);
      }
      if (part) segments[segments.length - 1].push({ ...run, text: part });
    });
  }
  return segments.map((seg, i) => (
    <span key={i}>
      {i > 0 && <span className="docp-tab" style={tabs[i - 1] ? runCss(tabs[i - 1]) : undefined} aria-hidden="true">{'\u00a0'}</span>}
      <span className="docp-seg"><Runs runs={seg} scale={1} /></span>
    </span>
  ));
}

const DEFAULT_TAB = 48; // Word's default stops: every half inch

// Sizes the tabs of a paragraph the way Word places text at tab stops:
// a left stop starts the text there, a right stop ends it there and a
// centre stop centres it. Stops count from the paragraph's left edge
// (the text column), in unscaled page px.
function layoutTabs(p, stops, scale) {
  const tabs = p.querySelectorAll('.docp-tab');
  if (!tabs.length) return;
  tabs.forEach((t) => { t.style.width = '0px'; });
  const left = p.getBoundingClientRect().left;
  tabs.forEach((tab) => {
    const at = tab.getBoundingClientRect();
    const x = (at.left - left) / scale;
    const seg = tab.nextElementSibling;
    const segRect = seg?.getBoundingClientRect();
    // Text that wraps onto another line has no width on this one.
    const sameLine = segRect && Math.abs((segRect.top + segRect.bottom) / 2 - (at.top + at.bottom) / 2) < segRect.height / 2;
    const textWidth = sameLine && seg.getClientRects().length <= 1 ? segRect.width / scale : 0;
    const stop = (stops || []).find((s) => s.pos > x + 1);
    let width = stop ? stop.pos - x : (Math.floor(x / DEFAULT_TAB) + 1) * DEFAULT_TAB - x;
    // A couple of px short of a right stop, so text ending on the margin doesn't wrap.
    if (stop && ['right', 'end', 'decimal'].includes(stop.type)) width -= textWidth + 2;
    else if (stop?.type === 'center') width -= textWidth / 2;
    tab.style.width = `${Math.max(1, width)}px`;
    tab.classList.toggle('has-leader', !!stop?.leader && stop.leader !== 'none');
  });
}

function Paragraph({ block, pageNo = 1, pageCount = 1, marker, className }) {
  const runs = block.runs?.length ? fieldRuns(block.runs, pageNo, pageCount) : [{ text: block.text || '', style: null }];
  const empty = runs.every((r) => !r.text);
  const hasTabs = runs.some((r) => r.text.includes('\t'));
  return (
    <p
      className={`${className}${block.layout ? '' : ' is-legacy'}${marker ? ' has-slide-marker' : ''}`}
      style={paragraphCss(block.layout)}
      data-tabs={hasTabs ? JSON.stringify(block.layout?.tabs || []) : undefined}
    >
      {marker}
      {empty ? '\u200b' : <TabbedRuns runs={runs} />}
    </p>
  );
}

function ListItem({ item }) {
  const left = item.indentLeft ?? 24 * (item.level + 1);
  const first = item.indentFirst ?? -24;
  const style = { ...paragraphCss(item.layout), paddingLeft: left, textIndent: 0, position: 'relative' };
  const firstStyle = item.runs?.[0]?.style;
  const markerBox = (
    <span
      className="doc-marker"
      aria-hidden="true"
      style={{ ...(firstStyle ? runCss(firstStyle) : null), left: Math.max(0, left + first), width: Math.max(12, -first) }}
    >
      {item.marker || (item.ordered ? '1.' : '•')}
    </span>
  );
  const runs = item.runs?.length ? item.runs : [{ text: item.text, style: null }];
  const hasTabs = runs.some((r) => r.text.includes('\t'));
  return (
    <p className={`doc-li${item.layout ? '' : ' is-legacy'}`} style={style} data-tabs={hasTabs ? JSON.stringify(item.layout?.tabs || []) : undefined}>
      {markerBox}
      <TabbedRuns runs={runs} />
    </p>
  );
}

function FlatTable({ rows }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>{row.map((cell, c) => (r === 0 ? <th key={c} scope="col">{cell}</th> : <td key={c}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Where a picture sits: in line (aligned), floated with text wrapping
// beside it, or free at an offset over the text, as it was in Word.
function Picture({ b, img }) {
  const size = img.widthPx ? { width: img.widthPx, aspectRatio: img.heightPx ? `${img.widthPx} / ${img.heightPx}` : undefined } : undefined;
  const picture = <img className="doc-img" src={img.dataUrl} alt="Picture from the document" style={size} />;
  const f = b.float;
  if (f?.wrap === 'square') return <div className={`docp-float is-${f.align === 'right' ? 'right' : 'left'}`}>{picture}</div>;
  if (f?.wrap === 'front') {
    return (
      <div className={`docp-free${f.behind ? ' is-behind' : ''}`}>
        <div className="docp-free-box" style={{ left: f.x || 0, top: f.y || 0 }}>{picture}</div>
      </div>
    );
  }
  const align = f?.align || b.layout?.align;
  return <p className="doc-img-wrap" style={align && align !== 'justify' ? { textAlign: align } : undefined}>{picture}</p>;
}

function Block({ b, imageById, slideStart }) {
  // Sits in the left margin, so it never moves or wraps the heading.
  const tag = slideStart ? <span className="doc-slide-marker mono" title="The suggested outline starts a new slide here">New slide</span> : null;
  switch (b.type) {
    case 'title':
      return <Paragraph block={b} className="docp-title" />;
    case 'subtitle':
      return <Paragraph block={b} className="doc-subtitle" />;
    case 'heading':
      return <Paragraph block={b} className={`doc-h doc-h${b.level}`} marker={tag} />;
    case 'paragraph':
      return <Paragraph block={b} className="doc-p" />;
    case 'list':
      return (
        <div className="doc-list">
          {b.items.map((item, i) => (
            <ListItem key={i} item={item} />
          ))}
        </div>
      );
    case 'table':
      return b.table ? (
        <div className="doc-table-wrap">
          <TableBlock b={b} s={1} flow />
        </div>
      ) : (
        <FlatTable rows={b.rows} />
      );
    case 'chart': {
      if (!b.chart) return null;
      const w = b.widthPx || 480;
      const h = b.heightPx || 288;
      return (
        <p className="doc-img-wrap">
          <svg className="doc-chart" role="img" aria-label={chartSummary(b.chart)} viewBox={`0 0 ${w} ${h}`} style={{ width: w, fontFamily: CHART_FONT }}>
            <ChartSvg chart={b.chart} width={w} height={h} />
          </svg>
        </p>
      );
    }
    case 'image': {
      const img = imageById.get(b.imageId);
      if (!img) return null;
      return <Picture b={b} img={img} />;
    }
    default:
      return null;
  }
}

// Splits blocks into pages: explicit page breaks always start a page, and
// a page also ends when the next block would overflow its text area
// (measured in the browser; without layout, e.g. in tests, only explicit
// breaks count).
function paginate(blocks, heights, contentHeight) {
  const pages = [[]];
  let used = 0;
  blocks.forEach((b, i) => {
    if (b.type === 'pageBreak') {
      pages.push([]);
      used = 0;
      return;
    }
    const h = heights[i] || 0;
    const page = pages[pages.length - 1];
    if (page.length && used + h > contentHeight) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(i);
    used += h;
  });
  return pages.filter((p, i) => p.length || i === 0);
}

function DocumentPreview({ blocks, images, headings, page, header, footer }) {
  const imageById = useMemo(() => new Map((images || []).map((i) => [i.id, i])), [images]);
  const slideStarts = useMemo(() => new Set((headings || []).filter((h) => h.startsSlide).map((h) => h.blockIndex)), [headings]);
  const size = page?.width ? page : DEFAULT_PAGE;
  const m = { ...DEFAULT_PAGE.margins, ...(size.margins || {}) };
  const contentHeight = size.height - m.top - m.bottom;

  const measureRef = useRef(null);
  const wrapRef = useRef(null);
  const [heights, setHeights] = useState([]);
  const [scale, setScale] = useState(1);

  // Text widths change once web fonts arrive: lay out again then.
  const [fontsLoaded, setFontsLoaded] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts) return undefined;
    let live = true;
    const bump = () => { if (live) setFontsLoaded((n) => n + 1); };
    fonts.ready?.then(bump);
    fonts.addEventListener?.('loadingdone', bump);
    return () => {
      live = false;
      fonts.removeEventListener?.('loadingdone', bump);
    };
  }, []);

  // Measure each block at the page's text width, including margins.
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const next = Array.from(root.children).map((el) => {
      const cs = window.getComputedStyle(el.firstElementChild || el);
      return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    });
    setHeights((prev) => (prev.length === next.length && prev.every((h, i) => h === next[i]) ? prev : next));
  }, [blocks, size.width, fontsLoaded]);

  // Fit the page to the panel width on narrow screens.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setScale(Math.min(1, (el.clientWidth || size.width) / size.width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width]);

  // Tab stops need the laid-out text, so they are sized after each render.
  useLayoutEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    for (const p of root.querySelectorAll('p[data-tabs]')) {
      let stops = [];
      try { stops = JSON.parse(p.dataset.tabs); } catch { /* default stops */ }
      layoutTabs(p, stops, p.closest('.doc-measure') ? 1 : scale);
    }
  });

  const pages = paginate(blocks, heights, contentHeight);
  const pageCount = pages.length;
  const textWidth = size.width - m.left - m.right;

  return (
    <div className="doc-pages" ref={wrapRef} aria-label="Document preview">
      <div className="doc-measure" ref={measureRef} aria-hidden="true" style={{ width: textWidth }}>
        {blocks.map((b, i) => (
          <div key={i} className="docp-block">
            <Block b={b} imageById={imageById} slideStart={slideStarts.has(i)} />
          </div>
        ))}
      </div>
      {pages.map((indices, p) => {
        // A single block taller than a page (a long table) grows its page
        // rather than being cut off.
        const used = indices.reduce((a, i) => a + (heights[i] || 0), 0);
        const pageHeight = Math.max(size.height, used + m.top + m.bottom);
        return (
          <div key={p} className="doc-page-slot" style={{ height: pageHeight * scale, width: size.width * scale }}>
            <article
              className="doc-paper"
              aria-label={`Page ${p + 1} of ${pageCount}`}
              style={{
                width: size.width,
                height: pageHeight,
                padding: `${m.top}px ${m.right}px ${m.bottom}px ${m.left}px`,
                transform: scale < 1 ? `scale(${scale})` : undefined
              }}
            >
              {header?.length ? (
                <header className="docp-header" style={{ top: m.header, left: m.left, right: m.right }}>
                  {header.map((para, i) => (
                    <Paragraph key={i} block={para} pageNo={p + 1} pageCount={pageCount} className="doc-p" />
                  ))}
                </header>
              ) : null}
              <div className="docp-flow-page">
                {indices.map((i) => (
                  <div key={i} className="docp-block">
                    <Block b={blocks[i]} imageById={imageById} slideStart={slideStarts.has(i)} />
                  </div>
                ))}
              </div>
              {footer?.length ? (
                <footer className="docp-footer" style={{ bottom: m.footer, left: m.left, right: m.right }}>
                  {footer.map((para, i) => (
                    <Paragraph key={i} block={para} pageNo={p + 1} pageCount={pageCount} className="doc-p" />
                  ))}
                </footer>
              ) : null}
            </article>
          </div>
        );
      })}
    </div>
  );
}

export default DocumentPreview;
