import { Link } from 'react-router-dom';

// The PreSync mark: two stacked slides in forest green, with a small
// crimson "live" point. Used by every navbar, sidebar and footer.
export function LogoMark({ size = 26 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 28 28" fill="none">
        <rect x="1" y="1" width="26" height="26" rx="7" fill="#285C43" />
        <rect x="6.5" y="9" width="12" height="9" rx="1.8" stroke="#A3D4B2" strokeWidth="1.6" opacity="0.55" />
        <rect x="9.5" y="11.5" width="12" height="9" rx="1.8" fill="#171A19" stroke="#F2F4F0" strokeWidth="1.6" />
        <circle cx="21.5" cy="7" r="2.4" fill="#AC3045" />
      </svg>
    </span>
  );
}

function Logo({ to = '/', label = 'PreSync' }) {
  return (
    <Link to={to} className="logo" aria-label={`${label} home`}>
      <LogoMark />
      <span className="logo-word">{label}</span>
    </Link>
  );
}

export default Logo;
