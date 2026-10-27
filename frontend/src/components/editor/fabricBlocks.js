import * as fabric from 'fabric';
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_FONT_FAMILY,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_COLOR,
  LIST_PREFIX
} from '../../data/slideFormat.js';

// Slide blocks <-> Fabric.js objects for the editor canvas. Building an
// object from a block, updating it in place, and reading its geometry
// back all live here so the three stay consistent.
//
// Geometry convention (shared with SlideView): x/y/width/height is the
// unrotated box; rotation turns it about its centre.

// Fabric 7 positions objects by their centre by default; blocks are
// stored by their top-left corner, so every object is pinned to that.
export const BASE_OBJECT_PROPS = { originX: 'left', originY: 'top', strokeWidth: 0 };

const PATH_BOX = 1000;

function rotate(dx, dy, deg) {
  const a = (deg * Math.PI) / 180;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

// Linear gradient for Fabric from { angle (CSS degrees), stops }.
export function fabricGradient(g, width, height) {
  if (!g?.stops?.length) return null;
  const a = ((g.angle ?? 180) * Math.PI) / 180;
  // CSS angles point "to" a direction: 0deg is upwards, 90deg rightwards.
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return new fabric.Gradient({
    type: 'linear',
    gradientUnits: 'pixels',
    coords: { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half },
    colorStops: g.stops.map((s) => ({ offset: Math.min(1, Math.max(0, s.pos || 0)), color: s.color }))
  });
}

export function slideBackgroundFill(slide, fallback) {
  return fabricGradient(slide.backgroundGradient, CANVAS_WIDTH, CANVAS_HEIGHT) || slide.backgroundColor || fallback;
}

// --- text ---------------------------------------------------------------

// Fabric's Textbox plus two things slide text needs and SlideView also
// draws: list paragraphs whose wrapped lines hang under the text rather
// than the bullet, and extra space between paragraphs.
export class SlideTextbox extends fabric.Textbox {
  static textLayoutProperties = [...fabric.Textbox.textLayoutProperties, 'paragraphSpacing'];

  // Width of the list marker on hard line `lineIndex`, or 0.
  _hangOf(lineIndex) {
    if (this.textAlign !== 'left') return 0;
    const line = this.__wrapLines?.[lineIndex];
    if (line === undefined) return 0;
    const m = LIST_PREFIX.exec(Array.isArray(line) ? line.join('') : line);
    if (!m) return 0;
    return this._measureWord(Array.from(m[0]), lineIndex, 0);
  }

  // Fabric's word wrap, with continuation lines narrowed by the hang.
  _wrapLine(lineIndex, desiredWidth, { largestWordWidth, wordsData }, reservedSpace = 0) {
    const hang = this._hangOf(lineIndex);
    if (!hang || this.splitByGrapheme) return super._wrapLine(lineIndex, desiredWidth, { largestWordWidth, wordsData }, reservedSpace);
    this.__hangs = this.__hangs || {};
    this.__hangs[lineIndex] = hang;
    const additionalSpace = this._getWidthOfCharSpacing();
    const graphemeLines = [];
    let lineWidth = 0;
    let line = [];
    let offset = 0;
    let infixWidth = 0;
    let lineJustStarted = true;
    const base = desiredWidth - reservedSpace;
    let maxWidth = Math.max(base, largestWordWidth, this.dynamicMinWidth);
    const data = wordsData[lineIndex];
    let i;
    for (i = 0; i < data.length; i++) {
      const { word, width: wordWidth } = data[i];
      offset += word.length;
      lineWidth += infixWidth + wordWidth - additionalSpace;
      if (lineWidth > maxWidth && !lineJustStarted) {
        graphemeLines.push(line);
        line = [];
        lineWidth = wordWidth;
        lineJustStarted = true;
        maxWidth = Math.max(base - hang, largestWordWidth);
      } else lineWidth += additionalSpace;
      if (!lineJustStarted) line.push(' ');
      line = line.concat(word);
      infixWidth = this._measureWord([' '], lineIndex, offset);
      offset++;
      lineJustStarted = false;
    }
    if (i) graphemeLines.push(line);
    if (largestWordWidth + reservedSpace > this.dynamicMinWidth) {
      this.dynamicMinWidth = largestWordWidth - additionalSpace + reservedSpace;
    }
    return graphemeLines;
  }

  _wrapText(lines, desiredWidth) {
    this.__hangs = {};
    this.__wrapLines = lines;
    return super._wrapText(lines, desiredWidth);
  }

  _getLineLeftOffset(lineIndex) {
    const base = super._getLineLeftOffset(lineIndex);
    const map = this._styleMap?.[lineIndex];
    if (!map || map.offset === 0) return base;
    return base + (this.__hangs?.[map.line] || 0);
  }

  getHeightOfLine(lineIndex) {
    const h = super.getHeightOfLine(lineIndex);
    if (!this.paragraphSpacing || lineIndex >= this._textLines.length - 1) return h;
    return this.isEndOfWrapping(lineIndex) ? h + this.paragraphSpacing : h;
  }
}

export function textboxProps(block, scale) {
  const text = block.text || '';
  const props = {
    ...BASE_OBJECT_PROPS,
    left: (block.x || 0) * scale,
    top: (block.y || 0) * scale,
    width: (block.width || 300) * scale,
    scaleX: 1,
    scaleY: 1,
    angle: block.rotation || 0,
    fontSize: (block.fontSize || 16) * scale,
    text,
    fill: block.fill || DEFAULT_TEXT_COLOR,
    fontFamily: block.fontFamily || DEFAULT_FONT_FAMILY,
    fontWeight: block.fontWeight || 'normal',
    fontStyle: block.fontStyle || 'normal',
    underline: !!block.underline,
    linethrough: !!block.linethrough,
    textAlign: block.textAlign || 'left',
    lineHeight: block.lineHeight || DEFAULT_LINE_HEIGHT,
    paragraphSpacing: (block.paragraphSpacing || 0) * scale,
    styles: fabric.util.stylesFromArray(scaleStyles(block.styles, scale) || [], text)
  };
  return props;
}

function scaleStyles(styles, scale) {
  if (!Array.isArray(styles) || scale === 1) return styles;
  return styles.map((r) => (r.style?.fontSize ? { ...r, style: { ...r.style, fontSize: r.style.fontSize * scale } } : r));
}

// Places a text object for its block once Fabric knows its height:
// anchors it in its box (verticalAlign) and turns it about the box's
// centre. Records what writeback needs on obj.data.
export function placeText(obj, block, scale) {
  const w = (block.width || 300) * scale;
  const textH = obj.height * (obj.scaleY || 1);
  const anchored = block.verticalAlign && block.verticalAlign !== 'top' && block.height;
  const boxH = anchored ? block.height * scale : textH;
  const offset = anchored ? (boxH - textH) * (block.verticalAlign === 'middle' ? 0.5 : 1) : 0;
  const angle = block.rotation || 0;
  const boxC = { x: (block.x || 0) * scale + w / 2, y: (block.y || 0) * scale + boxH / 2 };
  const d = rotate(0, offset + textH / 2 - boxH / 2, angle);
  obj.set({ angle });
  obj.setPositionByOrigin(new fabric.Point(boxC.x + d.x, boxC.y + d.y), 'center', 'center');
  obj.data = { ...(obj.data || {}), anchor: anchored ? { align: block.verticalAlign, height: block.height } : null };
}

// --- shapes ---------------------------------------------------------------

function shapePaint(block, w, h) {
  return {
    fill: fabricGradient(block.fillGradient, w, h) || block.background || 'transparent',
    opacity: 1,
    stroke: block.stroke || null,
    strokeWidth: block.stroke ? (block.strokeWidth || 1) : 0,
    strokeDashArray: block.dash && block.stroke ? [(block.strokeWidth || 1) * 4, (block.strokeWidth || 1) * 3] : null,
    strokeUniform: true
  };
}

function withAlpha(fill, opacity) {
  if (typeof fill !== 'string' || opacity === undefined || opacity >= 1 || !/^#[0-9a-f]{6}$/i.test(fill)) return fill;
  const n = parseInt(fill.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

export function shapeKey(block) {
  return `${block.shape || 'rect'}|${block.path || ''}`;
}

// A new Fabric object for a shape block.
export function createShape(block, scale) {
  const w = (block.width || 100) * scale;
  const h = (block.height || 100) * scale;
  let obj;
  if (block.shape === 'ellipse') obj = new fabric.Ellipse({ rx: w / 2, ry: h / 2 });
  else if (block.shape === 'rect' || block.shape === 'roundRect' || !block.shape) obj = new fabric.Rect({ width: w, height: h });
  else {
    // Paths are authored in a 0–1000 box; the leading moves pin Fabric's
    // bounds to that whole box so the path stretches over the block.
    const d = block.shape === 'line' ? 'M0 0 L1000 1000' : block.path || 'M0 0 H1000 V1000 H0 Z';
    obj = new fabric.Path(`M0 0 M${PATH_BOX} ${PATH_BOX} ${d}`, { objectCaching: false });
  }
  obj.data = { blockId: block.id, kind: 'shape', key: shapeKey(block) };
  updateShape(obj, block, scale);
  return obj;
}

export function updateShape(obj, block, scale) {
  const w = (block.width || 100) * scale;
  const h = (block.height || 100) * scale;
  const paint = shapePaint(block, w, h);
  paint.fill = withAlpha(paint.fill, block.opacity);
  const props = { ...BASE_OBJECT_PROPS, ...paint, flipX: !!block.flipH, flipY: !!block.flipV, angle: block.rotation || 0 };
  if (obj.type === 'ellipse') Object.assign(props, { rx: w / 2, ry: h / 2, scaleX: 1, scaleY: 1 });
  else if (obj.type === 'rect') {
    const r = block.shape === 'roundRect' ? (block.radius ?? Math.min(block.width, block.height) * 0.17) * scale : 0;
    Object.assign(props, { width: w, height: h, rx: r, ry: r, scaleX: 1, scaleY: 1 });
  } else {
    Object.assign(props, { scaleX: w / PATH_BOX, scaleY: h / PATH_BOX });
    if (block.shape === 'line') {
      props.fill = null;
      props.stroke = block.stroke || '#000000';
      props.strokeWidth = Math.max(1, block.strokeWidth || 1);
    }
  }
  obj.set(props);
  centre(obj, block, scale);
}

function centre(obj, block, scale) {
  const w = (block.width || 100) * scale;
  const h = (block.height || 100) * scale;
  obj.setPositionByOrigin(new fabric.Point((block.x || 0) * scale + w / 2, (block.y || 0) * scale + h / 2), 'center', 'center');
}

// --- images ---------------------------------------------------------------

export function placeImage(img, block, scale) {
  const width = (block.width || img.width) * scale;
  const height = block.height ? block.height * scale : (img.height * width) / img.width;
  img.set({
    ...BASE_OBJECT_PROPS,
    scaleX: width / img.width,
    scaleY: height / img.height,
    flipX: !!block.flipH,
    flipY: !!block.flipV,
    angle: block.rotation || 0
  });
  img.setPositionByOrigin(
    new fabric.Point((block.x || 0) * scale + width / 2, (block.y || 0) * scale + height / 2),
    'center',
    'center'
  );
}

// --- tables -----------------------------------------------------------------

export function tableKey(block) {
  return JSON.stringify([block.table, block.width, block.height]);
}

function cellTextbox(cell, width, scale) {
  const text = cell.text || '';
  return new SlideTextbox(text, {
    ...BASE_OBJECT_PROPS,
    width: Math.max(4, width),
    paragraphSpacing: (cell.paragraphSpacing || 0) * scale,
    fontSize: (cell.fontSize || 16) * scale,
    fill: cell.fill || DEFAULT_TEXT_COLOR,
    fontFamily: cell.fontFamily || DEFAULT_FONT_FAMILY,
    fontWeight: cell.fontWeight || 'normal',
    fontStyle: cell.fontStyle || 'normal',
    underline: !!cell.underline,
    linethrough: !!cell.linethrough,
    textAlign: cell.textAlign || 'left',
    lineHeight: cell.lineHeight || DEFAULT_LINE_HEIGHT,
    styles: fabric.util.stylesFromArray(scaleStyles(cell.styles, scale) || [], text),
    editable: false,
    selectable: false,
    evented: false
  });
}

// Lays out a table block: row heights grow to fit their text, merged
// cells span their rows and columns. Returns a Fabric group.
export function createTable(block, scale) {
  const table = block.table || { columns: [], rows: [] };
  const cols = table.columns.map((w) => w * scale);
  const colX = cols.reduce((acc, w, i) => [...acc, acc[i] + w], [0]);
  const rows = table.rows;
  const heights = rows.map((r) => (r.height || 0) * scale);
  const pad = (cell) => (cell.padding || [4, 7, 4, 7]).map((p) => p * scale);
  const spanWidth = (c, span) => colX[Math.min(cols.length, c + span)] - colX[c];

  // Text first, so rows can grow before anything is placed.
  const texts = rows.map((row) =>
    row.cells.map((cell, c) => {
      if (cell.covered) return null;
      const [pt, pr, pb, pl] = pad(cell);
      const tb = cellTextbox(cell, spanWidth(c, cell.colspan || 1) - pl - pr, scale);
      if ((cell.rowspan || 1) === 1) heights[rows.indexOf(row)] = Math.max(heights[rows.indexOf(row)], tb.height + pt + pb);
      return tb;
    })
  );
  const rowY = heights.reduce((acc, h, i) => [...acc, acc[i] + h], [0]);

  const objects = [];
  const borders = [];
  rows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      if (cell.covered) return;
      const x = colX[c];
      const y = rowY[r];
      const w = spanWidth(c, cell.colspan || 1);
      const h = rowY[Math.min(rows.length, r + (cell.rowspan || 1))] - y;
      if (cell.background) {
        objects.push(new fabric.Rect({ ...BASE_OBJECT_PROPS, left: x, top: y, width: w, height: h, fill: cell.background, selectable: false, evented: false }));
      }
      const tb = texts[r][c];
      const [pt, , pb, pl] = pad(cell);
      const free = h - pt - pb - tb.height;
      const dy = cell.verticalAlign === 'middle' ? free / 2 : cell.verticalAlign === 'bottom' ? free : 0;
      tb.set({ left: x + pl, top: y + pt + Math.max(0, dy) });
      objects.push(tb);
      const b = cell.borders || {};
      const line = (x1, y1, x2, y2, border) =>
        border &&
        borders.push(
          new fabric.Line([x1, y1, x2, y2], {
            stroke: border.color,
            strokeWidth: Math.max(1, border.width * scale),
            selectable: false,
            evented: false,
            originX: 'center',
            originY: 'center'
          })
        );
      line(x, y, x + w, y, b.top);
      line(x, y + h, x + w, y + h, b.bottom);
      line(x, y, x, y + h, b.left);
      line(x + w, y, x + w, y + h, b.right);
    });
  });

  const group = new fabric.Group([...objects, ...borders], {
    ...BASE_OBJECT_PROPS,
    subTargetCheck: false,
    interactive: false,
    objectCaching: true
  });
  group.data = {
    blockId: block.id,
    kind: 'table',
    key: tableKey(block),
    layoutWidth: colX[colX.length - 1] / scale,
    layoutHeight: rowY[rowY.length - 1] / scale
  };
  const gw = colX[colX.length - 1];
  const gh = rowY[rowY.length - 1];
  group.set({ angle: block.rotation || 0 });
  group.setPositionByOrigin(new fabric.Point((block.x || 0) * scale + gw / 2, (block.y || 0) * scale + gh / 2), 'center', 'center');
  return group;
}

// Resizing a table on the canvas scales its columns and minimum row
// heights; text keeps its size and rows re-fit around it.
export function scaledTable(table, sx, sy) {
  return {
    ...table,
    columns: table.columns.map((w) => Math.round(w * sx * 10) / 10),
    rows: table.rows.map((r) => ({ ...r, height: Math.round((r.height || 0) * sy * 10) / 10 }))
  };
}

// --- writeback ---------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

// Reads an object's geometry back into slide coordinates (unrotated box
// plus rotation). Works for objects inside a multi-selection too.
export function blockGeometry(obj, scale) {
  const scaling = obj.getObjectScaling();
  const sx = Math.abs(scaling.x);
  const sy = Math.abs(scaling.y);
  const angle = Math.round((((obj.getTotalAngle ? obj.getTotalAngle() : obj.angle) % 360) + 360) % 360 * 10) / 10;
  const c = obj.getCenterPoint();
  const geometry = { rotation: angle || null };
  const kind = obj.data?.kind;

  if (obj.type === 'textbox' && kind !== 'table') {
    const w = obj.width * sx;
    const textH = obj.height * sy;
    const anchor = obj.data?.anchor;
    const boxH = anchor ? anchor.height * scale : textH;
    const offset = anchor ? (boxH - textH) * (anchor.align === 'middle' ? 0.5 : 1) : 0;
    const d = rotate(0, offset + textH / 2 - boxH / 2, angle);
    const boxC = { x: c.x - d.x, y: c.y - d.y };
    geometry.x = round1((boxC.x - w / 2) / scale);
    geometry.y = round1((boxC.y - boxH / 2) / scale);
    geometry.width = round1(w / scale);
    geometry.fontSize = Math.max(4, round1((obj.fontSize * sy) / scale));
    return geometry;
  }

  let w;
  let h;
  if (kind === 'table') {
    // The group's own bounds include half of each outer border line.
    w = obj.data.layoutWidth * scale * sx;
    h = obj.data.layoutHeight * scale * sy;
    geometry.tableScale = { x: sx, y: sy };
  } else if (obj.type === 'ellipse') {
    w = obj.rx * 2 * sx;
    h = obj.ry * 2 * sy;
  } else if (obj.type === 'path') {
    w = PATH_BOX * sx;
    h = PATH_BOX * sy;
  } else {
    w = obj.width * sx;
    h = obj.height * sy;
  }
  if (kind === 'shape' && obj.strokeWidth && !obj.strokeUniform && obj.type !== 'path') {
    // Non-uniform strokes are part of the box; strip them back out.
    w -= obj.strokeWidth * sx;
    h -= obj.strokeWidth * sy;
  }
  geometry.x = round1((c.x - w / 2) / scale);
  geometry.y = round1((c.y - h / 2) / scale);
  geometry.width = round1(w / scale);
  geometry.height = round1(h / scale);
  return geometry;
}

// Fabric's per-character styles, as stored on blocks.
export function stylesOf(obj, scale = 1) {
  const arr = fabric.util.stylesToArray(obj.styles || {}, obj.text || '');
  if (!arr.length) return null;
  return scale === 1 ? arr : scaleStyles(arr, 1 / scale);
}

// Fonts named in blocks (every family of each stack), so the editor can
// wait for web fonts before measuring text.
export function fontFamiliesOf(blocks) {
  const families = new Set();
  const add = (stack) =>
    (stack || '')
      .split(',')
      .map((f) => f.replace(/["']/g, '').trim())
      .filter((f) => f && !['serif', 'sans-serif', 'monospace'].includes(f))
      .forEach((f) => families.add(f));
  for (const b of blocks || []) {
    add(b.fontFamily);
    (b.styles || []).forEach((r) => add(r.style?.fontFamily));
    (b.table?.rows || []).forEach((row) => row.cells.forEach((cell) => {
      add(cell.fontFamily);
      (cell.styles || []).forEach((r) => add(r.style?.fontFamily));
    }));
  }
  return [...families];
}
