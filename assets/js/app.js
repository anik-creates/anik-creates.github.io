// Public site renderer. Every page is a thin HTML shell with <body data-page="...">;
// this module loads data/content.json and renders the header, page body and footer.
import { injectSprite, icon, setIconResolver } from './icons.js';
import { loadContent, asset, isPreview, ROOT } from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const PAGE = (isPreview && new URLSearchParams(location.search).get('page')) || document.body.dataset.page || 'home';

let C = null; // content

/* ------------------------------------------------------------------ helpers */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // block javascript:, data:, etc.
  return asset(u);
};
const list = (k) => (Array.isArray(C?.[k]) ? C[k] : []);
// In preview every page renders through index.html so unpublished custom pages work too
const pageHref = (id) => (ROOT === './' ? '' : ROOT) + (isPreview ? `index.html?preview=1&page=${encodeURIComponent(id)}` : id === 'home' ? 'index.html' : `${id}.html`);
const visiblePage = (id) => (C.pages || []).some((p) => p.id === id && p.visible !== false);
const fullName = () => [C.settings.prefix, C.settings.name].filter(Boolean).join(' ');

const L = (k, fallback = '') => C.labels?.[k] ?? fallback;
const pageOf = (id) => (C.pages || []).find((p) => p.id === id);

const HEAD_ICONS = {
  homeFocus: 'bulb', homeProjects: 'box', homeResearch: 'book', homeCta: 'send', about: 'user', skills: 'cpu',
  education: 'cap', experience: 'briefcase', certifications: 'award', talks: 'mic', projects: 'box', research: 'book',
  awards: 'trophy', leadership: 'crown', contact: 'send',
};

/** Section heading from a heading object ({eyebrow, title, highlight, lead, icon}). */
let SEC_NO = 0;
const pad2 = (n) => String(n).padStart(2, '0');
function headFrom(h, { tag = 'h2', cls = '', ic = 'sparkle' } = {}) {
  if (!h || !(h.eyebrow || h.title || h.highlight || h.lead)) return '';
  return `<header class="section-head reveal ${cls}">
    ${h.logo ? `<img class="section-logo" src="${esc(asset(h.logo))}" alt="" loading="lazy" />` : ''}
    ${h.eyebrow ? `<span class="eyebrow"><span class="num">${pad2(++SEC_NO)}</span><span class="rule"></span>${esc(h.eyebrow)}</span>` : ''}
    ${h.title || h.highlight ? `<${tag}>${esc(h.title)} ${h.highlight ? `<span class="grad-text">${esc(h.highlight)}</span>` : ''}</${tag}>` : ''}
    ${h.lead ? `<p class="lead">${esc(h.lead)}</p>` : ''}
  </header>`;
}
const head = (key, opts = {}) => headFrom(C.headings?.[key], { ic: HEAD_ICONS[key], ...opts });

/* Proof photos: every item with photos registers here, buttons reference it by index. */
const PROOFS = [];
function proofBtn(item, title = '') {
  const items = (item?.proofs || []).filter((p) => p?.src);
  if (!items.length) return '';
  PROOFS.push({ items, title: title || item.title || item.role || item.degree || item.name || '' });
  return `<button class="proof-btn" type="button" data-proof="${PROOFS.length - 1}" aria-label="View ${items.length} photo${items.length > 1 ? 's' : ''}">
    ${icon('camera')}<span>${items.length}</span></button>`;
}

const tags = (arr, cls = 'chips') =>
  Array.isArray(arr) && arr.filter(Boolean).length ? `<div class="${cls}">${arr.filter(Boolean).map((t, j) => `<span style="--i:${j}">${esc(t)}</span>`).join('')}</div>` : '';

/* ------------------------------------------------------------------ settings → page */
const FONT_STACKS = {
  display: '"Segoe UI", system-ui, sans-serif',
  body: '"Segoe UI", system-ui, -apple-system, sans-serif',
};
function applySettings() {
  const s = C.settings, t = s.theme || {};
  const root = document.documentElement.style;
  // Only accept #rrggbb colours and plain font names, so content can't inject CSS
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  const isFont = (v) => /^[A-Za-z0-9 ]{2,40}$/.test(v || '');
  if (isHex(t.accent1)) root.setProperty('--a1', t.accent1);
  if (isHex(t.accent2)) root.setProperty('--a2', t.accent2);
  if (isHex(t.accent3)) root.setProperty('--a3', t.accent3);
  if (!isFont(t.displayFont)) delete t.displayFont;
  if (!isFont(t.bodyFont)) delete t.bodyFont;
  const fonts = [t.displayFont, t.bodyFont].filter(Boolean);
  if (fonts.some((f) => f !== 'Geist')) {
    const fam = [...new Set(fonts)].map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join('&');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${fam}&display=swap`;
    document.head.appendChild(link);
  }
  if (t.displayFont) root.setProperty('--font-display', `"${t.displayFont}", ${FONT_STACKS.display}`);
  if (t.bodyFont) root.setProperty('--font-body', `"${t.bodyFont}", ${FONT_STACKS.body}`);
  root.setProperty('--on-accent', onColor(isHex(t.accent1) ? t.accent1 : '#e8590c'));
  applyCustomScheme(t.custom);
  try {
    localStorage.setItem('site.cache', JSON.stringify({
      a1: isHex(t.accent1) ? t.accent1 : '', a2: isHex(t.accent2) ? t.accent2 : '', a3: isHex(t.accent3) ? t.accent3 : '',
      initials: s.initials || '', name: fullName(),
    }));
    localStorage.setItem('theme.default', t.default || 'system');
    localStorage.setItem('pl.off', t.preloader === false ? '1' : '0');
  } catch {}

  const pageMeta = pageOf(PAGE);
  const baseTitle = s.seo?.title || fullName();
  document.title = PAGE === 'home' || !pageMeta ? baseTitle : `${pageMeta.label} | ${fullName()}`;
  if (s.seo?.description) $('meta[name="description"]')?.setAttribute('content', s.seo.description);
}

/** Black or white text, whichever reads better on the given colour. */
function onColor(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return '#17181b';
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.22 ? '#17181b' : '#ffffff';
}

/** Fully custom colours from the admin (per light/dark mode). */
function applyCustomScheme(c) {
  document.getElementById('custom-scheme')?.remove();
  if (!c?.enabled) return;
  const ok = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  const block = (m) => {
    if (!m) return '';
    const v = [];
    if (ok(m.bg)) v.push(`--bg:${m.bg}`, `--bg-2:color-mix(in srgb, ${m.bg} 92%, ${ok(m.text) ? m.text : '#888'})`);
    if (ok(m.surface)) v.push(`--surface:${m.surface}`, `--surface-2:color-mix(in srgb, ${m.surface} 90%, ${ok(m.text) ? m.text : '#888'})`);
    if (ok(m.text)) v.push(`--text:${m.text}`, `--text-2:color-mix(in srgb, ${m.text} 82%, ${ok(m.bg) ? m.bg : '#888'})`, `--line:color-mix(in srgb, ${m.text} 11%, transparent)`, `--line-strong:color-mix(in srgb, ${m.text} 24%, transparent)`, `--grid:color-mix(in srgb, ${m.text} ${m.grid === false ? 0 : 4}%, transparent)`);
    if (ok(m.muted)) v.push(`--muted:${m.muted}`);
    if (ok(m.accent)) v.push(`--accent:${m.accent}`);
    return v.join(';');
  };
  const st = document.createElement('style');
  st.id = 'custom-scheme';
  st.textContent = `:root{${block(c.light)}}:root[data-theme="dark"]{${block(c.dark)}}`;
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ layout */
function renderHeader() {
  const s = C.settings;
  const links = (C.pages || []).filter((p) => p.visible !== false).map((p) => `
    <li><a href="${pageHref(p.id)}" class="${p.id === PAGE ? 'active' : ''}" ${p.id === PAGE ? 'aria-current="page"' : ''}>
      ${icon(p.icon || 'sparkle')}<span>${esc(p.label)}</span></a></li>`).join('');
  $('#app-header').innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="nav-wrap" id="navWrap">
      <nav class="nav" aria-label="Primary">
        <a href="${pageHref('home')}" class="brand" aria-label="${esc(fullName())}, home">
          <span class="brand-mark">${esc(s.initials || '')}</span>
          <span class="brand-name">${esc(s.brand || s.name)}<span class="dot">.</span></span>
        </a>
        <ul class="nav-links" id="navLinks">${links}</ul>
        <div class="nav-actions">
          <button class="icon-btn neu" id="themeToggle" type="button" aria-label="Toggle dark and light mode" title="Toggle theme">
            ${icon('sun', 'ic-sun')}${icon('moon', 'ic-moon')}
          </button>
          <button class="icon-btn neu menu-btn" id="menuBtn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">
            ${icon('menu', 'ic-menu')}${icon('x', 'ic-close')}
          </button>
        </div>
      </nav>
    </header>
    <div class="scroll-progress" id="scrollProgress"></div>`;
}

function socialLinks(cls = 'social neu', onlyHero = false) {
  const s = C.settings;
  const items = list('socials').filter((x) => x.url && (!onlyHero || x.hero !== false))
    .map((x) => `<a class="${cls}" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener" aria-label="${esc(x.label)}" data-tip="${esc(x.label)}">${icon(x.icon)}</a>`);
  if (s.email) items.push(`<a class="${cls}" href="mailto:${esc(s.email)}" aria-label="Email" data-tip="Email">${icon('mail')}</a>`);
  if (onlyHero && s.phone) items.push(`<a class="${cls}" href="tel:${esc(s.phone)}" aria-label="Call" data-tip="Call">${icon('phone')}</a>`);
  return items.join('');
}

function renderFooter() {
  const s = C.settings;
  const nav = (C.pages || []).filter((p) => p.visible !== false)
    .map((p) => `<a href="${pageHref(p.id)}">${esc(p.label)}</a>`).join('');
  $('#app-footer').innerHTML = `
    <footer class="footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          <a href="${pageHref('home')}" class="brand"><span class="brand-mark">${esc(s.initials)}</span><span class="brand-name">${esc(s.brand || s.name)}<span class="dot">.</span></span></a>
          <p>${esc(s.headline)}</p>
          ${s.timezone ? `<span class="footer-clock" id="footerClock" data-tz="${esc(s.timezone)}" data-city="${esc(s.clockCity || '')}"></span>` : ''}
        </div>
        <nav class="footer-nav" aria-label="Footer">${nav}</nav>
        <div class="footer-social">${socialLinks('fs-link')}</div>
      </div>
      <div class="container footer-bottom">
        <p>© ${new Date().getFullYear()} ${esc(fullName())}. ${esc(s.footer || '')}</p>
        <a class="admin-link" href="${ROOT}admin/" aria-label="Admin portal" title="Admin">${icon('lock')}</a>
      </div>
    </footer>
    <button class="to-top neu" id="toTop" type="button" aria-label="Back to top">${icon('up')}</button>
    <div class="toast glass" id="toast" role="status" aria-live="polite"></div>
    ${isPreview ? `<div class="preview-bar glass">${icon('eye')} Previewing unpublished changes <a href="${location.pathname}">Exit</a></div>` : ''}`;
}

/* ------------------------------------------------------------------ shared blocks */
function portrait(src, { badges = true, chips = true, id = 'portrait' } = {}) {
  const chipEls = chips ? list('heroChips').slice(0, 4).map((c, i) =>
    `<div class="chip-float c${i + 1}" aria-hidden="true"><span class="pad">${icon(c.icon)}</span><span class="lead-line"></span><span class="lbl">${esc(c.label)}</span></div>`).join('') : '';
  const badgeEls = badges ? list('heroBadges').slice(0, 2).map((b, i) =>
    `<div class="badge-float b${i + 1}">${icon(b.icon)}<div><strong>${esc(b.title)}</strong><small>${esc(b.subtitle)}</small></div></div>`).join('') : '';
  const url = src ? esc(asset(src)) : '';
  return `<div class="portrait-stage" data-parallax>
    <div class="disc-floor" aria-hidden="true"></div>
    <div class="morph-blob disc">${src ? `<img src="${url}" alt="" class="portrait-in" aria-hidden="true" decoding="async" />` : ''}<span class="disc-shine"></span></div>
    <div class="morph-blob blob-2" aria-hidden="true"></div>
    <svg class="orbit-ring" viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="190"/><circle cx="200" cy="200" r="160" class="dashed"/></svg>
    ${src ? `<img src="${url}" alt="Portrait of ${esc(C.settings.name)}" class="portrait" id="${id}" width="600" height="800" fetchpriority="high" decoding="async" />` : ''}
    ${chipEls}${badgeEls}
  </div>`;
}

/** Lines up the two portrait layers: the copy inside the disc shows the body, the top copy
 *  is clipped at the disc's equator so only the head and shoulders break out of the circle. */
function layoutPortraits() {
  $$('.portrait-stage').forEach((stage) => {
    const top = $('.portrait', stage), inner = $('.portrait-in', stage), disc = $('.disc', stage);
    if (!top || !inner || !disc) { stage.classList.add('laid'); return; }
    const apply = () => {
      if (!top.naturalWidth) return;
      const iw = top.offsetWidth, ih = top.offsetHeight, il = top.offsetLeft, it = top.offsetTop;
      const dl = disc.offsetLeft, dt = disc.offsetTop, dh = disc.offsetHeight;
      Object.assign(inner.style, { width: `${iw}px`, height: `${ih}px`, left: `${il - dl}px`, top: `${it - dt}px` });
      const cut = Math.max(0, it + ih - (dt + dh * 0.5));
      top.style.clipPath = `inset(-40% -40% ${cut}px -40%)`;
      stage.classList.add('laid');
    };
    if (top.complete) apply(); else top.addEventListener('load', apply, { once: true });
    top.addEventListener('error', () => stage.classList.add('laid'), { once: true });
  });
}

function artMotif(seed) {
  const r = (n) => (Math.sin(seed * 9301 + n * 49297) + 1) / 2;
  let paths = '', dots = '';
  for (let k = 0; k < 5; k++) {
    const y = 20 + r(k) * 110, x1 = r(k + 7) * 80, x2 = 140 + r(k + 3) * 120, dy = (r(k + 11) - 0.5) * 40;
    paths += `<path d="M${x1.toFixed(1)} ${y.toFixed(1)} H${(x2 - 20).toFixed(1)} l20 ${dy.toFixed(1)} H400"/>`;
    dots += `<circle cx="${x1.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`;
  }
  return `<svg class="art-bg" viewBox="0 0 400 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${paths}${dots}</svg>`;
}

function projectCard(p, i) {
  const cats = (p.categories || []).map((c) => c.toLowerCase()).join(' ');
  const proofs = (p.proofs || []).filter((x) => x?.src);
  const cover = p.cover || proofs[0]?.src;
  return `<article class="project glass reveal tilt" data-cat="${esc(cats)}" data-delay="${i % 3}" data-project="${i}" tabindex="0" role="button" aria-label="Open ${esc(p.title)} details">
    <div class="project-art">
      ${cover ? `<img src="${esc(asset(cover))}" alt="" loading="lazy" decoding="async" class="cover" />` : artMotif(i + 1)}
      <span class="big-ic">${icon(p.icon)}</span>
      ${p.year ? `<span class="project-year glass">${esc(p.year)}</span>` : ''}
    </div>
    <h3>${esc(p.title)}</h3>
    ${p.kicker ? `<div class="kicker">${esc(p.kicker)}</div>` : ''}
    <p>${esc(p.text)}</p>
    ${tags(p.tags)}
    <div class="card-foot">
      <span class="more">${icon('arrow-right')} ${esc(L('details', 'Details'))}</span>
      ${proofs.length ? `<span class="proof-count">${icon('camera')} ${proofs.length}</span>` : ''}
    </div>
  </article>`;
}

function pubCard(p, i) {
  const name = esc(C.settings.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const authors = esc(p.authors || '').replace(new RegExp(name, 'g'), (m) => `<b>${m}</b>`);
  return `<article class="pub glass reveal" data-delay="${i % 3}">
    <span class="pub-num">${icon(p.icon || 'book')}</span>
    <div>
      <h3>${esc(p.title)}</h3>
      <p class="venue">${icon('book')} ${esc(p.venue)}</p>
      ${p.authors ? `<p class="authors">${authors}</p>` : ''}
      ${tags([p.year, ...(p.tags || [])].filter(Boolean), 'chips accent')}
    </div>
    <div class="pub-actions">
      ${proofBtn(p)}
      ${p.link ? `<a class="pub-link" href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener" aria-label="Open record for ${esc(p.title)}">${icon('arrow')}</a>` : ''}
    </div>
  </article>`;
}

function timelineItem({ icon: ic, title, org, period, score, points, text, percent, link }, item) {
  return `<li class="tl-item reveal">
    <span class="tl-node">${icon(ic)}</span>
    <div class="tl-card glass">
      <div class="tl-meta">
        ${period ? `<span class="chip-date">${icon('calendar')} ${esc(period)}</span>` : ''}
        ${score ? `<span class="score">${esc(score)}</span>` : ''}
        ${proofBtn(item, title)}
      </div>
      <h3>${esc(title)}</h3>
      ${org ? `<p class="tl-org">${esc(org)}</p>` : ''}
      ${text ? `<p class="tl-text">${esc(text)}</p>` : ''}
      ${Array.isArray(points) && points.filter(Boolean).length ? `<ul>${points.filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${percent ? `<div class="meter" style="--v:${Math.max(0, Math.min(100, +percent))}%"><span></span></div>` : ''}
      ${link ? `<a class="link-arrow sm" href="${esc(safeUrl(link))}" target="_blank" rel="noopener">${icon('external')} ${esc(L('visitProject', 'Open link'))}</a>` : ''}
    </div>
  </li>`;
}

const roleItems = (arr) => `<ul class="role-list">${arr.map((r) => `
    <li><span class="ri">${icon(r.icon)}</span><div><strong>${esc(r.title)}</strong>${r.org || r.subtitle ? `<span>${esc(r.org || r.subtitle)}</span>` : ''}${r.period || r.date ? `<em>${esc(r.period || r.date)}</em>` : ''}</div>${proofBtn(r)}</li>`).join('')}</ul>`;

function awardCard(a, i) {
  return `<article class="award neu reveal tilt ${a.highlight ? 'gold' : ''}" data-delay="${i % 4}">
    ${a.year ? `<span class="yr">${esc(a.year)}</span>` : ''}
    <span class="mc-icon">${icon(a.icon)}</span>
    <h3>${esc(a.title)}</h3><p>${esc(a.text)}</p>
    ${proofBtn(a)}
  </article>`;
}

const wrap = (inner, cls = '') => `<section class="section ${cls}"><div class="container">${inner}</div></section>`;
const moreLink = (id, label) => (pageOf(id)?.visible !== false && pageOf(id) && PAGE !== id
  ? `<div class="center-link reveal"><a href="${pageHref(id)}" class="link-arrow">${esc(label)} ${icon('arrow-right')}</a></div>` : '');

/* ------------------------------------------------------------------ section renderers */
const SECTION = {
  hero() {
    const s = C.settings;
    const words = s.name.trim().split(/\s+/);
    return `<section class="hero">
      <div class="container hero-grid">
        <div class="hero-copy">
          ${s.showAvailability && s.availability ? `<div class="pill glass reveal"><span class="live-dot"></span> ${esc(s.availability)}</div>` : ''}
          <h1 class="hero-title reveal" data-delay="1">
            ${s.greeting ? `<span class="hello">${esc(s.greeting)}</span>` : ''}
            <span class="name" aria-label="${esc(fullName())}">${s.prefix ? `<span class="prefix">${esc(s.prefix)}</span>` : ''}${letters(words.slice(0, -1).join(' '))} <span class="grad-text">${letters(words.slice(-1)[0], words.slice(0, -1).join(' ').length)}</span></span>
          </h1>
          <p class="hero-role reveal" data-delay="2"><span class="prompt">&gt;</span><span class="typed" id="typed" aria-live="polite">${esc((s.roles || [])[0] || s.headline)}</span><span class="caret"></span></p>
          <p class="hero-sub reveal" data-delay="3">${esc(s.tagline)}</p>
          <div class="hero-cta reveal" data-delay="4">
            ${s.cv ? `<a href="${esc(asset(s.cv))}" class="btn btn-primary" download>${icon('download')} ${esc(L('downloadCv', 'Download CV'))}</a>` : ''}
            ${pageOf('contact')?.visible !== false && pageOf('contact') ? `<a href="${pageHref('contact')}" class="btn btn-neu">${icon('send')} ${esc(L('letsTalk', "Let's talk"))}</a>` : ''}
          </div>
          <div class="hero-social reveal" data-delay="5">${socialLinks('social neu', true)}</div>
        </div>
        <div class="hero-visual reveal" data-delay="2">${portrait(s.photo)}</div>
      </div>
      ${list('stats').length ? `<div class="container stats">${list('stats').map((x, i) => `
        <div class="stat glass reveal" data-delay="${i}">${icon(x.icon)}<div><b data-count="${Number(x.value) || 0}" data-suffix="${esc(x.suffix || '')}">0</b><span>${esc(x.label)}</span></div></div>`).join('')}</div>` : ''}
      <a href="#after-hero" class="scroll-cue" aria-label="Scroll down"><span class="mouse"><span></span></span></a>
    </section><div id="after-hero"></div>`;
  },

  pageHero(sec) {
    const h = C.headings?.[sec.headingKey] || sec.heading || {};
    const page = pageOf(PAGE) || {};
    return `<section class="page-hero">
      <div class="container page-hero-inner">
        <div class="page-hero-copy">
          <nav class="crumbs reveal" aria-label="Breadcrumb"><a href="${pageHref('home')}">${icon('home')} ${esc(pageOf('home')?.label || 'Home')}</a>${icon('chevron-right')}<span>${esc(page.label || '')}</span></nav>
          ${h.logo ? `<img class="section-logo reveal" src="${esc(asset(h.logo))}" alt="" />` : ''}
          ${h.eyebrow ? `<span class="eyebrow reveal"><span class="num">${pad2(++SEC_NO)}</span><span class="rule"></span>${esc(h.eyebrow)}</span>` : ''}
          <h1 class="reveal" data-delay="1">${esc(h.title)} ${h.highlight ? `<span class="grad-text">${esc(h.highlight)}</span>` : ''}</h1>
          ${h.lead ? `<p class="lead reveal" data-delay="2">${esc(h.lead)}</p>` : ''}
        </div>
        <div class="page-hero-art reveal" data-delay="2" aria-hidden="true">
          <div class="page-num">${pad2(Math.max(1, (C.pages || []).filter((p) => p.visible !== false).findIndex((p) => p.id === PAGE) + 1)).replace(/(\d)$/, '<span>$1</span>')}</div>
        </div>
      </div>
    </section>`;
  },

  marquee() {
    const hi = list('awards').filter((a) => a.highlight);
    const items = hi.length ? hi : list('awards');
    if (!items.length) return '';
    return `<div class="marquee" aria-label="Highlights"><div class="marquee-track">${[...items, ...items].map((a) =>
      `<span class="mq-item">${icon(a.icon)} ${esc(a.title)}</span>`).join('')}</div></div>`;
  },

  focus() {
    return wrap(`${head('homeFocus')}
      <div class="focus-grid">${list('focus').map((f, i) => `
        <article class="mini-card neu reveal tilt" data-delay="${i % 4}">
          ${proofBtn(f)}
          <span class="mc-icon">${icon(f.icon)}</span>
          <h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>
        </article>`).join('')}</div>
      ${moreLink('about', L('moreAbout', 'More about me'))}`);
  },

  featuredProjects() {
    const featured = list('projects').map((p, i) => [p, i]).filter(([p]) => p.featured).slice(0, 3);
    if (!featured.length) return '';
    return wrap(`${head('homeProjects')}
      <div class="projects-grid">${featured.map(([p, i]) => projectCard(p, i)).join('')}</div>
      ${moreLink('projects', L('allProjects', 'See all projects'))}`);
  },

  latestResearch() {
    if (!list('publications').length) return '';
    return wrap(`${head('homeResearch')}
      <div class="pubs">${list('publications').slice(0, 2).map(pubCard).join('')}</div>
      ${moreLink('research', L('allPublications', 'All publications'))}`);
  },

  cta() {
    const h = C.headings?.homeCta || {};
    const contact = pageOf('contact');
    return `<section class="section"><div class="container"><div class="cta-band glass reveal">
      <div class="morph-blob cta-blob" aria-hidden="true"></div>
      <div class="cta-copy">
        ${h.eyebrow ? `<span class="eyebrow"><span class="num">${pad2(++SEC_NO)}</span><span class="rule"></span>${esc(h.eyebrow)}</span>` : ''}
        <h2>${esc(h.title)} <span class="grad-text">${esc(h.highlight)}</span></h2>
        ${h.lead ? `<p class="lead">${esc(h.lead)}</p>` : ''}
      </div>
      <div class="cta-actions">
        ${contact && contact.visible !== false && PAGE !== 'contact' ? `<a href="${pageHref('contact')}" class="btn btn-primary">${icon('send')} ${esc(L('getInTouch', 'Get in touch'))}</a>` : ''}
        ${C.settings.cv ? `<a href="${esc(asset(C.settings.cv))}" class="btn btn-neu" download>${icon('download')} ${esc(L('downloadCv', 'Download CV'))}</a>` : ''}
      </div>
    </div></div></section>`;
  },

  aboutIntro() {
    const s = C.settings, a = C.about || {};
    return `<section class="section tight"><div class="container about-grid">
      <div class="about-photo reveal">${portrait(s.aboutPhoto || s.photo, { badges: false, chips: true, id: 'aboutPortrait' })}</div>
      <div class="about-text glass reveal" data-delay="1">
        ${(a.paragraphs || []).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}
        <div class="about-tags">${(a.facts || []).map((f) => `<span class="tag">${icon(f.icon)} ${esc(f.text)}</span>`).join('')}</div>
        ${list('languages').length ? `<div class="langs">${list('languages').map((l) => `
          <div class="lang"><div class="lang-top"><span>${icon(l.icon || 'lang')} <b>${esc(l.name)}</b></span><small>${esc(l.level)}</small>${proofBtn(l)}</div>
          <div class="meter" style="--v:${Math.max(0, Math.min(100, +l.percent || 0))}%"><span></span></div></div>`).join('')}</div>` : ''}
      </div>
    </div></section>`;
  },

  skills() {
    return wrap(`${head('skills')}
      <div class="skills-grid">${list('skills').map((k, i) => `
        <article class="skill-card neu reveal tilt" data-delay="${i % 3}" tabindex="0">
          ${proofBtn(k)}
          <div class="skill-top"><span class="mc-icon">${icon(k.icon)}</span><div><h3>${esc(k.title)}</h3><small>${esc(k.subtitle)}</small></div></div>
          <p>${esc(k.text)}</p>
          ${tags(k.tools, 'chips tools')}
        </article>`).join('')}</div>`);
  },

  education() {
    return wrap(`${head('education')}
      <ol class="timeline">${list('education').map((e) => timelineItem(
        { icon: e.icon || 'cap', title: e.degree, org: [e.school, e.location].filter(Boolean).join(' · '), period: e.period, score: e.score, percent: e.percent }, e)).join('')}</ol>`);
  },

  experience() {
    return wrap(`${head('experienceList')}
      <ol class="timeline">${list('experience').map((e) => timelineItem(
        { icon: e.icon || 'briefcase', title: e.role, org: [e.org, e.location].filter(Boolean).join(' · '), period: e.period, points: e.points }, e)).join('')}</ol>`, PAGE === 'experience' ? 'tight' : '');
  },

  certifications() {
    return wrap(`${head('certifications')}
      <div class="cert-grid">${list('certifications').map((c, i) => `
        <article class="cert neu reveal tilt" data-delay="${i % 3}">
          <span class="mc-icon">${icon(c.icon || 'award')}</span>
          <div class="cert-body">
            <div class="tl-meta">${c.date ? `<span class="chip-date">${icon('calendar')} ${esc(c.date)}</span>` : ''}${c.grade ? `<span class="score">${esc(c.grade)}</span>` : ''}</div>
            <h3>${esc(c.title)}</h3><p>${esc(c.issuer)}</p>
            <div class="cert-actions">${proofBtn(c)}${c.link ? `<a class="link-arrow sm" href="${esc(safeUrl(c.link))}" target="_blank" rel="noopener">${esc(L('verify', 'Verify'))} ${icon('external')}</a>` : ''}</div>
          </div>
        </article>`).join('')}</div>`);
  },

  talks() {
    return wrap(`${head('talks')}
      <div class="talks-grid">${list('talks').map((t, i) => `
        <article class="talk glass reveal" data-delay="${i % 2}">
          <span class="mc-icon">${icon(t.icon)}</span>
          <div>
            <span class="role">${esc([t.role, t.date].filter(Boolean).join(' · '))}</span>
            <h3>${esc(t.title)}</h3>
            <span class="role muted">${esc(t.org)}</span>
            <p>${esc(t.text)}</p>
            ${proofBtn(t)}
          </div>
        </article>`).join('')}</div>`);
  },

  projects() {
    const all = list('projects');
    const cats = [...new Set(all.flatMap((p) => p.categories || []))];
    const catIcon = (c) => ({ iot: 'wifi', power: 'zap', robotics: 'bot', web: 'code', automation: 'factory', vlsi: 'layers', ai: 'sparkle', research: 'book' }[c.toLowerCase()] || 'target');
    return wrap(`${PAGE === 'projects' ? '' : head('projects')}
      ${cats.length > 1 ? `<div class="filters reveal" role="group" aria-label="Filter projects">
        <button class="filter neu active" data-filter="all" type="button" aria-pressed="true">${icon('sparkle')} ${esc(L('filterAll', 'All'))} <span class="count">${all.length}</span></button>
        ${cats.map((c) => `<button class="filter neu" type="button" aria-pressed="false" data-filter="${esc(c.toLowerCase())}">${icon(catIcon(c))} ${esc(c)} <span class="count">${all.filter((p) => (p.categories || []).includes(c)).length}</span></button>`).join('')}
      </div>` : ''}
      <div class="projects-grid" id="projectsGrid">${all.map(projectCard).join('')}</div>`, PAGE === 'projects' ? 'tight' : '');
  },

  publications() {
    const scholar = list('socials').find((x) => x.icon === 'scholar' && x.url);
    return wrap(`${PAGE === 'research' ? '' : head('research')}
      <div class="pubs">${list('publications').map(pubCard).join('')}</div>
      ${scholar ? `<div class="scholar-cta glass reveal">
        <span class="sc-icon">${icon('scholar')}</span>
        <div><h3>${esc(scholar.label)}</h3><p>${esc(L('scholarText', ''))}</p></div>
        <a class="btn btn-primary" href="${esc(safeUrl(scholar.url))}" target="_blank" rel="noopener">${esc(L('viewProfile', 'View profile'))} ${icon('arrow')}</a>
      </div>` : ''}`, PAGE === 'research' ? 'tight' : '');
  },

  awards() {
    return wrap(`${PAGE === 'achievements' ? '' : head('awards')}
      <div class="awards-grid">${list('awards').map(awardCard).join('')}</div>`, PAGE === 'achievements' ? 'tight' : '');
  },

  leadership() {
    const cols = [];
    if (list('leadership').length) cols.push(`<div class="lead-col glass reveal"><h3>${icon('crown')} ${esc(L('executiveRoles', 'Executive roles'))}</h3>${roleItems(list('leadership'))}</div>`);
    if (list('ambassador').length) cols.push(`<div class="lead-col glass reveal" data-delay="1"><h3>${icon('megaphone')} ${esc(L('ambassadorRoles', 'Ambassador roles'))}</h3>${roleItems(list('ambassador'))}</div>`);
    if (!cols.length) return '';
    return wrap(`${head('leadership')}<div class="lead-cols ${cols.length === 1 ? 'single' : ''}">${cols.join('')}</div>`);
  },

  contactHero() {
    const s = C.settings;
    const tiles = [];
    if (s.email) tiles.push({ icon: 'mail', label: 'Email', value: s.email, href: `mailto:${s.email}`, copy: s.email });
    if (s.phone) tiles.push({ icon: 'phone', label: 'Phone', value: s.phone.replace(/^(\+880)(\d{4})(\d+)/, '$1 $2 $3'), href: `tel:${s.phone}`, copy: s.phone });
    if (s.whatsapp) tiles.push({ icon: 'whatsapp', label: 'WhatsApp', value: 'Chat with me', href: `https://wa.me/${String(s.whatsapp).replace(/\D/g, '')}`, ext: true });
    list('socials').filter((x) => x.url).forEach((x) => tiles.push({ icon: x.icon, label: x.label, value: x.handle || x.url, href: safeUrl(x.url), ext: true }));
    if (s.location) tiles.push({ icon: 'pin', label: 'Location', value: s.location, href: `https://maps.google.com/?q=${encodeURIComponent(s.location)}`, ext: true });
    const n = Math.min(tiles.length, 6);
    return `<section class="contact-hero">
      <div class="container contact-layout">
        <div class="contact-visual reveal">
          ${portrait(s.contactPhoto || s.photo, { badges: false, chips: false, id: 'contactPortrait' })}
          <div class="orbit-icons" aria-hidden="true">${tiles.slice(0, 6).map((t, i) => `<span class="oi glass" style="--k:${i};--n:${n}">${icon(t.icon)}</span>`).join('')}</div>
        </div>
        <div class="contact-main">
          ${head('contact', { tag: 'h1', cls: 'left' })}
          <div class="contact-tiles">${tiles.map((t, i) => `
            <div class="c-tile neu reveal" data-delay="${i % 4}">
              <a class="c-tile-link" href="${esc(t.href)}" ${t.ext ? 'target="_blank" rel="noopener"' : ''}>
                <span class="c-icon">${icon(t.icon)}</span>
                <span class="c-text"><small>${esc(t.label)}</small><b>${esc(t.value)}</b></span>
              </a>
              ${t.copy ? `<button class="copy-btn" type="button" data-copy="${esc(t.copy)}" aria-label="Copy ${esc(t.label)}">${icon('copy')}</button>` : `<span class="go">${icon('arrow')}</span>`}
            </div>`).join('')}</div>
        </div>
      </div>
    </section>`;
  },

  contactForm() {
    const f = C.settings.form || {};
    const direct = f.provider && f.provider !== 'mailto' && f.key;
    return wrap(`<form class="contact-form glass reveal" id="contactForm" novalidate>
        <div class="form-head"><span class="c-icon">${icon('message')}</span><div><h2>${esc(L('formTitle', 'Send a message'))}</h2><p>${esc(L('formSubtitle', ''))}</p></div></div>
        <div class="form-row">
          <div class="field"><input type="text" id="cf-name" name="name" placeholder=" " required autocomplete="name" maxlength="100" /><label for="cf-name">${icon('user')} ${esc(L('formName', 'Your name'))}</label></div>
          <div class="field"><input type="email" id="cf-email" name="email" placeholder=" " required autocomplete="email" maxlength="150" /><label for="cf-email">${icon('mail')} ${esc(L('formEmail', 'Your email'))}</label></div>
        </div>
        <div class="field"><input type="text" id="cf-subject" name="subject" placeholder=" " maxlength="150" /><label for="cf-subject">${icon('file')} ${esc(L('formSubject', 'Subject'))}</label></div>
        <div class="field"><textarea id="cf-msg" name="message" rows="5" placeholder=" " required maxlength="5000"></textarea><label for="cf-msg">${icon('message')} ${esc(L('formMessage', 'Message'))}</label></div>
        <input type="text" name="botcheck" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <button type="submit" class="btn btn-primary btn-block">${icon('send')} <span>${esc(L('formSend', 'Send message'))}</span></button>
        <p class="form-note" id="formNote" role="status">${direct ? 'Your message goes straight to my inbox.' : 'Opens your email app with the message filled in.'}</p>
      </form>`, 'tight');
  },

  /* Custom sections built in the admin portal */
  custom(sec) {
    const items = (sec.items || []).filter((x) => x && (x.title || x.text || x.image));
    const h = headFrom(sec.heading, { ic: sec.heading?.icon || 'sparkle' });
    const layout = sec.layout || 'cards';
    let body = '';
    if (layout === 'text') {
      body = `<div class="custom-text glass reveal ${sec.image ? 'has-img' : ''}">
        ${sec.image ? `<img src="${esc(asset(sec.image))}" alt="" loading="lazy" class="ct-img" />` : ''}
        <div>${String(sec.text || '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${esc(p.trim())}</p>`).join('')}
        ${sec.button?.label && sec.button?.url ? `<a class="btn btn-primary" href="${esc(safeUrl(sec.button.url))}" ${/^https?:/.test(sec.button.url) ? 'target="_blank" rel="noopener"' : ''}>${icon('arrow-right')} ${esc(sec.button.label)}</a>` : ''}</div>
      </div>`;
    } else if (layout === 'timeline') {
      body = `<ol class="timeline">${items.map((x) => timelineItem({ icon: x.icon || 'calendar', title: x.title, org: x.subtitle, period: x.date, text: x.text, points: x.points, link: x.link }, x)).join('')}</ol>`;
    } else if (layout === 'list') {
      body = `<div class="lead-col glass reveal custom-list">${roleItems(items.map((x) => ({ ...x, org: x.subtitle, period: x.date })))}</div>`;
    } else if (layout === 'gallery') {
      const pics = items.filter((x) => x.image).map((x) => ({ src: x.image, caption: x.title || x.text || '' }));
      PROOFS.push({ items: pics, title: sec.heading?.title || '' });
      const reg = PROOFS.length - 1;
      body = `<div class="gallery-grid">${pics.map((p, i) => `<button type="button" class="g-item reveal" data-delay="${i % 4}" data-gallery="${reg}" data-k="${i}">
        <img src="${esc(asset(p.src))}" alt="${esc(p.caption)}" loading="lazy" />${p.caption ? `<span>${esc(p.caption)}</span>` : ''}</button>`).join('')}</div>`;
    } else if (layout === 'stats') {
      body = `<div class="stats">${items.map((x, i) => {
        const num = parseFloat(String(x.title).replace(/[^\d.]/g, ''));
        const suffix = String(x.title).replace(/^[\d.,\s]+/, '');
        return `<div class="stat neu reveal" data-delay="${i % 4}">${icon(x.icon || 'star')}<div><b ${Number.isFinite(num) ? `data-count="${num}" data-suffix="${esc(suffix)}">0` : `>${esc(x.title)}`}</b><span>${esc(x.subtitle || x.text || '')}</span></div></div>`;
      }).join('')}</div>`;
    } else {
      body = `<div class="focus-grid custom-cards">${items.map((x, i) => `
        <article class="mini-card neu reveal tilt" data-delay="${i % 4}">
          ${proofBtn(x)}
          ${x.image ? `<img src="${esc(asset(x.image))}" alt="" loading="lazy" class="mc-img" />` : `<span class="mc-icon">${icon(x.icon || 'sparkle')}</span>`}
          <h3>${esc(x.title)}</h3>
          ${x.subtitle || x.date ? `<p class="mc-sub">${esc([x.subtitle, x.date].filter(Boolean).join(' · '))}</p>` : ''}
          ${x.text ? `<p>${esc(x.text)}</p>` : ''}
          ${tags(x.tags)}
          ${x.link ? `<a class="link-arrow sm" href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener">${icon('external')} ${esc(x.linkLabel || L('visitProject', 'Open link'))}</a>` : ''}
        </article>`).join('')}</div>`;
    }
    return wrap(h + body);
  },
};

/** Splits text into per-letter spans for the staggered entrance (words stay unbreakable). */
function letters(text, start = 0) {
  let i = start;
  return String(text).split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? ' ' : `<span style="white-space:nowrap">${[...w].map((c) => `<span class="ch" style="--i:${i++}">${esc(c)}</span>`).join('')}</span>`)).join('');
}

function renderPage() {
  if (PAGE === '404') return renderPageAs404();
  const page = pageOf(PAGE);
  if (!page) return renderPageAs404();
  const html = (page.sections || []).filter((s) => s.visible !== false).map((s) => {
    try { return SECTION[s.type]?.(s) || ''; } catch (e) { console.error('Section failed', s, e); return ''; }
  }).join('');
  return html || `<section class="not-found"><div class="container"><h1>${esc(page.label)}</h1><p class="lead">This page has no sections yet.</p></div></section>`;
}
function renderPageAs404() {
  return `<section class="not-found"><div class="container">
    <div class="nf-code reveal"><span>4</span><span class="nf-chip neu">${icon('cpu')}</span><span>4</span></div>
    <h1 class="reveal" data-delay="1">${esc(L('notFoundTitle', 'Page not'))} <span class="grad-text">${esc(L('notFoundHighlight', 'found'))}</span></h1>
    <p class="lead reveal" data-delay="2">${esc(L('notFoundText', ''))}</p>
    <a href="${pageHref('home')}" class="btn btn-primary reveal" data-delay="3">${icon('home')} ${esc(L('backHome', 'Back home'))}</a>
  </div></section>`;
}

/* ------------------------------------------------------------------ interactions */
function initTheme() {
  const btn = $('#themeToggle'), root = document.documentElement;
  const meta = $('meta[name="theme-color"]');
  const sync = () => meta && meta.setAttribute('content', root.dataset.theme === 'dark' ? '#090e1c' : '#e7ecf4');
  sync();
  btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch {}
      sync();
      dispatchEvent(new Event('themechange'));
    };
    if (!document.startViewTransition || reduceMotion) return apply();
    const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-vt');
    const vt = document.startViewTransition(apply);
    vt.ready.then(() => root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' }));
    vt.finished.finally(() => root.classList.remove('theme-vt'));
  });
}

function initNav() {
  const menuBtn = $('#menuBtn'), links = $('#navLinks'), wrap = $('#navWrap');
  const close = () => { links.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', () => {
    const open = !links.classList.contains('open');
    links.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  let lastY = scrollY, ticking = false;
  const prog = $('#scrollProgress'), toTop = $('#toTop');
  const onScroll = () => {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
    wrap.classList.toggle('hidden', y > lastY && y > 300 && !links.classList.contains('open'));
    wrap.classList.toggle('scrolled', y > 20);
    toTop.classList.toggle('show', y > 700);
    lastY = y; ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });
  toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
  onScroll();
}

function initNavIndicator() {
  const ul = $('#navLinks');
  if (!ul) return;
  const ind = document.createElement('span');
  ind.className = 'nav-indicator';
  ind.setAttribute('aria-hidden', 'true');
  ul.prepend(ind);
  const move = (a) => {
    if (!a) { ind.style.opacity = '0'; return; }
    ind.style.opacity = '1';
    ind.style.width = `${a.offsetWidth}px`;
    ind.style.transform = `translateX(${a.parentElement.offsetLeft + a.offsetLeft - 5}px)`;
  };
  const active = () => $('a.active', ul);
  $$('a', ul).forEach((a) => a.addEventListener('pointerenter', () => move(a)));
  ul.addEventListener('pointerleave', () => move(active()));
  addEventListener('resize', () => move(active()));
  document.fonts?.ready.then(() => move(active()));
  move(active());
}

/** Scroll-driven motion: hero parallax, scroll-velocity ticker, shared velocity for the canvas. */
const SCROLL = { y: scrollY, v: 0 };
function initScrollFx() {
  let last = scrollY;
  const root = document.documentElement.style;
  const track = $('.marquee-track');
  let mx = 0;
  if (track && !reduceMotion) track.classList.add('js');
  const loop = () => {
    const y = scrollY;
    SCROLL.v = SCROLL.v * 0.85 + (y - last) * 0.15;
    SCROLL.y = y; last = y;
    if (!reduceMotion) root.setProperty('--sy', Math.min(y, 1100).toFixed(1));
    if (track && !reduceMotion) {
      mx -= 0.5 + Math.min(14, Math.abs(SCROLL.v) * 0.35);
      const half = track.scrollWidth / 2;
      if (half && -mx > half) mx += half;
      track.style.transform = `translateX(${mx}px) skewX(${Math.max(-8, Math.min(8, -SCROLL.v * 0.4))}deg)`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

function initTyped() {
  const el = $('#typed');
  const words = (C.settings.roles || []).filter(Boolean);
  if (!el || reduceMotion || words.length < 2) return;
  let w = 0, c = words[0].length, del = true;
  const tick = () => {
    const word = words[w];
    c += del ? -1 : 1;
    el.textContent = word.slice(0, c);
    let wait = del ? 35 : 70;
    if (!del && c === word.length) { del = true; wait = 1800; }
    else if (del && c === 0) { del = false; w = (w + 1) % words.length; wait = 350; }
    setTimeout(tick, wait);
  };
  setTimeout(tick, 2400);
}

function initReveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      $$('[data-count]', en.target).forEach(countUp);
      if (en.target.matches('[data-count]')) countUp(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
  els.forEach((el) => io.observe(el));
}
function countUp(el) {
  if (el.dataset.done) return;
  el.dataset.done = '1';
  const target = +el.dataset.count, suffix = el.dataset.suffix || '';
  if (reduceMotion) { el.textContent = target + suffix; return; }
  const dur = 1600, t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 4);
    el.textContent = Math.round(target * e) + (p === 1 ? suffix : '');
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function initPointerFx() {
  // Sparks when a primary button is pressed
  if (!reduceMotion) {
    document.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.btn-primary');
      if (!b) return;
      for (let i = 0; i < 10; i++) {
        const sp = document.createElement('i');
        sp.className = 'spark';
        sp.style.left = e.clientX + 'px'; sp.style.top = e.clientY + 'px';
        document.body.appendChild(sp);
        const ang = Math.random() * Math.PI * 2, dist = 20 + Math.random() * 40;
        sp.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 12}px) scale(.2)`, opacity: 0 }],
          { duration: 450 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => sp.remove();
      }
    });
  }
  if (!finePointer || reduceMotion) return;

  // Cursor glow + dot + trailing ring
  const glowOn = C.settings.theme?.cursorGlow !== false;
  const mk = (cls) => { const el = document.createElement('div'); el.className = cls; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); return el; };
  const glow = glowOn ? mk('cursor-glow') : null;
  const dot = mk('cursor-dot'), ring = mk('cursor-ring');
  let mx = -999, my = -999, rx = -999, ry = -999, gx = -999, gy = -999;
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  const loop = () => {
    rx += (mx - rx) * 0.2; ry += (my - ry) * 0.2;
    gx += (mx - gx) * 0.08; gy += (my - gy) * 0.08;
    dot.style.transform = `translate(${mx}px, ${my}px)`;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    if (glow) glow.style.transform = `translate(${gx}px, ${gy}px)`;
    requestAnimationFrame(loop);
  };
  loop();
  const interactive = 'a, button, [data-project], .filter, .c-tile, input, textarea, label';
  document.addEventListener('pointerover', (e) => ring.classList.toggle('hover', !!e.target.closest(interactive)));
  document.addEventListener('pointerdown', () => ring.classList.add('down'));
  document.addEventListener('pointerup', () => ring.classList.remove('down'));
  document.addEventListener('pointerleave', () => { mx = my = -999; });

  // Spotlight border on every card follows the cursor
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.glass, .neu');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });

  // Subtle 3D tilt on cards
  $$('.tilt').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.transform = `perspective(900px) rotateX(${(0.5 - py) * 5}deg) rotateY(${(px - 0.5) * 6}deg) translateY(-4px)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; });
  });

  // Magnetic buttons
  $$('.btn, .social, .pub-link').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });

  // Portrait parallax
  $$('[data-parallax]').forEach((stage) => {
    const host = stage.closest('section') || document.body;
    const img = $('.portrait', stage);
    host.addEventListener('pointermove', (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      stage.style.transform = `perspective(1100px) rotateY(${x * 10}deg) rotateX(${-y * 7}deg)`;
      stage.style.setProperty('--px', `${(x * 18).toFixed(1)}px`);
      stage.style.setProperty('--py', `${(y * 10).toFixed(1)}px`);
    });
    host.addEventListener('pointerleave', () => { stage.style.transform = ''; stage.style.setProperty('--px', '0px'); stage.style.setProperty('--py', '0px'); });
  });
}

function initClock() {
  const el = $('#footerClock');
  if (!el) return;
  const tz = el.dataset.tz, city = el.dataset.city;
  const tick = () => {
    try {
      const t = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date());
      el.textContent = `${city ? city + ' · ' : ''}${t} local time`;
    } catch { el.remove(); }
  };
  tick(); setInterval(tick, 30000);
}

function initSkillTap() {
  $$('.skill-card').forEach((c) => {
    c.addEventListener('click', (e) => { if (!finePointer && !e.target.closest('.proof-btn')) c.classList.toggle('open'); });
    c.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); c.classList.toggle('open'); } });
  });
}

function initFilters() {
  const btns = $$('.filter');
  btns.forEach((b) => b.addEventListener('click', () => {
    btns.forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    const f = b.dataset.filter;
    $$('.project').forEach((p) => {
      const show = f === 'all' || p.dataset.cat.split(' ').includes(f);
      p.classList.toggle('hide', !show);
      p.classList.remove('pop');
      if (show) { void p.offsetWidth; p.classList.add('pop', 'in'); }
    });
  }));
}

/* ---------- Modal / lightbox ---------- */
let lastFocus = null;
function openModal(html, cls = '') {
  closeModal(true);
  lastFocus = document.activeElement;
  const m = document.createElement('div');
  m.className = `modal ${cls}`;
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<div class="modal-backdrop" data-close></div><div class="modal-panel glass">${html}<button class="modal-close icon-btn neu" type="button" data-close aria-label="Close">${icon('x')}</button></div>`;
  document.body.appendChild(m);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => m.classList.add('show'));
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') {
      const f = $$('button, a[href], [tabindex]:not([tabindex="-1"])', m).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  setTimeout(() => $('.modal-close', m)?.focus(), 50);
  return m;
}
function closeModal(instant = false) {
  const m = $('.modal');
  if (!m) return;
  document.body.classList.remove('modal-open');
  if (instant) { m.remove(); return; }
  m.classList.remove('show');
  setTimeout(() => m.remove(), 300);
  lastFocus?.focus?.();
}

function openGallery(proofs, start = 0, title = '') {
  const items = proofs.filter((p) => p?.src);
  if (!items.length) return;
  let i = start;
  const m = openModal(`
    <div class="lightbox">
      <div class="lb-head">${icon('camera')} <span class="lb-title">${esc(title)}</span><span class="lb-count"></span></div>
      <div class="lb-stage">
        <button class="lb-nav prev icon-btn neu" type="button" aria-label="Previous photo">${icon('chevron-left')}</button>
        <figure><img class="lb-img" alt="" /><figcaption class="lb-cap"></figcaption></figure>
        <button class="lb-nav next icon-btn neu" type="button" aria-label="Next photo">${icon('chevron-right')}</button>
      </div>
      <div class="lb-thumbs">${items.map((p, k) => `<button type="button" class="lb-thumb" data-k="${k}" aria-label="Photo ${k + 1}"><img src="${esc(asset(p.src))}" alt="" loading="lazy" /></button>`).join('')}</div>
    </div>`, 'modal-gallery');
  const img = $('.lb-img', m), cap = $('.lb-cap', m), count = $('.lb-count', m);
  const show = (k) => {
    i = (k + items.length) % items.length;
    const box = $('.lightbox', m);
    img.classList.remove('in');
    box.classList.add('loading'); box.classList.remove('failed');
    img.onload = () => { img.classList.add('in'); box.classList.remove('loading'); };
    img.onerror = () => { box.classList.remove('loading'); box.classList.add('failed'); };
    img.src = asset(items[i].src);
    img.alt = items[i].caption || title;
    cap.textContent = items[i].caption || '';
    count.textContent = `${i + 1} / ${items.length}`;
    $$('.lb-thumb', m).forEach((t, k2) => t.classList.toggle('active', k2 === i));
  };
  $$('.lb-nav', m).forEach((b) => b.hidden = items.length < 2);
  $('.lb-thumbs', m).hidden = items.length < 2;
  $('.prev', m).addEventListener('click', () => show(i - 1));
  $('.next', m).addEventListener('click', () => show(i + 1));
  $$('.lb-thumb', m).forEach((t) => t.addEventListener('click', () => show(+t.dataset.k)));
  m.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
  let sx = null;
  $('.lb-stage', m).addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $('.lb-stage', m).addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
    sx = null;
  });
  show(start);
}

function openProject(i) {
  const p = list('projects')[i];
  if (!p) return;
  const proofs = (p.proofs || []).filter((x) => x?.src);
  const cover = p.cover || proofs[0]?.src;
  const m = openModal(`
    <article class="project-detail">
      <div class="pd-cover">${cover ? `<img src="${esc(asset(cover))}" alt="" />` : artMotif(i + 1)}<span class="big-ic">${icon(p.icon)}</span></div>
      <div class="pd-body">
        <div class="tl-meta">${p.year ? `<span class="chip-date">${icon('calendar')} ${esc(p.year)}</span>` : ''}${(p.categories || []).map((c) => `<span class="score">${esc(c)}</span>`).join('')}</div>
        <h2>${esc(p.title)}</h2>
        ${p.kicker ? `<p class="kicker">${esc(p.kicker)}</p>` : ''}
        <p>${esc(p.text)}</p>
        ${tags(p.tags)}
        ${proofs.length ? `<h3 class="pd-sub">${icon('camera')} ${esc(L('photos', 'Photos'))}</h3><div class="pd-gallery">${proofs.map((x, k) => `<button type="button" class="pd-thumb" data-k="${k}"><img src="${esc(asset(x.src))}" alt="${esc(x.caption || '')}" loading="lazy" />${x.caption ? `<span>${esc(x.caption)}</span>` : ''}</button>`).join('')}</div>` : ''}
        ${p.link ? `<a class="btn btn-primary" href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener">${icon('external')} ${esc(L('visitProject', 'Visit project'))}</a>` : ''}
      </div>
    </article>`, 'modal-project');
  $$('.pd-thumb', m).forEach((t) => t.addEventListener('click', () => openGallery(proofs, +t.dataset.k, p.title)));
}

function initModals() {
  document.addEventListener('click', (e) => {
    const pb = e.target.closest('[data-proof]');
    if (pb) {
      e.stopPropagation();
      const reg = PROOFS[+pb.dataset.proof];
      if (reg) openGallery(reg.items, 0, reg.title);
      return;
    }
    const g = e.target.closest('[data-gallery]');
    if (g) {
      const reg = PROOFS[+g.dataset.gallery];
      if (reg) openGallery(reg.items, +g.dataset.k || 0, reg.title);
      return;
    }
    const card = e.target.closest('[data-project]');
    if (card && !e.target.closest('a')) openProject(+card.dataset.project);
  });
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('[data-project]');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProject(+card.dataset.project); }
  });
}

/* ---------- Contact ---------- */
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function initCopy() {
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.copy;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1200);
    toast(`Copied: ${text}`);
  }));
}
function initContactForm() {
  const form = $('#contactForm');
  if (!form) return;
  const note = $('#formNote'), btn = $('button[type="submit"]', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.botcheck.value) return; // honeypot
    const name = form.name.value.trim(), email = form.email.value.trim(), msg = form.message.value.trim();
    const subject = form.subject.value.trim() || `Portfolio enquiry from ${name}`;
    $$('.field', form).forEach((f) => f.classList.remove('error'));
    const bad = [];
    if (!name) bad.push(form.name);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad.push(form.email);
    if (!msg) bad.push(form.message);
    if (bad.length) {
      bad.forEach((el) => el.parentElement.classList.add('error'));
      note.textContent = 'Fill in your name, a valid email and a message.';
      note.className = 'form-note err'; bad[0].focus(); return;
    }
    const cfg = C.settings.form || {};
    note.className = 'form-note';
    if (cfg.provider === 'web3forms' && cfg.key || cfg.provider === 'formspree' && cfg.key) {
      btn.disabled = true; btn.classList.add('loading');
      try {
        const res = cfg.provider === 'web3forms'
          ? await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ access_key: cfg.key, name, email, subject, message: msg, from_name: 'Portfolio' }) })
          : await fetch(`https://formspree.io/f/${encodeURIComponent(cfg.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name, email, subject, message: msg }) });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        form.classList.add('sent');
        note.textContent = L('formSent', 'Thanks! Your message has been sent.');
        note.className = 'form-note ok';
        toast('Message sent');
      } catch {
        note.textContent = `Couldn't send right now. Email me directly at ${C.settings.email}.`;
        note.className = 'form-note err';
      } finally { btn.disabled = false; btn.classList.remove('loading'); }
      return;
    }
    location.href = `mailto:${C.settings.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${msg}\n\nFrom: ${name} <${email}>`)}`;
    note.textContent = 'Your email app should open with the message filled in.';
    toast('Opening your email app…');
  });
}

/* ---------- Circuit-trace background ---------- */
function initCircuit() {
  if (C.settings.theme?.circuit === false) return;
  const cv = document.createElement('canvas');
  cv.className = 'bg-canvas'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const ctx = cv.getContext('2d');
  let dpr, V, traces = [], pulses = [], colors = {}, raf = 0, mx = -999, my = -999;
  const G = 28;
  const probe = document.createElement('i');
  probe.hidden = true;
  document.body.appendChild(probe);
  const resolve = (v) => { probe.style.color = `var(${v})`; return getComputedStyle(probe).color; };
  const readColors = () => { colors.trace = resolve('--trace'); colors.pulse = resolve('--trace-pulse'); colors.hot = resolve('--a1'); };
  const build = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    V = innerHeight * 3; // traces live on a tall virtual sheet that scrolls past
    traces = []; pulses = [];
    const count = Math.round((innerWidth * V) / 52000);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < count; i++) {
      let x = Math.round(Math.random() * innerWidth / G) * G, y = Math.round(Math.random() * V / G) * G;
      let d = Math.floor(Math.random() * 4);
      const pts = [[x, y]];
      const segs = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < segs; k++) {
        const len = (2 + Math.floor(Math.random() * 6)) * G;
        const [dx, dy] = dirs[d];
        x += dx * len; y += dy * len; pts.push([x, y]);
        d = d < 4 ? (Math.random() < 0.5 ? 4 + ((d + (Math.random() < 0.5 ? 0 : 1)) % 4) : d) : Math.floor(Math.random() * 4);
      }
      let total = 0; const lens = [];
      for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); lens.push(l); total += l; }
      traces.push({ pts, lens, total, y0: pts[0][1] });
      if (Math.random() < 0.5) pulses.push({ t: traces.length - 1, p: Math.random(), v: 0.0012 + Math.random() * 0.0025 });
    }
  };
  const pointAt = (tr, p) => {
    let d = p * tr.total;
    for (let k = 0; k < tr.lens.length; k++) {
      if (d <= tr.lens[k]) { const a = tr.pts[k], b = tr.pts[k + 1], f = d / tr.lens[k]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      d -= tr.lens[k];
    }
    return tr.pts[tr.pts.length - 1];
  };
  // Vertical offset for a trace so the sheet scrolls at 35% of the page speed and wraps around
  const shift = (tr) => (((tr.y0 - SCROLL.y * 0.35) % V) + V) % V - tr.y0 - innerHeight * 0.5;
  const strokeTrace = (tr, dy) => {
    ctx.beginPath(); ctx.moveTo(tr.pts[0][0], tr.pts[0][1] + dy);
    for (let k = 1; k < tr.pts.length; k++) ctx.lineTo(tr.pts[k][0], tr.pts[k][1] + dy);
    ctx.stroke();
  };
  const visible = (tr, dy) => tr.pts.some(([, y]) => y + dy > -60 && y + dy < innerHeight + 60);
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const shown = [];
    ctx.lineWidth = 1.2; ctx.strokeStyle = colors.trace; ctx.fillStyle = colors.trace;
    traces.forEach((tr, i) => {
      const dy = shift(tr);
      if (!visible(tr, dy)) return;
      shown.push([tr, dy, i]);
      strokeTrace(tr, dy);
      const [sx, sy] = tr.pts[0], [ex, ey] = tr.pts[tr.pts.length - 1];
      ctx.beginPath(); ctx.arc(sx, sy + dy, 2.5, 0, 7); ctx.arc(ex, ey + dy, 2.5, 0, 7); ctx.fill();
    });
    // Traces light up around the cursor
    if (mx > -900) {
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, 170, 0, 7); ctx.clip();
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 170);
      g.addColorStop(0, colors.hot); g.addColorStop(1, 'transparent');
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.8;
      shown.forEach(([tr, dy]) => strokeTrace(tr, dy));
      ctx.restore();
    }
    ctx.fillStyle = colors.pulse; ctx.shadowColor = colors.pulse; ctx.shadowBlur = 10;
    const map = new Map(shown.map(([tr, dy, i]) => [i, dy]));
    pulses.forEach((pu) => {
      if (!map.has(pu.t)) return;
      const [x, y] = pointAt(traces[pu.t], pu.p);
      ctx.beginPath(); ctx.arc(x, y + map.get(pu.t), 2.2, 0, 7); ctx.fill();
    });
    ctx.shadowBlur = 0;
  };
  const loop = () => {
    const boost = 1 + Math.min(6, Math.abs(SCROLL.v) * 0.25);
    pulses.forEach((pu) => { pu.p += pu.v * boost; if (pu.p > 1) pu.p = 0; });
    draw(); raf = requestAnimationFrame(loop);
  };
  readColors(); build();
  if (reduceMotion) draw(); else loop();
  if (finePointer) {
    addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
    document.addEventListener('pointerleave', () => { mx = my = -999; });
  }
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { build(); if (reduceMotion) draw(); }, 200); });
  addEventListener('themechange', () => { readColors(); if (reduceMotion) draw(); });
  document.addEventListener('visibilitychange', () => {
    if (reduceMotion) return;
    cancelAnimationFrame(raf);
    if (!document.hidden) loop();
  });
}

function initPreloader(done) {
  if (window.__boot) window.__boot.finish(done); else { $('#preloader')?.remove(); done(); }
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  injectSprite();
  setIconResolver(asset);
  try {
    const res = await loadContent();
    C = res.content;
  } catch (err) {
    window.__boot?.finish();
    document.body.classList.add('ready');
    $('#main').innerHTML = `<section class="not-found"><div class="container"><h1>Couldn't load the site</h1><p class="lead">${esc(err.message)}. Please refresh the page.</p></div></section>`;
    console.error(err);
    return;
  }
  applySettings();
  renderHeader();
  SEC_NO = 0;
  $('#main').innerHTML = renderPage();
  renderFooter();

  initTheme();
  initNav();
  initFilters();
  initModals();
  initCopy();
  initContactForm();
  initSkillTap();
  initPointerFx();
  initCircuit();
  initClock();
  initNavIndicator();
  initScrollFx();
  layoutPortraits();
  addEventListener('resize', layoutPortraits);
  document.body.classList.add('ready');
  initPreloader(() => { initReveal(); initTyped(); });

  // Projects page: open a project from the URL hash (#project-2)
  const m = location.hash.match(/^#project-(\d+)/);
  if (m && PAGE === 'projects') setTimeout(() => openProject(+m[1]), 600);
}

boot();
