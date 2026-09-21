import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import RequireAuth from './components/RequireAuth.jsx';

// LandingPage and NotFound are kept in the main bundle — they're the
// first and last things a user might see, and are tiny.
import LandingPage from './pages/LandingPage.jsx';
import NotFound from './pages/NotFound.jsx';

// Everything else is lazy-loaded on demand. EditorPage alone pulls in
// fabric.js + yjs which is most of what pushed the single-bundle build
// past the 500kB warning threshold.
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const DecksPage = lazy(() => import('./pages/DecksPage.jsx'));
const EditorPage = lazy(() => import('./pages/EditorPage.jsx'));
const PresenterPage = lazy(() => import('./pages/PresenterPage.jsx'));
const ViewerJoinPage = lazy(() => import('./pages/ViewerJoinPage.jsx'));
const ViewerLivePage = lazy(() => import('./pages/ViewerLivePage.jsx'));

function RouteFallback() {
  return <div className="route-fallback mono">Loading…</div>;
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/decks" element={<RequireAuth><DecksPage /></RequireAuth>} />
        <Route path="/editor/:deckId" element={<RequireAuth><EditorPage /></RequireAuth>} />
        <Route path="/presenter/:roomCode" element={<RequireAuth><PresenterPage /></RequireAuth>} />
        <Route path="/join" element={<ViewerJoinPage />} />
        <Route path="/view/:roomCode" element={<ViewerLivePage />} />
        {/* Catch-all — must be last */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;