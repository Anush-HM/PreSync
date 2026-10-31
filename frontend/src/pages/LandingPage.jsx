import { Link } from 'react-router-dom';
import {
  Users, Upload, Radio, MessageSquareText, NotebookPen, FileDown,
  ShieldCheck, KeyRound, EyeOff, Lock, ArrowRight, Check, FileText, Presentation,
  MousePointer2, Undo2, Redo2, Play, Share2, Plus, Type, Bold, Italic, AlignLeft
} from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import FeatureCard from '../components/FeatureCard.jsx';
import { isLoggedIn } from '../data/apiConfig.js';
import './LandingPage.css';

const FEATURES = [
  {
    icon: Users,
    title: 'Edit together, live',
    description: 'Teammates edit the same slides at the same time. Changes merge automatically, and you can see who is on which slide.'
  },
  {
    icon: Upload,
    title: 'Bring your existing slides',
    description: 'Import PowerPoint and PDF files as slides, and review what PreSync found before anything is created. Word documents open in their own editor.'
  },
  {
    icon: Radio,
    title: 'Present to a live audience',
    description: 'Start a session and share a 6-character code. Viewers follow the presenter’s slide on any device, with no account.'
  },
  {
    icon: MessageSquareText,
    title: 'Q&A grounded in your deck',
    description: 'Audience questions can get an AI-drafted answer built only from your slides. Nothing is sent until the presenter approves it.'
  },
  {
    icon: NotebookPen,
    title: 'Private viewer notes',
    description: 'Viewers jot notes against any slide. Their view waits while they write, even if the presenter moves on.'
  },
  {
    icon: FileDown,
    title: 'Export when you’re done',
    description: 'Download the deck as PowerPoint with editable text and speaker notes, or as a PDF.'
  }
];

const STEPS = [
  { num: '01', title: 'Create or import', description: 'Start from a blank presentation, or upload a .pptx or PDF and review the structure PreSync extracts.' },
  { num: '02', title: 'Edit together', description: 'Invite teammates by email. Everyone edits the same deck in real time; edits autosave and Save writes them to the database immediately.' },
  { num: '03', title: 'Go live', description: 'Choose Present to open the presenter view and get a session code. Editing can continue safely in the background.' },
  { num: '04', title: 'Audience joins', description: 'Viewers enter the code and a name, follow along, take private notes and ask questions.' }
];

const SECURITY = [
  { icon: KeyRound, title: 'Hashed passwords', text: 'Passwords are stored as bcrypt hashes, never in plain text. Signed tokens authorise every editor request.' },
  { icon: Lock, title: 'Editors only', text: 'Only a deck’s owner and the collaborators they invite can open, edit, export or present it.' },
  { icon: EyeOff, title: 'Viewers see the stage, nothing more', text: 'Audience members receive only the slide on screen. Speaker notes and the rest of the deck never reach them.' },
  { icon: ShieldCheck, title: 'You approve every answer', text: 'AI-drafted Q&A answers stay private to the presenter until they choose to send them.' }
];

const SHORTCUTS = [
  { keys: ['Ctrl', 'S'], action: 'Save now' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo (also Ctrl + Y)' },
  { keys: ['Ctrl', 'D'], action: 'Duplicate selection' },
  { keys: ['Delete'], action: 'Delete selection' },
  { keys: ['→', 'Space'], action: 'Next slide while presenting' },
  { keys: ['←'], action: 'Previous slide while presenting' }
];

// Static illustration of the editor for the hero. It is decorative, so
// it is hidden from assistive tech and described by its caption.
function ProductPreview() {
  return (
    <figure className="preview" aria-label="Illustration of the PreSync editor">
      <div className="preview-window" aria-hidden="true">
        <div className="preview-toolbar">
          <span className="preview-dots"><i /><i /><i /></span>
          <span className="preview-title">Product launch plan</span>
          <span className="preview-tools"><Undo2 /><Redo2 /></span>
          <span className="preview-spacer" />
          <span className="preview-presence">
            <span className="preview-avatar" style={{ background: '#2F6B4D' }}>MA</span>
            <span className="preview-avatar" style={{ background: '#6B3A46' }}>JS</span>
          </span>
          <span className="preview-btn"><Share2 />Share</span>
          <span className="preview-btn is-primary"><Play />Present</span>
        </div>
        <div className="preview-body">
          <div className="preview-rail">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`preview-thumb${i === 1 ? ' is-active' : ''}`}>
                <span className="preview-thumb-num mono">{i + 1}</span>
                <div className="preview-thumb-slide">
                  <i style={{ width: i === 0 ? '70%' : '55%' }} />
                  <i style={{ width: '80%' }} />
                  <i style={{ width: '60%' }} />
                </div>
              </div>
            ))}
            <div className="preview-add"><Plus /></div>
          </div>
          <div className="preview-stage">
            <div className="preview-slide">
              <span className="preview-slide-kicker">Q3 roadmap</span>
              <span className="preview-slide-h">Launch in three phases</span>
              <div className="preview-slide-cols">
                {['Private beta', 'Public preview', 'General availability'].map((t, i) => (
                  <div key={t} className="preview-slide-col">
                    <b className="mono">0{i + 1}</b>
                    <span>{t}</span>
                    <i /><i />
                  </div>
                ))}
              </div>
              <div className="preview-selection"><span /><span /><span /><span /></div>
              <div className="preview-cursor" style={{ color: '#A3D4B2' }}>
                <MousePointer2 />
                <em style={{ background: '#2F6B4D' }}>Maya</em>
              </div>
            </div>
          </div>
          <div className="preview-panel">
            <span className="preview-panel-h">Text</span>
            <div className="preview-field">Public Sans</div>
            <div className="preview-row">
              <div className="preview-field">36</div>
              <span className="preview-icon is-on"><Bold /></span>
              <span className="preview-icon"><Italic /></span>
              <span className="preview-icon"><AlignLeft /></span>
            </div>
            <span className="preview-panel-h">Colour</span>
            <div className="preview-swatches">
              {['#171A19', '#285C43', '#8F2638', '#F2F4F0', '#E4B66A'].map((c) => <i key={c} style={{ background: c }} />)}
            </div>
            <span className="preview-panel-h">Slide</span>
            <div className="preview-field"><Type />Layout: Title + 3 columns</div>
          </div>
        </div>
        <div className="preview-status">
          <span className="preview-live"><span className="live-dot" />Live · <span className="mono">K7QX2M</span></span>
          <span className="preview-saved"><Check />All changes saved</span>
        </div>
      </div>
      <figcaption className="sr-only">
        The editor shows slide thumbnails on the left, the slide canvas in the middle and text formatting on the right,
        with collaborators’ avatars, a Present button and live-session status.
      </figcaption>
    </figure>
  );
}

function LandingPage() {
  const startHref = isLoggedIn() ? '/decks' : '/login?mode=register';

  return (
    <div className="landing">
      <Navbar />

      <main>
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-inner">
            <span className="eyebrow"><span className="dot" />Collaborative presentation studio</span>
            <h1 className="hero-title">
              Your ideas. <span className="editorial">One shared stage.</span>
            </h1>
            <p className="hero-sub">
              Create presentations, collaborate in real time, and turn documents into engaging presentations.
              PreSync brings your content, teammates, and audience together in one workspace.
            </p>
            <div className="hero-ctas">
              <Link to={startHref} className="btn btn-primary btn-lg">Create a Presentation <ArrowRight /></Link>
              <a href="#features" className="btn btn-secondary btn-lg">Explore PreSync</a>
            </div>
            <p className="hero-note">Audiences join with a code. No download, no account.</p>
          </div>
          <ProductPreview />
        </section>

        <section id="features" className="landing-section">
          <div className="section-head">
            <span className="eyebrow">What PreSync does</span>
            <h2>Everything between the first draft and the last question</h2>
            <p>One workspace for building slides with your team and presenting them to the room.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => <FeatureCard key={f.title} {...f} />)}
          </div>
        </section>

        <section id="how-it-works" className="landing-section landing-alt">
          <div className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>From file to live session in four steps</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s) => (
              <li className="step" key={s.num}>
                <span className="step-num mono">{s.num}</span>
                <h3>{s.title}</h3>
                <p>{s.description}</p>
              </li>
            ))}
          </ol>

          <div className="import-flow" aria-label="Import workflow">
            <div className="import-flow-file">
              <span className="file-chip"><FileText aria-hidden="true" />remote-work-policy.docx</span>
              <span className="file-chip"><Presentation aria-hidden="true" />quarterly-review.pptx</span>
            </div>
            <ArrowRight className="import-flow-arrow" aria-hidden="true" />
            <ul className="import-flow-list">
              <li><Check aria-hidden="true" />Word documents open in the document editor with headings, lists, tables and pictures intact</li>
              <li><Check aria-hidden="true" />PowerPoint slide order, text boxes and their positions</li>
              <li><Check aria-hidden="true" />Fonts, sizes, bold / italic / underline, colours, alignment</li>
              <li><Check aria-hidden="true" />Pictures, slide backgrounds and speaker notes (PowerPoint)</li>
              <li className="is-limit">Tables, charts, SmartArt and animations are not imported yet</li>
            </ul>
          </div>
        </section>

        <section id="collaboration" className="landing-section">
          <div className="split">
            <div className="split-copy">
              <span className="eyebrow">Real-time collaboration</span>
              <h2>Everyone on the same deck, at the same time</h2>
              <p>
                PreSync syncs every edit through a shared document, so there is nothing to merge and no one gets locked out.
                Collaborators see each other’s cursors on the slide they are working on.
              </p>
              <ul className="check-list">
                <li><Check aria-hidden="true" />Invite co-editors by email</li>
                <li><Check aria-hidden="true" />Live presence and cursors per slide</li>
                <li><Check aria-hidden="true" />Undo and redo that only touch your own edits</li>
                <li><Check aria-hidden="true" />Autosave, plus Save to write to the database now</li>
              </ul>
            </div>
            <div className="split-visual" aria-hidden="true">
              <div className="presence-card">
                <div className="presence-line"><span className="preview-avatar" style={{ background: '#2F6B4D' }}>MA</span><span>Maya is editing slide 2</span></div>
                <div className="presence-line"><span className="preview-avatar" style={{ background: '#6B3A46' }}>JS</span><span>Jon is editing slide 5</span></div>
                <div className="presence-line is-muted"><Check /><span>All changes saved</span></div>
              </div>
            </div>
          </div>
        </section>

        <section id="live" className="landing-section landing-alt">
          <div className="split split-reverse">
            <div className="split-copy">
              <span className="eyebrow"><span className="live-dot" aria-hidden="true" />Live audience sessions</span>
              <h2>A steady stage for the room</h2>
              <p>
                When you go live, each slide is captured the moment you arrive on it, so edits happening in the background
                never flash on the audience’s screens.
              </p>
              <ul className="check-list">
                <li><Check aria-hidden="true" />Join by code: no app, no account</li>
                <li><Check aria-hidden="true" />Viewers follow your slide in real time</li>
                <li><Check aria-hidden="true" />Questions come to the presenter’s queue</li>
                <li><Check aria-hidden="true" />Session history with attendees and Q&amp;A</li>
              </ul>
            </div>
            <div className="split-visual" aria-hidden="true">
              <div className="session-card">
                <div className="session-card-head">
                  <span className="badge badge-live"><span className="live-dot" />Live</span>
                  <span className="mono session-card-code">K7QX2M</span>
                </div>
                <div className="session-card-q">
                  <span className="session-card-label">Question</span>
                  <p>When does the public preview start?</p>
                </div>
                <div className="session-card-a">
                  <span className="session-card-label">Drafted from slide 2</span>
                  <p>The public preview is phase two of the launch plan.</p>
                  <div className="session-card-actions"><span className="preview-btn is-primary">Send answer</span><span className="preview-btn">Edit</span></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="ai" className="landing-section">
          <div className="section-head">
            <span className="eyebrow">AI assistance, where it helps</span>
            <h2>Draft answers, not decisions</h2>
            <p>
              With an Anthropic API key configured on the server, PreSync drafts answers to audience questions using only what is on your slides.
              If the deck does not cover it, the draft says so. The presenter always reviews, edits or discards before anything is sent.
            </p>
          </div>
        </section>

        <section id="security" className="landing-section landing-alt">
          <div className="section-head">
            <span className="eyebrow">Security and data handling</span>
            <h2>Clear boundaries between editors and the audience</h2>
          </div>
          <div className="security-grid">
            {SECURITY.map(({ icon: Icon, title, text }) => (
              <div key={title} className="security-item">
                <Icon aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="documentation" className="landing-section">
          <div className="section-head">
            <span className="eyebrow">Documentation</span>
            <h2>Supported files and shortcuts</h2>
          </div>
          <div className="docs-grid">
            <div className="docs-card card">
              <h3>Importing</h3>
              <dl className="docs-list">
                <div><dt>Word</dt><dd>.docx up to 25 MB, opened in the document editor. Headings, paragraphs, lists, tables and PNG/JPEG/GIF pictures. Legacy .doc must be re-saved as .docx first.</dd></div>
                <div><dt>PowerPoint</dt><dd>.pptx up to 25 MB. Pictures up to 1.5 MB each, 8 MB per deck. Legacy .ppt must be re-saved as .pptx first.</dd></div>
                <div><dt>PDF</dt><dd>.pdf up to 25 MB. Each page becomes a slide with editable text.</dd></div>
                <div><dt>Export</dt><dd>PowerPoint keeps text editable and includes speaker notes. PDF uses standard fonts and covers Latin text.</dd></div>
              </dl>
            </div>
            <div className="docs-card card" id="shortcuts">
              <h3>Keyboard shortcuts</h3>
              <table className="shortcut-table">
                <tbody>
                  {SHORTCUTS.map((s) => (
                    <tr key={s.action}>
                      <td>{s.keys.map((k, i) => <span key={k}>{i > 0 && ' + '}<kbd className="kbd">{k}</kbd></span>)}</td>
                      <td>{s.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="field-hint">On a Mac, use ⌘ instead of Ctrl.</p>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="final-cta-inner">
            <h2>Put your next presentation on <span className="editorial">one shared stage.</span></h2>
            <div className="hero-ctas">
              <Link to={startHref} className="btn btn-primary btn-lg">Get Started <ArrowRight /></Link>
              <Link to="/join" className="btn btn-ghost btn-lg">Join a session</Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default LandingPage;
