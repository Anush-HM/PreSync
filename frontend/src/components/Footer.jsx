import { Link } from 'react-router-dom';
import './Footer.css';

function Footer() {
  return (
    <footer>
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="logo">
            <span className="logo-mark">
              <svg viewBox="0 0 20 20" fill="none">
                <path d="M2 13 Q5 6 8 13 T14 13" stroke="#4FA8FF" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
                <path d="M2 7 Q5 14 8 7 T14 7" stroke="#FFB454" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
              </svg>
            </span>
            PreSync
          </div>
          <p>One shared deck. Editors stay concurrent, the room stays synced — two sync models, running at once, on purpose.</p>
        </div>
        <div className="footer-col">
          <h4>Product</h4>
          <ul>
            <li><a href="#features">Features</a></li>
            <li><a href="#how-it-works">How it works</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Roles</h4>
          <ul>
            <li><Link to="/login">Editor login</Link></li>
            <li><Link to="/join">Join with a code</Link></li>
            <li><Link to="/decks">Start a session</Link></li>
          </ul>
        </div>
        <div className="footer-col">
          <h4>Company</h4>
          <ul>
            <li><a href="#">About</a></li>
            <li><a href="#">Contact</a></li>
            <li><a href="#">Privacy</a></li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 PreSync. All rights reserved.</span>
        <span>Built on Yjs · Socket.io · MERN</span>
      </div>
    </footer>
  );
}

export default Footer;