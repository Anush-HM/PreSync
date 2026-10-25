import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu as MenuIcon, X } from 'lucide-react';
import Logo from './ui/Logo.jsx';
import { isLoggedIn } from '../data/apiConfig.js';
import './Navbar.css';

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#collaboration', label: 'Collaboration' },
  { href: '#documentation', label: 'Documentation' }
];

// Public site navigation. On small screens the links fold into a menu.
function Navbar() {
  const loggedIn = isLoggedIn();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('');

  // Highlight the section currently in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const targets = LINKS.map((l) => document.querySelector(l.href)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(`#${e.target.id}`); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  return (
    <header className="site-nav">
      <div className="site-nav-inner">
        <Logo />
        <nav className={`site-nav-links${open ? ' open' : ''}`} aria-label="Site">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={active === l.href ? 'active' : undefined}
              aria-current={active === l.href ? 'true' : undefined}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <div className="site-nav-mobile-actions">
            {loggedIn ? (
              <Link to="/decks" className="btn btn-primary btn-block">Open dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-block">Sign In</Link>
                <Link to="/login?mode=register" className="btn btn-primary btn-block">Get Started</Link>
              </>
            )}
          </div>
        </nav>
        <div className="site-nav-actions">
          <Link to="/join" className="btn btn-quiet">Join a session</Link>
          {loggedIn ? (
            <Link to="/decks" className="btn btn-primary">Open dashboard</Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">Sign In</Link>
              <Link to="/login?mode=register" className="btn btn-primary">Get Started</Link>
            </>
          )}
        </div>
        <button
          type="button"
          className="icon-btn site-nav-toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X /> : <MenuIcon />}
        </button>
      </div>
    </header>
  );
}

export default Navbar;
