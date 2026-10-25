import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Presentation, Users, Radio, LogOut, Menu as MenuIcon, X, LogIn } from 'lucide-react';
import Logo from '../ui/Logo.jsx';
import Avatar from '../ui/Avatar.jsx';
import { clearAuthToken, getCurrentUser } from '../../data/apiConfig.js';
import './AppShell.css';

// Only sections backed by real data are listed here. Templates, Trash
// and Settings will join once the backend supports them.
const NAV = [
  { to: '/decks', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/decks/mine', label: 'My Presentations', icon: Presentation },
  { to: '/decks/shared', label: 'Shared With Me', icon: Users },
  { to: '/sessions', label: 'Live Sessions', icon: Radio }
];

// Signed-in layout: a sidebar on desktop, an off-canvas drawer with a
// compact top bar below 1024px.
function AppShell({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getCurrentUser();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function handleSignOut() {
    clearAuthToken();
    navigate('/', { replace: true });
  }

  return (
    <div className={`app-shell${drawerOpen ? ' drawer-open' : ''}`}>
      <header className="app-topbar">
        <button
          type="button"
          className="icon-btn"
          aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={drawerOpen}
          aria-controls="app-sidebar"
          onClick={() => setDrawerOpen((o) => !o)}
        >
          {drawerOpen ? <X /> : <MenuIcon />}
        </button>
        <Logo to="/decks" />
        <span className="app-topbar-spacer" />
        <Avatar person={user ? { id: user.id, name: user.name, email: user.email } : null} size={30} />
      </header>

      <div className="app-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />

      <aside id="app-sidebar" className="app-sidebar" aria-label="Main navigation">
        <div className="app-sidebar-logo"><Logo to="/decks" /></div>
        <nav className="app-nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `app-nav-link${isActive ? ' active' : ''}`}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <div className="app-nav-sep" />
          <NavLink to="/join" className="app-nav-link">
            <LogIn aria-hidden="true" />
            <span>Join a session</span>
          </NavLink>
        </nav>

        <div className="app-account">
          {user ? (
            <>
              <Avatar person={{ id: user.id, name: user.name, email: user.email }} size={34} />
              <div className="app-account-text">
                <span className="app-account-name">{user.name || user.email}</span>
                {user.name && <span className="app-account-email">{user.email}</span>}
              </div>
            </>
          ) : <span className="app-account-text" />}
          <button type="button" className="icon-btn" aria-label="Sign out" data-tip="Sign out" onClick={handleSignOut}>
            <LogOut />
          </button>
        </div>
      </aside>

      <main className="app-main" id="main">
        <div className="app-main-inner">{children}</div>
      </main>
    </div>
  );
}

export default AppShell;
