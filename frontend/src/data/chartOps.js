import { CHART_COLORS, MAX_CHART_POINTS, MAX_CHART_SERIES, sanitizeChart } from './chartLayout.js';

// Pure edits on a chart block's `chart` data (see chartLayout.js). Each
// returns a new, sanitised chart.

export function defaultChart(kind = 'column') {
  return sanitizeChart({
    kind,
    title: 'Chart title',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'This year', values: [42, 55, 61, 70] },
      { name: 'Last year', values: [35, 41, 48, 52] }
    ],
    legend: 'bottom'
  });
}

const clean = (chart) => sanitizeChart(chart);

export function setChartField(chart, key, value) {
  return clean({ ...chart, [key]: value });
}

export function setCategory(chart, i, label) {
  const categories = [...chart.categories];
  categories[i] = label;
  return clean({ ...chart, categories });
}

// Parses what someone typed into a value cell: blank is a gap.
export function parseValue(text) {
  const t = String(text ?? '').trim().replace(/,/g, '');
  if (!t) return null;
  const pct = /%$/.test(t);
  const n = Number(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) return undefined;
  return pct ? n / 100 : n;
}

export function setValue(chart, s, i, text) {
  const v = parseValue(text);
  if (v === undefined) return chart;
  const series = chart.series.map((ser, j) => {
    if (j !== s) return ser;
    const values = [...ser.values];
    while (values.length <= i) values.push(null);
    values[i] = v;
    return { ...ser, values };
  });
  return clean({ ...chart, series });
}

export function setSeriesName(chart, s, name) {
  return clean({ ...chart, series: chart.series.map((ser, j) => (j === s ? { ...ser, name } : ser)) });
}

export function setSeriesColor(chart, s, color) {
  return clean({ ...chart, series: chart.series.map((ser, j) => (j === s ? { ...ser, color } : ser)) });
}

export function addCategory(chart) {
  if (chart.categories.length >= MAX_CHART_POINTS) return chart;
  return clean({
    ...chart,
    categories: [...chart.categories, `Item ${chart.categories.length + 1}`],
    series: chart.series.map((s) => ({ ...s, values: [...s.values, null] }))
  });
}

export function removeCategory(chart, i) {
  if (chart.categories.length <= 1) return chart;
  return clean({
    ...chart,
    categories: chart.categories.filter((_, j) => j !== i),
    series: chart.series.map((s) => ({ ...s, values: s.values.filter((_, j) => j !== i) }))
  });
}

export function addSeries(chart) {
  if (chart.series.length >= MAX_CHART_SERIES) return chart;
  const n = chart.series.length;
  return clean({
    ...chart,
    series: [...chart.series, { name: `Series ${n + 1}`, values: chart.categories.map(() => null), color: CHART_COLORS[n % CHART_COLORS.length] }]
  });
}

export function removeSeries(chart, s) {
  if (chart.series.length <= 1) return chart;
  return clean({ ...chart, series: chart.series.filter((_, j) => j !== s) });
}

// Spreadsheet paste: the first row names the series, the first column
// names the categories.
export function chartFromGrid(chart, tsv) {
  const rows = String(tsv || '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split('\t'));
  if (rows.length < 2 || rows[0].length < 2) return chart;
  const names = rows[0].slice(1);
  const body = rows.slice(1);
  return clean({
    ...chart,
    categories: body.map((r) => r[0]),
    series: names.map((name, s) => ({
      name,
      values: body.map((r) => parseValue(r[s + 1]) ?? null),
      ...(chart.series[s]?.color ? { color: chart.series[s].color } : {})
    }))
  });
}
