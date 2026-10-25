import { Link } from 'react-router-dom';
import Logo from './ui/Logo.jsx';
import './Footer.css';

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>A collaborative presentation studio: build slides together, then present them live to an audience that follows along.</p>
        </div>
        <nav className="footer-col" aria-label="Product">
          <h4>Product</h4>
          <ul>
            <li><a href="#features">Features</a></li>
            <li><a href="#how-it-works">How it works</a></li>
            <li><a href="#collaboration">Collaboration</a></li>
            <li><a href="#live">Live sessions</a></li>
          </ul>
        </nav>
        <nav className="footer-col" aria-label="Get started">
          <h4>Get started</h4>
          <ul>
            <li><Link to="/login?mode=register">Create an account</Link></li>
            <li><Link to="/login">Sign in</Link></li>
            <li><Link to="/join">Join a session</Link></li>
          </ul>
        </nav>
        <nav className="footer-col" aria-label="Documentation and support">
          <h4>Docs &amp; support</h4>
          <ul>
            <li><a href="#documentation">Supported formats</a></li>
            <li><a href="#shortcuts">Keyboard shortcuts</a></li>
            <li><a href="#security">Security &amp; data</a></li>
          </ul>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} PreSync</span>
        <span className="mono">Built with React, Yjs and Socket.IO</span>
      </div>
    </footer>
  );
}

export default Footer;
