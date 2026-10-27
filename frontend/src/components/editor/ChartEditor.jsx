import { Plus, Trash2 } from 'lucide-react';
import { CHART_KIND_LABELS, CHART_KINDS, seriesColor } from '../../data/chartLayout.js';
import {
  addCategory, addSeries, chartFromGrid, removeCategory, removeSeries, setCategory, setChartField, setSeriesColor, setSeriesName, setValue
} from '../../data/chartOps.js';

const fmt = (v) => (v === null || v === undefined ? '' : String(v));

// Chart data and options in the side panel: a small sheet of categories
// × series, which also takes a range pasted from a spreadsheet.
function ChartEditor({ block, onChange }) {
  const chart = block.chart;
  if (!chart) return null;
  const single = chart.kind === 'pie' || chart.kind === 'doughnut';

  function onPaste(e) {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!/\t/.test(text) || !/\n/.test(text.trim())) return;
    e.preventDefault();
    onChange(chartFromGrid(chart, text));
  }

  return (
    <div className="chart-editor">
      <div className="props-row">
        <label className="field-inline">
          <span className="props-label">Type</span>
          <select className="select select-sm" value={chart.kind} onChange={(e) => onChange(setChartField(chart, 'kind', e.target.value))}>
            {CHART_KINDS.map((k) => <option key={k} value={k}>{CHART_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        {['column', 'bar', 'area'].includes(chart.kind) && (
          <label className="field-inline">
            <span className="props-label">Grouping</span>
            <select className="select select-sm" value={chart.grouping} onChange={(e) => onChange(setChartField(chart, 'grouping', e.target.value))}>
              <option value="clustered">Side by side</option>
              <option value="stacked">Stacked</option>
              <option value="percentStacked">100% stacked</option>
            </select>
          </label>
        )}
      </div>
      <label className="field-stack">
        <span className="props-label">Title</span>
        <input className="input input-sm" value={chart.title || ''} maxLength={200} placeholder="No title" onChange={(e) => onChange(setChartField(chart, 'title', e.target.value))} />
      </label>

      <div className="chart-sheet-wrap" onPaste={onPaste}>
        <table className="chart-sheet">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Category</span></th>
              {chart.series.map((s, i) => (
                <th key={i} scope="col">
                  <div className="chart-series-head">
                    <label className="swatch is-square chart-series-color" style={{ background: seriesColor(chart, i) }}>
                      <input type="color" aria-label={`Colour of ${s.name || `series ${i + 1}`}`} value={seriesColor(chart, i)} onChange={(e) => onChange(setSeriesColor(chart, i, e.target.value))} />
                    </label>
                    <input className="input input-sm" aria-label={`Series ${i + 1} name`} value={s.name} onChange={(e) => onChange(setSeriesName(chart, i, e.target.value))} />
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${s.name || `series ${i + 1}`}`} disabled={chart.series.length <= 1} onClick={() => onChange(removeSeries(chart, i))}><Trash2 /></button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.categories.map((cat, r) => (
              <tr key={r}>
                <th scope="row">
                  <div className="chart-series-head">
                    <input className="input input-sm" aria-label={`Category ${r + 1}`} value={cat} onChange={(e) => onChange(setCategory(chart, r, e.target.value))} />
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${cat || `category ${r + 1}`}`} disabled={chart.categories.length <= 1} onClick={() => onChange(removeCategory(chart, r))}><Trash2 /></button>
                  </div>
                </th>
                {chart.series.map((s, i) => (
                  <td key={i}>
                    <input
                      key={`${i}-${r}-${fmt(s.values[r])}`}
                      className="input input-sm mono"
                      inputMode="decimal"
                      aria-label={`${s.name || `Series ${i + 1}`}, ${cat}`}
                      defaultValue={fmt(s.values[r])}
                      onBlur={(e) => onChange(setValue(chart, i, r, e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="props-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(addCategory(chart))}><Plus aria-hidden="true" />Category</button>
        {!single && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(addSeries(chart))}><Plus aria-hidden="true" />Series</button>}
      </div>
      <p className="field-hint">Paste a range from a spreadsheet (series names across the top, categories down the side) to replace the data.</p>

      <div className="props-row">
        <label className="field-inline">
          <span className="props-label">Legend</span>
          <select className="select select-sm" value={chart.legend || 'bottom'} onChange={(e) => onChange(setChartField(chart, 'legend', e.target.value))}>
            <option value="bottom">Bottom</option>
            <option value="top">Top</option>
            <option value="right">Right</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={!!chart.dataLabels} onChange={(e) => onChange(setChartField(chart, 'dataLabels', e.target.checked))} />
          Data labels
        </label>
        <label className="check">
          <input type="checkbox" checked={chart.numberFormat === 'percent'} onChange={(e) => onChange(setChartField(chart, 'numberFormat', e.target.checked ? 'percent' : 'general'))} />
          Percent
        </label>
      </div>
    </div>
  );
}

export default ChartEditor;
