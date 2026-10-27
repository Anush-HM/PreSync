import { ArrowUp, ArrowDown, Trash2, Plus, ImageOff, NotebookPen, TableProperties } from 'lucide-react';
import { bulletsToText, textToBullets } from '../../data/outline.js';
import './review.css';

let localId = 0;
function newItem() {
  localId += 1;
  return { id: `new-${Date.now()}-${localId}`, layout: 'content', title: 'New slide', subtitle: '', bullets: [], notes: '', imageId: null, tableId: null, tableRows: null };
}

// A small text-only preview of the table rows a slide will show.
function TablePreview({ block, rows }) {
  const all = block.table?.rows || [];
  const [start, end] = rows || [0, all.length];
  const shown = (start > 0 ? [all[0], ...all.slice(start, end)] : all.slice(start, end)).slice(0, 6);
  const more = end - start - (shown.length - (start > 0 ? 1 : 0));
  return (
    <div className="outline-table-wrap">
      <table className="outline-table">
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {row.cells.map((c, ci) =>
                c.covered ? null : (
                  <td key={ci} colSpan={c.colspan || 1} rowSpan={c.rowspan || 1}>{c.text}</td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <p className="field-hint">…and {more} more row{more === 1 ? '' : 's'}</p>}
    </div>
  );
}

function OutlineEditor({ outline, images, blocks, onChange }) {
  const imageById = new Map((images || []).map((i) => [i.id, i]));
  const tableById = new Map((blocks || []).filter((b) => b.type === 'table' && b.id).map((b) => [b.id, b]));

  function update(index, patch) {
    onChange(outline.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function move(index, delta) {
    const next = [...outline];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  }
  function remove(index) {
    onChange(outline.filter((_, i) => i !== index));
  }
  function addAfter(index) {
    const next = [...outline];
    next.splice(index + 1, 0, newItem());
    onChange(next);
  }

  return (
    <ol className="outline-list" aria-label="Slide outline">
      {outline.map((item, i) => {
        const image = item.imageId && imageById.get(item.imageId);
        const table = item.layout !== 'title' && item.tableId && tableById.get(item.tableId);
        const titleId = `outline-title-${item.id}`;
        return (
          <li key={item.id} className="outline-item">
            <div className="outline-item-head">
              <span className="outline-num mono" aria-hidden="true">{i + 1}</span>
              <label className="sr-only" htmlFor={titleId}>Slide {i + 1} title</label>
              <input
                id={titleId}
                className="input outline-title"
                value={item.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Slide title"
              />
              <label className="outline-layout">
                <span className="sr-only">Slide {i + 1} layout</span>
                <select className="select" value={item.layout} onChange={(e) => update(i, { layout: e.target.value })}>
                  <option value="content">Title and bullets</option>
                  <option value="title">Title slide</option>
                </select>
              </label>
              <div className="outline-tools">
                <button type="button" className="icon-btn" aria-label={`Move slide ${i + 1} up`} data-tip="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></button>
                <button type="button" className="icon-btn" aria-label={`Move slide ${i + 1} down`} data-tip="Move down" disabled={i === outline.length - 1} onClick={() => move(i, 1)}><ArrowDown /></button>
                <button type="button" className="icon-btn" aria-label={`Add a slide after slide ${i + 1}`} data-tip="Add slide after" onClick={() => addAfter(i)}><Plus /></button>
                <button type="button" className="icon-btn outline-delete" aria-label={`Remove slide ${i + 1}`} data-tip="Remove slide" disabled={outline.length === 1} onClick={() => remove(i)}><Trash2 /></button>
              </div>
            </div>

            <div className={`outline-item-body${image ? ' has-image' : ''}${table ? ' has-table' : ''}`}>
              {item.layout === 'title' ? (
                <div className="field">
                  <label className="field-label" htmlFor={`outline-sub-${item.id}`}>Subtitle</label>
                  <input
                    id={`outline-sub-${item.id}`}
                    className="input"
                    value={item.subtitle || ''}
                    onChange={(e) => update(i, { subtitle: e.target.value })}
                  />
                </div>
              ) : (
                <div className="field">
                  <label className="field-label" htmlFor={`outline-bullets-${item.id}`}>
                    Bullets <span className="field-hint">one per line, indent with two spaces</span>
                  </label>
                  <textarea
                    key={bulletsToText(item.bullets)}
                    id={`outline-bullets-${item.id}`}
                    className="textarea outline-bullets"
                    rows={Math.min(8, Math.max(3, (item.bullets?.length || 0) + 1))}
                    defaultValue={bulletsToText(item.bullets)}
                    onBlur={(e) => update(i, { bullets: textToBullets(e.target.value) })}
                  />
                </div>
              )}
              {image && (
                <figure className="outline-image">
                  <img src={image.dataUrl} alt="Picture from the document" />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => update(i, { imageId: null })}>
                    <ImageOff /> Remove picture
                  </button>
                </figure>
              )}
              {table && (
                <figure className="outline-image outline-table-fig">
                  <figcaption className="field-label"><TableProperties aria-hidden="true" /> Table from the document</figcaption>
                  <TablePreview block={table} rows={item.tableRows} />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => update(i, { tableId: null, tableRows: null })}>
                    <Trash2 /> Remove table
                  </button>
                </figure>
              )}
            </div>

            <details className="outline-notes">
              <summary><NotebookPen aria-hidden="true" /> Speaker notes{item.notes ? '' : ' (empty)'}</summary>
              <textarea
                className="textarea"
                aria-label={`Speaker notes for slide ${i + 1}`}
                value={item.notes || ''}
                onChange={(e) => update(i, { notes: e.target.value })}
                rows={4}
              />
            </details>
          </li>
        );
      })}
    </ol>
  );
}

export default OutlineEditor;
