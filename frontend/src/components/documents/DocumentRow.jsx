import { Link, useNavigate } from 'react-router-dom';
import { Download, FileDown, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Menu from '../ui/Menu.jsx';
import { plural, timeAgo } from '../../data/format.js';
import '../imports/imports.css';

// One Word document in a list, with its actions.
function DocumentRow({ item, onRename, onDownload, onDelete }) {
  const navigate = useNavigate();
  const items = [
    { label: 'Open', icon: FileText, onSelect: () => navigate(`/documents/${item.id}`) },
    { label: 'Rename', icon: Pencil, onSelect: () => onRename(item) },
    { label: 'Download as .docx', icon: Download, onSelect: () => onDownload(item, 'docx') },
    { label: 'Download as PDF', icon: FileDown, onSelect: () => onDownload(item, 'pdf') }
  ];
  if (item.isOwner) items.push('separator', { label: 'Delete', icon: Trash2, danger: true, onSelect: () => onDelete(item) });
  return (
    <li className="import-row">
      <span className="import-row-icon is-docx"><FileText aria-hidden="true" /></span>
      <div className="import-row-main">
        <Link to={`/documents/${item.id}`} className="import-row-title">{item.title}</Link>
        <span className="import-row-meta">
          {plural(item.wordCount, 'word')} · edited {timeAgo(item.updatedAt)}
          {!item.isOwner && ' · shared with you'}
        </span>
      </div>
      <Link to={`/documents/${item.id}`} className="btn btn-sm btn-ghost">Open</Link>
      <Menu label={`Actions for ${item.title}`} icon={MoreHorizontal} items={items} />
    </li>
  );
}

export default DocumentRow;
