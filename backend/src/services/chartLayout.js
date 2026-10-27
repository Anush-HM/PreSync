// Chart blocks -> drawing primitives. This file is shared verbatim with
// frontend/src/data/chartLayout.js (a test checks they match), so the
// editor, the slide renderers and the PDF export all draw a chart from
// the same geometry.
//
// A chart block's `chart` field:
//   { kind: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter',
//     grouping: 'clustered' | 'stacked' | 'percentStacked',
//     title, categories: [string], series: [{ name, values: [number|null], color, xValues? }],
//     legend: 'bottom' | 'right' | 'top' | 'none', dataLabels: bool,
//     numberFormat: 'general' | 'percent', textColor, gridColor, fontSize, smooth }
//
// chartLayout(chart, width, height) returns primitives in the block's own
// box (0,0 top-left):
//   { type: 'rect', x, y, w, h, fill }
//   { type: 'line', x1, y1, x2, y2, stroke, width }
//   { type: 'poly', points: [[x, y]], stroke, width, fill, closed }
//   { type: 'path', d, fill, stroke, width }            (pie slices; SVG path data)
//   { type: 'circle', cx, cy, r, fill }
//   { type: 'text', x, y, text, size, color, anchor: 'start'|'middle'|'end', bold }
//     (y is the text's vertical middle)

export const CHART_KINDS = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'];
export const CHART_KIND_LABELS = {
  column: 'Column', bar: 'Bar', line: 'Line', area: 'Area', pie: 'Pie', doughnut: 'Doughnut', scatter: 'Scatter'
};
// PreSync's own series palette: forest, gold, slate blue, crimson, sage, plum.
export const CHART_COLORS = ['#2e7d5b', '#c89b3c', '#4f6d9a', '#b8323f', '#8fb39a', '#7a5a8c', '#3f8f99', '#d27a3a'];
export const MAX_CHART_SERIES = 12;
// Charts draw their labels in a font every renderer has a match for.
export const CHART_FONT = 'Calibri, Carlito, Arial, Arimo, sans-serif';
export const MAX_CHART_POINTS = 200;

const r1 = (v) => Math.round(v * 10) / 10;

export function seriesColor(chart, i) {
  const s = chart.series?.[i];
  return (s && s.color) || CHART_COLORS[i % CHART_COLORS.length];
}

// Point colours for pie/doughnut charts: each category gets its own.
export function pointColor(chart, i) {
  const pc = chart.series?.[0]?.pointColors?.[i];
  return pc || CHART_COLORS[i % CHART_COLORS.length];
}

export function formatChartNumber(v, format) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (format === 'percent') return `${Math.round(v * 1000) / 10}%`;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${Math.round(v / 1e8) / 10}B`;
  if (abs >= 1e6) return `${Math.round(v / 1e5) / 10}M`;
  if (abs >= 1e4) return `${Math.round(v / 100) / 10}k`;
  if (abs >= 100) return String(Math.round(v));
  return String(Math.round(v * 1000) / 1000);
}

// Rounded axis bounds and a step that gives about `count` gridlines.
export function niceScale(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2 };
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, step: 0.2 };
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = max - min;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  return { min: lo, max: hi === lo ? lo + step : hi, step };
}

function textWidth(text, size) {
  return String(text).length * size * 0.55;
}

function truncate(text, size, maxW) {
  const s = String(text ?? '');
  if (textWidth(s, size) <= maxW) return s;
  const n = Math.max(1, Math.floor(maxW / (size * 0.55)) - 1);
  return `${s.slice(0, n)}…`;
}

function values(series) {
  return (series.values || []).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
}

function legendEntries(chart) {
  if (chart.kind === 'pie' || chart.kind === 'doughnut') {
    return (chart.categories || []).map((c, i) => ({ label: c, color: pointColor(chart, i) }));
  }
  return (chart.series || []).map((s, i) => ({ label: s.name || `Series ${i + 1}`, color: seriesColor(chart, i) }));
}

function arcPath(cx, cy, r, inner, a0, a1) {
  const pt = (rad, a) => [r1(cx + rad * Math.cos(a)), r1(cy + rad * Math.sin(a))];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  // A full circle needs two arcs; a single one with equal ends draws nothing.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const m = a0 + Math.PI;
    const outer = `M${pt(r, a0)} A${r1(r)} ${r1(r)} 0 1 1 ${pt(r, m)} A${r1(r)} ${r1(r)} 0 1 1 ${pt(r, a0)} Z`;
    if (!inner) return outer;
    return `${outer} M${pt(inner, a0)} A${r1(inner)} ${r1(inner)} 0 1 0 ${pt(inner, m)} A${r1(inner)} ${r1(inner)} 0 1 0 ${pt(inner, a0)} Z`;
  }
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  if (!inner) return `M${r1(cx)} ${r1(cy)} L${x0} ${y0} A${r1(r)} ${r1(r)} 0 ${large} 1 ${x1} ${y1} Z`;
  const [ix1, iy1] = pt(inner, a1);
  const [ix0, iy0] = pt(inner, a0);
  return `M${x0} ${y0} A${r1(r)} ${r1(r)} 0 ${large} 1 ${x1} ${y1} L${ix1} ${iy1} A${r1(inner)} ${r1(inner)} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

export function chartLayout(chart, width, height) {
  const items = [];
  const w = Math.max(40, width || 400);
  const h = Math.max(30, height || 260);
  if (!chart) return items;
  const kind = CHART_KINDS.includes(chart.kind) ? chart.kind : 'column';
  const color = chart.textColor || '#3a3f3b';
  const grid = chart.gridColor || '#d9ddd8';
  const size = chart.fontSize || Math.max(8, Math.min(14, Math.round(h / 26)));
  const pad = Math.max(4, Math.round(size * 0.6));
  const box = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 };

  if (chart.title) {
    const ts = Math.round(size * 1.3);
    items.push({ type: 'text', x: r1(w / 2), y: r1(box.y + ts * 0.6), text: truncate(chart.title, ts, box.w), size: ts, color, anchor: 'middle', bold: true });
    box.y += ts * 1.5;
    box.h -= ts * 1.5;
  }

  const legend = legendEntries(chart);
  const legendPos = chart.legend || (legend.length > 1 || kind === 'pie' || kind === 'doughnut' ? 'bottom' : 'none');
  if (legendPos !== 'none' && legend.length) {
    const sw = size * 0.8;
    if (legendPos === 'right') {
      const lw = Math.min(box.w * 0.35, Math.max(...legend.map((e) => textWidth(e.label, size))) + sw + size);
      const x0 = box.x + box.w - lw;
      const total = legend.length * size * 1.5;
      let y = box.y + Math.max(0, (box.h - total) / 2) + size * 0.75;
      legend.forEach((e) => {
        if (y > box.y + box.h) return;
        items.push({ type: 'rect', x: r1(x0), y: r1(y - sw / 2), w: r1(sw), h: r1(sw), fill: e.color });
        items.push({ type: 'text', x: r1(x0 + sw + size * 0.4), y: r1(y), text: truncate(e.label, size, lw - sw - size * 0.4), size, color, anchor: 'start' });
        y += size * 1.5;
      });
      box.w -= lw + size;
    } else {
      // One or more rows, centred.
      const gap = size * 1.2;
      const widths = legend.map((e) => sw + size * 0.4 + Math.min(textWidth(e.label, size), box.w * 0.4));
      const rows = [[]];
      let rowW = 0;
      widths.forEach((ew, i) => {
        if (rowW + ew > box.w && rows[rows.length - 1].length) {
          rows.push([]);
          rowW = 0;
        }
        rows[rows.length - 1].push(i);
        rowW += ew + gap;
      });
      const lh = size * 1.5;
      const top = legendPos === 'top' ? box.y : box.y + box.h - rows.length * lh;
      rows.forEach((row, ri) => {
        const total = row.reduce((a, i) => a + widths[i], 0) + gap * (row.length - 1);
        let x = box.x + (box.w - total) / 2;
        const y = top + ri * lh + lh / 2;
        row.forEach((i) => {
          const e = legend[i];
          items.push({ type: 'rect', x: r1(x), y: r1(y - sw / 2), w: r1(sw), h: r1(sw), fill: e.color });
          items.push({ type: 'text', x: r1(x + sw + size * 0.4), y: r1(y), text: truncate(e.label, size, box.w * 0.4), size, color, anchor: 'start' });
          x += widths[i] + gap;
        });
      });
      if (legendPos === 'top') box.y += rows.length * lh + size * 0.3;
      box.h -= rows.length * lh + size * 0.3;
    }
  }
  if (box.w < 10 || box.h < 10) return items;

  if (kind === 'pie' || kind === 'doughnut') {
    const vals = values(chart.series?.[0] || {}).map((v) => (v && v > 0 ? v : 0));
    const total = vals.reduce((a, v) => a + v, 0);
    const r = Math.min(box.w, box.h) / 2;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const inner = kind === 'doughnut' ? r * 0.55 : 0;
    if (!total) {
      items.push({ type: 'path', d: arcPath(cx, cy, r, inner, 0, Math.PI * 2), fill: grid, stroke: null, width: 0 });
      return items;
    }
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!v) return;
      const a1 = a + (v / total) * Math.PI * 2;
      items.push({ type: 'path', d: arcPath(cx, cy, r, inner, a, a1), fill: pointColor(chart, i), stroke: '#ffffff', width: 1 });
      if (chart.dataLabels !== false && v / total >= 0.04) {
        const mid = (a + a1) / 2;
        const lr = inner ? (r + inner) / 2 : r * 0.62;
        const label = chart.numberFormat === 'percent' || chart.dataLabels === undefined
          ? `${Math.round((v / total) * 100)}%`
          : formatChartNumber(v, chart.numberFormat);
        items.push({ type: 'text', x: r1(cx + lr * Math.cos(mid)), y: r1(cy + lr * Math.sin(mid)), text: label, size, color: '#ffffff', anchor: 'middle', bold: true });
      }
      a = a1;
    });
    return items;
  }

  const series = (chart.series || []).slice(0, MAX_CHART_SERIES);
  const cats = (chart.categories || []).slice(0, MAX_CHART_POINTS);
  const n = Math.max(cats.length, ...series.map((s) => (s.values || []).length), 1);
  const grouping = kind === 'line' || kind === 'scatter' ? 'standard' : chart.grouping || 'clustered';
  const stacked = grouping === 'stacked' || grouping === 'percentStacked';
  const percent = grouping === 'percentStacked';
  const horizontal = kind === 'bar';

  // Value range.
  let lo = 0;
  let hi = 0;
  const totals = Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + Math.abs(values(s)[i] || 0), 0));
  if (percent) hi = 1;
  else if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      series.forEach((s) => {
        const v = values(s)[i] || 0;
        if (v >= 0) pos += v;
        else neg += v;
      });
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    }
  } else {
    series.forEach((s) => values(s).forEach((v) => {
      if (v === null) return;
      hi = Math.max(hi, v);
      lo = Math.min(lo, v);
    }));
  }
  // Like Office, a narrow band of large positive values gets an axis that
  // doesn't start at zero, so the differences stay visible.
  if (!stacked && kind !== 'area' && lo >= 0) {
    const all = series.flatMap((s) => values(s).filter((v) => v !== null));
    const least = Math.min(...all);
    if (all.length && least > 0 && hi > 0 && (hi - least) / hi < 1 / 6) lo = Math.max(0, least - (hi - least) / 2);
  }
  if (Number.isFinite(chart.min)) lo = chart.min;
  if (Number.isFinite(chart.max)) hi = chart.max;
  const scale = niceScale(lo, hi, Math.max(2, Math.min(8, Math.round((horizontal ? box.w : box.h) / (size * 4)))));
  const fmt = percent ? 'percent' : chart.numberFormat;

  // Scatter x range.
  let xs = null;
  if (kind === 'scatter') {
    const all = series.flatMap((s) => (s.xValues || s.values.map((_, i) => i + 1)).filter((v) => Number.isFinite(v)));
    xs = niceScale(Math.min(...all, 0), Math.max(...all, 1), Math.max(2, Math.round(box.w / (size * 6))));
  }

  // Axis label room.
  const tickLabels = [];
  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) tickLabels.push(Math.round(v / scale.step) * scale.step);
  const valLabelW = Math.max(...tickLabels.map((v) => textWidth(formatChartNumber(v, fmt), size))) + size * 0.6;
  const catLabelW = Math.min(box.w * 0.3, Math.max(0, ...cats.map((c) => textWidth(c, size))) + size * 0.6);
  const plot = horizontal
    ? { x: box.x + catLabelW, y: box.y, w: box.w - catLabelW, h: box.h - size * 1.6 }
    : { x: box.x + valLabelW, y: box.y + size * 0.5, w: box.w - valLabelW, h: box.h - size * 2.1 };
  if (plot.w < 10 || plot.h < 10) return items;

  const vPos = (v) => {
    const t = (v - scale.min) / (scale.max - scale.min || 1);
    return horizontal ? plot.x + t * plot.w : plot.y + plot.h - t * plot.h;
  };

  // Gridlines and value labels.
  tickLabels.forEach((v) => {
    const p = r1(vPos(v));
    if (horizontal) {
      items.push({ type: 'line', x1: p, y1: r1(plot.y), x2: p, y2: r1(plot.y + plot.h), stroke: grid, width: 1 });
      items.push({ type: 'text', x: p, y: r1(plot.y + plot.h + size * 0.9), text: formatChartNumber(v, fmt), size, color, anchor: 'middle' });
    } else {
      items.push({ type: 'line', x1: r1(plot.x), y1: p, x2: r1(plot.x + plot.w), y2: p, stroke: grid, width: 1 });
      items.push({ type: 'text', x: r1(plot.x - size * 0.4), y: p, text: formatChartNumber(v, fmt), size, color, anchor: 'end' });
    }
  });

  if (kind === 'scatter') {
    const xPos = (v) => plot.x + ((v - xs.min) / (xs.max - xs.min || 1)) * plot.w;
    for (let v = xs.min; v <= xs.max + xs.step / 2; v += xs.step) {
      items.push({ type: 'text', x: r1(xPos(v)), y: r1(plot.y + plot.h + size * 0.9), text: formatChartNumber(Math.round(v / xs.step) * xs.step, 'general'), size, color, anchor: 'middle' });
    }
    series.forEach((s, si) => {
      const c = seriesColor(chart, si);
      values(s).forEach((v, i) => {
        const x = (s.xValues || [])[i] ?? i + 1;
        if (v === null || !Number.isFinite(x)) return;
        items.push({ type: 'circle', cx: r1(xPos(x)), cy: r1(vPos(v)), r: Math.max(2, size * 0.35), fill: c });
      });
    });
    return items;
  }

  // Category axis.
  const band = (horizontal ? plot.h : plot.w) / n;
  const catCentre = (i) => (horizontal ? plot.y + band * (i + 0.5) : plot.x + band * (i + 0.5));
  const axisAt = r1(vPos(Math.max(scale.min, Math.min(scale.max, 0))));
  if (horizontal) items.push({ type: 'line', x1: axisAt, y1: r1(plot.y), x2: axisAt, y2: r1(plot.y + plot.h), stroke: color, width: 1 });
  else items.push({ type: 'line', x1: r1(plot.x), y1: axisAt, x2: r1(plot.x + plot.w), y2: axisAt, stroke: color, width: 1 });
  const every = Math.max(1, Math.ceil((n * size * 1.2) / (horizontal ? plot.h : plot.w * 0.5)));
  cats.forEach((c, i) => {
    if (i % every) return;
    if (horizontal) items.push({ type: 'text', x: r1(plot.x - size * 0.4), y: r1(catCentre(i)), text: truncate(c, size, catLabelW - size * 0.6), size, color, anchor: 'end' });
    else items.push({ type: 'text', x: r1(catCentre(i)), y: r1(plot.y + plot.h + size * 0.9), text: truncate(c, size, band * every * 0.95), size, color, anchor: 'middle' });
  });

  if (kind === 'column' || kind === 'bar') {
    const groupW = band * 0.7;
    const barW = stacked ? groupW : groupW / Math.max(1, series.length);
    const pos = Array(n).fill(0);
    const neg = Array(n).fill(0);
    series.forEach((s, si) => {
      const c = seriesColor(chart, si);
      values(s).forEach((raw, i) => {
        if (raw === null || i >= n) return;
        const v = percent ? (totals[i] ? raw / totals[i] : 0) : raw;
        // Bars grow from zero, or from the axis floor when it is above zero.
        let from = Math.max(scale.min, Math.min(scale.max, 0));
        let to = Math.max(scale.min, Math.min(scale.max, v));
        if (stacked) {
          if (v >= 0) { from = pos[i]; pos[i] += v; to = pos[i]; } else { from = neg[i]; neg[i] += v; to = neg[i]; }
        }
        const a = vPos(from);
        const b = vPos(to);
        const offset = catCentre(i) - groupW / 2 + (stacked ? 0 : barW * si);
        const inset = stacked ? 0 : Math.min(1, barW * 0.08);
        const rect = horizontal
          ? { x: Math.min(a, b), y: offset + inset, w: Math.abs(b - a), h: barW - inset * 2 }
          : { x: offset + inset, y: Math.min(a, b), w: barW - inset * 2, h: Math.abs(b - a) };
        items.push({ type: 'rect', x: r1(rect.x), y: r1(rect.y), w: r1(rect.w), h: r1(rect.h), fill: c });
        if (chart.dataLabels) {
          const label = formatChartNumber(percent ? v : raw, fmt);
          if (horizontal) items.push({ type: 'text', x: r1(rect.x + rect.w + size * 0.3), y: r1(rect.y + rect.h / 2), text: label, size: size * 0.9, color, anchor: 'start' });
          else items.push({ type: 'text', x: r1(rect.x + rect.w / 2), y: r1(rect.y - size * 0.6), text: label, size: size * 0.9, color, anchor: 'middle' });
        }
      });
    });
    return items;
  }

  // Line and area.
  const base = Array(n).fill(0);
  series.forEach((s, si) => {
    const c = seriesColor(chart, si);
    const vals = values(s);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const raw = vals[i];
      if (raw === null || raw === undefined) {
        if (kind === 'line' && pts.length) {
          items.push({ type: 'poly', points: pts.splice(0), stroke: c, width: Math.max(1.5, size * 0.2), fill: null, closed: false });
        }
        continue;
      }
      let v = percent ? (totals[i] ? raw / totals[i] : 0) : raw;
      if (stacked) { base[i] += v; v = base[i]; }
      pts.push([r1(catCentre(i)), r1(vPos(v))]);
    }
    if (!pts.length) return;
    if (kind === 'area') {
      const bottom = r1(vPos(Math.max(scale.min, 0)));
      const ring = [[pts[0][0], bottom], ...pts, [pts[pts.length - 1][0], bottom]];
      items.push({ type: 'poly', points: ring, stroke: null, width: 0, fill: c, closed: true, opacity: stacked ? 1 : 0.75 });
    } else {
      items.push({ type: 'poly', points: pts, stroke: c, width: Math.max(1.5, size * 0.2), fill: null, closed: false });
      pts.forEach(([x, y]) => items.push({ type: 'circle', cx: x, cy: y, r: Math.max(2, size * 0.28), fill: c }));
    }
    if (chart.dataLabels) {
      pts.forEach(([x, y], i) => items.push({ type: 'text', x, y: r1(y - size * 0.9), text: formatChartNumber(vals[i], fmt), size: size * 0.9, color, anchor: 'middle' }));
    }
  });
  return items;
}

// A plain description of the chart for screen readers and alt text.
export function chartSummary(chart) {
  if (!chart) return 'Chart';
  const kind = CHART_KIND_LABELS[chart.kind] || 'Chart';
  const parts = [`${kind} chart${chart.title ? `: ${chart.title}` : ''}`];
  const series = chart.series || [];
  series.slice(0, 4).forEach((s, si) => {
    const pairs = (s.values || []).slice(0, 8).map((v, i) => `${chart.categories?.[i] ?? i + 1} ${formatChartNumber(v, chart.numberFormat)}`);
    parts.push(`${s.name || `Series ${si + 1}`}: ${pairs.join(', ')}`);
  });
  return parts.join('. ');
}

// Clamps a chart from an untrusted source (an import, a collaborator)
// to a sane size and shape.
export function sanitizeChart(chart) {
  if (!chart || typeof chart !== 'object') return null;
  const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : v === null || v === undefined ? '' : String(v).slice(0, max));
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined);
  const out = {
    kind: CHART_KINDS.includes(chart.kind) ? chart.kind : 'column',
    grouping: ['clustered', 'stacked', 'percentStacked'].includes(chart.grouping) ? chart.grouping : 'clustered',
    title: str(chart.title),
    categories: (Array.isArray(chart.categories) ? chart.categories : []).slice(0, MAX_CHART_POINTS).map((c) => str(c, 80)),
    series: (Array.isArray(chart.series) ? chart.series : []).slice(0, MAX_CHART_SERIES).map((s) => {
      const clean = {
        name: str(s?.name, 80),
        values: (Array.isArray(s?.values) ? s.values : []).slice(0, MAX_CHART_POINTS).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
      };
      if (hex(s?.color)) clean.color = hex(s.color);
      if (Array.isArray(s?.xValues)) clean.xValues = s.xValues.slice(0, MAX_CHART_POINTS).map((v) => (Number.isFinite(v) ? v : null));
      if (Array.isArray(s?.pointColors)) clean.pointColors = s.pointColors.slice(0, MAX_CHART_POINTS).map((c) => hex(c) || null);
      return clean;
    })
  };
  if (['bottom', 'right', 'top', 'none'].includes(chart.legend)) out.legend = chart.legend;
  if (typeof chart.dataLabels === 'boolean') out.dataLabels = chart.dataLabels;
  if (chart.numberFormat === 'percent') out.numberFormat = 'percent';
  if (hex(chart.textColor)) out.textColor = hex(chart.textColor);
  if (hex(chart.gridColor)) out.gridColor = hex(chart.gridColor);
  if (Number.isFinite(chart.fontSize)) out.fontSize = Math.max(6, Math.min(40, chart.fontSize));
  if (Number.isFinite(chart.min)) out.min = chart.min;
  if (Number.isFinite(chart.max)) out.max = chart.max;
  return out;
}
