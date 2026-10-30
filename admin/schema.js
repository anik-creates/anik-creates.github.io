// Describes every editable part of data/content.json. The admin UI builds its forms from this.
// Field types: text, textarea, url, email, number, bool, select, color, icon, image, file, list, tags, proofs

const PROOFS = { key: 'proofs', label: 'Proof photos', type: 'proofs', hint: 'Certificates, event photos, screenshots. Shown on the site behind a camera button.' };
const ICON = { key: 'icon', label: 'Icon', type: 'icon' };

export const FONTS = {
  display: ['Geist', 'Inter', 'Manrope', 'Plus Jakarta Sans', 'Outfit', 'Space Grotesk', 'Sora', 'DM Sans', 'Urbanist'],
  body: ['Geist', 'Inter', 'Manrope', 'Plus Jakarta Sans', 'DM Sans', 'Outfit', 'Work Sans'],
};

export const PALETTES = [
  { name: 'Ember', a: ['#ff6a1f', '#3dd6a3', '#ffd23f'] },
  { name: 'Electric', a: ['#3b82f6', '#22d3ee', '#a3e635'] },
  { name: 'Lime', a: ['#a3e635', '#22d3ee', '#facc15'] },
  { name: 'Rose', a: ['#f43f5e', '#fb923c', '#fde047'] },
  { name: 'Mint', a: ['#10b981', '#06b6d4', '#fbbf24'] },
  { name: 'Mono', a: ['#e4e4e7', '#a1a1aa', '#fafafa'] },
];

const LABEL_FIELDS = [
  ['downloadCv', 'Download CV button'], ['letsTalk', 'Hero contact button'], ['getInTouch', 'Call-to-action button'],
  ['moreAbout', '"More about me" link'], ['allProjects', '"See all projects" link'], ['allPublications', '"All publications" link'],
  ['details', 'Project card link'], ['visitProject', 'Project / item link button'], ['photos', 'Photo gallery title'], ['filterAll', 'Project filter: all'],
  ['verify', 'Certificate verify link'], ['scholarText', 'Google Scholar card text'], ['viewProfile', 'Google Scholar button'],
  ['executiveRoles', 'Leadership column title'], ['ambassadorRoles', 'Ambassador column title'],
  ['formTitle', 'Contact form title'], ['formSubtitle', 'Contact form subtitle'], ['formName', 'Form: name'], ['formEmail', 'Form: email'],
  ['formSubject', 'Form: subject'], ['formMessage', 'Form: message'], ['formSend', 'Form: send button'], ['formSent', 'Form: success message'],
  ['notFoundTitle', '404 title'], ['notFoundHighlight', '404 highlight'], ['notFoundText', '404 text'], ['backHome', '404 button'],
].map(([key, label]) => ({ key, label, type: 'text' }));

/* Section types available in the page builder. heading: key in content.headings; manage: sidebar sections holding the data. */
export const SECTION_TYPES = {
  hero: { label: 'Hero', desc: 'Photo, name, typewriter roles, buttons and stats', icon: 'user', manage: ['identity', 'media', 'stats', 'heroBadges', 'heroChips', 'socials'] },
  pageHero: { label: 'Page header', desc: 'Big title at the top of a page', icon: 'flag' },
  marquee: { label: 'Highlights ticker', desc: 'Scrolling strip of highlighted awards', icon: 'activity', manage: ['awards'] },
  focus: { label: 'What I do', desc: 'Icon cards about your focus areas', icon: 'bulb', heading: 'homeFocus', manage: ['focus'] },
  featuredProjects: { label: 'Featured projects', desc: 'Up to 3 projects marked "featured"', icon: 'star', heading: 'homeProjects', manage: ['projects'] },
  latestResearch: { label: 'Latest publications', desc: 'Your two newest papers', icon: 'book', heading: 'homeResearch', manage: ['publications'] },
  cta: { label: 'Call to action', desc: 'Band with contact & CV buttons', icon: 'send', heading: 'homeCta' },
  aboutIntro: { label: 'About intro', desc: 'Photo, bio paragraphs, facts and languages', icon: 'user', manage: ['aboutText', 'aboutFacts', 'languages', 'media'] },
  skills: { label: 'Skills', desc: 'Skill cards with tools', icon: 'cpu', heading: 'skills', manage: ['skills'] },
  education: { label: 'Education', desc: 'Education timeline', icon: 'cap', heading: 'education', manage: ['education'] },
  experience: { label: 'Experience', desc: 'Work timeline', icon: 'briefcase', heading: 'experienceList', manage: ['experience'] },
  certifications: { label: 'Certifications', desc: 'Certificate cards', icon: 'award', heading: 'certifications', manage: ['certifications'] },
  talks: { label: 'Workshops & talks', desc: 'Sessions you led', icon: 'mic', heading: 'talks', manage: ['talks'] },
  projects: { label: 'All projects', desc: 'Filterable project grid', icon: 'box', heading: 'projects', manage: ['projects'] },
  publications: { label: 'Publications', desc: 'Paper list + Google Scholar card', icon: 'book', heading: 'research', manage: ['publications'] },
  awards: { label: 'Awards', desc: 'Award cards', icon: 'trophy', heading: 'awards', manage: ['awards'] },
  leadership: { label: 'Leadership & ambassador', desc: 'Two columns of roles', icon: 'crown', heading: 'leadership', manage: ['leadership', 'ambassador'] },
  contactHero: { label: 'Contact cards', desc: 'Your photo with icon contact cards', icon: 'phone', heading: 'contact', manage: ['contactinfo', 'socials', 'media'] },
  contactForm: { label: 'Contact form', desc: 'Message form', icon: 'message', manage: ['form', 'labels'] },
  custom: { label: 'Custom section', desc: 'Your own section: cards, timeline, list, text, gallery or stats', icon: 'plus' },
};

export const LAYOUTS = [
  ['cards', 'Cards grid'], ['timeline', 'Timeline'], ['list', 'Compact list'], ['text', 'Text block (with optional image)'], ['gallery', 'Photo gallery'], ['stats', 'Number stats'],
];

export const CUSTOM_ITEM_FIELDS = [
  { key: 'icon', label: 'Icon', type: 'icon' },
  { key: 'title', label: 'Title (the number, for stats)', type: 'text' },
  { key: 'subtitle', label: 'Subtitle / organisation', type: 'text' },
  { key: 'date', label: 'Date', type: 'text' },
  { key: 'text', label: 'Description', type: 'textarea' },
  { key: 'tags', label: 'Tags', type: 'tags' },
  { key: 'link', label: 'Link', type: 'url' },
  { key: 'linkLabel', label: 'Link text', type: 'text' },
  { key: 'image', label: 'Image', type: 'image', max: 1600 },
  { key: 'proofs', label: 'Proof photos', type: 'proofs' },
];

export const RESERVED_PAGE_IDS = ['index', 'home', 'about', 'experience', 'projects', 'research', 'achievements', 'contact', '404', 'admin', 'assets', 'data'];

/* Sections shown in the sidebar, grouped. kind: object | collection | headings | special */
export const GROUPS = [
  { label: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'home', kind: 'special' },
  ] },
  { label: 'Site', items: [
    { id: 'pages', label: 'Pages & sections', icon: 'layers', kind: 'special' },
    { id: 'colors', label: 'Custom colours', icon: 'palette', kind: 'special' },
    { id: 'identity', label: 'Name & profile', icon: 'user', kind: 'object', path: 'settings',
      desc: 'Your name, headline and the text at the top of the home page.',
      fields: [
        { key: 'prefix', label: 'Title prefix', type: 'text', placeholder: 'Engr.' },
        { key: 'name', label: 'Full name', type: 'text', required: true },
        { key: 'brand', label: 'Short name (logo)', type: 'text' },
        { key: 'initials', label: 'Initials (logo badge)', type: 'text', max: 3 },
        { key: 'greeting', label: 'Greeting above name', type: 'text' },
        { key: 'headline', label: 'Headline', type: 'text' },
        { key: 'roles', label: 'Typewriter roles', type: 'list', hint: 'Cycles under your name on the home page.' },
        { key: 'tagline', label: 'Intro paragraph', type: 'textarea' },
        { key: 'availability', label: 'Availability badge', type: 'text' },
        { key: 'showAvailability', label: 'Show availability badge', type: 'bool' },
        { key: 'footer', label: 'Footer note', type: 'text' },
      ] },
    { id: 'contactinfo', label: 'Contact details', icon: 'phone', kind: 'object', path: 'settings',
      desc: 'Shown on the contact page, footer and hero icons.',
      fields: [
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone (with country code)', type: 'text', placeholder: '+8801…' },
        { key: 'whatsapp', label: 'WhatsApp number (digits only)', type: 'text', placeholder: '8801…' },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'clockCity', label: 'City shown with the footer clock', type: 'text' },
        { key: 'timezone', label: 'Time zone for the footer clock (blank = hide)', type: 'text', placeholder: 'Asia/Dhaka' },
      ] },
    { id: 'socials', label: 'Social links', icon: 'link', kind: 'collection', path: 'socials', titleKey: 'label', subKey: 'url',
      desc: 'Links with icons, shown in the hero, footer and contact page.',
      fields: [ICON, { key: 'label', label: 'Name', type: 'text' }, { key: 'handle', label: 'Handle / display text', type: 'text' }, { key: 'url', label: 'URL', type: 'url' }, { key: 'hero', label: 'Show in home hero', type: 'bool' }],
      blank: { icon: 'link', label: '', handle: '', url: '', hero: true } },
    { id: 'media', label: 'Photos & CV', icon: 'image', kind: 'object', path: 'settings',
      desc: 'Background-free PNG/WebP photos blend best. Use "Remove background" if your photo has one.',
      fields: [
        { key: 'photo', label: 'Home page photo', type: 'image', cutout: true, max: 1200 },
        { key: 'aboutPhoto', label: 'About page photo', type: 'image', cutout: true, max: 1200 },
        { key: 'contactPhoto', label: 'Contact page photo', type: 'image', cutout: true, max: 1200 },
        { key: 'cv', label: 'CV (PDF)', type: 'file', accept: 'application/pdf', dir: 'assets/files' },
      ] },
    { id: 'theme', label: 'Theme & style', icon: 'sliders', kind: 'object', path: 'settings.theme',
      desc: 'Colours, fonts and effects for the whole site.',
      fields: [
        { key: 'default', label: 'Default mode for new visitors', type: 'select', options: [['system', 'Follow device'], ['dark', 'Dark'], ['light', 'Light']] },
        { key: 'match', label: 'Match colours to your photo', type: 'colormatch' },
        { key: 'palette', label: 'Colour presets', type: 'palette' },
        { key: 'accent1', label: 'Accent 1', type: 'color' },
        { key: 'accent2', label: 'Accent 2', type: 'color' },
        { key: 'accent3', label: 'Accent 3', type: 'color' },
        { key: 'displayFont', label: 'Heading font', type: 'select', options: FONTS.display },
        { key: 'bodyFont', label: 'Body font', type: 'select', options: FONTS.body },
        { key: 'preloader', label: 'Oscilloscope boot screen on first visit', type: 'bool' },
        { key: 'circuit', label: 'Animated circuit background', type: 'bool' },
        { key: 'cursorGlow', label: 'Cursor glow & custom cursor', type: 'bool' },
      ] },
    { id: 'headings', label: 'Section headings', icon: 'edit', kind: 'headings', path: 'headings',
      desc: 'Every section title on the site. The highlight part is shown in gradient.' },
    { id: 'labels', label: 'Buttons & labels', icon: 'pen', kind: 'object', path: 'labels',
      desc: 'Every button and small piece of text on the site.',
      fields: LABEL_FIELDS },
    { id: 'seo', label: 'SEO & sharing', icon: 'globe', kind: 'object', path: 'settings.seo',
      desc: 'How the site appears in Google and when shared.',
      fields: [
        { key: 'title', label: 'Site title', type: 'text' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'siteUrl', label: 'Site URL', type: 'url' },
      ] },
    { id: 'form', label: 'Contact form', icon: 'message', kind: 'object', path: 'settings.form',
      desc: 'By default the form opens the visitor\'s email app. For direct delivery, create a free Web3Forms access key (web3forms.com) and paste it here.',
      fields: [
        { key: 'provider', label: 'Delivery', type: 'select', options: [['mailto', 'Open email app (no setup)'], ['web3forms', 'Web3Forms'], ['formspree', 'Formspree']] },
        { key: 'key', label: 'Access key / form ID', type: 'text' },
      ] },
  ] },
  { label: 'Home', items: [
    { id: 'stats', label: 'Stats', icon: 'activity', kind: 'collection', path: 'stats', titleKey: 'label', subKey: 'value',
      fields: [ICON, { key: 'value', label: 'Number', type: 'number' }, { key: 'suffix', label: 'Suffix', type: 'text', placeholder: '+' }, { key: 'label', label: 'Label', type: 'text' }],
      blank: { icon: 'star', value: 0, suffix: '', label: '' } },
    { id: 'heroBadges', label: 'Photo badges', icon: 'award', kind: 'collection', path: 'heroBadges', titleKey: 'title', subKey: 'subtitle', limit: 2,
      desc: 'Up to two floating badges beside your photo.',
      fields: [ICON, { key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }],
      blank: { icon: 'star', title: '', subtitle: '' } },
    { id: 'heroChips', label: 'Floating icons', icon: 'sparkle', kind: 'collection', path: 'heroChips', titleKey: 'label', limit: 4,
      desc: 'Up to four icons orbiting your photo.',
      fields: [ICON, { key: 'label', label: 'Tooltip', type: 'text' }],
      blank: { icon: 'cpu', label: '' } },
    { id: 'focus', label: 'What I do', icon: 'bulb', kind: 'collection', path: 'focus', titleKey: 'title', subKey: 'text',
      fields: [ICON, { key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Text', type: 'textarea' }, PROOFS],
      blank: { icon: 'cpu', title: '', text: '', proofs: [] } },
  ] },
  { label: 'About', items: [
    { id: 'aboutText', label: 'About text', icon: 'user', kind: 'object', path: 'about',
      fields: [{ key: 'paragraphs', label: 'Paragraphs', type: 'list', multiline: true }] },
    { id: 'aboutFacts', label: 'Quick facts', icon: 'info', kind: 'collection', path: 'about.facts', titleKey: 'text',
      fields: [ICON, { key: 'text', label: 'Text', type: 'text' }], blank: { icon: 'pin', text: '' } },
    { id: 'skills', label: 'Skills', icon: 'cpu', kind: 'collection', path: 'skills', titleKey: 'title', subKey: 'subtitle',
      fields: [ICON, { key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }, { key: 'text', label: 'Description', type: 'textarea' }, { key: 'tools', label: 'Tools', type: 'tags' }, PROOFS],
      blank: { icon: 'cpu', title: '', subtitle: '', text: '', tools: [], proofs: [] } },
    { id: 'education', label: 'Education', icon: 'cap', kind: 'collection', path: 'education', titleKey: 'degree', subKey: 'school',
      fields: [ICON, { key: 'degree', label: 'Degree', type: 'text' }, { key: 'school', label: 'Institution', type: 'text' }, { key: 'location', label: 'Location', type: 'text' }, { key: 'period', label: 'Period', type: 'text' }, { key: 'score', label: 'Result', type: 'text' }, { key: 'percent', label: 'Result bar (0–100)', type: 'number' }, PROOFS],
      blank: { icon: 'cap', degree: '', school: '', location: '', period: '', score: '', percent: 0, proofs: [] } },
    { id: 'languages', label: 'Languages', icon: 'lang', kind: 'collection', path: 'languages', titleKey: 'name', subKey: 'level',
      fields: [ICON, { key: 'name', label: 'Language', type: 'text' }, { key: 'level', label: 'Level', type: 'text' }, { key: 'percent', label: 'Bar (0–100)', type: 'number' }, PROOFS],
      blank: { icon: 'lang', name: '', level: '', percent: 50, proofs: [] } },
  ] },
  { label: 'Experience', items: [
    { id: 'experience', label: 'Experience', icon: 'briefcase', kind: 'collection', path: 'experience', titleKey: 'role', subKey: 'org',
      fields: [ICON, { key: 'role', label: 'Role', type: 'text' }, { key: 'org', label: 'Organisation', type: 'text' }, { key: 'location', label: 'Location', type: 'text' }, { key: 'period', label: 'Period', type: 'text', placeholder: 'May 2025 – Present' }, { key: 'points', label: 'Highlights', type: 'list', multiline: true }, PROOFS],
      blank: { icon: 'briefcase', role: '', org: '', location: '', period: '', points: [], proofs: [] } },
    { id: 'certifications', label: 'Certifications', icon: 'award', kind: 'collection', path: 'certifications', titleKey: 'title', subKey: 'issuer',
      fields: [ICON, { key: 'title', label: 'Title', type: 'text' }, { key: 'issuer', label: 'Issuer', type: 'text' }, { key: 'date', label: 'Date', type: 'text' }, { key: 'grade', label: 'Grade', type: 'text' }, { key: 'link', label: 'Verification link', type: 'url' }, PROOFS],
      blank: { icon: 'award', title: '', issuer: '', date: '', grade: '', link: '', proofs: [] } },
    { id: 'talks', label: 'Workshops & talks', icon: 'mic', kind: 'collection', path: 'talks', titleKey: 'title', subKey: 'org',
      fields: [ICON, { key: 'role', label: 'Your role', type: 'text' }, { key: 'date', label: 'Date', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'org', label: 'Organiser', type: 'text' }, { key: 'text', label: 'Description', type: 'textarea' }, PROOFS],
      blank: { icon: 'mic', role: '', date: '', title: '', org: '', text: '', proofs: [] } },
  ] },
  { label: 'Work', items: [
    { id: 'projects', label: 'Projects', icon: 'box', kind: 'collection', path: 'projects', titleKey: 'title', subKey: 'kicker',
      fields: [ICON, { key: 'title', label: 'Title', type: 'text' }, { key: 'kicker', label: 'Short tagline', type: 'text' }, { key: 'year', label: 'Year', type: 'text' }, { key: 'categories', label: 'Categories (filters)', type: 'tags' }, { key: 'featured', label: 'Feature on home page', type: 'bool' }, { key: 'text', label: 'Description', type: 'textarea' }, { key: 'tags', label: 'Tech tags', type: 'tags' }, { key: 'link', label: 'Project link', type: 'url' }, { key: 'cover', label: 'Cover image', type: 'image', max: 1600 }, PROOFS],
      blank: { icon: 'box', title: '', kicker: '', year: String(new Date().getFullYear()), categories: [], featured: false, text: '', tags: [], link: '', cover: '', proofs: [] } },
    { id: 'publications', label: 'Publications', icon: 'book', kind: 'collection', path: 'publications', titleKey: 'title', subKey: 'venue',
      fields: [ICON, { key: 'title', label: 'Title', type: 'textarea' }, { key: 'venue', label: 'Venue', type: 'textarea' }, { key: 'authors', label: 'Authors', type: 'text' }, { key: 'year', label: 'Year', type: 'text' }, { key: 'tags', label: 'Tags', type: 'tags' }, { key: 'link', label: 'DOI / link', type: 'url' }, PROOFS],
      blank: { icon: 'book', title: '', venue: '', authors: '', year: String(new Date().getFullYear()), tags: [], link: '', proofs: [] } },
  ] },
  { label: 'Achievements', items: [
    { id: 'awards', label: 'Awards', icon: 'trophy', kind: 'collection', path: 'awards', titleKey: 'title', subKey: 'text',
      fields: [ICON, { key: 'title', label: 'Title', type: 'text' }, { key: 'text', label: 'Details', type: 'textarea' }, { key: 'year', label: 'Year', type: 'text' }, { key: 'highlight', label: 'Highlight (gold icon + home marquee)', type: 'bool' }, PROOFS],
      blank: { icon: 'trophy', title: '', text: '', year: String(new Date().getFullYear()), highlight: false, proofs: [] } },
    { id: 'leadership', label: 'Leadership roles', icon: 'crown', kind: 'collection', path: 'leadership', titleKey: 'title', subKey: 'org',
      fields: [ICON, { key: 'title', label: 'Role', type: 'text' }, { key: 'org', label: 'Organisation', type: 'text' }, { key: 'period', label: 'Period', type: 'text' }, PROOFS],
      blank: { icon: 'crown', title: '', org: '', period: '', proofs: [] } },
    { id: 'ambassador', label: 'Ambassador roles', icon: 'megaphone', kind: 'collection', path: 'ambassador', titleKey: 'title', subKey: 'org',
      fields: [ICON, { key: 'title', label: 'Role', type: 'text' }, { key: 'org', label: 'Event', type: 'text' }, { key: 'period', label: 'Year', type: 'text' }, PROOFS],
      blank: { icon: 'megaphone', title: '', org: '', period: '', proofs: [] } },
  ] },
  { label: 'Publishing', items: [
    { id: 'publish', label: 'Publish', icon: 'upload', kind: 'special' },
    { id: 'history', label: 'History', icon: 'clock', kind: 'special' },
    { id: 'backup', label: 'Backup & restore', icon: 'save', kind: 'special' },
    { id: 'security', label: 'Security', icon: 'lock', kind: 'special' },
  ] },
];

export const SECTIONS = Object.fromEntries(GROUPS.flatMap((g) => g.items).map((s) => [s.id, s]));

export const HEADING_LABELS = {
  homeFocus: 'Home · What I do', homeProjects: 'Home · Featured projects', homeResearch: 'Home · Latest research', homeCta: 'Call-to-action band',
  about: 'About · Page header', skills: 'About · Skills', education: 'About · Education',
  experience: 'Experience · Page header', certifications: 'Experience · Certifications', talks: 'Experience · Workshops',
  projects: 'Projects · Page header', research: 'Research · Page header',
  awards: 'Achievements · Page header', leadership: 'Achievements · Leadership', leadershipCol: 'Achievements · Roles column', ambassadorCol: 'Achievements · Ambassador column',
  contact: 'Contact · Page header',
};
