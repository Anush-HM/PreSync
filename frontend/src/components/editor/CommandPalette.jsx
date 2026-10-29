import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import Dialog from '../ui/Dialog.jsx';
import { filterCommands, keyParts } from '../../data/shortcuts.js';

// Ctrl+K: find any editor command by name and run it.
// commands: [{ id, label, group, icon, keys?, keywords?, run, disabled? }]
function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  function run(cmd) {
    if (!cmd || cmd.disabled) return;
    onClose();
    // After the dialog has handed focus back.
    requestAnimationFrame(() => cmd.run());
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(1, results.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + results.length) % Math.max(1, results.length)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[current]); }
  }

  let lastGroup = null;
  return (
    <Dialog title="Command palette" onClose={onClose} size="md">
      <div className="cmdk">
        <div className="elements-search">
          <Search aria-hidden="true" />
          <input
            className="input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[current] ? `${listId}-${results[current].id}` : undefined}
            aria-label="Search commands"
            placeholder="Type a command, like “align” or “sticker”"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            data-autofocus
          />
        </div>
        <div className="cmdk-list" id={listId} role="listbox" aria-label="Commands">
          {results.length === 0 && <p className="field-hint">No command matches “{query}”.</p>}
          {results.map((c, i) => {
            const Icon = c.icon;
            const heading = !query && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id} role="presentation">
                {heading && <div className="cmdk-group" role="presentation">{heading}</div>}
                <button
                  id={`${listId}-${c.id}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === current}
                  aria-disabled={c.disabled || undefined}
                  disabled={c.disabled}
                  className="cmdk-item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  {Icon && <Icon aria-hidden="true" />}
                  <span>{c.label}</span>
                  {c.keys && <kbd>{keyParts(c.keys).join(' ')}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

export default CommandPalette;
