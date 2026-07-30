import { Link } from 'react-router-dom';
import './Navbar.css';

function Navbar() {
  return (
    <nav>
      <div className="nav-inner">
        <Link to="/" className="logo">
          <span className="logo-mark">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M2 13 Q5 6 8 13 T14 13" stroke="#4FA8FF" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
              <path d="M2 7 Q5 14 8 7 T14 7" stroke="#FFB454" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
            </svg>
          </span>
          PreSync
        </Link>
        <div className="nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#access">Roles</a>
        </div>
        <div className="nav-actions">
          <Link to="/join" className="btn btn-ghost mono">Join with code</Link>
          <Link to="/decks" className="btn btn-solid">Sign in</Link>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;