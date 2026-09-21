import { Link } from 'react-router-dom';
import './NotFound.css';

function NotFound() {
  return (
    <div className="notfound-page">
      <div className="notfound-inner">
        <div className="eyebrow"><span className="dot"></span>404 — PAGE NOT FOUND</div>
        <h1 className="notfound-code">404</h1>
        <p className="notfound-msg">
          This page doesn't exist. Check the URL or head back to where you started.
        </p>
        <div className="notfound-actions">
          <Link to="/" className="btn btn-amber">Back to home</Link>
          <Link to="/join" className="btn btn-ghost mono">Join with a code →</Link>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
