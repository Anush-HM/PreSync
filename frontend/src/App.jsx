import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';

// EditorPage, PresenterPage, and ViewerJoinPage will be added as we build
// those screens next — placeholders kept out for now to avoid dead imports.

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
    </Routes>
  );
}

export default App;