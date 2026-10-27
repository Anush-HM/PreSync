import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, MoreHorizontal, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react';
import ScaledSlide from '../ScaledSlide.jsx';
import { slideTitle } from '../../data/slideFormat.js';
import Menu from '../ui/Menu.jsx';
import './editor.css';

// Left zone: real thumbnails of every slide, in order. Arrow keys move
// between slides; each thumbnail has its own actions menu.
function SlideRail({ slides, activeIdx, peers, onSelect, onAdd, onDuplicate, onMove, onDelete, onRename, onToggleHidden }) {
  const listRef = useRef(null);
  const [renaming, setRenaming] = useState(null); // { idx, value }

  function commitRename() {
    if (!renaming) return;
    onRename?.(renaming.idx, renaming.value.trim().slice(0, 200));
    setRenaming(null);
  }

  // Keep the active thumbnail in view when it changes from elsewhere
  // (undo, a peer deleting slides, keyboard navigation).
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-slide-idx="${activeIdx}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIdx]);

  function onListKey(e) {
    if (e.target.getAttribute('data-slide-idx') === null) return;
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = Math.min(slides.length - 1, activeIdx + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = Math.max(0, activeIdx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = slides.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSelect(next);
    listRef.current?.querySelector(`[data-slide-idx="${next}"]`)?.focus();
  }

  return (
    <div className="rail">
      <div className="rail-head">
        <h2 className="ed-zone-title">Slides <span className="mono">{slides.length}</span></h2>
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Add slide after current" data-tip="Add slide" onClick={onAdd}>
          <Plus />
        </button>
      </div>

      <ol className="rail-list" ref={listRef} onKeyDown={onListKey} aria-label="Slides">
        {slides.map((slide, i) => {
          const here = peers.filter((p) => p.activeSlideIdx === i);
          const active = i === activeIdx;
          const title = slideTitle(slide, i);
          const named = title !== `Slide ${i + 1}`;
          return (
            <li key={slide.id} className={`rail-item${active ? ' is-active' : ''}${slide.hidden ? ' is-hidden' : ''}`}>
              <span className="rail-num mono" aria-hidden="true">{i + 1}</span>
              <button
                type="button"
                className="rail-thumb"
                data-slide-idx={i}
                aria-current={active ? 'true' : undefined}
                aria-label={`Slide ${i + 1}${named ? `: ${title}` : ''}${slide.hidden ? ', hidden' : ''}${here.length ? `, ${here.map((p) => p.name).join(', ')} here` : ''}`}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect(i)}
              >
                <ScaledSlide slide={slide} />
                {renaming?.idx !== i && <span className="rail-title" aria-hidden="true" title={title}>{title}</span>}
                {slide.notes?.trim() && <StickyNote className="rail-notes" aria-hidden="true" />}
                {slide.hidden && <span className="rail-hidden" aria-hidden="true"><EyeOff /></span>}
                {here.length > 0 && (
                  <span className="rail-peers" aria-hidden="true">
                    {here.slice(0, 3).map((p) => <span key={p.clientId} style={{ background: p.color }} />)}
                  </span>
                )}
              </button>
              {renaming?.idx === i && (
                <input
                  className="input rail-rename"
                  aria-label={`Name for slide ${i + 1}`}
                  placeholder={`Slide ${i + 1}`}
                  value={renaming.value}
                  maxLength={200}
                  autoFocus
                  onChange={(e) => setRenaming({ idx: i, value: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              )}
              <div className="rail-item-menu">
                <Menu
                  label={`Slide ${i + 1} actions`}
                  icon={MoreHorizontal}
                  triggerClassName="icon-btn icon-btn-sm"
                  align="start"
                  items={[
                    { label: 'Rename…', icon: Pencil, onSelect: () => setRenaming({ idx: i, value: slide.name || '' }) },
                    { label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(i) },
                    { label: slide.hidden ? 'Show slide' : 'Hide slide', icon: slide.hidden ? Eye : EyeOff, onSelect: () => onToggleHidden?.(i) },
                    { label: 'Move up', icon: ArrowUp, onSelect: () => onMove(i, -1), disabled: i === 0 },
                    { label: 'Move down', icon: ArrowDown, onSelect: () => onMove(i, 1), disabled: i >= slides.length - 1 },
                    'separator',
                    { label: 'Delete slide', icon: Trash2, onSelect: () => onDelete(i), danger: true, disabled: slides.length <= 1 }
                  ]}
                />
              </div>
            </li>
          );
        })}
      </ol>

      <div className="rail-foot">
        <button type="button" className="btn btn-secondary btn-sm rail-add" onClick={onAdd}>
          <Plus aria-hidden="true" /> New slide
        </button>
      </div>
    </div>
  );
}

export default SlideRail;
