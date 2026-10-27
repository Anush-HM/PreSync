import { useId } from 'react';
import {
  blockTextStyle,
  blockTransform,
  legacyFitScale,
  LIST_PREFIX,
  paragraphRuns,
  splitRuns,
  runCss,
  slideBackgroundStyle,
  styledRuns,
  textFormatCss
} from '../data/slideFormat.js';
import { CHART_FONT, chartLayout, chartSummary } from '../data/chartLayout.js';
import './SlideView.css';

// Read-only render of one slide, shared by the presenter and viewer
// pages (and thumbnails) so content looks the same everywhere it shows.

export function Runs({ runs, scale }) {
  return runs.map((run, i) =>
    run.style ? (
      <span key={i} style={runCss(run.style, scale)}>
        {run.text}
      </span>
    ) : (
      run.text
    )
  );
}

function RichText({ text, styles, scale }) {
  return <Runs runs={styledRuns(text, styles)} scale={scale} />;
}

// Text laid out paragraph by paragraph, matching the editor: list items
// hang their wrapped lines under the text, and paragraphs are spaced
// apart by the block's paragraphSpacing.
function Paragraphs({ block, scale }) {
  const hang = !block.textAlign || block.textAlign === 'left';
  return paragraphRuns(block.text, block.styles).map((runs, i) => {
    const style = i > 0 && block.paragraphSpacing ? { marginTop: block.paragraphSpacing * scale } : undefined;
    const plain = runs.map((r) => r.text).join('');
    const marker = hang && LIST_PREFIX.exec(plain);
    if (marker) {
      const [head, tail] = splitRuns(runs, Array.from(marker[0]).length);
      return (
        <div key={i} className="slide-para is-list" style={style}>
          <span className="slide-marker"><Runs runs={head} scale={scale} /></span>
          <span className="slide-para-text"><Runs runs={tail} scale={scale} /></span>
        </div>
      );
    }
    return (
      <div key={i} className="slide-para" style={style}>
        {runs.length ? <Runs runs={runs} scale={scale} /> : '\u200b'}
      </div>
    );
  });
}

function ShapeBlock({ b, s }) {
  const gid = `g${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const w = (b.width || 100) * s;
  const h = (b.height || 100) * s;
  const sw = (b.strokeWidth || 0) * s;
  const common = {
    fill: b.fillGradient?.stops?.length ? `url(#${gid})` : b.background || 'none',
    fillOpacity: b.opacity ?? 1,
    stroke: b.stroke || 'none',
    strokeWidth: b.stroke ? sw : 0,
    strokeDasharray: b.dash && b.stroke ? `${sw * 4} ${sw * 3}` : undefined
  };
  let shape;
  if (b.shape === 'ellipse') shape = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />;
  else if (b.shape === 'line') shape = <line x1={0} y1={0} x2={w} y2={h} {...common} fill="none" stroke={b.stroke || '#000000'} strokeWidth={Math.max(1, sw)} />;
  else if (b.shape === 'path' && b.path) {
    shape = (
      <svg x={0} y={0} width={w} height={h} viewBox="0 0 1000 1000" preserveAspectRatio="none" overflow="visible">
        <path d={b.path} {...common} vectorEffect="non-scaling-stroke" />
      </svg>
    );
  } else {
    const r = b.shape === 'roundRect' ? (b.radius || Math.min(w, h) * 0.17) * (b.radius ? s : 1) : 0;
    shape = <rect x={0} y={0} width={w} height={h} rx={r} ry={r} {...common} />;
  }
  return (
    <svg
      className="slide-shape"
      width={w}
      height={h}
      style={{ left: (b.x || 0) * s, top: (b.y || 0) * s, transform: blockTransform(b) }}
      aria-hidden="true"
    >
      {b.fillGradient?.stops?.length ? (
        <defs>
          <linearGradient
            id={gid}
            gradientTransform={`rotate(${((b.fillGradient.angle ?? 180) - 90 + 360) % 360} 0.5 0.5)`}
          >
            {b.fillGradient.stops.map((st, i) => (
              <stop key={i} offset={st.pos} stopColor={st.color} />
            ))}
          </linearGradient>
        </defs>
      ) : null}
      {shape}
    </svg>
  );
}

// A chart drawn from its data, from the same primitives the editor and
// the PDF export use.
export function ChartSvg({ chart, width, height }) {
  const items = chartLayout(chart, width, height);
  return items.map((it, i) => {
    switch (it.type) {
      case 'rect':
        return <rect key={i} x={it.x} y={it.y} width={Math.max(0, it.w)} height={Math.max(0, it.h)} fill={it.fill} />;
      case 'line':
        return <line key={i} x1={it.x1} y1={it.y1} x2={it.x2} y2={it.y2} stroke={it.stroke} strokeWidth={it.width} />;
      case 'poly': {
        const points = it.points.map((p) => p.join(',')).join(' ');
        return it.closed ? (
          <polygon key={i} points={points} fill={it.fill || 'none'} fillOpacity={it.opacity ?? 1} stroke={it.stroke || 'none'} />
        ) : (
          <polyline key={i} points={points} fill="none" stroke={it.stroke} strokeWidth={it.width} strokeLinejoin="round" />
        );
      }
      case 'path':
        return <path key={i} d={it.d} fill={it.fill} fillRule="evenodd" stroke={it.stroke || 'none'} strokeWidth={it.width || 0} />;
      case 'circle':
        return <circle key={i} cx={it.cx} cy={it.cy} r={it.r} fill={it.fill} />;
      case 'text':
        return (
          <text
            key={i}
            x={it.x}
            y={it.y}
            fontSize={it.size}
            fill={it.color}
            fontWeight={it.bold ? 700 : 400}
            textAnchor={it.anchor}
            dominantBaseline="central"
          >
            {it.text}
          </text>
        );
      default:
        return null;
    }
  });
}

function ChartBlock({ b, s }) {
  const w = b.width || 400;
  const h = b.height || 260;
  return (
    <svg
      className="slide-chart"
      role="img"
      aria-label={chartSummary(b.chart)}
      width={w * s}
      height={h * s}
      viewBox={`0 0 ${w} ${h}`}
      style={{ left: (b.x || 0) * s, top: (b.y || 0) * s, transform: blockTransform(b), fontFamily: CHART_FONT }}
    >
      <ChartSvg chart={b.chart} width={w} height={h} />
    </svg>
  );
}

function borderCss(border, s) {
  return border ? `${Math.max(1, border.width * s)}px solid ${border.color}` : 'none';
}

// `flow` renders the table in normal document flow (the Word preview)
// instead of positioned on a slide.
export function TableBlock({ b, s, flow = false }) {
  const table = b.table || { columns: [], rows: [] };
  const width = table.columns.reduce((a, w) => a + w, 0) * s;
  return (
    <table
      className={`slide-table${flow ? ' is-flow' : ''}`}
      style={flow ? { width } : { left: (b.x || 0) * s, top: (b.y || 0) * s, width, transform: blockTransform(b) }}
    >
      <colgroup>
        {table.columns.map((w, i) => (
          <col key={i} style={{ width: w * s }} />
        ))}
      </colgroup>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r} style={{ height: (row.height || 0) * s }}>
            {row.cells.map((cell, c) =>
              cell.covered ? null : (
                <td
                  key={c}
                  colSpan={cell.colspan || 1}
                  rowSpan={cell.rowspan || 1}
                  style={{
                    ...textFormatCss(cell, s),
                    background: cell.background || 'transparent',
                    verticalAlign: cell.verticalAlign === 'middle' ? 'middle' : cell.verticalAlign || 'top',
                    padding: (cell.padding || [4, 7, 4, 7]).map((p) => `${p * s}px`).join(' '),
                    borderTop: borderCss(cell.borders?.top, s),
                    borderRight: borderCss(cell.borders?.right, s),
                    borderBottom: borderCss(cell.borders?.bottom, s),
                    borderLeft: borderCss(cell.borders?.left, s)
                  }}
                >
                  <RichText text={cell.text} styles={cell.styles} scale={s} />
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SlideView({ slide }) {
  const blocks = slide.blocks || [];
  const s = legacyFitScale(blocks);

  return (
    <div className="stage-slide" style={slideBackgroundStyle(slide)}>
      {blocks.map((b) => {
        if (b.type === 'image' && b.imageUrl) {
          return (
            <img
              key={b.id}
              src={b.imageUrl}
              alt=""
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{
                position: 'absolute',
                left: (b.x || 0) * s,
                top: (b.y || 0) * s,
                width: (b.width || 300) * s,
                height: b.height ? b.height * s : 'auto',
                objectFit: 'fill',
                display: 'block',
                transform: blockTransform(b)
              }}
            />
          );
        }
        if (b.type === 'image') {
          // Image left out of a lightweight payload (e.g. a dashboard
          // thumbnail) or missing its source: keep its footprint visible.
          return (
            <div
              key={b.id}
              className="slide-image-placeholder"
              style={{
                left: (b.x || 0) * s,
                top: (b.y || 0) * s,
                width: (b.width || 300) * s,
                height: (b.height || 160) * s
              }}
            />
          );
        }
        if (b.type === 'shape') return <ShapeBlock key={b.id} b={b} s={s} />;
        if (b.type === 'table') return <TableBlock key={b.id} b={b} s={s} />;
        if (b.type === 'chart') return <ChartBlock key={b.id} b={b} s={s} />;
        return (
          <div key={b.id} className="slide-text" style={blockTextStyle(b, s)}>
            <div>
              <Paragraphs block={b} scale={s} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SlideView;
