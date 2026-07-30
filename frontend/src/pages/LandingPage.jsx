import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import FeatureCard from '../components/FeatureCard.jsx';
import './LandingPage.css';

const FEATURES = [
  {
    tagLabel: 'Editors',
    tagColor: 'blue',
    title: 'Edit together, live',
    description: 'Add slides, retype content, move things around — with your team, at the same time, with nothing to save or merge.'
  },
  {
    tagLabel: 'Presenter',
    tagColor: 'amber',
    title: 'A stable view for the room',
    description: 'Whatever the presenter shows is snapshotted the instant they arrive on it — so background edits never flash on screen mid-talk.'
  },
  {
    tagLabel: 'Viewers',
    tagColor: 'amber',
    title: 'Notes that wait for you',
    description: "Jot a private note on any slide. If the presenter moves on while you're mid-thought, your view waits until you hit Done."
  },
  {
    tagLabel: 'Q&A',
    tagColor: 'blue',
    title: 'Answers grounded in the deck',
    description: 'Questions get a drafted answer pulled only from what\'s actually on the slides — or an honest "not covered" if it isn\'t.'
  }
];

const STEPS = [
  {
    num: '01',
    role: 'EDITOR',
    roleColor: 'blue',
    title: 'Upload your deck',
    description: 'Drop in a PDF exported from PowerPoint, Slides, or Keynote. PreSync reads the real text and rebuilds it as editable content — not a flattened picture.'
  },
  {
    num: '02',
    role: 'EDITOR',
    roleColor: 'blue',
    title: 'Edit together',
    description: 'Retype text, add blocks, reorder slides — with as many teammates as you need, all changes visible instantly, no locking.'
  },
  {
    num: '03',
    role: 'PRESENTER',
    roleColor: 'amber',
    title: 'Go live',
    description: 'Start a session and get a room code. From here, your view is what the room sees — editing continues safely in the background.'
  },
  {
    num: '04',
    role: 'VIEWER',
    roleColor: 'amber',
    title: 'Join with a code',
    description: 'No account needed. Enter the code, add a name, and follow along — take notes, ask questions, stay in sync.'
  }
];

function LandingPage() {
  return (
    <>
      <Navbar />

      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow"><span className="dot"></span>TWO SYNC MODELS, ONE DOCUMENT</div>
            <h1>
              One deck. <span className="accent-blue">Editors stay live.</span><br />
              <span className="accent-amber">Everyone else stays in sync.</span>
            </h1>
            <p className="sub">
              Your team edits the deck together in real time. Your audience always sees exactly
              what's on screen — nothing half-finished, nothing out of sync.
            </p>
            <div className="hero-ctas">
              <Link to="/decks" className="btn btn-amber">Start presenting</Link>
              <Link to="/join" className="btn btn-ghost mono">Join with a code →</Link>
            </div>
            <div className="hero-note">No download. No install. Viewers need nothing but a 6-character code.</div>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        <div className="section-head">
          <div className="eyebrow">WHAT PRESYNC DOES</div>
          <h2>Four systems, one room</h2>
          <p>Each one solves a different problem. Together, they let a team build and present without ever tripping over each other.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </section>

      <section id="how-it-works">
        <div className="section-head">
          <div className="eyebrow">HOW IT WORKS</div>
          <h2>From upload to live in four steps</h2>
          <p>Real order matters here — each step depends on the one before it.</p>
        </div>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.num}>
              <div className="step-num"><span className="n">{s.num}</span></div>
              <div className="step-body">
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                <span
                  className="role-chip"
                  style={{
                    background: s.roleColor === 'blue' ? 'var(--blue-dim)' : 'var(--amber-dim)',
                    color: s.roleColor === 'blue' ? 'var(--blue)' : 'var(--amber)'
                  }}
                >
                  {s.role}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </>
  );
}

export default LandingPage;