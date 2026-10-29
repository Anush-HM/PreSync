import { layoutById, PROMPT_COLOR, slideFromLayout } from './layouts.js';
import { themeById } from './themes.js';

// PreSync's starter templates: original decks built from the app's own
// layouts and themes, with example copy written for this file. Each
// slide names a layout and the text for its text slots, in slot order.

export const TEMPLATES = [
  {
    id: 'pitch',
    name: 'Startup pitch',
    description: 'Problem, solution, market and the ask, in eight slides.',
    theme: 'studio',
    slides: [
      { layout: 'title', texts: ['Company name', 'One line on what you do · Founder name'] },
      { layout: 'title-content', texts: ['The problem', '• Who has it, and how often\n• What it costs them today\n• Why current options fall short'] },
      { layout: 'title-content', texts: ['Our solution', '• What the product does in one sentence\n• The moment customers say “finally”\n• Why now'] },
      { layout: 'kpi', texts: ['Traction', '1,200', '38%', '4.8★', 'Weekly active teams', 'Month-on-month growth', 'Average review score'] },
      { layout: 'two-column', texts: ['Market', '• Total market and how you sized it\n• The first segment you will win', '• How you reach customers\n• What it costs to acquire one'] },
      { layout: 'process', texts: ['Business model', '1. Free plan\nTeams try it with no card', '2. Team plan\nPer-seat monthly pricing', '3. Enterprise\nSecurity, support and SSO'] },
      { layout: 'comparison', texts: ['Why we win', 'Us', 'Alternatives', '• Set up in minutes\n• Works where teams already are', '• Weeks of onboarding\n• Another tab to keep open'] },
      { layout: 'closing', texts: ['The ask', 'Raising a seed round · founder@example.com'] }
    ]
  },
  {
    id: 'lesson',
    name: 'Lesson plan',
    description: 'Objectives, key ideas, an activity and a recap for a class.',
    theme: 'forest',
    slides: [
      { layout: 'title', texts: ['Lesson title', 'Course name · Week 1'] },
      { layout: 'title-content', texts: ['By the end of this lesson', '• You can explain the main idea in your own words\n• You can apply it to a new example\n• You know where to read more'] },
      { layout: 'section', texts: ['Key idea', 'The one thing to remember from today'] },
      { layout: 'image-text', texts: ['An example', 'Walk through a real case step by step, and point out where the key idea shows up.'] },
      { layout: 'timeline', texts: ['Activity', '5 min', '10 min', '10 min', '5 min', 'Read the brief', 'Work in pairs', 'Share with the class', 'Reflect'] },
      { layout: 'title-content', texts: ['Recap', '• The key idea\n• How the example used it\n• Homework: one page applying it'] },
      { layout: 'closing', texts: ['Questions?', 'Office hours · Tuesdays 2–4 pm'] }
    ]
  },
  {
    id: 'project-update',
    name: 'Project update',
    description: 'Status, progress, risks and next steps for a weekly review.',
    theme: 'paper',
    slides: [
      { layout: 'title', texts: ['Project name: status update', 'Team name · Date'] },
      { layout: 'kpi', texts: ['At a glance', 'On track', '72%', '3', 'Overall status', 'Scope complete', 'Open risks'] },
      { layout: 'two-column', texts: ['Progress', '• Done this week\n• Shipped to users', '• In progress\n• Blocked, and on what'] },
      { layout: 'timeline', texts: ['Milestones', 'Discovery', 'Build', 'Beta', 'Launch', 'Complete', 'In progress', 'Next month', 'Target date'] },
      { layout: 'title-content', texts: ['Risks and decisions needed', '• Risk, its impact, and the mitigation\n• A decision we need, by when, and from whom'] },
      { layout: 'title-content', texts: ['Next steps', '• Owner: action, due date\n• Owner: action, due date'] }
    ]
  },
  {
    id: 'quarterly',
    name: 'Quarterly review',
    description: 'Results against goals, highlights and the plan for next quarter.',
    theme: 'harbor',
    slides: [
      { layout: 'title', texts: ['Q3 business review', 'Department · Presenter'] },
      { layout: 'kpi', texts: ['Results', '$2.4M', '112%', '+9', 'Revenue this quarter', 'Of target', 'Net promoter score change'] },
      { layout: 'comparison', texts: ['Goals and outcomes', 'What we planned', 'What happened', '• Goal one\n• Goal two\n• Goal three', '• Met, with a note\n• Partly met, and why\n• Moved to next quarter'] },
      { layout: 'image-caption', texts: ['Highlight of the quarter', 'A picture of the launch, the team or the result'] },
      { layout: 'section', texts: ['Next quarter', 'Where we will focus'] },
      { layout: 'title-content', texts: ['Plan', '• Priority one and how we will measure it\n• Priority two and how we will measure it\n• What we will stop doing'] },
      { layout: 'closing', texts: ['Thank you', 'Questions and discussion'] }
    ]
  },
  {
    id: 'workshop',
    name: 'Workshop',
    description: 'Agenda, warm-up, exercises and takeaways for a session.',
    theme: 'sand',
    slides: [
      { layout: 'title', texts: ['Workshop title', 'Facilitator · Location'] },
      { layout: 'timeline', texts: ['Agenda', 'Welcome', 'Warm-up', 'Exercises', 'Wrap-up', '10:00', '10:15', '10:45', '11:45'] },
      { layout: 'title-content', texts: ['Ground rules', '• Every idea is welcome\n• One conversation at a time\n• Phones away during exercises'] },
      { layout: 'process', texts: ['Exercise', '1. Diverge\nWrite as many ideas as you can', '2. Cluster\nGroup similar ideas together', '3. Vote\nPick the three to develop'] },
      { layout: 'title-content', texts: ['Takeaways', '• What we decided\n• Who follows up on what\n• When we meet again'] },
      { layout: 'closing', texts: ['Thank you for joining', 'Share feedback · workshop@example.com'] }
    ]
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'A short case-study deck to show your work.',
    theme: 'mono',
    slides: [
      { layout: 'title', texts: ['Your name', 'Designer · Selected work'] },
      { layout: 'image-text', texts: ['About me', 'A few sentences about what you do, who you have worked with and what you care about.'] },
      { layout: 'image-caption', texts: ['Project one', 'Client · Year · Your role'] },
      { layout: 'two-column', texts: ['The brief and the result', '• The problem the client brought\n• Constraints you worked within', '• What you made\n• What changed because of it'] },
      { layout: 'image-caption', texts: ['Project two', 'Client · Year · Your role'] },
      { layout: 'closing', texts: ['Let’s work together', 'hello@example.com · example.com'] }
    ]
  }
];

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

// The slides for a new deck made from `template`. Example text fills the
// layout's text slots in order and is ordinary, editable text.
export function buildTemplateSlides(template) {
  const theme = themeById(template.theme);
  return template.slides.map((spec, order) => {
    const layout = layoutById(spec.layout) || layoutById('blank');
    const slide = slideFromLayout(layout, order, theme);
    const texts = spec.texts || [];
    let i = 0;
    slide.blocks = slide.blocks.map((b) => {
      if (b.type !== 'textbox' || !b.layoutSlot || i >= texts.length) return b;
      const text = texts[i++];
      if (text == null) return b;
      // A filled slot is content now, so a later layout change keeps it.
      const { layoutSlot, ...rest } = b;
      void layoutSlot;
      return { ...rest, text, fill: b.fill === PROMPT_COLOR && theme ? theme.text : b.fill };
    });
    slide.theme = template.theme;
    return slide;
  });
}
