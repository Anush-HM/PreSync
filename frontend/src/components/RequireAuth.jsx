import { Navigate, useLocation } from 'react-router-dom';
import { isLoggedIn } from '../data/apiConfig.js';

// Wraps editor-only routes (decks, editor, presenter). Viewer routes
// (/join, /view/:roomCode) are intentionally never wrapped in this —
// that path stays code + display name, no account, per the spec.
function RequireAuth({ children }) {
  const location = useLocation();
  if (!isLoggedIn()) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}

export default RequireAuth;