import Dialog from '../ui/Dialog.jsx';
import { SHORTCUT_GROUPS, keyParts } from '../../data/shortcuts.js';

function ShortcutsDialog({ onClose }) {
  return (
    <Dialog title="Keyboard shortcuts" description="Shortcuts work when you are not typing in a panel field." onClose={onClose} size="lg">
      <div className="shortcuts">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.items.map((s) => (
                <div key={s.id} style={{ display: 'contents' }}>
                  <dt>{s.label}</dt>
                  <dd>{keyParts(s.keys).map((k) => <kbd key={k}>{k}</kbd>)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export default ShortcutsDialog;
