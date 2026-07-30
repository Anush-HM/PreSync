import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import DecksPage from './pages/DecksPage.jsx';
import EditorPage from './pages/EditorPage.jsx';
import PresenterPage from './pages/PresenterPage.jsx';
import ViewerJoinPage from './pages/ViewerJoinPage.jsx';
import ViewerLivePage from './pages/ViewerLivePage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/decks" element={<DecksPage />} />
      <Route path="/editor/:deckId" element={<EditorPage />} />
      <Route path="/presenter/:roomCode" element={<PresenterPage />} />
      <Route path="/join" element={<ViewerJoinPage />} />
      <Route path="/view/:roomCode" element={<ViewerLivePage />} />
    </Routes>
  );
}

export default App;