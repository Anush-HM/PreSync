import { attr, child, children, find, num, readXml } from './ooxml.js';
import { colorFrom, fillFrom, lineFrom, representativeColor } from './drawingml.js';
import { MAX_CHART_POINTS, MAX_CHART_SERIES, sanitizeChart } from './chartLayout.js';

// Reads a DrawingML chart part (ppt/charts/chartN.xml, or a Word
// document's word/charts/chartN.xml) into the chart block model of
// chartLayout.js: kind, series and their cached values, categories,
// colours, title, legend and labels. Charts keep their numbers, so they
// redraw sharply everywhere and stay editable; 3-D, trendlines, error
// bars and secondary axes are simplified and reported.

const KIND_OF = {
  'c:barChart': 'column',
  'c:bar3DChart': 'column',
  'c:lineChart': 'line',
  'c:line3DChart': 'line',
  'c:stockChart': 'line',
  'c:radarChart': 'line',
  'c:areaChart': 'area',
  'c:area3DChart': 'area',
  'c:pieChart': 'pie',
  'c:pie3DChart': 'pie',
  'c:ofPieChart': 'pie',
  'c:doughnutChart': 'doughnut',
  'c:scatterChart': 'scatter',
  'c:bubbleChart': 'scatter'
};
const SIMPLIFIED = new Set(['c:bar3DChart', 'c:line3DChart', 'c:area3DChart', 'c:pie3DChart', 'c:ofPieChart', 'c:stockChart', 'c:radarChart', 'c:bubbleChart', 'c:surfaceChart', 'c:surface3DChart']);
const LEGEND_POS = { r: 'right', tr: 'right', l: 'right', b: 'bottom', t: 'top' };

function textOf(node) {
  const out = [];
  (function walk(n) {
    for (const c of children(n)) {
      if (c.nodeName === 'a:t' || c.nodeName === 'c:v') out.push(c.textContent);
      else walk(c);
    }
  })(node);
  return out.join('').trim();
}

// Cached points of a strRef/numRef/strLit/numLit/multiLvlStrRef, by index.
function cachedPoints(ref) {
  if (!ref) return { points: [], format: null };
  const cache =
    find(ref, 'c:numRef', 'c:numCache') || find(ref, 'c:strRef', 'c:strCache') ||
    child(ref, 'c:numLit') || child(ref, 'c:strLit') ||
    // Multi-level categories: the innermost level names each point.
    child(find(ref, 'c:multiLvlStrRef', 'c:multiLvlStrCache'), 'c:lvl');
  if (!cache) return { points: [], format: null };
  const count = Math.min(MAX_CHART_POINTS, num(child(cache, 'c:ptCount'), 'val') ?? 0);
  const points = Array(count).fill(null);
  for (const pt of children(cache, 'c:pt')) {
    const idx = num(pt, 'idx');
    if (idx === null || idx >= MAX_CHART_POINTS) continue;
    if (idx >= points.length) points.length = idx + 1;
    points[idx] = child(pt, 'c:v')?.textContent ?? null;
  }
  return { points, format: child(cache, 'c:formatCode')?.textContent || null };
}

function numbers(points) {
  return points.map((p) => {
    if (p === null || p === '') return null;
    const v = Number(p);
    return Number.isFinite(v) ? v : null;
  });
}

function seriesFill(ser, theme, kind) {
  const spPr = child(ser, 'c:spPr');
  if (!spPr) return null;
  if (kind === 'line' || kind === 'scatter') {
    const line = lineFrom(child(spPr, 'a:ln'), theme);
    if (line?.color) return line.color;
  }
  return representativeColor(fillFrom(spPr, theme)) || lineFrom(child(spPr, 'a:ln'), theme)?.color || null;
}

function accent(theme, i) {
  const c = theme?.colors?.[`accent${(i % 6) + 1}`];
  return c || null;
}

// `fontPx(pt)` converts the chart's text size to canvas pixels.
export async function readChart(zip, target, { theme, fontPx = (pt) => pt * 1.333 } = {}) {
  const root = target && (await readXml(zip, target));
  const chartEl = root && child(root, 'c:chart');
  const plot = chartEl && child(chartEl, 'c:plotArea');
  if (!plot) return null;
  const groups = children(plot).filter((c) => /Chart$/.test(c.nodeName));
  if (!groups.length) return null;
  const notes = new Set();
  const first = groups[0];
  let kind = KIND_OF[first.nodeName];
  if (!kind) return null;
  if (first.nodeName.startsWith('c:bar') && attr(child(first, 'c:barDir'), 'val') === 'bar') kind = 'bar';
  groups.forEach((g) => SIMPLIFIED.has(g.nodeName) && notes.add('simplified'));
  if (groups.length > 1) notes.add('combo');
  const grouping = attr(child(first, 'c:grouping'), 'val');

  const series = [];
  let categories = [];
  let percentFormat = false;
  let dataLabels = attr(find(first, 'c:dLbls', 'c:showVal'), 'val') === '1' || attr(find(first, 'c:dLbls', 'c:showPercent'), 'val') === '1';
  for (const group of groups) {
    const gKind = KIND_OF[group.nodeName] || kind;
    const sers = children(group, 'c:ser').sort((a, b) => (num(child(a, 'c:order'), 'val') ?? 0) - (num(child(b, 'c:order'), 'val') ?? 0));
    for (const ser of sers) {
      if (series.length >= MAX_CHART_SERIES) {
        notes.add('truncated');
        break;
      }
      if (child(ser, 'c:trendline') || child(ser, 'c:errBars')) notes.add('simplified');
      const name = textOf(child(ser, 'c:tx'));
      const isScatter = gKind === 'scatter';
      const valRef = isScatter ? child(ser, 'c:yVal') : child(ser, 'c:val');
      const { points, format } = cachedPoints(valRef);
      if (format && /%/.test(format)) percentFormat = true;
      const s = { name, values: numbers(points) };
      if (isScatter) {
        s.xValues = numbers(cachedPoints(child(ser, 'c:xVal')).points);
      } else if (!categories.length) {
        categories = cachedPoints(child(ser, 'c:cat')).points.map((c) => (c === null ? '' : String(c)));
      }
      const color = seriesFill(ser, theme, gKind) || accent(theme, series.length);
      if (color) s.color = color;
      const dPts = children(ser, 'c:dPt');
      if (kind === 'pie' || kind === 'doughnut') {
        const n = s.values.length;
        const varied = attr(child(group, 'c:varyColors'), 'val') !== '0';
        s.pointColors = Array.from({ length: n }, (_, i) => (varied ? accent(theme, i) : s.color || null));
        for (const d of dPts) {
          const idx = num(child(d, 'c:idx'), 'val');
          const c = representativeColor(fillFrom(child(d, 'c:spPr'), theme));
          if (idx !== null && idx < n && c) s.pointColors[idx] = c;
        }
      }
      if (attr(find(ser, 'c:dLbls', 'c:showVal'), 'val') === '1' || attr(find(ser, 'c:dLbls', 'c:showPercent'), 'val') === '1') dataLabels = true;
      series.push(s);
    }
  }
  if (!series.length) return null;
  if (!categories.length) categories = series[0].values.map((_, i) => String(i + 1));

  // Titles: an explicit one, or (as Office does) the only series' name.
  const titleEl = child(chartEl, 'c:title');
  let title = titleEl ? textOf(child(titleEl, 'c:tx')) : '';
  const autoDeleted = attr(child(chartEl, 'c:autoTitleDeleted'), 'val') === '1';
  if (!title && !autoDeleted && series.length === 1 && (titleEl || kind !== 'pie')) title = series[0].name || '';

  const legendEl = child(chartEl, 'c:legend');
  const legend = legendEl ? LEGEND_POS[attr(child(legendEl, 'c:legendPos'), 'val')] || 'right' : 'none';

  // Shared text formatting from the chart's text properties.
  const defRPr = find(root, 'c:txPr', 'a:p', 'a:pPr', 'a:defRPr');
  const chart = {
    kind,
    grouping: grouping === 'stacked' || grouping === 'percentStacked' ? grouping : 'clustered',
    title,
    categories,
    series,
    legend,
    dataLabels
  };
  if (percentFormat) chart.numberFormat = 'percent';
  const sz = num(defRPr, 'sz');
  if (sz) chart.fontSize = Math.round(fontPx(sz / 100) * 10) / 10;
  const textColor = colorFrom(child(defRPr, 'a:solidFill'), theme);
  if (textColor) chart.textColor = textColor;
  const valAx = child(plot, 'c:valAx');
  const min = num(find(valAx, 'c:scaling', 'c:min'), 'val');
  const max = num(find(valAx, 'c:scaling', 'c:max'), 'val');
  if (Number.isFinite(min)) chart.min = min;
  if (Number.isFinite(max)) chart.max = max;
  const gridLine = lineFrom(find(valAx, 'c:majorGridlines', 'c:spPr', 'a:ln'), theme);
  if (gridLine?.color) chart.gridColor = gridLine.color;
  return { chart: sanitizeChart(chart), notes };
}
