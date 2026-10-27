import { attr, child, children, find, num } from './ooxml.js';

// DrawingML shape geometry -> what the editor can draw. Simple presets
// map to native shapes (rect, rounded rect, ellipse, line); polygon
// presets and custom geometry become an SVG path in a 0–1000 box that
// renderers stretch over the block. Presets we don't know fall back to
// a rectangle and are reported as approximated.

const BOX = 1000;

function adjustments(prstGeom) {
  const out = {};
  for (const gd of children(child(prstGeom, 'a:avLst'), 'a:gd')) {
    const m = /^val\s+(-?\d+)/.exec(attr(gd, 'fmla') || '');
    if (m) out[attr(gd, 'name')] = Number(m[1]);
  }
  return out;
}

function poly(points) {
  return `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${Math.round(x * BOX)} ${Math.round(y * BOX)}`).join(' ')} Z`;
}

function regularStar(points, inner) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return poly(pts);
}

function regularPolygon(sides) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return poly(pts);
}

const LINE_PRESETS = new Set([
  'line', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5',
  'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5'
]);
const RECT_PRESETS = new Set(['rect', 'flowChartProcess', 'flowChartAlternateProcess', 'frame', 'snip1Rect', 'textBox']);
const ELLIPSE_PRESETS = new Set(['ellipse', 'flowChartConnector', 'donut', 'circle']);
const ROUND_PRESETS = new Set(['roundRect', 'round1Rect', 'round2SameRect', 'round2DiagRect', 'snipRoundRect', 'flowChartTerminator']);

// w, h: the shape's size in any unit (only the ratio matters).
export function presetShape(prstGeom, w, h) {
  const prst = attr(prstGeom, 'prst') || 'rect';
  const adj = adjustments(prstGeom);
  const ss = Math.min(w, h) || 1;
  const fx = (a) => Math.min(0.5, (ss * a) / 100000 / (w || 1)); // fraction of width
  const fy = (a) => Math.min(0.5, (ss * a) / 100000 / (h || 1)); // fraction of height

  if (RECT_PRESETS.has(prst)) return { shape: 'rect' };
  if (ELLIPSE_PRESETS.has(prst)) return { shape: 'ellipse' };
  if (LINE_PRESETS.has(prst)) return { shape: 'line' };
  if (ROUND_PRESETS.has(prst)) {
    const a = prst === 'flowChartTerminator' ? 50000 : adj.adj ?? adj.adj1 ?? 16667;
    return { shape: 'roundRect', radiusRatio: Math.min(0.5, a / 100000) };
  }

  switch (prst) {
    case 'triangle': {
      const a = (adj.adj ?? 50000) / 100000;
      return { shape: 'path', path: poly([[a, 0], [1, 1], [0, 1]]) };
    }
    case 'rtTriangle':
      return { shape: 'path', path: poly([[0, 0], [1, 1], [0, 1]]) };
    case 'diamond':
    case 'flowChartDecision':
      return { shape: 'path', path: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) };
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const o = fx(adj.adj ?? 25000);
      return { shape: 'path', path: poly([[o, 0], [1, 0], [1 - o, 1], [0, 1]]) };
    }
    case 'trapezoid': {
      const o = fx(adj.adj ?? 25000);
      return { shape: 'path', path: poly([[o, 0], [1 - o, 0], [1, 1], [0, 1]]) };
    }
    case 'pentagon':
      return { shape: 'path', path: regularPolygon(5) };
    case 'hexagon': {
      const o = fx(adj.adj ?? 25000);
      return { shape: 'path', path: poly([[o, 0], [1 - o, 0], [1, 0.5], [1 - o, 1], [o, 1], [0, 0.5]]) };
    }
    case 'heptagon':
      return { shape: 'path', path: regularPolygon(7) };
    case 'octagon': {
      const ox = fx(adj.adj ?? 29289);
      const oy = fy(adj.adj ?? 29289);
      return {
        shape: 'path',
        path: poly([[ox, 0], [1 - ox, 0], [1, oy], [1, 1 - oy], [1 - ox, 1], [ox, 1], [0, 1 - oy], [0, oy]])
      };
    }
    case 'homePlate': {
      const o = fx(adj.adj ?? 50000);
      return { shape: 'path', path: poly([[0, 0], [1 - o, 0], [1, 0.5], [1 - o, 1], [0, 1]]) };
    }
    case 'chevron': {
      const o = fx(adj.adj ?? 50000);
      return { shape: 'path', path: poly([[0, 0], [1 - o, 0], [1, 0.5], [1 - o, 1], [0, 1], [o, 0.5]]) };
    }
    case 'rightArrow':
    case 'leftArrow': {
      const t = (adj.adj1 ?? 50000) / 100000;
      const head = fx((adj.adj2 ?? 50000) * 2);
      const y0 = 0.5 - t / 2;
      const y1 = 0.5 + t / 2;
      const pts = [[0, y0], [1 - head, y0], [1 - head, 0], [1, 0.5], [1 - head, 1], [1 - head, y1], [0, y1]];
      return { shape: 'path', path: poly(prst === 'leftArrow' ? pts.map(([x, y]) => [1 - x, y]) : pts) };
    }
    case 'upArrow':
    case 'downArrow': {
      const t = (adj.adj1 ?? 50000) / 100000;
      const head = fy((adj.adj2 ?? 50000) * 2);
      const x0 = 0.5 - t / 2;
      const x1 = 0.5 + t / 2;
      const pts = [[x0, 1], [x0, head], [0, head], [0.5, 0], [1, head], [x1, head], [x1, 1]];
      return { shape: 'path', path: poly(prst === 'downArrow' ? pts.map(([x, y]) => [x, 1 - y]) : pts) };
    }
    case 'star4':
      return { shape: 'path', path: regularStar(4, 0.38) };
    case 'star5':
      return { shape: 'path', path: regularStar(5, 0.38) };
    case 'star6':
      return { shape: 'path', path: regularStar(6, 0.5) };
    case 'plus':
    case 'flowChartSummingJunction': {
      const ox = fx(adj.adj ?? 25000);
      const oy = fy(adj.adj ?? 25000);
      return {
        shape: 'path',
        path: poly([
          [ox, 0], [1 - ox, 0], [1 - ox, oy], [1, oy], [1, 1 - oy], [1 - ox, 1 - oy],
          [1 - ox, 1], [ox, 1], [ox, 1 - oy], [0, 1 - oy], [0, oy], [ox, oy]
        ])
      };
    }
    default:
      return { shape: 'rect', approximate: true, preset: prst };
  }
}

// Custom geometry (a:custGeom) -> one SVG path in the 0–1000 box.
export function customPath(custGeom) {
  const parts = [];
  for (const p of children(find(custGeom, 'a:pathLst'), 'a:path')) {
    const pw = num(p, 'w') || 1;
    const ph = num(p, 'h') || 1;
    const X = (v) => Math.round(((v || 0) / pw) * BOX);
    const Y = (v) => Math.round(((v || 0) / ph) * BOX);
    const pt = (node) => [num(node, 'x') || 0, num(node, 'y') || 0];
    let cur = [0, 0];
    for (const cmd of children(p)) {
      const pts = children(cmd, 'a:pt').map(pt);
      switch (cmd.nodeName) {
        case 'a:moveTo':
          cur = pts[0];
          parts.push(`M${X(cur[0])} ${Y(cur[1])}`);
          break;
        case 'a:lnTo':
          cur = pts[0];
          parts.push(`L${X(cur[0])} ${Y(cur[1])}`);
          break;
        case 'a:cubicBezTo':
          if (pts.length === 3) {
            parts.push(`C${pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join(' ')}`);
            cur = pts[2];
          }
          break;
        case 'a:quadBezTo':
          if (pts.length === 2) {
            parts.push(`Q${pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join(' ')}`);
            cur = pts[1];
          }
          break;
        case 'a:arcTo': {
          const wR = num(cmd, 'wR') || 0;
          const hR = num(cmd, 'hR') || 0;
          const st = ((num(cmd, 'stAng') || 0) / 60000) * (Math.PI / 180);
          const sw = ((num(cmd, 'swAng') || 0) / 60000) * (Math.PI / 180);
          const cx = cur[0] - wR * Math.cos(st);
          const cy = cur[1] - hR * Math.sin(st);
          const end = [cx + wR * Math.cos(st + sw), cy + hR * Math.sin(st + sw)];
          const large = Math.abs(sw) > Math.PI ? 1 : 0;
          const sweep = sw > 0 ? 1 : 0;
          const rx = Math.round((wR / pw) * BOX);
          const ry = Math.round((hR / ph) * BOX);
          parts.push(`A${rx} ${ry} 0 ${large} ${sweep} ${X(end[0])} ${Y(end[1])}`);
          cur = end;
          break;
        }
        case 'a:close':
          parts.push('Z');
          break;
        default:
          break;
      }
    }
  }
  return parts.length ? parts.join(' ') : null;
}
