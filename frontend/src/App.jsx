import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DecksPage from './pages/DecksPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import PresenterPage from './pages/PresenterPage.jsx';
import ViewerJoinPage from './pages/ViewerJoinPage.jsx';
import ViewerLivePage from './pages/ViewerLivePage.jsx';
import RequireAuth from './components/RequireAuth.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/decks" element={<RequireAuth><DecksPage /></RequireAuth>} />
      <Route path="/editor/:deckId" element={<RequireAuth><EditorPage /></RequireAuth>} />
      <Route path="/presenter/:roomCode" element={<RequireAuth><PresenterPage /></RequireAuth>} />
      <Route path="/join" element={<ViewerJoinPage />} />
      <Route path="/view/:roomCode" element={<ViewerLivePage />} />
    </Routes>
  );
}

export default App;