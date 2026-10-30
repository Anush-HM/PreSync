import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, ExternalLink, Pencil, Copy, Share2, History, Trash2, Layers } from 'lucide-react';
import ScaledSlide from '../ScaledSlide.jsx';
import Menu from '../ui/Menu.jsx';
import { AvatarStack } from '../ui/Avatar.jsx';
import { plural, timeAgo } from '../../data/format.js';
import './decks.css';

// One presentation on the dashboard: a real render of its first slide,
// title, last-edited time, who else can edit it, and its actions.
function DeckCard({ deck, currentUserId, onRename, onDuplicate, onShare, onHistory, onDelete, busy }) {
  const navigate = useNavigate();
  const id = deck.id;
  const open = () => navigate(`/editor/${id}`);

  // Everyone with access except the person looking at the card.
  const people = [deck.owner, ...(deck.collaborators || [])]
    .filter(Boolean)
    .filter((p) => String(p.id) !== String(currentUserId));

  const items = [
    { label: 'Open in editor', icon: ExternalLink, onSelect: open },
    { label: 'Rename', icon: Pencil, onSelect: () => onRename(deck) },
    { label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(deck) },
    { label: deck.isOwner ? 'Share' : 'People with access', icon: Share2, onSelect: () => onShare(deck) },
    { label: 'Session history', icon: History, onSelect: () => onHistory(deck) }
  ];
  if (deck.isOwner) {
    items.push('separator', { label: 'Delete', icon: Trash2, danger: true, onSelect: () => onDelete(deck) });
  }

  return (
    <article className={`deck-card${busy ? ' is-busy' : ''}`} aria-busy={busy || undefined}>
      <button type="button" className="deck-card-hit" onClick={open} aria-label={`Open ${deck.title}`} />
      <div className="deck-card-thumb">
        {deck.thumbnail ? (
          <ScaledSlide slide={deck.thumbnail} canvasWidth={deck.canvasWidth} canvasHeight={deck.canvasHeight} />
        ) : (
          <div className="deck-card-thumb-empty">
            <Layers aria-hidden="true" />
            <span>No slides yet</span>
          </div>
        )}
        <span className="deck-card-count mono">{plural(deck.slideCount, 'slide')}</span>
      </div>
      <div className="deck-card-body">
        <div className="deck-card-titles">
          <h3 className="deck-card-title" title={deck.title}>{deck.title}</h3>
          <p className="deck-card-meta">
            Edited {timeAgo(deck.updatedAt)}
            {!deck.isOwner && deck.owner && <> · Shared by {deck.owner.name || deck.owner.email}</>}
          </p>
        </div>
        <div className="deck-card-actions">
          <AvatarStack people={people} size={24} max={3} />
          <Menu label={`Actions for ${deck.title}`} icon={MoreHorizontal} items={items} />
        </div>
      </div>
    </article>
  );
}

export default DeckCard;
