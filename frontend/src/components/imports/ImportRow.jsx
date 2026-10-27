import { Link } from 'react-router-dom';
import { Trash2, ArrowRight, AlertTriangle } from 'lucide-react';
import { FORMAT_ICON, FORMAT_LABEL } from './formatIcons.js';
import { formatBytes, plural, timeAgo } from '../../data/format.js';
import './imports.css';

// One imported file in a list: what it is, how big, and a way back to
// its review screen.
function ImportRow({ item, onDelete }) {
  const Icon = FORMAT_ICON[item.format];
  const size = item.format === 'docx'
    ? [item.pageCount && plural(item.pageCount, 'page'), item.suggestedSlides && `${plural(item.suggestedSlides, 'suggested slide')}`]
    : [item.slideCount && plural(item.slideCount, item.format === 'pdf' ? 'page' : 'slide')];
  return (
    <li className="import-row">
      <span className={`import-row-icon is-${item.format}`}><Icon aria-hidden="true" /></span>
      <div className="import-row-main">
        <Link to={`/imports/${item.id}`} className="import-row-title">{item.title}</Link>
        <span className="import-row-meta">
          {FORMAT_LABEL[item.format]} · {[...size.filter(Boolean), formatBytes(item.fileSize)].join(' · ')} · imported {timeAgo(item.createdAt)}
          {item.deckIds.length > 0 && <> · {plural(item.deckIds.length, 'presentation')} made</>}
        </span>
      </div>
      {item.warningCount > 0 && (
        <span className="badge badge-warning" title="Some content could not be imported">
          <AlertTriangle aria-hidden="true" />{item.warningCount}<span className="sr-only"> conversion notes</span>
        </span>
      )}
      <Link to={`/imports/${item.id}`} className="btn btn-sm btn-ghost">Review <ArrowRight /></Link>
      {onDelete && (
        <button type="button" className="icon-btn" aria-label={`Delete import ${item.title}`} data-tip="Delete import" onClick={() => onDelete(item)}>
          <Trash2 />
        </button>
      )}
    </li>
  );
}

export default ImportRow;
