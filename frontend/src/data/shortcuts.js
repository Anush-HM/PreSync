// The editor's keyboard shortcuts, for the shortcuts help and the
// command palette. `keys` uses Mod for Ctrl (⌘ on a Mac).

export const SHORTCUT_GROUPS = [
  {
    title: 'General',
    items: [
      { id: 'palette', label: 'Command palette', keys: 'Mod+K' },
      { id: 'shortcuts', label: 'Keyboard shortcuts', keys: 'Mod+/' },
      { id: 'save', label: 'Save a snapshot', keys: 'Mod+S' },
      { id: 'undo', label: 'Undo', keys: 'Mod+Z' },
      { id: 'redo', label: 'Redo', keys: 'Mod+Shift+Z' },
      { id: 'cancel', label: 'Cancel the format painter', keys: 'Esc' }
    ]
  },
  {
    title: 'Elements',
    items: [
      { id: 'duplicate', label: 'Duplicate', keys: 'Mod+D' },
      { id: 'delete', label: 'Delete', keys: 'Delete' },
      { id: 'group', label: 'Group', keys: 'Mod+G' },
      { id: 'ungroup', label: 'Ungroup', keys: 'Mod+Shift+G' },
      { id: 'nudge', label: 'Nudge 1 px', keys: 'Arrow keys' },
      { id: 'nudge10', label: 'Nudge 10 px', keys: 'Shift+Arrow keys' },
      { id: 'nosnap', label: 'Move without snapping', keys: 'Hold Alt while dragging' },
      { id: 'paste', label: 'Paste a picture', keys: 'Mod+V' }
    ]
  },
  {
    title: 'Text',
    items: [
      { id: 'bold', label: 'Bold', keys: 'Mod+B' },
      { id: 'italic', label: 'Italic', keys: 'Mod+I' },
      { id: 'underline', label: 'Underline', keys: 'Mod+U' },
      { id: 'bullets', label: 'Bulleted list', keys: 'Mod+Shift+8' },
      { id: 'numbers', label: 'Numbered list', keys: 'Mod+Shift+7' },
      { id: 'indent', label: 'Indent or outdent a list item', keys: 'Tab / Shift+Tab' }
    ]
  },
  {
    title: 'Tables',
    items: [
      { id: 'nextcell', label: 'Next cell (adds a row at the end)', keys: 'Tab' },
      { id: 'prevcell', label: 'Previous cell', keys: 'Shift+Tab' }
    ]
  }
];

const BY_ID = new Map(SHORTCUT_GROUPS.flatMap((g) => g.items).map((s) => [s.id, s.keys]));

export function shortcutFor(id) {
  return BY_ID.get(id) || null;
}

export function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

// 'Mod+Shift+Z' → ['Ctrl', 'Shift', 'Z'] (or ['⌘', '⇧', 'Z'] on a Mac).
export function keyParts(keys, mac = isMac()) {
  if (!keys) return [];
  if (/\s/.test(keys.replace(/\+/g, ''))) return [keys]; // prose such as "Arrow keys"
  const map = mac ? { Mod: '⌘', Shift: '⇧', Alt: '⌥' } : { Mod: 'Ctrl' };
  return keys.split('+').map((k) => map[k] || k);
}

// Commands whose words all appear in the label, group or keywords,
// best matches (label starts with the query) first.
export function filterCommands(commands, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return commands;
  const q = query.trim().toLowerCase();
  return commands
    .filter((c) => {
      const hay = `${c.label} ${c.group || ''} ${c.keywords || ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)));
}
