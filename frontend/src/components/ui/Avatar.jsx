import './ui.css';

// Muted, theme-safe avatar tints. Picked by a stable hash of the id so a
// person keeps the same colour everywhere they appear.
const TINTS = ['#2F6B4D', '#3E5A4A', '#4B6B5C', '#5C4A3A', '#6B3A46', '#3A4F5C', '#4F4A62'];

function initialsFor(nameOrEmail = '') {
  const base = nameOrEmail.split('@')[0].trim();
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tintFor(id = '') {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

function Avatar({ person, size = 28, ring }) {
  const label = person?.name || person?.email || 'Unknown';
  return (
    <span
      className="avatar"
      title={label}
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.38),
        background: person?.color || tintFor(person?.id || label),
        boxShadow: ring ? `0 0 0 2px ${ring}` : undefined
      }}
    >
      <span aria-hidden="true">{initialsFor(label)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 26 }) {
  if (!people?.length) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p, i) => <Avatar key={p.id || p.email || i} person={p} size={size} />)}
      {extra > 0 && (
        <span className="avatar avatar-more" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} title={`${extra} more`}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export default Avatar;
