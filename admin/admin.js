// Admin portal: edit every part of the portfolio, attach proof photos, and publish to GitHub.
import { injectSprite, icon, ICON_NAMES, setIconResolver, isImageIcon, setCustomIcons, inlineSvg } from '../assets/js/icons.js?v=202611031628';
import { openCropper, cropToBlob, fitViewBox } from './cropper.js?v=202611031628';
import { parseSvgIcon, iconIdFor } from './svgicon.js?v=202611031628';
import { DRAFT_KEY, ROOT, pending, registerBlob, registerBlobs, asset, readDraft } from '../assets/js/store.js?v=202611031628';
import { GitHub } from './github.js?v=202611031628';
import { createVault, openVault, loadVault, cacheVault, passwordStrength, session, VAULT_FILE } from './vault.js?v=202611031628';
import { GROUPS, SECTIONS, HEADING_LABELS, PALETTES, SECTION_TYPES, LAYOUTS, CUSTOM_ITEM_FIELDS, RESERVED_PAGE_IDS, PAGE_TEMPLATES } from './schema.js?v=202611031628';
import { extractPalette, schemesFor, rgbToHex, rgbToHsl, hexToRgb } from './colors.js?v=202611031628';
import { processImage, uploadPath, removeBackground } from './imagetools.js?v=202611031628';

const CONTENT_PATH = 'data/content.json';
const AUTOLOCK_KEY = 'portfolio.admin.autolock';

const state = { content: null, published: '', remoteSha: null, mode: null, gh: null, user: null, section: 'dashboard' };

/* ------------------------------------------------------------------ utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
function getPath(obj, path, create = false) {
  return path.split('.').reduce((o, k) => {
    if (o == null) return o;
    if (o[k] == null && create) o[k] = {};
    return o[k];
  }, obj);
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtBytes = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const timeAgo = (t) => {
  const s = Math.round((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

function toast(msg, kind = '') {
  const t = $('#toast');
  t.className = `toast glass show ${kind}`;
  t.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info')} <span>${esc(msg)}</span>`;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/** Promise-based dialog. buttons: [{label, value, kind}] */
function dialog({ title, body = '', icon: ic = 'info', buttons = [{ label: 'OK', value: true, kind: 'primary' }], wide = false }) {
  return new Promise((resolve) => {
    const m = h(`<div class="a-modal" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
      <div class="a-modal-backdrop"></div>
      <div class="a-modal-panel glass ${wide ? 'wide' : ''}">
        <div class="a-modal-head"><span class="a-modal-icon">${icon(ic)}</span><h2 id="dlgTitle">${esc(title)}</h2></div>
        <div class="a-modal-body">${body}</div>
        <div class="a-modal-foot">${buttons.map((b, i) => `<button type="button" class="btn ${b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger' : 'btn-neu'}" data-i="${i}">${b.icon ? icon(b.icon) : ''}${esc(b.label)}</button>`).join('')}</div>
      </div></div>`);
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('show'));
    const done = (v) => { m.classList.remove('show'); setTimeout(() => m.remove(), 250); resolve(v); };
    $$('[data-i]', m).forEach((b) => b.addEventListener('click', () => done(buttons[+b.dataset.i].value)));
    $('.a-modal-backdrop', m).addEventListener('click', () => done(null));
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    setTimeout(() => ($('[data-i]:last-child', m) || m).focus(), 60);
  });
}
const confirmDlg = (title, body, okLabel = 'Confirm', danger = false) =>
  dialog({ title, body: `<p>${body}</p>`, icon: danger ? 'alert' : 'info', buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }] });

/* ------------------------------------------------------------------ draft */
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ content: state.content, savedAt: Date.now() })); }
  catch { toast('Browser storage is full, so the draft could not be saved', 'err'); }
  updateDirty();
  applyAdminTheme();
}
const isDirty = () => JSON.stringify(state.content) !== state.published;

function changedSections() {
  const pub = JSON.parse(state.published || '{}');
  const out = [];
  for (const s of Object.values(SECTIONS)) {
    if (!s.path) continue;
    const a = getPath(state.content, s.path), b = getPath(pub, s.path);
    if (s.kind === 'object') {
      if (s.fields.some((f) => JSON.stringify(a?.[f.key]) !== JSON.stringify(b?.[f.key]))) out.push(s);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(s);
  }
  return out;
}

function updateDirty() {
  const dirty = isDirty();
  const pill = $('#statusPill');
  if (!pill) return;
  pill.className = `status-pill ${dirty ? 'dirty' : 'clean'}`;
  pill.innerHTML = dirty ? `<span class="dot"></span> ${changedSections().length || 1} unpublished change${changedSections().length === 1 ? '' : 's'}` : `<span class="dot"></span> All published`;
  $('#publishBtn').classList.toggle('pulse', dirty);
}

const HEX = /^#[0-9a-f]{6}$/i;
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function applyAdminTheme() {
  const t = state.content?.settings?.theme || {};
  const r = document.documentElement.style;
  ['accent1', 'accent2', 'accent3'].forEach((k, i) => t[k] && r.setProperty(`--a${i + 1}`, t[k]));
  if (HEX.test(t.accent1 || '')) r.setProperty('--on-accent', lum(t.accent1) > 0.22 ? '#17181b' : '#ffffff');
  document.getElementById('custom-scheme')?.remove();
  const c = t.custom;
  if (!c?.enabled) return;
  const block = (m = {}) => [
    HEX.test(m.bg || '') && `--bg:${m.bg}`, HEX.test(m.surface || '') && `--surface:${m.surface};--surface-2:color-mix(in srgb, ${m.surface} 90%, ${m.text || '#888'})`,
    HEX.test(m.text || '') && `--text:${m.text};--text-2:color-mix(in srgb, ${m.text} 82%, ${m.bg || '#888'});--line:color-mix(in srgb, ${m.text} 11%, transparent);--line-strong:color-mix(in srgb, ${m.text} 24%, transparent)`,
    HEX.test(m.muted || '') && `--muted:${m.muted}`, HEX.test(m.accent || '') && `--accent:${m.accent}`,
  ].filter(Boolean).join(';');
  const st = document.createElement('style');
  st.id = 'custom-scheme';
  st.textContent = `:root{${block(c.light)}}:root[data-theme="dark"]{${block(c.dark)}}`;
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ login */
// Content is edited in a PRIVATE source repo; a GitHub Action deploys the public site from it.
const SOURCE_REPO = 'portfolio-source';
// Local test mode exists only when the portal runs on this computer (never on the live domain)
const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
function defaultRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) return { owner: host.split('.')[0], repo: SOURCE_REPO };
  return { owner: 'anik-creates', repo: SOURCE_REPO };
}

function bindPwToggles(root) {
  $$('.pw-toggle', root).forEach((b) => b.addEventListener('click', () => {
    const inp = b.previousElementSibling;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    b.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eye-off');
  }));
}
function strengthMeter(input, out) {
  const upd = () => {
    const r = passwordStrength(input.value);
    out.innerHTML = input.value ? `<span class="meter-bar s${r.score}"><i></i></span><small>${esc(r.hint)}</small>` : '';
  };
  input.addEventListener('input', upd);
}
const pwField = (id, label, auto, extra = '') => `<div class="a-field"><label for="${id}">${label}</label>
  <div class="pw-wrap"><input id="${id}" class="a-input" type="password" required autocomplete="${auto}" ${extra} />
  <button type="button" class="pw-toggle" aria-label="Show password">${icon('eye')}</button></div></div>`;

async function renderLogin(message = '', forceSetup = false) {
  $('#appShell').hidden = true;
  const login = $('#login');
  login.hidden = false;
  login.innerHTML = `<div class="login-card glass center"><span class="spinner"></span></div>`;
  const vlt = forceSetup ? null : await loadVault();
  if (vlt) renderSignIn(vlt, message);
  else renderSetup(message, forceSetup);
}

function renderSignIn(vlt, message) {
  const login = $('#login');
  login.innerHTML = `
    <form class="login-card glass" id="signinForm">
      <div class="login-brand"><span class="brand-mark">${icon('lock')}</span></div>
      <h1>Admin <span class="grad-text">sign in</span></h1>
      <p class="muted">Sign in to edit and publish your portfolio.</p>
      ${message ? `<p class="login-msg">${icon('info')} ${esc(message)}</p>` : ''}
      <div class="a-field"><label for="email">Email</label><input id="email" class="a-input" type="email" required autocomplete="username" placeholder="${esc(vlt.hint || 'you@example.com')}" /></div>
      ${pwField('password', 'Password', 'current-password')}
      <label class="check-row"><input type="checkbox" id="remember" /> <span>Keep me signed in on this device for 7 days</span></label>
      <p class="login-err" id="loginErr" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('key')} <span>Sign in</span></button>
      <div class="login-links">
        ${DEV ? `<button type="button" class="link" id="offlineBtn">${icon('eye')} Local test mode</button>` : ''}
        <button type="button" class="link" id="forgotBtn">${icon('info')} Forgot password?</button>
      </div>
    </form>`;
  bindPwToggles(login);
  $('#signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginErr'), btn = $('#signinForm button[type=submit]');
    const wait = +sessionStorage.getItem('adminLockUntil') || 0;
    if (Date.now() < wait) { err.textContent = `Too many attempts. Try again in ${Math.ceil((wait - Date.now()) / 1000)} s.`; return; }
    btn.disabled = true; btn.classList.add('loading'); $('span', btn).textContent = 'Checking…'; err.textContent = '';
    try {
      const cfg = await openVault(vlt, $('#email').value, $('#password').value);
      sessionStorage.removeItem('adminFails');
      await connect(cfg, $('#remember').checked);
    } catch (ex) {
      const fails = (+sessionStorage.getItem('adminFails') || 0) + 1;
      sessionStorage.setItem('adminFails', fails);
      if (fails >= 5) { sessionStorage.setItem('adminLockUntil', Date.now() + 60000); sessionStorage.setItem('adminFails', 0); }
      err.textContent = ex.status === 401 ? 'Your saved GitHub access has expired or was revoked. Use "Forgot password?" to set up a new one.' : ex.message;
      $('#signinForm').classList.add('shake'); setTimeout(() => $('#signinForm')?.classList.remove('shake'), 500);
    } finally { btn.disabled = false; btn.classList.remove('loading'); const s = $('#signinForm button[type=submit] span'); if (s) s.textContent = 'Sign in'; }
  });
  $('#forgotBtn').addEventListener('click', async () => {
    const v = await dialog({
      title: 'Reset your login', icon: 'key',
      body: `<p>Your password never leaves your device, so it can't be recovered or emailed. You can set a new email and password using a GitHub token for this repository.</p>`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Reset with GitHub token', value: true, kind: 'primary' }],
    });
    if (v) renderLogin('', true);
  });
  $('#offlineBtn')?.addEventListener('click', () => { if (DEV) startSession('local'); });
  setTimeout(() => $('#email')?.focus(), 50);
}

function renderSetup(message, isReset) {
  const d = defaultRepo();
  const login = $('#login');
  login.innerHTML = `
    <form class="login-card glass wide" id="setupForm" autocomplete="off">
      <div class="login-brand"><span class="brand-mark">${icon('shield')}</span></div>
      <h1>${isReset ? 'Reset your' : 'Create your'} <span class="grad-text">admin login</span></h1>
      <p class="muted">One-time setup. Afterwards you sign in with just your email and password, from any device.</p>
      ${message ? `<p class="login-msg">${icon('info')} ${esc(message)}</p>` : ''}
      <div class="setup-step"><span class="step-no">1</span><div>
        <b>Connect GitHub (only this once)</b>
        <details class="howto"><summary>${icon('info')} How to get the token (2 minutes)</summary>
          <ol>
            <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens → Generate new token</a>.</li>
            <li>Name: "Portfolio admin". Expiration: the longest offered (or "No expiration").</li>
            <li>Repository access: <b>Only select repositories</b> → <b>${esc(d.repo)}</b> (your private source repo).</li>
            <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
            <li>Click Generate, copy the token and paste it here.</li>
          </ol>
        </details>
        <div class="a-field"><label for="token">GitHub token</label>
          <div class="pw-wrap"><input id="token" class="a-input mono" type="password" required placeholder="github_pat_…" spellcheck="false" />
          <button type="button" class="pw-toggle" aria-label="Show token">${icon('eye')}</button></div></div>
        <details class="advanced"><summary>Repository settings</summary>
          <div class="grid-3">
            <div class="a-field"><label for="owner">Owner</label><input id="owner" class="a-input" required value="${esc(d.owner)}" /></div>
            <div class="a-field"><label for="repo">Repository</label><input id="repo" class="a-input" required value="${esc(d.repo)}" /></div>
            <div class="a-field"><label for="branch">Branch</label><input id="branch" class="a-input" required value="main" /></div>
          </div>
        </details>
      </div></div>
      <div class="setup-step"><span class="step-no">2</span><div>
        <b>Choose your sign-in details</b>
        <div class="a-field"><label for="email">Email</label><input id="email" class="a-input" type="email" required autocomplete="username" /></div>
        <div class="grid-2">
          ${pwField('pass1', 'Password', 'new-password', 'minlength="12"')}
          ${pwField('pass2', 'Repeat password', 'new-password', 'minlength="12"')}
        </div>
        <div class="strength" id="strength"></div>
      </div></div>
      <p class="hint">${icon('lock')} Your GitHub token is encrypted with your email + password (AES-256, 600,000 PBKDF2 rounds) and saved in the repository. Without your password it is unreadable, so choose a strong, unique one.</p>
      <label class="check-row"><input type="checkbox" id="remember" checked /> <span>Keep me signed in on this device for 7 days</span></label>
      <p class="login-err" id="loginErr" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('shield')} <span>${isReset ? 'Save new login' : 'Create login & continue'}</span></button>
      <div class="login-links">
        ${DEV ? `<button type="button" class="link" id="offlineBtn">${icon('eye')} Local test mode</button>` : ''}
        ${isReset ? `<button type="button" class="link" id="backBtn">${icon('chevron-left')} Back to sign in</button>` : ''}
      </div>
    </form>`;
  bindPwToggles(login);
  strengthMeter($('#pass1'), $('#strength'));
  $('#setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginErr'), btn = $('#setupForm button[type=submit]');
    const email = $('#email').value.trim(), p1 = $('#pass1').value, p2 = $('#pass2').value;
    const st = passwordStrength(p1);
    if (!st.ok) { err.textContent = `Password too weak: ${st.hint}.`; return; }
    if (p1 !== p2) { err.textContent = 'The passwords do not match.'; return; }
    const cfg = { token: $('#token').value.trim(), owner: $('#owner').value.trim(), repo: $('#repo').value.trim(), branch: $('#branch').value.trim() || 'main' };
    btn.disabled = true; btn.classList.add('loading'); err.textContent = '';
    try {
      await new GitHub(cfg).verify();
      const vlt = await createVault(cfg, email, p1);
      await new GitHub(cfg).commit([{ path: VAULT_FILE, text: JSON.stringify(vlt, null, 2) + '\n' }], isReset ? 'Reset admin login' : 'Set up admin login');
      cacheVault(vlt);
      toast('Login created. From now on just use your email and password.', 'ok');
      await connect({ ...cfg, email }, $('#remember').checked);
    } catch (ex) {
      err.textContent = ex.status === 401 ? 'GitHub rejected that token. Check it was copied completely.'
        : ex.status === 404 ? 'Repository not found, or the token has no access to it.'
        : ex.status === 409 ? 'The repository is empty. Push the site files first.'
        : ex.status === 403 ? 'The token cannot write to this repository. Give it "Contents: Read and write".' : ex.message;
    } finally { btn.disabled = false; btn.classList.remove('loading'); }
  });
  $('#backBtn')?.addEventListener('click', () => renderLogin());
  $('#offlineBtn')?.addEventListener('click', () => { if (DEV) startSession('local'); });
  setTimeout(() => $('#token')?.focus(), 50);
}

async function connect(cfg, remember = false) {
  const gh = new GitHub(cfg);
  const { user } = await gh.verify();
  state.gh = gh; state.user = user; state.email = cfg.email || '';
  if (remember) { try { await session.save({ token: cfg.token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, email: cfg.email }); } catch {} }
  await startSession('github');
}

/* ------------------------------------------------------------------ session */
async function startSession(mode) {
  if (mode !== 'github' && !DEV) return;
  state.mode = mode;
  let remote = null;
  try {
    if (mode === 'github') {
      const f = await state.gh.readText(CONTENT_PATH);
      if (f) { remote = JSON.parse(f.text); state.remoteSha = f.sha; }
    }
    if (!remote) {
      const res = await fetch(ROOT + CONTENT_PATH + '?v=' + Date.now(), { cache: 'no-store' });
      remote = await res.json();
    }
  } catch (e) {
    toast(`Could not load content: ${e.message}`, 'err');
    return;
  }
  state.published = JSON.stringify(remote);
  state.content = remote;
  try { registerBlobs(await pending.all()); } catch {}

  const draft = readDraft();
  if (draft?.content && JSON.stringify(draft.content) !== state.published) {
    const v = await dialog({
      title: 'Resume your unpublished draft?', icon: 'save',
      body: `<p>You have changes from ${esc(timeAgo(draft.savedAt))} that haven't been published yet.</p>`,
      buttons: [{ label: 'Discard draft', value: 'discard', kind: 'danger' }, { label: 'Resume draft', value: 'resume', kind: 'primary' }],
    });
    if (v === 'resume' || v === null) state.content = draft.content;
    else { localStorage.removeItem(DRAFT_KEY); try { await pending.clear(); } catch {} }
  }
  normalise(state.content);
  $('#login').hidden = true;
  $('#appShell').hidden = false;
  renderShell();
  applyAdminTheme();
  { const hsh = location.hash.slice(1); go(hsh in SECTIONS || hsh.startsWith('page:') ? hsh : 'dashboard'); }
  startIdleTimer();
}

/** Make sure every collection exists and every item that supports proofs has an array. */
function normalise(c) {
  for (const s of Object.values(SECTIONS)) {
    if (s.kind === 'collection') {
      const parent = s.path.includes('.') ? getPath(c, s.path.split('.').slice(0, -1).join('.'), true) : c;
      const key = s.path.split('.').pop();
      if (!Array.isArray(parent[key])) parent[key] = [];
      if (s.fields.some((f) => f.type === 'proofs')) parent[key].forEach((it) => { if (!Array.isArray(it.proofs)) it.proofs = []; });
    } else if (s.kind === 'object') getPath(c, s.path, true);
  }
  c.headings ||= {};
  c.labels ||= {};
  if (!Array.isArray(c.iconLibrary)) c.iconLibrary = [];
  c.settings ||= {};
  c.settings.footerBlock ||= {};
  ['showName', 'showText', 'showClock', 'showNav', 'showSocials', 'showSignature', 'signatureAnimate'].forEach((k) => { if (c.settings.footerBlock[k] == null) c.settings.footerBlock[k] = true; });
  setCustomIcons(c.iconLibrary);
  (c.pages || []).forEach((p) => { if (!Array.isArray(p.sections)) p.sections = []; });
}

function lock(reason = '') {
  state.gh = null; state.user = null;
  stopIdleTimer();
  session.clear();
  renderLogin(reason);
}

let idleTimer = null, lastActive = Date.now();
const markActive = () => { lastActive = Date.now(); };
function startIdleTimer() {
  stopIdleTimer();
  ['pointerdown', 'keydown', 'scroll'].forEach((e) => addEventListener(e, markActive, { passive: true }));
  idleTimer = setInterval(() => {
    const mins = +localStorage.getItem(AUTOLOCK_KEY) || 30;
    if (state.mode === 'github' && Date.now() - lastActive > mins * 60000) lock('Locked after inactivity. Your draft is saved.');
  }, 20000);
}
function stopIdleTimer() { clearInterval(idleTimer); }

/* ------------------------------------------------------------------ shell */
function renderShell() {
  const user = state.user;
  $('#sidebarNav').innerHTML = GROUPS.map((g) => `
    <div class="nav-group"><p>${esc(g.label)}</p>
      ${g.items.map((s) => `<a href="#${s.id}" data-sec="${s.id}">${icon(s.icon)}<span>${esc(s.label)}</span>${s.kind === 'collection' ? `<em class="count" data-count="${s.id}"></em>` : ''}</a>`).join('')}
    </div>`).join('');
  $('#userChip').innerHTML = state.mode === 'github'
    ? `${user?.avatar_url ? `<img src="${esc(user.avatar_url)}&s=64" alt="" />` : icon('user')}<div><b>${esc(state.email || user?.login || '')}</b><small>${esc(state.gh.owner)}/${esc(state.gh.repo)}</small></div>`
    : `${icon('eye')}<div><b>Local test mode</b><small>This computer only</small></div>`;
  $('#siteLink').href = ROOT + 'index.html';
  updateCounts();
  updateDirty();
}
function updateCounts() {
  $$('[data-count]').forEach((el) => {
    const s = SECTIONS[el.dataset.count];
    el.textContent = (getPath(state.content, s.path) || []).length;
  });
}

function go(id) {
  if (String(id).startsWith('page:')) {
    const pid = id.slice(5);
    state.section = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
    $$('#sidebarNav a').forEach((a) => a.classList.toggle('active', a.dataset.sec === 'pages'));
    $('#viewTitle').innerHTML = `${icon('layers')} Pages & sections`;
    document.body.classList.remove('nav-open');
    const view = $('#view');
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    view.innerHTML = '';
    view.appendChild(pageDetailView(pid));
    $('.workspace').scrollTo({ top: 0 });
    return;
  }
  const s = SECTIONS[id] || SECTIONS.dashboard;
  state.section = s.id;
  if (location.hash.slice(1) !== s.id) history.replaceState(null, '', '#' + s.id);
  $$('#sidebarNav a').forEach((a) => a.classList.toggle('active', a.dataset.sec === s.id));
  $('#viewTitle').innerHTML = `${icon(s.icon)} ${esc(s.label)}`;
  document.body.classList.remove('nav-open');
  const view = $('#view');
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  view.innerHTML = '';
  if (s.kind === 'object') view.appendChild(objectView(s));
  else if (s.kind === 'collection') view.appendChild(collectionView(s));
  else if (s.kind === 'headings') view.appendChild(headingsView(s));
  else view.appendChild(VIEWS[s.id]());
  $('.workspace').scrollTo({ top: 0 });
}

const sectionHeader = (s, actions = '') => `
  <header class="view-head">
    <div><h1>${icon(s.icon)} ${esc(s.label)}</h1>${s.desc ? `<p class="muted">${esc(s.desc)}</p>` : ''}</div>
    <div class="view-actions">${actions}</div>
  </header>`;

/* ------------------------------------------------------------------ zoom & crop */
/** Lets the user zoom/crop an uploaded photo to the shape it is shown in, then compresses it.
 *  Returns { out, skipRest } or null when cancelled. */
async function cropUpload(file, frame = 'card', { max = 1600, keepAlpha = false, title = '', batch = null } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
  const url = URL.createObjectURL(file);
  try {
    const r = await openCropper({ url, frame, title, batch });
    if (!r) return null;
    const src = r.mode === 'crop' ? new File([await cropToBlob(url, r, Math.max(max, 400))], 'crop.png', { type: 'image/png' }) : file;
    return { out: await processImage(src, { maxSize: max, keepAlpha }), skipRest: r.mode === 'original-all' };
  } finally { URL.revokeObjectURL(url); }
}
/** Re-crop an image that is already uploaded (or published). Returns the new path or null. */
async function recrop(path, frame, opts = {}) {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error('Could not load that image');
  const blob = await res.blob();
  const name = path.split('/').pop().replace(/\.\w+$/, '');
  const r = await cropUpload(new File([blob], name, { type: blob.type || 'image/png' }), frame, opts);
  if (!r) return null;
  const np = uploadPath(name.replace(/-[a-z0-9]{4,8}$/, ''), r.out.ext);
  await pending.put(np, r.out.blob); registerBlob(np, r.out.blob);
  return np;
}
/** SVG: trim to its drawing (square for icons) and let the user adjust the crop. Returns a viewBox or null. */
async function cropSvg(it, { square = true, title = '' } = {}) {
  const fitted = { ...it, vb: fitViewBox(it, { pad: square ? 0.06 : 0.03, square }) };
  const r = await openCropper({ svg: fitted, frame: square ? 'square' : 'free', title });
  if (!r) return null;
  return r.mode === 'crop' ? r.vb : fitted.vb;
}
/** How many times each icon is used across the content. */
function iconUsage() {
  const n = new Map();
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
      if ((k === 'icon' || k === 'badgeIcon') && typeof v === 'string' && v) n.set(v, (n.get(v) || 0) + 1);
      else if (k !== 'iconLibrary') walk(v);
    }
  };
  walk(state.content);
  return n;
}

/* ------------------------------------------------------------------ form fields */
function buildForm(fields, obj, onChange) {
  const form = h('<div class="a-form"></div>');
  for (const f of fields) {
    const wrap = h(`<div class="a-field ${['textarea', 'list', 'proofs', 'image', 'palette', 'tags', 'orbit', 'svg', 'items'].includes(f.type) ? 'full' : ''} t-${f.type}"></div>`);
    const id = `f-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
    if (f.type !== 'bool') wrap.appendChild(h(`<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`));
    wrap.appendChild(FIELD[f.type]?.(f, obj, onChange, id) || h('<span></span>'));
    if (f.hint) wrap.appendChild(h(`<p class="hint">${esc(f.hint)}</p>`));
    form.appendChild(wrap);
  }
  return form;
}

const FIELD = {
  link(f, o, ch, id) {
    const opts = [['contact', 'Contact page'], ...state.content.pages.map((pg) => [pg.id, `Page: ${pg.label}`]), ['cv', 'Download CV'], ['email', 'Email me'], ['phone', 'Call me']];
    const listId = `${id}-opts`;
    const el = h(`<div><input id="${id}" class="a-input" list="${listId}" placeholder="Page, cv, email, phone or https://…" /><datalist id="${listId}">${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</datalist></div>`);
    const inp = $('input', el);
    inp.value = o[f.key] ?? '';
    inp.addEventListener('input', () => { o[f.key] = inp.value.trim(); ch(); });
    return el;
  },
  text: (f, o, ch, id) => input(f, o, ch, id, 'text'),
  url: (f, o, ch, id) => input(f, o, ch, id, 'url'),
  email: (f, o, ch, id) => input(f, o, ch, id, 'email'),
  number(f, o, ch, id) {
    const el = h(`<input id="${id}" class="a-input" type="number" step="any" value="${esc(o[f.key] ?? '')}" />`);
    el.addEventListener('input', () => { o[f.key] = el.value === '' ? 0 : Number(el.value); ch(); });
    return el;
  },
  textarea(f, o, ch, id) {
    const el = h(`<textarea id="${id}" class="a-input" rows="3"></textarea>`);
    el.value = o[f.key] ?? '';
    const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
    el.addEventListener('input', () => { o[f.key] = el.value; fit(); ch(); });
    requestAnimationFrame(fit);
    return el;
  },
  bool(f, o, ch, id) {
    const el = h(`<label class="switch-row" for="${id}"><span>${esc(f.label)}</span><span class="switch"><input id="${id}" type="checkbox" ${o[f.key] !== false && o[f.key] != null ? 'checked' : ''} /><i></i></span></label>`);
    if (o[f.key] == null) o[f.key] = false, $('input', el).checked = false;
    $('input', el).addEventListener('change', (e) => { o[f.key] = e.target.checked; ch(); });
    return el;
  },
  select(f, o, ch, id) {
    const opts = f.options.map((x) => (Array.isArray(x) ? x : [x, x]));
    const el = h(`<div class="select-wrap"><select id="${id}" class="a-input">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(o[f.key]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${icon('chevron-down')}</div>`);
    $('select', el).addEventListener('change', (e) => { o[f.key] = e.target.value; ch(); });
    return el;
  },
  color(f, o, ch, id) {
    const v = o[f.key] || '#22d3ee';
    const el = h(`<div class="color-row"><input type="color" value="${esc(v)}" aria-label="${esc(f.label)}" /><input id="${id}" class="a-input mono" value="${esc(v)}" maxlength="7" /></div>`);
    const [pick, text] = $$('input', el);
    pick.addEventListener('input', () => { text.value = pick.value; o[f.key] = pick.value; ch(); });
    text.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(text.value)) { pick.value = text.value; o[f.key] = text.value; ch(); } });
    return el;
  },
  colormatch(f, o, ch) {
    return colorMatcher(o, { onApply: (sc) => { ch(); toast(`${sc.name} colours applied`, 'ok'); setTimeout(() => go(state.section), 350); } });
  },
  palette(f, o, ch) {
    const el = h(`<div class="palettes">${PALETTES.map((p, i) => `<button type="button" class="palette" data-i="${i}" title="${esc(p.name)}">
      <span style="background:linear-gradient(120deg,${p.a.join(',')})"></span>${esc(p.name)}</button>`).join('')}</div>`);
    $$('.palette', el).forEach((b) => b.addEventListener('click', () => {
      const p = PALETTES[+b.dataset.i];
      [o.accent1, o.accent2, o.accent3] = p.a;
      ch(); go(state.section); toast(`Applied ${p.name} palette`, 'ok');
    }));
    return el;
  },
  icon(f, o, ch, id) {
    const label = (v) => { const it = libItem(v); return it ? it.name : isImageIcon(v) ? 'Custom image' : v || 'Choose icon'; };
    const el = h(`<button id="${id}" type="button" class="icon-pick">${icon(o[f.key] || 'circuit')}<span>${esc(label(o[f.key]))}</span>${icon('chevron-down')}</button>`);
    el.addEventListener('click', async () => {
      const name = await iconPicker(o[f.key]);
      if (!name) return;
      o[f.key] = name;
      el.innerHTML = `${icon(name)}<span>${esc(label(name))}</span>${icon('chevron-down')}`;
      ch();
    });
    return el;
  },
  range(f, o, ch, id) {
    const v = o[f.key] ?? f.default ?? f.min ?? 0;
    const el = h(`<div class="range-row"><input id="${id}" type="range" min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 1}" value="${esc(v)}" /><output>${esc(v)}${esc(f.unit || '')}</output></div>`);
    const r = $('input', el), out = $('output', el);
    r.addEventListener('input', () => { o[f.key] = Number(r.value); out.textContent = r.value + (f.unit || ''); ch(); });
    return el;
  },
  /* Drag a floating icon around a mini photo to place it */
  orbit(f, o, ch) {
    const el = h(`<div class="orbit-pick">
      <div class="op-stage" title="Drag the icon to place it"><span class="op-ring"></span><span class="op-disc">${icon('user')}</span><span class="op-dot">${icon(o.icon || 'circuit')}</span></div>
      <div class="op-side"><p class="op-val"></p><p class="hint">Drag the icon around the photo. Further out = further from the photo.</p>
        <button type="button" class="btn btn-neu sm" data-auto>${icon('refresh')} Automatic position</button></div></div>`);
    const stage = $('.op-stage', el), dot = $('.op-dot', el), val = $('.op-val', el);
    const paint = () => {
      const custom = o.position === 'custom';
      const ang = custom ? Number(o.angle) || 0 : 0, dist = clamp(Number(o.distance) || 56, 20, 80);
      const rad = (ang * Math.PI) / 180;
      dot.style.left = `${20 + 0.6 * (50 + dist * Math.sin(rad))}%`;
      dot.style.top = `${20 + 0.6 * (50 - dist * Math.cos(rad))}%`;
      dot.classList.toggle('auto', !custom);
      val.innerHTML = custom ? `<b>${Math.round(ang)}°</b> around · <b>${Math.round(dist)}</b> from centre` : '<b>Automatic</b> (spread evenly with the others)';
    };
    const move = (e) => {
      const r = stage.getBoundingClientRect();
      const ux = ((e.clientX - r.left) / r.width - 0.5) / 0.6 * 100, uy = ((e.clientY - r.top) / r.height - 0.5) / 0.6 * 100;
      o.position = 'custom';
      o.distance = Math.round(clamp(Math.hypot(ux, uy), 20, 80));
      o.angle = Math.round(((Math.atan2(ux, -uy) * 180) / Math.PI + 360) % 360);
      paint(); ch();
    };
    stage.addEventListener('pointerdown', (e) => { e.preventDefault(); stage.setPointerCapture(e.pointerId); move(e); stage.addEventListener('pointermove', move); });
    stage.addEventListener('pointerup', () => stage.removeEventListener('pointermove', move));
    stage.addEventListener('pointercancel', () => stage.removeEventListener('pointermove', move));
    $('[data-auto]', el).addEventListener('click', () => { o.position = 'auto'; delete o.angle; paint(); ch(); });
    paint();
    return el;
  },
  /* SVG artwork (e.g. a signature), stored as safe shapes and painted in the accent colour */
  svg(f, o, ch, id) {
    const el = h('<div class="svg-field"></div>');
    const render = () => {
      const v = o[f.key];
      el.innerHTML = `<div class="svg-preview ${v ? '' : 'empty'}">${v ? inlineSvg(v, 'svg-art') : `${icon('pen')}<small>No signature yet</small>`}</div>
        <div class="img-actions">
          <label class="btn btn-neu sm">${icon('upload')} ${v ? 'Replace' : 'Upload'} SVG<input id="${id}" type="file" accept=".svg,image/svg+xml" hidden /></label>
          <button type="button" class="btn btn-neu sm" data-act="paste">${icon('code')} Paste SVG code</button>
          ${v ? `<button type="button" class="btn btn-neu sm" data-act="svgcrop">${icon('crop')} Crop / zoom</button>` : ''}
          ${v ? `<button type="button" class="btn btn-neu sm danger" data-act="clear">${icon('trash')} Remove</button>` : ''}
          ${v ? `<label class="switch-row mini-switch"><span>Paint in the accent colour</span><span class="switch"><input type="checkbox" data-act="mono" ${v.mono !== false ? 'checked' : ''} /><i></i></span></label>` : ''}
          <p class="hint">${esc(f.hint || 'An SVG file works best (export your signature from any drawing app). It follows your accent colour automatically.')}</p>
        </div>`;
      const take = async (text) => {
        try {
          const r = parseSvgIcon(text);
          const it = { vb: r.vb, els: r.els, mono: true };
          const vb = await cropSvg(it, { square: false, title: 'Trimmed to your signature. Adjust if you like.' });
          if (!vb) return;
          o[f.key] = { ...it, vb };
          ch(); render();
          toast(r.warnings.length ? `Added. Note: ${r.warnings.join('; ')}` : 'SVG added', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
      $('input[type=file]', el).addEventListener('change', async (e) => { const file = e.target.files[0]; if (file) take(await file.text()); });
      $('[data-act=paste]', el).addEventListener('click', async () => { const code = await askSvgCode(false); if (code) take(code.code); });
      $('[data-act=clear]', el)?.addEventListener('click', () => { o[f.key] = null; ch(); render(); });
      $('[data-act=svgcrop]', el)?.addEventListener('click', async () => {
        const r = await openCropper({ svg: o[f.key], frame: 'free', title: f.label });
        if (r?.mode === 'crop') { o[f.key].vb = r.vb; ch(); render(); }
      });
      $('[data-act=mono]', el)?.addEventListener('change', (e) => { o[f.key].mono = e.target.checked; ch(); render(); });
    };
    render();
    return el;
  },
  /* A small list of sub-items (e.g. footer lines) edited inline */
  items(f, o, ch) {
    if (!Array.isArray(o[f.key])) o[f.key] = [];
    return itemsAccordion(o[f.key], f.fields, f.blank || {}, ch, f.addLabel);
  },
  list(f, o, ch) {
    if (!Array.isArray(o[f.key])) o[f.key] = [];
    const arr = o[f.key];
    const el = h('<div class="list-edit"></div>');
    const render = () => {
      el.innerHTML = arr.map((v, i) => `<div class="list-row">
        ${f.multiline ? `<textarea class="a-input" rows="2" data-i="${i}">${esc(v)}</textarea>` : `<input class="a-input" data-i="${i}" value="${esc(v)}" />`}
        <div class="row-actions">
          <button type="button" class="mini" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" class="mini danger" data-act="del" data-i="${i}" aria-label="Remove">${icon('trash')}</button>
        </div></div>`).join('') + `<button type="button" class="add-row">${icon('plus')} Add line</button>`;
      $$('[data-i].a-input', el).forEach((inp) => {
        const fit = () => { if (inp.tagName === 'TEXTAREA') { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 2 + 'px'; } };
        requestAnimationFrame(fit);
        inp.addEventListener('input', () => { arr[+inp.dataset.i] = inp.value; fit(); ch(); });
      });
      $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i;
        if (b.dataset.act === 'del') arr.splice(i, 1);
        else [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        render(); ch();
      }));
      $('.add-row', el).addEventListener('click', () => { arr.push(''); render(); ch(); $$('.a-input', el).pop()?.focus(); });
    };
    render();
    return el;
  },
  tags(f, o, ch, id) {
    if (!Array.isArray(o[f.key])) o[f.key] = [];
    const arr = o[f.key];
    const el = h(`<div class="tag-input"><input id="${id}" placeholder="Type and press Enter" /></div>`);
    const inp = $('input', el);
    const render = () => {
      $$('.tchip', el).forEach((c) => c.remove());
      arr.forEach((t, i) => {
        const c = h(`<span class="tchip">${esc(t)}<button type="button" aria-label="Remove ${esc(t)}">${icon('x')}</button></span>`);
        $('button', c).addEventListener('click', () => { arr.splice(i, 1); render(); ch(); });
        el.insertBefore(c, inp);
      });
    };
    const add = () => {
      inp.value.split(',').map((x) => x.trim()).filter(Boolean).forEach((v) => { if (!arr.includes(v)) arr.push(v); });
      inp.value = ''; render(); ch();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
      if (e.key === 'Backspace' && !inp.value && arr.length) { arr.pop(); render(); ch(); }
    });
    inp.addEventListener('blur', () => inp.value.trim() && add());
    el.addEventListener('click', (e) => { if (e.target === el) inp.focus(); });
    render();
    return el;
  },
  image(f, o, ch, id) {
    const el = h('<div class="img-field"></div>');
    const render = () => {
      const src = o[f.key];
      el.innerHTML = `
        <div class="img-preview ${f.cutout ? 'checker' : ''}">${src ? `<img src="${esc(asset(src))}" alt="" />` : `<span class="empty">${icon('image')}<small>No image</small></span>`}</div>
        <div class="img-actions">
          <label class="btn btn-neu sm">${icon('upload')} ${src ? 'Replace' : 'Upload'}<input id="${id}" type="file" accept="image/*" hidden /></label>
          ${src ? `<button type="button" class="btn btn-neu sm" data-act="crop">${icon('crop')} Crop / zoom</button>` : ''}
          ${src && f.cutout ? `<button type="button" class="btn btn-neu sm" data-act="bg">${icon('sparkle')} Remove background</button>` : ''}
          ${src ? `<button type="button" class="btn btn-neu sm danger" data-act="clear">${icon('trash')} Remove</button>` : ''}
          <p class="hint">${f.cutout ? 'Tip: a photo without background (transparent PNG) blends into the design.' : 'JPG, PNG or WebP. Resized and compressed automatically.'}</p>
        </div>`;
      $('input[type=file]', el).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';
        const frame = f.frame || (f.cutout ? 'portrait' : 'card');
        const r = await cropUpload(file, frame, { max: f.max || 1600, keepAlpha: !!f.cutout || frame === 'logo' || frame === 'square', title: f.label });
        if (!r) return;
        await withBusy(el, 'Saving image…', async () => {
          const out = r.out;
          const path = uploadPath(file.name, out.ext);
          await pending.put(path, out.blob); registerBlob(path, out.blob);
          o[f.key] = path; ch(); render();
          toast(`Image ready (${fmtBytes(out.blob.size)})`, 'ok');
          if (f.cutout) setTimeout(() => offerColorMatch(path), 400);
        });
      });
      $('[data-act=clear]', el)?.addEventListener('click', () => { o[f.key] = ''; ch(); render(); });
      $('[data-act=crop]', el)?.addEventListener('click', async () => {
        try {
          const frame = f.frame || (f.cutout ? 'portrait' : 'card');
          const np = await recrop(o[f.key], frame, { max: f.max || 1600, keepAlpha: !!f.cutout || frame === 'logo' || frame === 'square', title: f.label });
          if (np) { o[f.key] = np; ch(); render(); toast('Image cropped', 'ok'); }
        } catch (ex) { toast(ex.message, 'err'); }
      });
      $('[data-act=bg]', el)?.addEventListener('click', async () => {
        await withBusy(el, 'Removing background… (first run downloads the AI model)', async (setMsg) => {
          const srcBlob = await (await fetch(asset(o[f.key]))).blob();
          const cut = await removeBackground(srcBlob, (k, p) => setMsg(`Removing background… ${k.includes('fetch') ? 'downloading model ' : ''}${Math.round(p * 100)}%`));
          const out = await processImage(new File([cut], 'cutout.png', { type: 'image/png' }), { maxSize: f.max || 1600, keepAlpha: true });
          const path = uploadPath('photo-cutout', out.ext);
          await pending.put(path, out.blob); registerBlob(path, out.blob);
          o[f.key] = path; ch(); render();
          toast('Background removed', 'ok');
          setTimeout(() => offerColorMatch(path), 400);
        }, 'Background removal needs an internet connection. You can also upload a transparent PNG made with remove.bg.');
      });
    };
    render();
    return el;
  },
  file(f, o, ch, id) {
    const el = h('<div class="file-field"></div>');
    const render = () => {
      const src = o[f.key];
      el.innerHTML = `<span class="file-chip">${icon('file')} ${src ? `<a href="${esc(asset(src))}" target="_blank" rel="noopener">${esc(src.split('/').pop())}</a>` : '<span class="muted">No file</span>'}</span>
        <label class="btn btn-neu sm">${icon('upload')} ${src ? 'Replace' : 'Upload'}<input id="${id}" type="file" accept="${esc(f.accept || '*/*')}" hidden /></label>`;
      $('input', el).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) return toast('File is larger than 15 MB', 'err');
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
        const path = uploadPath(file.name, ext, f.dir || 'assets/files');
        await pending.put(path, file); registerBlob(path, file);
        o[f.key] = path; ch(); render();
        toast(`${file.name} ready (${fmtBytes(file.size)})`, 'ok');
      });
    };
    render();
    return el;
  },
  proofs(f, o, ch) {
    if (!Array.isArray(o[f.key])) o[f.key] = [];
    const arr = o[f.key];
    const el = h('<div class="proofs"></div>');
    const render = () => {
      el.innerHTML = `<div class="proof-grid">${arr.map((p, i) => `
        <figure class="proof-item">
          <div class="proof-img"><img src="${esc(asset(p.src))}" alt="" loading="lazy" /></div>
          <input class="a-input sm" data-cap="${i}" placeholder="Caption (optional)" value="${esc(p.caption || '')}" />
          <div class="proof-actions">
            <button type="button" class="mini" data-act="crop" data-i="${i}" aria-label="Crop or zoom photo" title="Crop / zoom">${icon('crop')}</button>
            <button type="button" class="mini" data-act="left" data-i="${i}" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button>
            <button type="button" class="mini" data-act="right" data-i="${i}" aria-label="Move right" ${i === arr.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
            <button type="button" class="mini danger" data-act="del" data-i="${i}" aria-label="Delete photo">${icon('trash')}</button>
          </div>
        </figure>`).join('')}
        <label class="proof-add" tabindex="0">${icon('camera')}<b>Add photos</b><small>Click or drop images</small><input type="file" accept="image/*" multiple hidden /></label>
      </div>`;
      $$('[data-cap]', el).forEach((inp) => inp.addEventListener('input', () => { arr[+inp.dataset.cap].caption = inp.value; ch(); }));
      $$('[data-act]', el).forEach((b) => b.addEventListener('click', async () => {
        const i = +b.dataset.i, a = b.dataset.act;
        if (a === 'crop') {
          try { const np = await recrop(arr[i].src, f.frame || 'card', { max: 1600, title: arr[i].caption || 'Photo' }); if (np) { arr[i].src = np; render(); ch(); toast('Photo cropped', 'ok'); } }
          catch (ex) { toast(ex.message, 'err'); }
          return;
        }
        if (a === 'del') arr.splice(i, 1);
        else if (a === 'left') [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        else [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        render(); ch();
      }));
      const zone = $('.proof-add', el);
      const addFiles = async (files) => {
        const imgs = [...files].filter((x) => x.type.startsWith('image/'));
        if (!imgs.length) return;
        let added = 0, asIs = false;
        for (let k = 0; k < imgs.length; k++) {
          let out;
          if (asIs) out = await processImage(imgs[k], { maxSize: 1600 });
          else {
            const r = await cropUpload(imgs[k], f.frame || 'card', { max: 1600, title: imgs[k].name, batch: imgs.length > 1 ? { n: k + 1, total: imgs.length } : null });
            if (!r) continue;
            out = r.out; asIs = r.skipRest;
          }
          const path = uploadPath(imgs[k].name, out.ext);
          await pending.put(path, out.blob); registerBlob(path, out.blob);
          arr.push({ src: path, caption: '' }); added++;
        }
        render(); ch();
        if (added) toast(`${added} photo${added > 1 ? 's' : ''} added`, 'ok');
      };
      $('input', zone).addEventListener('change', (e) => addFiles(e.target.files));
      zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('input', zone).click(); } });
      ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
      zone.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
    };
    render();
    return el;
  },
};

function input(f, o, ch, id, type) {
  const el = h(`<input id="${id}" class="a-input" type="${type === 'url' ? 'text' : type}" ${type === 'url' ? 'inputmode="url" spellcheck="false"' : ''} ${f.max ? `maxlength="${f.max}"` : ''} placeholder="${esc(f.placeholder || (type === 'url' ? 'https://…' : ''))}" />`);
  el.value = o[f.key] ?? '';
  el.addEventListener('input', () => { o[f.key] = el.value; ch(); });
  if (type === 'url') {
    // add https:// to links like "www.facebook.com/me" so they open the right site
    el.addEventListener('blur', () => {
      const v = el.value.trim();
      if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v) && /\.[a-z]{2,}/i.test(v.split('/')[0])) { el.value = `https://${v.replace(/^\/+/, '')}`; o[f.key] = el.value; ch(); }
    });
  }
  return el;
}

async function withBusy(el, msg, fn, failHint = '') {
  const ov = h(`<div class="busy"><span class="spinner"></span><span class="busy-msg">${esc(msg)}</span></div>`);
  el.style.position = 'relative';
  el.appendChild(ov);
  try { await fn((m) => { $('.busy-msg', ov).textContent = m; }); }
  catch (e) { console.error(e); toast(`${e.message || 'Something went wrong'}${failHint ? ' · ' + failHint : ''}`, 'err'); }
  finally { ov.remove(); }
}

/* ---------- Icon library: uploaded SVG / image icons stay available until deleted ---------- */
const iconLib = () => (state.content.iconLibrary ||= []);
const libValue = (it) => (it.type === 'img' ? `img:${it.src}` : it.id);
const libItem = (v) => iconLib().find((it) => libValue(it) === v);
function iconUses(it) {
  const json = JSON.stringify({ ...state.content, iconLibrary: [] });
  return json.split(JSON.stringify(libValue(it))).length - 1;
}
async function addIconFiles(files, mono = true) {
  const added = [];
  for (const file of [...files]) {
    try {
      if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
        if (file.size > 300000) throw new Error(`${file.name} is larger than 300 KB`);
        const r = parseSvgIcon(await file.text());
        const it = { id: iconIdFor(file.name, iconLib()), type: 'svg', name: file.name.replace(/\.svg$/i, '').slice(0, 40), vb: r.vb, els: r.els, mono };
        const vb = files.length === 1 ? await cropSvg(it, { title: `${it.name}: trimmed to fill the icon box` }) : fitViewBox(it, { square: true });
        if (!vb) continue;
        it.vb = vb;
        iconLib().push(it); added.push(it);
        if (r.warnings.length) toast(`${file.name}: ${r.warnings.join('; ')}`, '');
      } else if (/^image\/(png|webp|jpeg)$/.test(file.type)) {
        const r = await cropUpload(file, 'square', { max: 256, keepAlpha: true, title: `${file.name}: crop to the icon square`, batch: files.length > 1 ? { n: added.length + 1, total: files.length } : null });
        if (!r) continue;
        const out = r.out;
        const path = uploadPath(`icon-${file.name}`, out.ext);
        await pending.put(path, out.blob); registerBlob(path, out.blob);
        const it = { id: `img-${rid()}`, type: 'img', name: file.name.replace(/\.\w+$/, '').slice(0, 40), src: path };
        iconLib().push(it); added.push(it);
      } else throw new Error(`${file.name}: use SVG, PNG, WebP or JPG`);
    } catch (e) { toast(e.message, 'err'); }
  }
  if (added.length) { setCustomIcons(iconLib()); saveDraft(); toast(`${added.length} icon${added.length > 1 ? 's' : ''} added to your library`, 'ok'); }
  return added;
}
function askSvgCode(withName = true) {
  const p = dialog({
    title: 'Paste SVG code', icon: 'code', wide: true,
    body: `${withName ? '<div class="a-field"><label for="svgName">Name</label><input id="svgName" class="a-input" maxlength="40" placeholder="e.g. My logo" /></div>' : ''}
      <div class="a-field"><label for="svgCode">SVG code</label><textarea id="svgCode" class="a-input mono" rows="8" placeholder="&lt;svg viewBox=&quot;0 0 24 24&quot;&gt;…&lt;/svg&gt;"></textarea></div>
      <p class="hint">${icon('info')} Only shapes are kept. Scripts, links and embedded images are removed automatically.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }],
  });
  return p.then((ok) => (ok ? { code: $('#svgCode')?.value || '', name: ($('#svgName')?.value || '').trim() } : null));
}
async function addIconFromCode(mono = true) {
  const r0 = await askSvgCode(true);
  if (!r0?.code.trim()) return null;
  try {
    const r = parseSvgIcon(r0.code);
    const it = { id: iconIdFor(r0.name || 'icon', iconLib()), type: 'svg', name: r0.name || 'My icon', vb: r.vb, els: r.els, mono };
    const vb = await cropSvg(it, { title: `${it.name}: trimmed to fill the icon box` });
    if (!vb) return null;
    it.vb = vb;
    iconLib().push(it); setCustomIcons(iconLib()); saveDraft();
    toast(r.warnings.length ? `Icon added. Note: ${r.warnings.join('; ')}` : 'Icon added to your library', 'ok');
    return it;
  } catch (e) { toast(e.message, 'err'); return null; }
}
async function deleteIcon(it) {
  const n = iconUses(it);
  if (!(await confirmDlg(`Delete "${it.name}"?`, n ? `It is used in ${n} place${n > 1 ? 's' : ''}. Those will show a default icon instead.` : 'It is not used anywhere on the site.', 'Delete icon', true))) return false;
  const lib = iconLib();
  lib.splice(lib.indexOf(it), 1);
  setCustomIcons(lib); saveDraft();
  toast('Icon deleted', 'ok');
  return true;
}

function iconPicker(current) {
  return new Promise((resolve) => {
    const usage = iconUsage();
    const m = h(`<div class="a-modal" role="dialog" aria-modal="true" aria-label="Choose an icon">
      <div class="a-modal-backdrop"></div>
      <div class="a-modal-panel glass wide">
        <div class="a-modal-head"><span class="a-modal-icon">${icon('grid')}</span><h2>Choose an icon</h2></div>
        <div class="picker-tools">
          <div class="search-wrap">${icon('search')}<input class="a-input" placeholder="Search icons…" /></div>
          <label class="btn btn-primary sm">${icon('upload')} Upload SVG or image<input type="file" accept=".svg,image/svg+xml,image/png,image/webp,image/jpeg" multiple hidden /></label>
          <button type="button" class="btn btn-neu sm" data-paste>${icon('code')} Paste SVG</button>
        </div>
        <div class="picker-switches">
          <label class="switch-row mini-switch"><span>Paint new SVG icons in the theme colour</span><span class="switch"><input type="checkbox" data-mono checked /><i></i></span></label>
          <label class="switch-row mini-switch"><span>Only show icons not used yet</span><span class="switch"><input type="checkbox" data-unused /><i></i></span></label>
        </div>
        <p class="cm-label">Your icons <small class="muted">stay in this list until you delete them</small></p>
        <div class="icon-grid mine"></div>
        <p class="cm-label">Built-in icons</p>
        <div class="icon-grid builtin">${ICON_NAMES.map((n) => { const u = usage.get(n) || 0; return `<button type="button" data-n="${n}" class="${n === current ? 'active' : ''} ${u ? 'used' : ''}" title="${n}${u ? ` · already used ${u}×` : ''}">${icon(n)}<span>${n}</span>${u ? `<em class="ig-used" aria-label="used ${u} times">${u}</em>` : ''}</button>`; }).join('')}</div>
      </div></div>`);
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('show'));
    const done = (v) => { m.classList.remove('show'); setTimeout(() => m.remove(), 250); resolve(v); };
    const mono = () => $('[data-mono]', m).checked;
    const renderMine = () => {
      const lib = iconLib();
      $('.mine', m).innerHTML = lib.length ? lib.map((it, i) => `<div class="ig-item"><button type="button" data-n="${esc(libValue(it))}" class="${libValue(it) === current ? 'active' : ''}" title="${esc(it.name)}">${icon(libValue(it))}<span>${esc(it.name)}</span></button>
        <button type="button" class="ig-del" data-del="${i}" aria-label="Delete ${esc(it.name)}" title="Delete from library">${icon('x')}</button></div>`).join('')
        : `<p class="muted small ig-empty">${icon('info')} Upload an SVG (or PNG) and it will be kept here for every icon choice.</p>`;
      $$('.mine [data-n]', m).forEach((b) => b.addEventListener('click', () => done(b.dataset.n)));
      $$('.mine [data-del]', m).forEach((b) => b.addEventListener('click', async () => { if (await deleteIcon(iconLib()[+b.dataset.del])) renderMine(); }));
    };
    renderMine();
    const search = $('.search-wrap input', m);
    const filter = () => {
      const q = search.value.toLowerCase(), unused = $('[data-unused]', m).checked;
      $$('.icon-grid [data-n]', m).forEach((b) => { (b.closest('.ig-item') || b).hidden = !(b.title || b.dataset.n).toLowerCase().includes(q) || (unused && b.classList.contains('used') && b.dataset.n !== current); });
    };
    search.addEventListener('input', filter);
    $('[data-unused]', m).addEventListener('change', filter);
    $$('.builtin button', m).forEach((b) => b.addEventListener('click', () => done(b.dataset.n)));
    $('input[type=file]', m).addEventListener('change', async (e) => {
      const added = await addIconFiles(e.target.files, mono());
      e.target.value = '';
      if (added.length === 1) done(libValue(added[0])); else renderMine();
    });
    $('[data-paste]', m).addEventListener('click', async () => { const it = await addIconFromCode(mono()); if (it) done(libValue(it)); });
    $('.a-modal-backdrop', m).addEventListener('click', () => done(null));
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.a-modal ~ .a-modal')) done(null); });
    setTimeout(() => search.focus(), 60);
  });
}

/* ------------------------------------------------------------------ colour match */
const matchState = { src: '', base: '' };

/** Lets the user pull colours from a photo and apply an accent scheme to `theme`. */
function colorMatcher(theme, { src = '', onApply = () => {} } = {}) {
  const s = state.content.settings;
  const photos = [['Home photo', s.photo], ['About photo', s.aboutPhoto], ['Contact photo', s.contactPhoto]].filter(([, p]) => p);
  const uniq = photos.filter(([, p], i) => photos.findIndex(([, q]) => q === p) === i);
  matchState.src = src || matchState.src || uniq[0]?.[1] || '';
  const el = h(`<div class="cmatch">
    <div class="cm-photo checker"><img alt="Click to pick a colour" title="Click anywhere on the photo to pick a colour" /><span class="cm-tip">${icon('target')} Click the photo to pick</span></div>
    <div class="cm-side">
      ${uniq.length > 1 ? `<div class="cm-src">${uniq.map(([l, p]) => `<button type="button" class="tchip link-chip ${p === matchState.src ? 'on' : ''}" data-src="${esc(p)}">${icon('image')} ${esc(l)}</button>`).join('')}</div>` : ''}
      <p class="cm-label">Colours found in the photo</p>
      <div class="cm-swatches"><span class="spinner sm"></span></div>
      <div class="cm-tools">
        ${'EyeDropper' in window ? `<button type="button" class="btn btn-neu sm" data-eye>${icon('target')} Pick from screen</button>` : ''}
        <label class="btn btn-neu sm cm-custom">${icon('palette')} Custom colour <input type="color" value="${esc(matchState.base || theme.accent1 || '#22d3ee')}" /></label>
      </div>
      <p class="cm-label">Pick a scheme <small class="muted">based on <span class="cm-base-dot"></span></small></p>
      <div class="cm-schemes"><p class="muted small">Choose a colour above.</p></div>
    </div>
  </div>`);
  const img = $('img', el);
  const showSchemes = (hex) => {
    matchState.base = hex;
    $('.cm-base-dot', el).innerHTML = `<i style="background:${hex}"></i> ${hex}`;
    $$('.cm-sw', el).forEach((b) => b.classList.toggle('on', b.dataset.hex === hex));
    $('.cm-schemes', el).innerHTML = schemesFor(hex).map((sc, i) => `
      <button type="button" class="scheme" data-i="${i}">
        <span class="sc-bar" style="background:linear-gradient(120deg,${sc.a.join(',')})"></span>
        <span class="sc-dots">${sc.a.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
        <b>${esc(sc.name)}</b><small>${esc(sc.desc)}</small>
      </button>`).join('');
    $$('.scheme', el).forEach((b) => b.addEventListener('click', () => {
      const sc = schemesFor(hex)[+b.dataset.i];
      [theme.accent1, theme.accent2, theme.accent3] = sc.a;
      $$('.scheme', el).forEach((x) => x.classList.toggle('on', x === b));
      onApply(sc);
    }));
  };
  const load = async () => {
    if (!matchState.src) { $('.cm-swatches', el).innerHTML = '<p class="muted small">Upload a photo first (Photos & CV).</p>'; return; }
    img.src = asset(matchState.src);
    try {
      const cols = await extractPalette(asset(matchState.src));
      $('.cm-swatches', el).innerHTML = cols.map((c) => `<button type="button" class="cm-sw" data-hex="${c}" style="--c:${c}" title="${c}" aria-label="Use ${c}"></button>`).join('');
      $$('.cm-sw', el).forEach((b) => b.addEventListener('click', () => showSchemes(b.dataset.hex)));
      showSchemes(matchState.base && !uniq.length ? matchState.base : (cols.find((c) => { const [, sat, l] = rgbToHsl(...hexToRgb(c)); return sat > 0.25 && l > 0.2 && l < 0.8; }) || cols[0] || '#22d3ee'));
    } catch (e) { $('.cm-swatches', el).innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  };
  img.addEventListener('click', (e) => {
    const r = img.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const x = Math.floor((e.clientX - r.left) / r.width * img.naturalWidth), y = Math.floor((e.clientY - r.top) / r.height * img.naturalHeight);
    const [R, G, B, A] = ctx.getImageData(x, y, 1, 1).data;
    if (A < 40) return toast('That spot is transparent. Click on the photo itself.', '');
    showSchemes(rgbToHex(R, G, B));
  });
  $$('[data-src]', el).forEach((b) => b.addEventListener('click', () => {
    matchState.src = b.dataset.src; matchState.base = '';
    $$('[data-src]', el).forEach((x) => x.classList.toggle('on', x === b));
    load();
  }));
  $('[data-eye]', el)?.addEventListener('click', async () => {
    try { const r = await new window.EyeDropper().open(); showSchemes(r.sRGBHex); } catch {}
  });
  $('.cm-custom input', el).addEventListener('input', (e) => showSchemes(e.target.value));
  load();
  return el;
}

async function offerColorMatch(path) {
  const p = dialog({
    title: 'Blend the site with your new photo?', icon: 'palette', wide: true,
    body: '<p>Pick a colour from the photo and a scheme. The whole site\'s accents will follow it.</p><div id="cmHost"></div>',
    buttons: [{ label: 'Not now', value: false }, { label: 'Done', value: true, kind: 'primary' }],
  });
  const theme = getPath(state.content, 'settings.theme', true);
  $('#cmHost').appendChild(colorMatcher(theme, { src: path, onApply: (sc) => { saveDraft(); toast(`${sc.name} colours applied. Preview to see the whole site.`, 'ok'); } }));
  await p;
}

/* ------------------------------------------------------------------ page builder */
const HERO_KEY = { about: 'about', experience: 'experience', projects: 'projects', research: 'research', achievements: 'awards', contact: 'contact' };
const rid = () => Math.random().toString(36).slice(2, 8);

function sectionTitle(sec) {
  const meta = SECTION_TYPES[sec.type] || { label: sec.type };
  const hk = sec.type === 'pageHero' ? sec.headingKey : sec.type === 'cta' ? null : meta.heading;
  if (sec.type === 'cta') {
    sec.heading ||= clone(state.content.headings?.homeCta || { eyebrow: '', title: '', highlight: '', lead: '' });
    sec.buttons ||= [{ label: state.content.labels?.getInTouch || 'Get in touch', link: 'contact', icon: 'send' }, { label: state.content.labels?.downloadCv || 'Download CV', link: 'cv', icon: 'download' }];
  }
  const hd = sec.type === 'custom' || sec.heading ? sec.heading : state.content.headings?.[hk];
  const t = [hd?.title, hd?.highlight].filter(Boolean).join(' ');
  return { name: meta.label, sub: t || meta.desc || '', icon: sec.type === 'custom' ? (sec.heading?.icon || LAYOUT_ICON[sec.layout] || 'plus') : meta.icon };
}
const LAYOUT_ICON = { cards: 'box', timeline: 'clock', list: 'menu', text: 'file', gallery: 'image', stats: 'activity' };

function pagesView() {
  const pages = state.content.pages;
  const el = h(`<div class="view">${sectionHeader({ label: 'Pages & sections', icon: 'layers', desc: 'Click a page to rename it, change its title or edit its sections. You can also add, hide, reorder and delete pages.' },
    `<button type="button" class="btn btn-primary" id="addPage">${icon('plus')} Add page</button>`)}
    <div class="item-list" id="pageList"></div></div>`);
  const render = () => {
    $('#pageList', el).innerHTML = pages.map((p, i) => `
      <div class="item-row glass ${p.visible === false ? 'muted-row' : ''}" data-i="${i}">
        <span class="item-icon">${icon(p.icon || 'file')}</span>
        <button type="button" class="item-main" data-act="open" data-i="${i}"><b>${esc(p.label)}</b><small>${p.id === 'home' ? 'index.html' : esc(p.id) + '.html'} · ${(p.sections || []).length} sections${p.custom ? ' · custom page' : ''}</small></button>
        <span class="badges">${p.visible === false ? `<span class="badge">${icon('eye-off')} Hidden</span>` : ''}</span>
        <span class="row-actions">
          <button type="button" class="mini" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" class="mini" data-act="down" data-i="${i}" aria-label="Move down" ${i === pages.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button>
          <button type="button" class="mini" data-act="vis" data-i="${i}" aria-label="${p.visible === false ? 'Show' : 'Hide'} in menu" ${p.id === 'home' ? 'disabled' : ''}>${icon(p.visible === false ? 'eye' : 'eye-off')}</button>
          <button type="button" class="mini" data-act="open" data-i="${i}" aria-label="Rename or edit ${esc(p.label)}" title="Rename / edit">${icon('edit')}</button>
          ${p.custom ? `<button type="button" class="mini danger" data-act="del" data-i="${i}" aria-label="Delete page">${icon('trash')}</button>` : ''}
        </span>
      </div>`).join('');
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', async () => {
      const i = +b.dataset.i, a = b.dataset.act, p = pages[i];
      if (a === 'open') return go(`page:${p.id}`);
      if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; [pages[i], pages[j]] = [pages[j], pages[i]]; }
      if (a === 'vis') p.visible = p.visible === false;
      if (a === 'del') {
        if (!(await confirmDlg(`Delete the "${p.label}" page?`, 'The page and its sections are removed when you publish.', 'Delete page', true))) return;
        pages.splice(i, 1);
        delete state.content.headings[`page_${p.id}`];
      }
      saveDraft(); render();
    }));
  };
  $('#addPage', el).addEventListener('click', addPage);
  render();
  return el;
}

async function addPage() {
  const p = dialog({
    title: 'Add a page', icon: 'file', wide: true,
    body: `<div class="a-field"><label for="npLabel">Page name (shown in the menu)</label><input id="npLabel" class="a-input" placeholder="e.g. Volunteering" maxlength="40" /></div>
      <p class="cm-label">Start from a template</p>
      <div class="type-grid tpl-grid">${PAGE_TEMPLATES.map((t, i) => `<button type="button" class="type-card ${i === 1 ? 'on' : ''}" data-tpl="${t.id}">${icon(t.icon)}<b>${esc(t.label)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>
      <p class="hint">${icon('info')} Everything stays editable: add, remove or reorder sections after creating the page.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Create page', value: true, kind: 'primary' }],
  });
  let tpl = PAGE_TEMPLATES[1].id;
  $$('.tpl-grid [data-tpl]').forEach((b) => b.addEventListener('click', () => {
    tpl = b.dataset.tpl;
    $$('.tpl-grid [data-tpl]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const v = await p;
  const label = ($('#npLabel')?.value || '').trim();
  if (!v || !label) return;
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'page';
  while (RESERVED_PAGE_IDS.includes(id) || state.content.pages.some((pg) => pg.id === id)) id += '-2';
  state.content.headings[`page_${id}`] = { eyebrow: label, title: label, highlight: '', lead: '' };
  const blankHead = (title = '') => ({ eyebrow: '', title, highlight: '', lead: '' });
  const make = (kind) => {
    if (kind === 'cta') return { id: `cta-${rid()}`, type: 'cta', visible: true, heading: { eyebrow: 'Contact', title: 'Want to know more?', highlight: "Let's talk.", lead: '' }, buttons: [{ label: 'Get in touch', link: 'contact', icon: 'send' }, { label: '', link: '' }] };
    const base = { id: `custom-${rid()}`, type: 'custom', visible: true, layout: kind, heading: blankHead(), items: [], text: '', buttons: [] };
    if (kind === 'banner') Object.assign(base, { heading: { eyebrow: label, title: 'A big headline', highlight: 'for this page', lead: '' }, text: 'Describe what this page is about.', buttons: [{ label: 'Contact me', link: 'contact', icon: 'send' }] });
    if (kind === 'split') Object.assign(base, { heading: blankHead('The story'), text: 'Tell the story here.' });
    if (kind === 'faq') Object.assign(base, { heading: blankHead('Questions'), items: [{ title: 'A common question?', text: 'The answer.' }] });
    return base;
  };
  const chosen = PAGE_TEMPLATES.find((t) => t.id === tpl) || PAGE_TEMPLATES[0];
  state.content.pages.push({ id, label, icon: chosen.icon === 'file' ? 'file' : chosen.icon, visible: true, custom: true, sections: [
    { id: `pageHero-${rid()}`, type: 'pageHero', visible: true, headingKey: `page_${id}` },
    ...chosen.sections.map(make),
  ] });
  saveDraft();
  go(`page:${id}`);
  toast(`${chosen.label} page created`, 'ok');
}

function pageDetailView(pageId) {
  const page = state.content.pages.find((p) => p.id === pageId);
  if (!page) return pagesView();
  page.sections ||= [];
  const el = h(`<div class="view">
    <header class="view-head">
      <div><button type="button" class="link back" id="backPages">${icon('chevron-left')} All pages</button>
        <h1>${icon(page.icon || 'file')} ${esc(page.label)}</h1><p class="muted">Sections appear on the page in this order. Drag or use the arrows to reorder.</p></div>
      <div class="view-actions">
        <button type="button" class="btn btn-neu" id="vbPage">${icon('layout')} Visual builder</button>
        <button type="button" class="btn btn-neu" id="pvPage">${icon('eye')} Preview page</button>
        <button type="button" class="btn btn-primary" id="addSec">${icon('plus')} Add section</button>
      </div>
    </header>
    <div class="card glass form-card page-settings"><h2>${icon('edit')} Page name & title</h2></div>
    <div class="item-list" id="secList"></div>
  </div>`);
  let t;
  const autosave = () => { clearTimeout(t); t = setTimeout(saveDraft, 250); };
  $('.page-settings', el).appendChild(buildForm([
    { key: 'label', label: 'Page name (menu, footer and breadcrumb)', type: 'text' },
    { key: 'icon', label: 'Menu icon', type: 'icon' },
    { key: 'tabTitle', label: 'Browser tab title (optional)', type: 'text', placeholder: `${page.label} | ${[state.content.settings.prefix, state.content.settings.name].filter(Boolean).join(' ')}` },
    ...(page.id === 'home' ? [] : [{ key: 'visible', label: 'Show this page in the menu', type: 'bool' }]),
  ], page, autosave));
  // The big title at the top of the page lives in the page-header (or contact) heading
  const heroSec = page.sections.find((x) => x.type === 'pageHero');
  const titleKey = heroSec?.headingKey || (page.sections.some((x) => x.type === 'contactHero') ? 'contact' : null);
  if (titleKey) {
    state.content.headings[titleKey] ||= { eyebrow: page.label, title: page.label, highlight: '', lead: '' };
    const hd = state.content.headings[titleKey];
    const prev = h(`<div class="title-preview"></div>`);
    const paint = () => { prev.innerHTML = `<small>${esc(hd.eyebrow || '')}</small><b>${esc(hd.title || '')} <span class="grad-text">${esc(hd.highlight || '')}</span></b>${hd.lead ? `<p>${esc(hd.lead)}</p>` : ''}`; };
    $('.page-settings', el).appendChild(h(`<h3 class="drawer-sub">${icon('flag')} Big title at the top of the page</h3>`));
    $('.page-settings', el).appendChild(prev);
    $('.page-settings', el).appendChild(buildForm([
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'highlight', label: 'Highlighted words (accent colour)', type: 'text' },
      { key: 'eyebrow', label: 'Small label above', type: 'text' },
      { key: 'lead', label: 'Subtitle', type: 'textarea' },
    ], hd, () => { paint(); autosave(); }));
    paint();
  } else if (page.id === 'home') {
    $('.page-settings', el).appendChild(h(`<p class="hint">${icon('info')} The home page title is your name. Change it in <a href="#identity">Name & profile</a>.</p>`));
  }
  const secs = page.sections;
  const render = () => {
    if (!secs.length) { $('#secList', el).innerHTML = `<div class="empty-state glass">${icon('layers')}<h3>No sections</h3><p class="muted">Add a section to put content on this page.</p></div>`; return; }
    $('#secList', el).innerHTML = secs.map((sec, i) => {
      const st = sectionTitle(sec);
      return `<div class="item-row glass ${sec.visible === false ? 'muted-row' : ''}" draggable="true" data-i="${i}">
        <span class="grip" aria-hidden="true">${icon('grip')}</span>
        <span class="item-icon">${icon(st.icon)}</span>
        <button type="button" class="item-main" data-act="edit" data-i="${i}"><b>${esc(st.name)}${sec.type === 'custom' ? ` <em class="type-tag">${esc((LAYOUTS.find((l) => l[0] === sec.layout) || [, 'Cards'])[1])}</em>` : ''}</b><small>${esc(st.sub)}</small></button>
        <span class="badges">${sec.visible === false ? `<span class="badge">${icon('eye-off')} Hidden</span>` : ''}${sec.type === 'custom' && (sec.items || []).length ? `<span class="badge">${(sec.items || []).length} items</span>` : ''}</span>
        <span class="row-actions">
          <button type="button" class="mini" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" class="mini" data-act="down" data-i="${i}" aria-label="Move down" ${i === secs.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button>
          <button type="button" class="mini" data-act="vis" data-i="${i}" aria-label="${sec.visible === false ? 'Show' : 'Hide'} section">${icon(sec.visible === false ? 'eye' : 'eye-off')}</button>
          <button type="button" class="mini" data-act="edit" data-i="${i}" aria-label="Edit">${icon('edit')}</button>
          <button type="button" class="mini" data-act="dup" data-i="${i}" aria-label="Duplicate">${icon('copy')}</button>
          <button type="button" class="mini danger" data-act="del" data-i="${i}" aria-label="Remove section">${icon('trash')}</button>
        </span>
      </div>`;
    }).join('');
    $$('[data-act]', $('#secList', el)).forEach((b) => b.addEventListener('click', async () => {
      const i = +b.dataset.i, a = b.dataset.act;
      if (a === 'edit') return openSectionEditor(page, i, render);
      if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; [secs[i], secs[j]] = [secs[j], secs[i]]; }
      if (a === 'vis') secs[i].visible = secs[i].visible === false;
      if (a === 'dup') { const c = clone(secs[i]); c.id = `${c.type}-${rid()}`; secs.splice(i + 1, 0, c); }
      if (a === 'del') {
        if (!(await confirmDlg(`Remove "${sectionTitle(secs[i]).name}" from ${page.label}?`, 'Only the section is removed. Its items (e.g. your projects) stay in the editor and can be shown again by re-adding the section.', 'Remove', true))) return;
        secs.splice(i, 1);
      }
      saveDraft(); render();
    }));
    let from = null;
    $$('.item-row', $('#secList', el)).forEach((row) => {
      row.addEventListener('dragstart', (e) => { from = +row.dataset.i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('drop-target');
        const to = +row.dataset.i;
        if (from == null || from === to) return;
        const [m] = secs.splice(from, 1); secs.splice(to, 0, m); from = null; saveDraft(); render();
      });
    });
  };
  $('#backPages', el).addEventListener('click', () => go('pages'));
  $('#pvPage', el).addEventListener('click', () => { saveDraft(); window.open(`${ROOT}index.html?preview=1&page=${encodeURIComponent(page.id)}`, '_blank', 'noopener'); });
  $('#addSec', el).addEventListener('click', () => addSection(page, render));
  $('#vbPage', el).addEventListener('click', () => { state.builderPage = page.id; go('builder'); });
  render();
  return el;
}

async function addSection(page, after, at = null) {
  const types = Object.entries(SECTION_TYPES);
  const m = h(`<div class="a-modal" role="dialog" aria-modal="true" aria-label="Add a section">
    <div class="a-modal-backdrop"></div>
    <div class="a-modal-panel glass wide">
      <div class="a-modal-head"><span class="a-modal-icon">${icon('plus')}</span><h2>Add a section to ${esc(page.label)}</h2></div>
      <p class="cm-label">Your own content</p>
      <div class="type-grid">${LAYOUTS.map(([k, l]) => `<button type="button" class="type-card custom" data-custom="${k}">${icon(LAYOUT_ICON[k])}<b>${esc(l)}</b><small>Custom section</small></button>`).join('')}</div>
      <p class="cm-label">Built-in sections</p>
      <div class="type-grid">${types.filter(([k]) => k !== 'custom').map(([k, t]) => `<button type="button" class="type-card" data-type="${k}">${icon(t.icon)}<b>${esc(t.label)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>
    </div></div>`);
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('show'));
  const close = () => { m.classList.remove('show'); setTimeout(() => m.remove(), 250); };
  $('.a-modal-backdrop', m).addEventListener('click', close);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const add = (sec) => {
    const pos = Number.isInteger(at) ? clamp(at, 0, page.sections.length) : page.sections.length;
    page.sections.splice(pos, 0, sec);
    saveDraft(); close(); after?.();
    setTimeout(() => openSectionEditor(page, pos, after), 280);
  };
  $$('[data-custom]', m).forEach((b) => b.addEventListener('click', () => add({ id: `custom-${rid()}`, type: 'custom', visible: true, layout: b.dataset.custom, heading: { eyebrow: '', title: 'New section', highlight: '', lead: '' }, items: [], text: '' })));
  $$('[data-type]', m).forEach((b) => b.addEventListener('click', () => {
    const type = b.dataset.type;
    const sec = { id: `${type}-${rid()}`, type, visible: true };
    if (type === 'pageHero') {
      sec.headingKey = HERO_KEY[page.id] || `page_${page.id}`;
      state.content.headings[sec.headingKey] ||= { eyebrow: page.label, title: page.label, highlight: '', lead: '' };
    }
    if (type === 'marquee') Object.assign(sec, { mode: 'logos', label: 'Worked with', speed: 'normal', direction: 'left', grayscale: true, showNames: false, items: [] });
    add(sec);
  }));
  setTimeout(() => $('.type-card', m)?.focus(), 60);
}

const ITEM_FIELDS_BY_LAYOUT = {
  cards: ['icon', 'title', 'subtitle', 'date', 'text', 'tags', 'link', 'linkLabel', 'image', 'display', 'proofs'],
  timeline: ['icon', 'title', 'subtitle', 'date', 'text', 'link', 'display', 'proofs'],
  faq: ['title', 'text'],
  quote: ['text', 'title', 'subtitle', 'image'],
  logos: ['image', 'title', 'link'],
  list: ['icon', 'title', 'subtitle', 'date', 'proofs'],
  gallery: ['image', 'title'],
  stats: ['icon', 'title', 'subtitle'],
};

function openSectionEditor(page, index, after) {
  const sec = clone(page.sections[index]);
  const meta = SECTION_TYPES[sec.type] || { label: sec.type };
  const hk = sec.type === 'pageHero' ? sec.headingKey : meta.heading;
  const headCopy = hk ? clone(state.content.headings[hk] || { eyebrow: '', title: '', highlight: '', lead: '' }) : null;
  if (sec.type === 'custom') sec.heading ||= { eyebrow: '', title: '', highlight: '', lead: '' };
  if (sec.type === 'hero' && !Array.isArray(sec.buttons)) sec.buttons = [{ label: state.content.labels?.letsTalk || 'Contact me', link: 'contact', icon: 'send' }];
  if (sec.type === 'contactHero' && sec.showCv == null) sec.showCv = true;
  if (sec.type === 'marquee') { sec.mode ||= 'awards'; sec.speed ||= 'normal'; sec.direction ||= 'left'; sec.items ||= []; }
  if (sec.type === 'pageHero') sec.badge ||= 'default';
  let start = '';
  const dr = h(`<div class="drawer" role="dialog" aria-modal="true" aria-label="Edit section">
    <div class="drawer-backdrop"></div>
    <aside class="drawer-panel glass">
      <header class="drawer-head"><span class="item-icon">${icon(sectionTitle(sec).icon)}</span><div><small>${esc(page.label)} · section</small><h2>${esc(meta.label)}</h2></div>
        <button type="button" class="icon-btn neu" data-close aria-label="Close">${icon('x')}</button></header>
      <div class="drawer-body"></div>
      <footer class="drawer-foot"><span></span><div><button type="button" class="btn btn-neu" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>${icon('tick')} Save section</button></div></footer>
    </aside></div>`);
  const body = $('.drawer-body', dr);
  const renderBody = () => {
    body.innerHTML = '';
    body.appendChild(buildForm([{ key: 'visible', label: 'Show this section on the site', type: 'bool' }], sec, () => {}));
    const headObj = sec.type === 'custom' || sec.type === 'cta' ? sec.heading : headCopy;
    if (headObj) {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('edit')} Heading</h3>`));
      body.appendChild(buildForm([
        { key: 'eyebrow', label: 'Small label above', type: 'text' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'highlight', label: 'Gradient highlight', type: 'text' },
        { key: 'lead', label: 'Subtitle', type: 'textarea' },
        { key: 'logo', label: 'Section logo / icon image (optional)', type: 'image', cutout: false, max: 400, frame: 'square' },
      ], headObj, () => {}));
    }
    const buttonsEditor = (title = 'Buttons') => {
      if (!Array.isArray(sec.buttons)) sec.buttons = [];
      if (!sec.buttons.length && sec.button?.label) sec.buttons.push({ label: sec.button.label, link: sec.button.url });
      body.appendChild(h(`<h3 class="drawer-sub">${icon('link')} ${esc(title)} <small class="muted">up to 4 · empty text hides a button</small></h3>`));
      const box = h('<div class="btns-edit"></div>');
      body.appendChild(box);
      const draw = () => {
        box.innerHTML = '';
        sec.buttons.forEach((b, i) => {
          const card = h(`<div class="btn-edit"><div class="btn-edit-head"><b>Button ${i + 1}</b><span class="row-actions">
            <button type="button" class="mini" data-a="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="mini danger" data-a="del" aria-label="Remove button">${icon('trash')}</button></span></div></div>`);
          card.appendChild(buildForm([{ key: 'label', label: 'Text', type: 'text' }, { key: 'link', label: 'Opens', type: 'link' }, { key: 'icon', label: 'Icon', type: 'icon' },
            { key: 'style', label: 'Look', type: 'select', options: [['', 'Automatic (first = filled)'], ['primary', 'Filled (accent)'], ['neu', 'Outline']] }], b, () => {}));
          $('[data-a=up]', card).addEventListener('click', () => { [sec.buttons[i - 1], sec.buttons[i]] = [sec.buttons[i], sec.buttons[i - 1]]; draw(); });
          $('[data-a=del]', card).addEventListener('click', () => { sec.buttons.splice(i, 1); draw(); });
          box.appendChild(card);
        });
        if (sec.buttons.length < 4) {
          const add = h(`<button type="button" class="add-row">${icon('plus')} Add button</button>`);
          add.addEventListener('click', () => { sec.buttons.push({ label: '', link: '', icon: '' }); draw(); $$('.btn-edit input', box).slice(-4)[0]?.focus(); });
          box.appendChild(add);
        }
      };
      draw();
    };
    if (sec.type === 'cta') buttonsEditor();
    if (sec.type === 'pageHero') {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('star')} Decoration on the right</h3>`));
      const bf = [{ key: 'badge', label: 'Show', type: 'select', options: [['default', 'Site default (Theme & style)'], ['icon', 'Floating icon'], ['number', 'Page number'], ['image', 'Image / logo'], ['text', 'Short text'], ['none', 'Nothing']] }];
      if (sec.badge === 'icon' || (sec.badge === 'default' && (state.content.settings.theme?.pageBadge || 'icon') === 'icon')) bf.push({ key: 'badgeIcon', label: 'Icon (blank = the page\'s menu icon)', type: 'icon' });
      if (sec.badge === 'image') bf.push({ key: 'badgeImage', label: 'Image', type: 'image', max: 600, frame: 'square' });
      if (sec.badge === 'text') bf.push({ key: 'badgeText', label: 'Text (up to 6 characters)', type: 'text', max: 6 });
      const was = sec.badge;
      body.appendChild(buildForm(bf, sec, () => { if (sec.badge !== was) renderBody(); }));
      buttonsEditor('Buttons under the title');
    }
    if (sec.type === 'marquee') {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('activity')} Scrolling strip</h3>`));
      const mf = [{ key: 'mode', label: 'Shows', type: 'select', options: [['logos', 'Logos (partner companies, organisations)'], ['text', 'Text with icons'], ['awards', 'My highlighted awards (automatic)']] },
        { key: 'label', label: 'Small title above (optional)', type: 'text', placeholder: 'e.g. Worked with' },
        { key: 'speed', label: 'Speed', type: 'select', options: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] },
        { key: 'direction', label: 'Direction', type: 'select', options: [['left', 'Right to left'], ['right', 'Left to right']] }];
      if (sec.mode === 'logos') mf.push({ key: 'grayscale', label: 'Grey logos, colour on hover', type: 'bool' }, { key: 'showNames', label: 'Show names next to logos', type: 'bool' });
      const wasMode = sec.mode;
      body.appendChild(buildForm(mf, sec, () => { if (sec.mode !== wasMode) renderBody(); }));
      if (sec.mode === 'awards') body.appendChild(h(`<p class="hint">${icon('info')} Uses awards marked "Highlight" in Achievements → Awards.</p>`));
      else {
        body.appendChild(h(`<h3 class="drawer-sub">${icon('menu')} ${sec.mode === 'logos' ? 'Logos' : 'Items'}</h3>`));
        const fields = sec.mode === 'logos'
          ? [{ key: 'image', label: 'Logo (PNG/SVG/WebP, transparent works best)', type: 'image', max: 600, frame: 'logo' }, { key: 'text', label: 'Company name (also read by screen readers)', type: 'text' }, { key: 'link', label: 'Link (optional)', type: 'link' }]
          : [{ key: 'icon', label: 'Icon', type: 'icon' }, { key: 'text', label: 'Text', type: 'text' }, { key: 'link', label: 'Link (optional)', type: 'link' }];
        body.appendChild(itemsAccordion(sec.items, fields, sec.mode === 'logos' ? { image: '', text: '', link: '' } : { icon: 'trophy', text: '', link: '' }, () => {}, sec.mode === 'logos' ? 'Add logo' : 'Add item'));
      }
    }
    if (sec.type === 'contactHero') body.appendChild(buildForm([{ key: 'showCv', label: 'Show the "Download CV" button here', type: 'bool' }], sec, () => {}));
    if (sec.type === 'hero') buttonsEditor('Hero buttons');
    else if (!['cta', 'custom', 'marquee', 'pageHero'].includes(sec.type)) buttonsEditor(sec.type === 'contactHero' ? 'Extra buttons next to Download CV' : 'Buttons under this section (optional)');
    if (sec.type === 'custom') {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('layers')} Layout & style</h3>`));
      const lay = sec.layout || 'cards';
      const opt = [{ key: 'layout', label: 'Display as', type: 'select', options: LAYOUTS },
        { key: 'style', label: 'Background', type: 'select', options: [['plain', 'Plain'], ['card', 'Card panel'], ['accent', 'Accent tint']] },
        { key: 'align', label: 'Heading alignment', type: 'select', options: [['center', 'Centred'], ['left', 'Left']] }];
      if (['cards', 'gallery', 'stats', 'quote', 'logos'].includes(lay)) opt.push({ key: 'columns', label: 'Columns', type: 'select', options: [['auto', 'Automatic'], ['2', '2'], ['3', '3'], ['4', '4']] });
      if (lay === 'split') opt.push({ key: 'imageSide', label: 'Image side', type: 'select', options: [['left', 'Left'], ['right', 'Right']] });
      body.appendChild(buildForm(opt, sec, () => renderBody()));
      if (['text', 'banner', 'split'].includes(lay)) {
        body.appendChild(buildForm([
          { key: 'text', label: 'Text (blank line = new paragraph)', type: 'textarea' },
          { key: 'image', label: lay === 'text' ? 'Image (optional)' : 'Image', type: 'image', max: 1600, frame: lay === 'banner' ? 'gallery' : 'gallery' },
        ], sec, () => {}));
        buttonsEditor();
      } else {
        body.appendChild(h(`<h3 class="drawer-sub">${icon('menu')} Items</h3>`));
        body.appendChild(itemsEditor(sec));
        buttonsEditor();
      }
    }
    if (meta.manage?.length) {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('sliders')} Content</h3>`));
      const links = h(`<div class="manage-links">${meta.manage.map((id) => SECTIONS[id] ? `<button type="button" class="tchip link-chip" data-go="${id}">${icon(SECTIONS[id].icon)} Edit ${esc(SECTIONS[id].label)} ${icon('arrow-right')}</button>` : '').join('')}</div>`);
      $$('[data-go]', links).forEach((b) => b.addEventListener('click', () => { save(); go(b.dataset.go); }));
      body.appendChild(links);
    }
  };
  const save = () => {
    page.sections[index] = sec;
    if (headCopy && hk) state.content.headings[hk] = headCopy;
    saveDraft();
    dr.classList.remove('show'); document.body.classList.remove('drawer-open');
    setTimeout(() => dr.remove(), 300);
    after?.();
  };
  const close = async () => {
    if (JSON.stringify([sec, headCopy]) !== start && !(await confirmDlg('Discard changes?', 'Your edits to this section will be lost.', 'Discard', true))) return;
    dr.classList.remove('show'); document.body.classList.remove('drawer-open');
    setTimeout(() => dr.remove(), 300);
  };
  renderBody();
  start = JSON.stringify([sec, headCopy]);
  document.body.appendChild(dr);
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => dr.classList.add('show'));
  $$('[data-close]', dr).forEach((b) => b.addEventListener('click', close));
  $('.drawer-backdrop', dr).addEventListener('click', close);
  dr.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.a-modal')) close(); });
  $('[data-save]', dr).addEventListener('click', () => { save(); toast('Section saved to draft', 'ok'); });
}

function itemsEditor(sec) {
  sec.items ||= [];
  const keys = ITEM_FIELDS_BY_LAYOUT[sec.layout] || ITEM_FIELDS_BY_LAYOUT.cards;
  const fields = keys.map((k) => ({ ...CUSTOM_ITEM_FIELDS.find((f) => f.key === k) })).map((f) => (f.key === 'link' ? { ...f, type: 'link' } : f));
  if (sec.layout === 'gallery') fields.find((f) => f.key === 'title') && (fields[1] = { key: 'title', label: 'Caption', type: 'text' });
  if (sec.layout === 'stats') { fields[1] = { key: 'title', label: 'Number (e.g. 25+)', type: 'text' }; fields[2] = { key: 'subtitle', label: 'Label', type: 'text' }; }
  if (sec.layout === 'faq') { fields[0] = { key: 'title', label: 'Question', type: 'text' }; fields[1] = { key: 'text', label: 'Answer', type: 'textarea' }; }
  if (sec.layout === 'quote') { fields[0] = { key: 'text', label: 'Quote', type: 'textarea' }; fields[1] = { key: 'title', label: 'Name', type: 'text' }; fields[2] = { key: 'subtitle', label: 'Role / organisation', type: 'text' }; fields[3] = { key: 'image', label: 'Photo (optional)', type: 'image', max: 400, frame: 'square' }; }
  if (sec.layout === 'gallery') { const im = fields.find((x) => x.key === 'image'); if (im) im.frame = 'gallery'; }
  if (sec.layout === 'logos') { fields[0] = { key: 'image', label: 'Logo', type: 'image', max: 600, frame: 'logo' }; fields[1] = { key: 'title', label: 'Name (optional)', type: 'text' }; fields[2] = { key: 'link', label: 'Link (optional)', type: 'link' }; }
  return itemsAccordion(sec.items, fields, { icon: 'circuit', title: '', proofs: [] }, () => {}, 'Add item');
}

function itemsAccordion(items, fields, blank, onChange = () => {}, addLabel = 'Add item') {
  const el = h('<div class="acc"></div>');
  let open = -1;
  const name = (it) => it.title || it.text || it.label || 'Untitled item';
  const render = () => {
    el.innerHTML = '';
    items.forEach((it, i) => {
      const row = h(`<div class="acc-item ${i === open ? 'open' : ''}">
        <div class="acc-head">
          <button type="button" class="acc-toggle" aria-expanded="${i === open}">${it.image ? `<img src="${esc(asset(it.image))}" alt="" />` : icon(it.icon || 'circuit')}<span>${esc(name(it))}</span>${icon('chevron-down')}</button>
          <span class="row-actions">
            <button type="button" class="mini" data-a="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="mini danger" data-a="del" aria-label="Delete item">${icon('trash')}</button>
          </span>
        </div>
        <div class="acc-body"></div>
      </div>`);
      if (i === open) $('.acc-body', row).appendChild(buildForm(fields, it, () => { $('.acc-toggle span', row).textContent = name(it); onChange(); }));
      $('.acc-toggle', row).addEventListener('click', () => { open = open === i ? -1 : i; render(); });
      $('[data-a=up]', row).addEventListener('click', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; open = -1; render(); onChange(); });
      $('[data-a=del]', row).addEventListener('click', async () => {
        if (!(await confirmDlg('Delete this item?', esc(name(it)), 'Delete', true))) return;
        items.splice(i, 1); open = -1; render(); onChange();
      });
      el.appendChild(row);
    });
    const add = h(`<button type="button" class="add-row">${icon('plus')} ${esc(addLabel)}</button>`);
    add.addEventListener('click', () => { items.push(clone(blank)); open = items.length - 1; render(); onChange(); });
    el.appendChild(add);
  };
  render();
  return el;
}

/** Edits a settings object (e.g. the footer) in a side drawer, saving as you type. */
function openObjectDrawer(sid) {
  const s = SECTIONS[sid];
  if (!s) return;
  const obj = getPath(state.content, s.path, true);
  const dr = h(`<div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(s.label)}">
    <div class="drawer-backdrop"></div>
    <aside class="drawer-panel glass">
      <header class="drawer-head"><span class="item-icon">${icon(s.icon)}</span><div><small>Site</small><h2>${esc(s.label)}</h2></div>
        <button type="button" class="icon-btn neu" data-close aria-label="Close">${icon('x')}</button></header>
      <div class="drawer-body"></div>
      <footer class="drawer-foot"><span class="autosave">${icon('tick')} Saved to your draft as you type</span><div><button type="button" class="btn btn-primary" data-close>${icon('tick')} Done</button></div></footer>
    </aside></div>`);
  let t;
  $('.drawer-body', dr).appendChild(buildForm(s.fields, obj, () => { clearTimeout(t); t = setTimeout(saveDraft, 300); }));
  const close = () => { saveDraft(); dr.classList.remove('show'); document.body.classList.remove('drawer-open'); setTimeout(() => dr.remove(), 300); };
  document.body.appendChild(dr);
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => dr.classList.add('show'));
  $$('[data-close]', dr).forEach((b) => b.addEventListener('click', close));
  $('.drawer-backdrop', dr).addEventListener('click', close);
  dr.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.a-modal')) close(); });
}

/* ------------------------------------------------------------------ views */
function objectView(s) {
  const obj = getPath(state.content, s.path, true);
  const el = h(`<div class="view">${sectionHeader(s, `<span class="autosave">${icon('tick')} Changes save to your draft automatically</span>`)}<div class="card glass form-card"></div></div>`);
  let t;
  $('.form-card', el).appendChild(buildForm(s.fields, obj, () => {
    clearTimeout(t); t = setTimeout(saveDraft, 250);
  }));
  return el;
}

function itemTitle(s, it) { return String(it?.[s.titleKey] ?? '').trim() || 'Untitled'; }

function collectionView(s) {
  const arr = getPath(state.content, s.path);
  const full = s.limit && arr.length >= s.limit;
  const el = h(`<div class="view">${sectionHeader(s, s.fixed ? '' : `<button type="button" class="btn btn-primary" id="addItem" ${full ? 'disabled title="Limit reached"' : ''}>${icon('plus')} Add ${esc(s.label.replace(/s$/, '').toLowerCase())}</button>`)}
    <div class="item-list" id="itemList"></div></div>`);
  const listEl = $('#itemList', el);
  const render = () => {
    if (!arr.length) {
      listEl.innerHTML = `<div class="empty-state glass">${icon(s.icon)}<h3>Nothing here yet</h3><p class="muted">Add your first entry to show this section on the site.</p></div>`;
      return;
    }
    listEl.innerHTML = arr.map((it, i) => {
      const proofs = (it.proofs || []).length;
      const sub = s.subKey ? String(it[s.subKey] ?? '') : '';
      return `<div class="item-row glass ${it.visible === false ? 'muted-row' : ''}" draggable="true" data-i="${i}">
        <span class="grip" aria-hidden="true">${icon('grip')}</span>
        <span class="item-icon">${icon(it.icon || s.icon)}</span>
        <button type="button" class="item-main" data-act="edit" data-i="${i}">
          <b>${esc(itemTitle(s, it))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}
        </button>
        <span class="badges">
          ${it.featured ? `<span class="badge" title="Featured">${icon('star')}</span>` : ''}
          ${it.highlight ? `<span class="badge" title="Highlighted">${icon('sparkle')}</span>` : ''}
          ${it.visible === false ? `<span class="badge" title="Hidden">${icon('eye-off')}</span>` : ''}
          ${proofs ? `<span class="badge proof" title="${proofs} proof photo(s)">${icon('camera')} ${proofs}</span>` : ''}
        </span>
        <span class="row-actions">
          <button type="button" class="mini" data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button type="button" class="mini" data-act="down" data-i="${i}" aria-label="Move down" ${i === arr.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button>
          <button type="button" class="mini" data-act="edit" data-i="${i}" aria-label="Edit">${icon('edit')}</button>
          ${s.fixed ? '' : `<button type="button" class="mini" data-act="dup" data-i="${i}" aria-label="Duplicate" ${full ? 'disabled' : ''}>${icon('copy')}</button>
          <button type="button" class="mini danger" data-act="del" data-i="${i}" aria-label="Delete">${icon('trash')}</button>`}
        </span>
      </div>`;
    }).join('');
    $$('[data-act]', listEl).forEach((b) => b.addEventListener('click', async () => {
      const i = +b.dataset.i, a = b.dataset.act;
      if (a === 'edit') return openEditor(s, i, render);
      if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; [arr[i], arr[j]] = [arr[j], arr[i]]; }
      if (a === 'dup') arr.splice(i + 1, 0, clone(arr[i]));
      if (a === 'del') {
        if (!(await confirmDlg(`Delete "${itemTitle(s, arr[i])}"?`, 'It disappears from the site after you publish. You can restore it from History.', 'Delete', true))) return;
        arr.splice(i, 1);
      }
      saveDraft(); render(); updateCounts(); refreshAdd();
    }));
    // drag to reorder
    let from = null;
    $$('.item-row', listEl).forEach((row) => {
      row.addEventListener('dragstart', (e) => { from = +row.dataset.i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('drop-target');
        const to = +row.dataset.i;
        if (from == null || from === to) return;
        const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved);
        from = null; saveDraft(); render();
      });
    });
  };
  const refreshAdd = () => { const b = $('#addItem', el); if (b) b.disabled = !!(s.limit && arr.length >= s.limit); };
  $('#addItem', el)?.addEventListener('click', () => openEditor(s, null, () => { render(); updateCounts(); refreshAdd(); }));
  render();
  return el;
}

function openEditor(s, index, after) {
  const arr = getPath(state.content, s.path);
  const isNew = index == null;
  const obj = isNew ? clone(s.blank || {}) : clone(arr[index]);
  const start = JSON.stringify(obj);
  const dr = h(`<div class="drawer" role="dialog" aria-modal="true" aria-label="${isNew ? 'New' : 'Edit'} ${esc(s.label)}">
    <div class="drawer-backdrop"></div>
    <aside class="drawer-panel glass">
      <header class="drawer-head"><span class="item-icon">${icon(obj.icon || s.icon)}</span><div><small>${esc(s.label)}</small><h2>${isNew ? 'New entry' : esc(itemTitle(s, obj))}</h2></div>
        <button type="button" class="icon-btn neu" data-close aria-label="Close">${icon('x')}</button></header>
      <div class="drawer-body"></div>
      <footer class="drawer-foot">
        ${!isNew && !s.fixed ? `<button type="button" class="btn btn-neu danger" data-del>${icon('trash')} Delete</button>` : '<span></span>'}
        <div><button type="button" class="btn btn-neu" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>${icon('tick')} ${isNew ? 'Add' : 'Save'}</button></div>
      </footer>
    </aside></div>`);
  $('.drawer-body', dr).appendChild(buildForm(s.fields, obj, () => {
    $('.drawer-head h2', dr).textContent = itemTitle(s, obj);
    $('.drawer-head .item-icon', dr).innerHTML = icon(obj.icon || s.icon);
  }));
  document.body.appendChild(dr);
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => dr.classList.add('show'));
  const close = async (force = false) => {
    if (!force && JSON.stringify(obj) !== start && !(await confirmDlg('Discard changes?', 'Your edits to this entry will be lost.', 'Discard', true))) return;
    dr.classList.remove('show'); document.body.classList.remove('drawer-open');
    setTimeout(() => dr.remove(), 300);
  };
  $$('[data-close]', dr).forEach((b) => b.addEventListener('click', () => close()));
  $('.drawer-backdrop', dr).addEventListener('click', () => close());
  dr.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.a-modal')) close(); });
  $('[data-save]', dr).addEventListener('click', () => {
    if (isNew) arr.push(obj); else arr[index] = obj;
    saveDraft(); close(true); after?.();
    toast(isNew ? 'Added to draft. Publish when ready.' : 'Saved to draft', 'ok');
  });
  $('[data-del]', dr)?.addEventListener('click', async () => {
    if (!(await confirmDlg(`Delete "${itemTitle(s, obj)}"?`, 'It disappears from the site after you publish.', 'Delete', true))) return;
    arr.splice(index, 1); saveDraft(); close(true); after?.(); updateCounts();
  });
  setTimeout(() => $('.drawer-body input, .drawer-body textarea, .drawer-body button', dr)?.focus(), 320);
}

function headingsView(s) {
  const heads = state.content.headings;
  const el = h(`<div class="view">${sectionHeader(s, `<span class="autosave">${icon('tick')} Saves to draft automatically</span>`)}<div class="heading-grid"></div></div>`);
  const grid = $('.heading-grid', el);
  let t;
  Object.keys(HEADING_LABELS).forEach((key) => {
    heads[key] ||= { eyebrow: '', title: '', highlight: '', lead: '' };
    const hd = heads[key];
    const card = h(`<div class="card glass heading-card"><div class="hc-top"><b>${esc(HEADING_LABELS[key])}</b></div><div class="hc-preview"></div></div>`);
    const preview = () => { $('.hc-preview', card).innerHTML = `${hd.eyebrow ? `<span class="eyebrow">${esc(hd.eyebrow)}</span>` : ''}<h3>${esc(hd.title)} <span class="grad-text">${esc(hd.highlight)}</span></h3>`; };
    card.appendChild(buildForm([
      { key: 'eyebrow', label: 'Small label', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'highlight', label: 'Gradient highlight', type: 'text' },
      { key: 'lead', label: 'Subtitle', type: 'text' },
      { key: 'logo', label: 'Section logo (optional)', type: 'image', max: 400 },
    ], hd, () => { preview(); clearTimeout(t); t = setTimeout(saveDraft, 250); }));
    preview();
    grid.appendChild(card);
  });
  return el;
}

/** Every repo path referenced anywhere in the content. */
function referencedPaths(obj, out = new Set()) {
  if (typeof obj === 'string') { const v = obj.startsWith('img:') ? obj.slice(4) : obj; if (/^assets\//.test(v)) out.add(v); }
  else if (Array.isArray(obj)) obj.forEach((v) => referencedPaths(v, out));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((v) => referencedPaths(v, out));
  return out;
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(state.content, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio-content-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Visual builder: the real page in an iframe, edited by clicking on it ---------- */
addEventListener('message', async (e) => {
  const fr = document.querySelector('.bv-frame');
  if (!fr || e.source !== fr.contentWindow || e.origin !== location.origin || !state.content) return;
  const d = e.data;
  if (!d || typeof d !== 'object' || d.src !== 'pf-builder' || typeof d.act !== 'string') return;
  const page = state.content.pages.find((p) => p.id === d.page);
  if (!page) return;
  if (d.act === 'page') { state.builderPage = page.id; const sel = $('#bvPage'); if (sel) sel.value = page.id; return; }
  if (d.act === 'footer') return openObjectDrawer('footer');
  const secs = page.sections, i = Number(d.i);
  if (d.act === 'add') return addSection(page, null, Number.isInteger(i) && i >= 0 ? i + 1 : secs.length);
  if (!Number.isInteger(i) || i < 0 || i >= secs.length) return;
  if (d.act === 'edit') return openSectionEditor(page, i, null);
  if (d.act === 'up' && i > 0) [secs[i - 1], secs[i]] = [secs[i], secs[i - 1]];
  else if (d.act === 'down' && i < secs.length - 1) [secs[i + 1], secs[i]] = [secs[i], secs[i + 1]];
  else if (d.act === 'dup') { const c = clone(secs[i]); c.id = `${c.type}-${rid()}`; secs.splice(i + 1, 0, c); }
  else if (d.act === 'vis') secs[i].visible = secs[i].visible === false;
  else if (d.act === 'del') {
    if (!(await confirmDlg(`Remove "${sectionTitle(secs[i]).name}" from ${page.label}?`, 'Only the section is removed. Its items stay in the editor.', 'Remove', true))) return;
    secs.splice(i, 1);
  } else return;
  saveDraft();
});

const VIEWS = {
  /* Site maintenance: Next.js / package updates, security fixes and rebuilds, without touching code.
     Buttons write maintenance/request.json; a GitHub Action test-builds every change and only publishes
     it when the site passes all checks, then writes maintenance/status.json back for this page. */
  maintenance() {
    const ACTIONS_URL = 'https://github.com/anik-creates/portfolio-source/actions/workflows/maintenance.yml';
    const el = h(`<div class="view">${sectionHeader({ label: 'Site maintenance', icon: 'wrench', desc: 'Keep the engine behind your site (Next.js and its packages) up to date. Every update is test-built first and only goes live if the whole site passes its checks, so a bad update can never break the site.' })}
      <div id="maint"><div class="card glass form-card"><span class="spinner"></span> Loading…</div></div></div>`);
    const box = $('#maint', el);
    let pendingAt = null, timer = 0;
    const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
    const load = async () => {
      if (state.mode !== 'github') return null;
      const f = await state.gh.readText('maintenance/status.json');
      return f ? JSON.parse(f.text) : { history: [] };
    };
    const send = async (req, label) => {
      if (state.mode !== 'github') { toast('Sign in with your email and password to run maintenance', 'err'); return; }
      const at = Date.now();
      try {
        await state.gh.commit([{ path: 'maintenance/request.json', text: JSON.stringify({ ...req, at, by: state.email || 'admin' }, null, 2) + '\n' }], `Maintenance request: ${label}`);
      } catch (e) { toast(`Could not start: ${e.message}`, 'err'); return; }
      pendingAt = at;
      toast(`${label}: started. This takes 1 to 5 minutes.`, 'ok');
      render(await load().catch(() => null));
      poll(at, 0);
    };
    const poll = (at, n) => {
      clearTimeout(timer);
      if (n > 40 || !el.isConnected) return;
      timer = setTimeout(async () => {
        const s = await load().catch(() => null);
        if (s?.lastRequestAt === at) {
          pendingAt = null;
          const last = s.history?.[0];
          toast(last?.result === 'failed' ? 'Maintenance finished: nothing was changed (see details)' : 'Maintenance finished', last?.result === 'failed' ? 'err' : 'ok');
          render(s);
        } else poll(at, n + 1);
      }, 10000);
    };
    const render = (s) => {
      if (state.mode !== 'github') {
        box.innerHTML = `<div class="notice glass">${icon('info')}<div><b>Available when you sign in.</b><p class="muted">Sign in with your email and password to check for updates, install them and rebuild the site.</p></div></div>`;
        return;
      }
      const cur = s?.current || {}, av = s?.available || {}, sec = s?.security;
      const issues = sec ? (sec.critical || 0) + (sec.high || 0) + (sec.moderate || 0) : null;
      const hist = (s?.history || []).slice(0, 12);
      box.innerHTML = `
        ${pendingAt ? `<div class="notice glass maint-busy"><span class="spinner"></span><div><b>Working on it…</b><p class="muted">Test-building the site on GitHub. This page updates by itself when it is done (1 to 5 minutes).</p></div></div>` : ''}
        <div class="maint-grid">
          <div class="card glass maint-card"><span class="item-icon">${icon('layers')}</span><small>Next.js</small><b>${esc(cur.next || 'unknown')}</b><span class="muted small">React ${esc(cur.react || '?')}</span></div>
          <div class="card glass maint-card ${av.minor ? 'has-update' : ''}"><span class="item-icon">${icon(av.minor ? 'download' : 'check')}</span><small>Safe update</small><b>${av.minor ? `Next.js ${esc(av.minor.next)}` : 'Up to date'}</b><span class="muted small">${av.minor ? `React ${esc(av.minor.react)}` : `Checked ${esc(when(s?.checkedAt))}`}</span></div>
          <div class="card glass maint-card"><span class="item-icon">${icon('rocket')}</span><small>New major version</small><b>${av.major ? `Next.js ${esc(av.major.next)}` : 'None'}</b><span class="muted small">${av.major ? 'Bigger update, tested before going live' : 'You are on the newest major'}</span></div>
          <div class="card glass maint-card ${issues ? 'has-issue' : ''}"><span class="item-icon">${icon('shield-check')}</span><small>Security</small><b>${issues == null ? 'Not checked yet' : issues ? `${issues} issue${issues > 1 ? 's' : ''}` : 'No known issues'}</b><span class="muted small">Packages scanned with npm audit</span></div>
        </div>
        <div class="card glass form-card maint-actions">
          <h2>${icon('wrench')} Actions</h2>
          <div class="maint-btns">
            <button type="button" class="btn btn-neu" data-m="check">${icon('refresh')} Check for updates</button>
            <button type="button" class="btn btn-primary" data-m="update" ${av.minor ? '' : 'disabled'}>${icon('download')} Install safe update</button>
            <button type="button" class="btn btn-neu" data-m="major" ${av.major ? '' : 'disabled'}>${icon('rocket')} Upgrade to Next.js ${esc(av.major?.next?.split('.')[0] || '')}</button>
            <button type="button" class="btn btn-neu" data-m="security">${icon('shield-check')} Apply security fixes</button>
            <button type="button" class="btn btn-neu" data-m="rebuild">${icon('layers')} Rebuild the site</button>
          </div>
          <label class="switch-row"><span><b>Automatic updates</b><br><small class="muted">Every Monday: install safe updates and security fixes (only releases at least ${esc(s?.minAgeDays || 7)} days old, and only if the site passes its checks).</small></span>
            <span class="switch"><input type="checkbox" id="maintAuto" ${s?.auto !== false ? 'checked' : ''} /><i></i></span></label>
          <p class="hint">${icon('info')} If an update ever fails its checks, nothing changes on your site and the reason shows below. <a href="${ACTIONS_URL}" target="_blank" rel="noopener">Technical log on GitHub</a></p>
        </div>
        <div class="card glass form-card">
          <h2>${icon('clock')} History</h2>
          ${hist.length ? `<ul class="maint-hist">${hist.map((x) => `<li class="${x.result === 'failed' ? 'bad' : 'good'}">
            <span class="mh-ic">${icon(x.result === 'failed' ? 'alert' : 'check')}</span>
            <div><b>${esc({ check: 'Checked for updates', update: x.level === 'major' ? 'Major upgrade' : 'Update', security: 'Security fixes', rebuild: 'Rebuild', auto: 'Automatic weekly maintenance' }[x.action] || x.action)}</b>
              <p>${esc(x.message || '')}</p><small class="muted">${esc(when(x.at))} · ${esc(x.by || '')}</small>
              ${x.log ? `<details><summary>Details</summary><pre>${esc(x.log)}</pre></details>` : ''}</div></li>`).join('')}</ul>`
            : '<p class="muted">No maintenance has run yet. Press "Check for updates" to start.</p>'}
        </div>`;
      $$('[data-m]', box).forEach((b) => b.addEventListener('click', async () => {
        const m = b.dataset.m;
        if (m === 'major' && !(await confirmDlg(`Upgrade to Next.js ${av.major?.next}?`, 'Major versions can change how things work. The upgrade is test-built first and only goes live if the whole site passes its checks.', 'Upgrade', false))) return;
        if (m === 'rebuild' && !(await confirmDlg('Rebuild the site now?', 'The site is rebuilt and republished as it is. Takes about 2 minutes.', 'Rebuild', false))) return;
        const map = { check: [{ action: 'check' }, 'Check for updates'], update: [{ action: 'update', level: 'minor' }, 'Install safe update'], major: [{ action: 'update', level: 'major' }, 'Major upgrade'], security: [{ action: 'security' }, 'Security fixes'], rebuild: [{ action: 'rebuild' }, 'Rebuild'] };
        send(...map[m]);
      }));
      $('#maintAuto', box)?.addEventListener('change', async (e) => {
        try {
          await state.gh.commit([{ path: 'maintenance/config.json', text: JSON.stringify({ auto: e.target.checked }, null, 2) + '\n' }], `Automatic updates ${e.target.checked ? 'on' : 'off'}`);
          toast(`Automatic updates ${e.target.checked ? 'on' : 'off'}`, 'ok');
        } catch (ex) { toast(ex.message, 'err'); e.target.checked = !e.target.checked; }
      });
    };
    load().then(render).catch((e) => { box.innerHTML = `<div class="notice glass">${icon('alert')}<div><b>Could not load the maintenance report.</b><p class="muted">${esc(e.message)}</p></div></div>`; });
    return el;
  },

  builder() {
    const pages = state.content.pages;
    if (!pages.some((p) => p.id === state.builderPage)) state.builderPage = 'home';
    const el = h(`<div class="view builder-view">
      <div class="bv-bar glass">
        <div class="bv-group">
          <div class="select-wrap"><select id="bvPage" class="a-input" aria-label="Page">${pages.map((p) => `<option value="${esc(p.id)}" ${p.id === state.builderPage ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>${icon('chevron-down')}</div>
          <button type="button" class="btn btn-primary sm" id="bvAdd">${icon('plus')} Add section</button>
          <button type="button" class="btn btn-neu sm" id="bvSettings">${icon('sliders')} Page name & title</button>
          <button type="button" class="btn btn-neu sm" id="bvFooter">${icon('pen')} Footer</button>
        </div>
        <div class="bv-devices" role="group" aria-label="Preview size">
          <button type="button" data-w="100%" class="on" title="Desktop" aria-label="Desktop">${icon('monitor')}</button>
          <button type="button" data-w="820px" title="Tablet" aria-label="Tablet">${icon('laptop')}</button>
          <button type="button" data-w="390px" title="Phone" aria-label="Phone">${icon('smartphone')}</button>
        </div>
        <div class="bv-group">
          <button type="button" class="mini" id="bvReload" title="Reload preview" aria-label="Reload preview">${icon('refresh')}</button>
          <button type="button" class="btn btn-neu sm" id="bvOpen">${icon('external')} New tab</button>
        </div>
      </div>
      <p class="bv-tip">${icon('info')} Hover any part of the page to edit, move, duplicate, hide or delete it, or use <b>Add section here</b> to place a new block. Double-click a section to edit it. Nothing goes live until you publish.</p>
      <div class="bv-stage"><div class="bv-frame-wrap"><iframe class="bv-frame" title="Live preview of your site"></iframe></div></div>
    </div>`);
    const frame = $('.bv-frame', el);
    const load = () => {
      saveDraft();
      try { sessionStorage.setItem('seenPreloader', '1'); } catch {}
      frame.src = `${ROOT}index.html?preview=1&builder=1&page=${encodeURIComponent(state.builderPage)}`;
    };
    const page = () => state.content.pages.find((p) => p.id === state.builderPage);
    $('#bvPage', el).addEventListener('change', (e) => { state.builderPage = e.target.value; load(); });
    $('#bvAdd', el).addEventListener('click', () => addSection(page(), null));
    $('#bvSettings', el).addEventListener('click', () => go(`page:${state.builderPage}`));
    $('#bvFooter', el).addEventListener('click', () => openObjectDrawer('footer'));
    $('#bvReload', el).addEventListener('click', load);
    $('#bvOpen', el).addEventListener('click', () => { saveDraft(); window.open(`${ROOT}index.html?preview=1&page=${encodeURIComponent(state.builderPage)}`, '_blank', 'noopener'); });
    $$('.bv-devices button', el).forEach((b) => b.addEventListener('click', () => {
      $$('.bv-devices button', el).forEach((x) => x.classList.toggle('on', x === b));
      $('.bv-frame-wrap', el).style.width = b.dataset.w;
    }));
    load();
    return el;
  },

  icons() {
    const el = h(`<div class="view">${sectionHeader({ label: 'Icon library', icon: 'grid', desc: 'Your own SVG and image icons. They appear in every icon picker until you delete them.' },
      `<button type="button" class="btn btn-neu" id="icPaste">${icon('code')} Paste SVG</button><label class="btn btn-primary">${icon('upload')} Upload SVG or image<input type="file" accept=".svg,image/svg+xml,image/png,image/webp,image/jpeg" multiple hidden /></label>`)}
      <label class="switch-row mini-switch glass"><span>Paint new SVG icons in the theme colour (recommended for line and solid icons; turn off for multi-colour logos)</span><span class="switch"><input type="checkbox" id="icMono" checked /><i></i></span></label>
      <div class="lib-grid" id="libGrid"></div></div>`);
    const render = () => {
      const lib = iconLib();
      $('#libGrid', el).innerHTML = lib.length ? lib.map((it, i) => `<div class="lib-card glass">
          <div class="lib-ic">${icon(libValue(it))}</div>
          <input class="a-input sm" data-name="${i}" value="${esc(it.name)}" maxlength="40" aria-label="Icon name" />
          <small class="muted">${it.type === 'svg' ? 'SVG' : 'Image'} · used ${iconUses(it)}×</small>
          <div class="lib-actions">
            ${it.type === 'svg' ? `<label class="switch-row mini-switch"><span>Theme colour</span><span class="switch"><input type="checkbox" data-mono="${i}" ${it.mono !== false ? 'checked' : ''} /><i></i></span></label>` : '<span></span>'}
            <span class="lib-btns"><button type="button" class="mini" data-crop="${i}" aria-label="Crop ${esc(it.name)}" title="Crop / zoom">${icon('crop')}</button>
            <button type="button" class="mini danger" data-del="${i}" aria-label="Delete ${esc(it.name)}">${icon('trash')}</button></span>
          </div></div>`).join('')
        : `<div class="empty-state glass">${icon('grid')}<h3>No custom icons yet</h3><p class="muted">Upload an SVG file (or PNG) to add it to every icon picker.</p></div>`;
      $$('[data-name]', el).forEach((inp) => inp.addEventListener('input', () => { iconLib()[+inp.dataset.name].name = inp.value; saveDraft(); }));
      $$('[data-mono]', el).forEach((c) => c.addEventListener('change', () => { iconLib()[+c.dataset.mono].mono = c.checked; setCustomIcons(iconLib()); saveDraft(); render(); }));
      $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => { if (await deleteIcon(iconLib()[+b.dataset.del])) render(); }));
      $$('[data-crop]', el).forEach((b) => b.addEventListener('click', async () => {
        const it = iconLib()[+b.dataset.crop];
        try {
          if (it.type === 'svg') { const r = await openCropper({ svg: it, frame: 'square', title: it.name }); if (r?.mode === 'crop') it.vb = r.vb; else return; }
          else { const np = await recrop(it.src, 'square', { max: 256, keepAlpha: true, title: it.name }); if (!np) return; it.src = np; }
          setCustomIcons(iconLib()); saveDraft(); render(); toast('Icon cropped', 'ok');
        } catch (ex) { toast(ex.message, 'err'); }
      }));
    };
    $('input[type=file]', el).addEventListener('change', async (e) => { await addIconFiles(e.target.files, $('#icMono', el).checked); e.target.value = ''; render(); });
    $('#icPaste', el).addEventListener('click', async () => { if (await addIconFromCode($('#icMono', el).checked)) render(); });
    render();
    return el;
  },

  dashboard() {
    const c = state.content;
    const tiles = ['projects', 'publications', 'awards', 'experience', 'certifications', 'skills', 'leadership', 'talks'].map((id) => SECTIONS[id]);
    const allProofs = [...referencedPaths(c)].filter((p) => p.startsWith('assets/uploads/')).length;
    const el = h(`<div class="view">
      <section class="hello glass">
        <div class="hello-text">
          <span class="eyebrow">${icon('sparkle')} ${state.mode === 'github' ? 'Connected to GitHub' : 'Local test mode'}</span>
          <h1>Hi ${esc(c.settings.brand || c.settings.name)}, <span class="grad-text">what's new?</span></h1>
          <p class="muted">Edit any section from the menu. Changes are saved as a draft in this browser. Preview them, then publish to make them live.</p>
          <div class="hello-actions">
            <button type="button" class="btn btn-primary" data-go="projects">${icon('plus')} Add a project</button>
            <button type="button" class="btn btn-neu" data-go="awards">${icon('trophy')} Add an award</button>
            <button type="button" class="btn btn-neu" id="dashPreview">${icon('eye')} Preview draft</button>
          </div>
        </div>
        <div class="hello-photo">${c.settings.photo ? `<img src="${esc(asset(c.settings.photo))}" alt="" />` : ''}</div>
      </section>
      <div class="dash-grid">${tiles.map((s) => `<button type="button" class="dash-tile neu" data-go="${s.id}">${icon(s.icon)}<b>${(getPath(c, s.path) || []).length}</b><span>${esc(s.label)}</span></button>`).join('')}
        <button type="button" class="dash-tile neu" data-go="media">${icon('camera')}<b>${allProofs}</b><span>Uploaded photos</span></button>
      </div>
      <section class="card glass visits-card" id="visitsCard">
        <div class="visits-head"><h2>${icon('bar-chart')} Visitors</h2>
          <div class="visits-actions"><button type="button" class="btn btn-neu sm" id="visitsRefresh">${icon('refresh')} Refresh</button>
          ${state.mode === 'github' ? `<button type="button" class="btn btn-neu sm danger" id="visitsReset">${icon('rotate')} Reset counter</button>` : ''}</div></div>
        <div class="visits-body"><span class="spinner"></span> Loading visit counts…</div>
      </section>
      <section class="card glass status-card">
        <h2>${icon('activity')} Status</h2>
        <ul class="status-list">
          <li>${icon(isDirty() ? 'alert' : 'check')} ${isDirty() ? `${changedSections().length} section(s) changed since the last publish` : 'Everything is published'}</li>
          <li>${icon('globe')} Live site: <a href="${esc(ROOT)}index.html" target="_blank" rel="noopener">open in new tab</a></li>
          ${state.mode === 'github' ? `<li>${icon('github')} Repository: <a href="https://github.com/${esc(state.gh.owner)}/${esc(state.gh.repo)}" target="_blank" rel="noopener">${esc(state.gh.owner)}/${esc(state.gh.repo)}</a></li>` : `<li>${icon('info')} Sign in with your email and password to publish changes.</li>`}
        </ul>
      </section>
    </div>`);
    $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $('#dashPreview', el).addEventListener('click', preview);
    loadVisits(el);
    $('#visitsRefresh', el).addEventListener('click', () => loadVisits(el));
    $('#visitsReset', el)?.addEventListener('click', () => resetVisits(el));
    return el;
  },

  publish() {
    const changed = changedSections();
    const el = h(`<div class="view">${sectionHeader(SECTIONS.publish)}
      <div class="card glass publish-card">
        ${state.mode !== 'github' ? `
          <div class="notice">${icon('info')}<div><b>You're in local test mode.</b><p class="muted">Sign out and sign in with your email and password to publish. You can download your draft as a backup.</p></div></div>
          <button type="button" class="btn btn-neu" id="dl">${icon('download')} Download content.json</button>` : `
          <h2>${icon('upload')} Ready to publish</h2>
          ${changed.length ? `<p class="muted">These sections changed since the last publish:</p>
            <div class="changed">${changed.map((s) => `<button type="button" class="tchip link-chip" data-go="${s.id}">${icon(s.icon)} ${esc(s.label)}</button>`).join('')}</div>` : '<p class="muted">No content changes. You can still republish.</p>'}
          <div class="a-field"><label for="commitMsg">Describe this update</label><input id="commitMsg" class="a-input" value="Update portfolio content" maxlength="120" /></div>
          <div class="publish-actions">
            <button type="button" class="btn btn-neu" id="pv">${icon('eye')} Preview first</button>
            <button type="button" class="btn btn-primary" id="doPublish">${icon('upload')} Publish to live site</button>
          </div>
          <ol class="steps" id="steps" hidden></ol>`}
      </div>
      ${isDirty() ? `<div class="card glass danger-zone"><div><b>Discard unpublished changes</b><p class="muted">Go back to what's currently live.</p></div><button type="button" class="btn btn-neu danger" id="discard">${icon('refresh')} Discard draft</button></div>` : ''}
    </div>`);
    $$('[data-go]', el).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $('#dl', el)?.addEventListener('click', downloadJson);
    $('#pv', el)?.addEventListener('click', preview);
    $('#doPublish', el)?.addEventListener('click', () => publish($('#commitMsg', el).value.trim() || 'Update portfolio content', el));
    $('#discard', el)?.addEventListener('click', async () => {
      if (!(await confirmDlg('Discard all unpublished changes?', 'Your draft will be replaced with the live content.', 'Discard', true))) return;
      state.content = JSON.parse(state.published); normalise(state.content);
      localStorage.removeItem(DRAFT_KEY); try { await pending.clear(); } catch {}
      updateDirty(); updateCounts(); applyAdminTheme(); go('publish'); toast('Draft discarded', 'ok');
    });
    return el;
  },

  history() {
    const el = h(`<div class="view">${sectionHeader({ ...SECTIONS.history, desc: 'Every publish is saved as a version. Load an older version into the editor to restore it.' })}<div class="history-list" id="hist"><div class="card glass"><span class="spinner"></span> Loading history…</div></div></div>`);
    if (state.mode !== 'github') { $('#hist', el).innerHTML = `<div class="notice glass">${icon('info')} Connect GitHub to see version history.</div>`; return el; }
    state.gh.history(CONTENT_PATH).then((commits) => {
      $('#hist', el).innerHTML = commits.map((c) => `
        <div class="item-row glass">
          <span class="item-icon">${icon('clock')}</span>
          <div class="item-main static"><b>${esc(c.commit.message.split('\n')[0])}</b><small>${esc(timeAgo(c.commit.author.date))} · ${esc(c.commit.author.name)} · <code>${c.sha.slice(0, 7)}</code></small></div>
          <span class="row-actions">
            <a class="mini" href="${esc(c.html_url)}" target="_blank" rel="noopener" aria-label="View on GitHub">${icon('external')}</a>
            <button type="button" class="btn btn-neu sm" data-sha="${c.sha}">${icon('refresh')} Load</button>
          </span>
        </div>`).join('') || '<p class="muted">No history yet.</p>';
      $$('[data-sha]', el).forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDlg('Load this version?', 'It replaces your current draft. Nothing changes on the live site until you publish.', 'Load version'))) return;
        const f = await state.gh.readText(CONTENT_PATH, b.dataset.sha);
        state.content = JSON.parse(f.text); normalise(state.content);
        saveDraft(); updateCounts(); toast('Version loaded into your draft. Publish to restore it.', 'ok');
      }));
    }).catch((e) => { $('#hist', el).innerHTML = `<div class="notice glass">${icon('alert')} ${esc(e.message)}</div>`; });
    return el;
  },

  backup() {
    const el = h(`<div class="view">${sectionHeader({ ...SECTIONS.backup, desc: 'Download a copy of all your content, or restore one.' })}
      <div class="grid-2">
        <div class="card glass action-card">${icon('download')}<h3>Export</h3><p class="muted">Saves your current draft as a JSON file.</p><button type="button" class="btn btn-primary" id="exp">${icon('download')} Download backup</button></div>
        <div class="card glass action-card">${icon('upload')}<h3>Import</h3><p class="muted">Loads a backup file into the editor as a draft.</p><label class="btn btn-neu">${icon('upload')} Choose file<input type="file" accept="application/json,.json" id="imp" hidden /></label></div>
      </div></div>`);
    $('#exp', el).addEventListener('click', downloadJson);
    $('#imp', el).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data.settings || !Array.isArray(data.pages)) throw new Error('This does not look like a portfolio backup');
        if (!(await confirmDlg('Import this backup?', 'It replaces your current draft.', 'Import'))) return;
        state.content = data; normalise(state.content); saveDraft(); updateCounts();
        toast('Backup imported into your draft', 'ok');
      } catch (ex) { toast(ex.message, 'err'); }
    });
    return el;
  },

  security() {
    const mins = +localStorage.getItem(AUTOLOCK_KEY) || 30;
    const gh = state.gh;
    const el = h(`<div class="view">${sectionHeader({ ...SECTIONS.security, desc: 'Your sign-in details and how the portal stays secure.' })}
      <div class="card glass form-card">
        <div class="a-form">
          <div class="a-field"><label>Signed in as</label><p>${state.mode === 'github' ? `<b>${esc(state.email || '')}</b><br><span class="muted">Publishing to ${esc(gh.owner)}/${esc(gh.repo)} (${esc(gh.branch)}) via GitHub user ${esc(state.user?.login || '')}</span>` : 'Offline mode'}</p></div>
          <div class="a-field"><label for="al">Auto-lock after inactivity</label>
            <div class="select-wrap"><select id="al" class="a-input">${[5, 15, 30, 60, 120].map((m) => `<option value="${m}" ${m === mins ? 'selected' : ''}>${m} minutes</option>`).join('')}</select>${icon('chevron-down')}</div></div>
        </div>
      </div>
      ${state.mode === 'github' ? `
      <div class="card glass form-card"><h2>${icon('key')} Change email or password</h2>
        <div class="a-form">
          <div class="a-field full"><label for="curPw">Current password</label><input id="curPw" type="password" class="a-input" autocomplete="current-password" /></div>
          <div class="a-field full"><label for="newEmail">Email</label><input id="newEmail" type="email" class="a-input" value="${esc(state.email || '')}" autocomplete="username" /></div>
          <div class="a-field"><label for="np1">New password</label><input id="np1" type="password" class="a-input" autocomplete="new-password" /></div>
          <div class="a-field"><label for="np2">Repeat new password</label><input id="np2" type="password" class="a-input" autocomplete="new-password" /></div>
          <div class="strength full" id="strength2"></div>
        </div><button type="button" class="btn btn-primary" id="chg">${icon('save')} Save sign-in details</button></div>
      <div class="card glass form-card"><h2>${icon('github')} Replace GitHub token</h2>
        <p class="muted">Use this when your token expires. Create a new one with the same settings (Contents: Read and write on this repository only).</p>
        <div class="a-form">
          <div class="a-field full"><label for="newTok">New token</label><input id="newTok" type="password" class="a-input mono" placeholder="github_pat_…" /></div>
          <div class="a-field full"><label for="curPw2">Current password</label><input id="curPw2" type="password" class="a-input" autocomplete="current-password" /></div>
        </div><button type="button" class="btn btn-primary" id="tok">${icon('refresh')} Update token</button></div>` : ''}
      <div class="card glass notice-card">${icon('shield')}<div><b>How your login is protected</b>
        <p class="muted">Your GitHub token is stored in the repository encrypted with your email + password (AES-256-GCM, 600,000 PBKDF2 rounds). It is only decrypted in your browser. To cut off access everywhere, delete the token at github.com/settings/tokens and set a new one here.</p></div></div>
      <div class="card glass danger-zone"><div><b>Sign out</b><p class="muted">Ends the session on this device, including "keep me signed in".</p></div><button type="button" class="btn btn-neu danger" id="signout">${icon('logout')} Sign out</button></div>
    </div>`);
    $('#al', el).addEventListener('change', (e) => { localStorage.setItem(AUTOLOCK_KEY, e.target.value); toast('Auto-lock updated', 'ok'); });
    if ($('#np1', el)) strengthMeter($('#np1', el), $('#strength2', el));
    const reencrypt = async (cfg, email, password, msg) => {
      const v = await createVault(cfg, email, password);
      await new GitHub(cfg).commit([{ path: VAULT_FILE, text: JSON.stringify(v, null, 2) + '\n' }], msg);
      cacheVault(v);
    };
    const checkCurrent = async (pw) => {
      const v = await loadVault();
      if (!v) throw new Error('Login vault not found');
      await openVault(v, state.email, pw);
    };
    $('#chg', el)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const email = $('#newEmail', el).value.trim(), a = $('#np1', el).value, b = $('#np2', el).value, cur = $('#curPw', el).value;
      const pw = a || cur;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email', 'err');
      if (a) { const st = passwordStrength(a); if (!st.ok) return toast(`Password too weak: ${st.hint}`, 'err'); if (a !== b) return toast('New passwords do not match', 'err'); }
      btn.disabled = true; btn.classList.add('loading');
      try {
        await checkCurrent(cur);
        await reencrypt({ token: gh.token, owner: gh.owner, repo: gh.repo, branch: gh.branch }, email, pw, 'Update admin sign-in details');
        state.email = email.toLowerCase();
        await session.clear();
        ['curPw', 'np1', 'np2'].forEach((id) => { $('#' + id, el).value = ''; });
        toast('Sign-in details updated', 'ok');
      } catch (ex) { toast(ex.message, 'err'); } finally { btn.disabled = false; btn.classList.remove('loading'); }
    });
    $('#tok', el)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget, token = $('#newTok', el).value.trim(), cur = $('#curPw2', el).value;
      if (!token) return toast('Paste the new token', 'err');
      btn.disabled = true; btn.classList.add('loading');
      try {
        await checkCurrent(cur);
        const cfg = { token, owner: gh.owner, repo: gh.repo, branch: gh.branch };
        await new GitHub(cfg).verify();
        await reencrypt(cfg, state.email, cur, 'Rotate admin GitHub token');
        state.gh = new GitHub(cfg);
        await session.clear();
        $('#newTok', el).value = $('#curPw2', el).value = '';
        toast('GitHub token updated', 'ok');
      } catch (ex) { toast(ex.status === 401 ? 'GitHub rejected the new token' : ex.message, 'err'); } finally { btn.disabled = false; btn.classList.remove('loading'); }
    });
    $('#signout', el).addEventListener('click', () => lock('Signed out. Your draft is saved on this device.'));
    return el;
  },
  colors() {
    const t = getPath(state.content, 'settings.theme', true);
    const DEF = {
      light: { bg: '#fafafa', surface: '#ffffff', text: '#09090b', muted: '#71717a', accent: '#d9480f' },
      dark: { bg: '#08080a', surface: '#111114', text: '#fafafa', muted: '#8b8b95', accent: '#ff6a1f' },
    };
    t.custom ||= { enabled: false, light: { ...DEF.light }, dark: { ...DEF.dark } };
    t.custom.light ||= { ...DEF.light }; t.custom.dark ||= { ...DEF.dark };
    const FIELDS = [
      { key: 'bg', label: 'Page background', type: 'color' },
      { key: 'surface', label: 'Cards & panels', type: 'color' },
      { key: 'text', label: 'Main text', type: 'color' },
      { key: 'muted', label: 'Secondary text', type: 'color' },
      { key: 'accent', label: 'Text accent (links, numbers)', type: 'color' },
    ];
    const el = h(`<div class="view">${sectionHeader({ label: 'Custom colours', icon: 'palette', desc: 'Pick every colour yourself, separately for light and dark mode. Accent 1 colours the buttons, accent 2 the bars and diagrams, accent 3 the highlighter marks.' },
      `<button type="button" class="btn btn-neu" id="resetCols">${icon('refresh')} Reset to defaults</button>`)}
      <div class="card glass form-card" id="enableCard"></div>
      <div class="grid-2 scheme-grid" id="modeCards"></div>
      <div class="card glass form-card"><h2>${icon('zap')} Accents (both modes)</h2><div id="accentForm"></div></div>
    </div>`);
    let tm;
    const changed = () => { clearTimeout(tm); tm = setTimeout(saveDraft, 200); paint(); };
    $('#enableCard', el).appendChild(buildForm([{ key: 'enabled', label: 'Use my custom colours instead of the built-in palette', type: 'bool' }], t.custom, changed));
    $('#accentForm', el).appendChild(buildForm([
      { key: 'accent1', label: 'Accent 1: buttons', type: 'color' },
      { key: 'accent2', label: 'Accent 2: bars & diagrams', type: 'color' },
      { key: 'accent3', label: 'Accent 3: highlighter', type: 'color' },
    ], t, changed));
    const cards = {};
    for (const mode of ['light', 'dark']) {
      const card = h(`<div class="card glass form-card mode-card"><h2>${icon(mode === 'light' ? 'sun' : 'moon')} ${mode === 'light' ? 'Light' : 'Dark'} mode</h2>
        <div class="scheme-preview"><div class="sp-card"><span class="sp-eyebrow">01 — Preview</span><b>Heading text</b><p>Secondary text looks like this.</p><span class="sp-btn">Button</span> <span class="sp-link">Link</span></div></div>
        <p class="contrast-note"></p></div>`);
      card.appendChild(buildForm(FIELDS, t.custom[mode], changed));
      cards[mode] = card;
      $('#modeCards', el).appendChild(card);
    }
    const paint = () => {
      for (const mode of ['light', 'dark']) {
        const m = t.custom[mode], card = cards[mode];
        const pv = $('.scheme-preview', card);
        pv.style.background = m.bg; pv.style.opacity = t.custom.enabled ? 1 : 0.55;
        const sc = $('.sp-card', card);
        sc.style.background = m.surface; sc.style.color = m.text; sc.style.borderColor = m.text + '22';
        $('p', sc).style.color = m.muted; $('.sp-eyebrow', sc).style.color = m.accent;
        $('.sp-link', sc).style.color = m.accent;
        const b = $('.sp-btn', sc); b.style.background = t.accent1; b.style.color = lum(t.accent1) > 0.22 ? '#17181b' : '#fff';
        const issues = [];
        if (HEX.test(m.text) && HEX.test(m.bg) && contrast(m.text, m.bg) < 4.5) issues.push(`main text on background is ${contrast(m.text, m.bg).toFixed(1)}:1`);
        if (HEX.test(m.muted) && HEX.test(m.surface) && contrast(m.muted, m.surface) < 3) issues.push(`secondary text on cards is ${contrast(m.muted, m.surface).toFixed(1)}:1`);
        $('.contrast-note', card).innerHTML = issues.length ? `${icon('alert')} Hard to read: ${esc(issues.join('; '))}. Aim for 4.5:1 or more.` : `${icon('check')} Good contrast`;
        $('.contrast-note', card).className = `contrast-note ${issues.length ? 'warn' : 'ok'}`;
      }
    };
    $('#resetCols', el).addEventListener('click', () => {
      t.custom = { enabled: t.custom.enabled, light: { ...DEF.light }, dark: { ...DEF.dark } };
      [t.accent1, t.accent2, t.accent3] = ['#ff6a1f', '#3dd6a3', '#ffd23f'];
      saveDraft(); go('colors'); toast('Colours reset', 'ok');
    });
    paint();
    return el;
  },
  pages() { return pagesView(); },
};

/* ------------------------------------------------------------------ visitor counter */
const COUNTER_API = 'https://abacus.jasoncameron.dev';
const dayKey = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(d).replace(/-/g, '');
async function counterGet(ns, key) {
  try {
    const r = await fetch(`${COUNTER_API}/get/${encodeURIComponent(ns)}/${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (r.status === 404) return 0;
    const j = await r.json();
    return Number(j.value) || 0;
  } catch { return null; }
}
async function loadVisits(el) {
  const box = $('.visits-body', el);
  const pub = JSON.parse(state.published || '{}').settings?.analytics || state.content.settings.analytics || {};
  if (!pub.namespace) { box.innerHTML = `<p class="muted">The counter is not set up yet. Publish once to start counting.</p>`; return; }
  if (pub.enabled === false) { box.innerHTML = `<p class="muted">Counting is switched off (Site → Visitor counter).</p>`; return; }
  box.innerHTML = `<span class="spinner"></span> Loading visit counts…`;
  const tz = state.content.settings.timezone, e = Number(pub.epoch) || 1;
  const days = [...Array(14)].map((_, k) => { const d = new Date(Date.now() - (13 - k) * 864e5); return { d, key: dayKey(d, tz) }; });
  const [total, ...daily] = await Promise.all([counterGet(pub.namespace, `total-e${e}`), ...days.map((x) => counterGet(pub.namespace, `d-e${e}-${x.key}`))]);
  if (total == null) { box.innerHTML = `<p class="muted">${icon('alert')} Couldn't reach the counter service. Try Refresh.</p>`; return; }
  const max = Math.max(1, ...daily.map((v) => v || 0));
  const fmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: tz || undefined });
  const week = daily.slice(-7).reduce((a, b) => a + (b || 0), 0);
  box.innerHTML = `
    <div class="visit-tiles">
      <div class="visit-tile"><small>Lifetime visits</small><b>${total.toLocaleString()}</b></div>
      <div class="visit-tile"><small>Today</small><b>${(daily[13] || 0).toLocaleString()}</b></div>
      <div class="visit-tile"><small>Last 7 days</small><b>${week.toLocaleString()}</b></div>
    </div>
    <div class="visit-chart" role="img" aria-label="Visits per day for the last 14 days">
      ${days.map((x, k) => `<div class="vbar" tabindex="0" data-tip="${esc(fmt(x.d))}: ${daily[k] || 0} visit${daily[k] === 1 ? '' : 's'}"><i style="height:${((daily[k] || 0) / max) * 100}%"></i><span>${k % 2 ? '' : esc(fmt(x.d))}</span></div>`).join('')}
    </div>
    <details class="visit-table"><summary>Show as table</summary><table><thead><tr><th>Day</th><th>Visits</th></tr></thead><tbody>${days.map((x, k) => `<tr><td>${esc(fmt(x.d))}</td><td>${daily[k] || 0}</td></tr>`).join('')}</tbody></table></details>
    <p class="hint">${icon('info')} One visit = one browser session. Your own visits on the live site count too; local previews don't.</p>`;
}
async function resetVisits(el) {
  if (!(await confirmDlg('Reset the visitor counter?', 'Lifetime and daily counts start again from zero. This publishes immediately.', 'Reset', true))) return;
  const btn = $('#visitsReset', el);
  btn.disabled = true; btn.classList.add('loading');
  try {
    const f = await state.gh.readText(CONTENT_PATH);
    const live = JSON.parse(f.text);
    live.settings.analytics = { enabled: true, namespace: live.settings.analytics?.namespace || `anikcreates-pf-${Math.random().toString(16).slice(2, 8)}`, epoch: (Number(live.settings.analytics?.epoch) || 1) + 1 };
    await state.gh.commit([{ path: CONTENT_PATH, text: JSON.stringify(live, null, 2) + '\n' }], 'Reset visitor counter');
    // keep the editor and the "published" baseline in step so the draft doesn't look changed
    const pub = JSON.parse(state.published); pub.settings.analytics = live.settings.analytics; state.published = JSON.stringify(pub);
    state.content.settings.analytics = clone(live.settings.analytics);
    state.remoteSha = (await state.gh.readText(CONTENT_PATH))?.sha || null;
    saveDraft();
    toast('Counter reset. New visits count from now.', 'ok');
    loadVisits(el);
  } catch (ex) { toast(`Reset failed: ${ex.message}`, 'err'); }
  finally { btn.disabled = false; btn.classList.remove('loading'); }
}

/* ------------------------------------------------------------------ preview & publish */
function preview() {
  saveDraft();
  window.open(ROOT + 'index.html?preview=1', '_blank', 'noopener');
}

async function publish(message, viewEl) {
  const steps = $('#steps', viewEl), btn = $('#doPublish', viewEl);
  const log = (label, kind = 'run') => {
    steps.hidden = false;
    $$('li.run', steps).forEach((li) => { li.className = 'done'; li.querySelector('.st').innerHTML = icon('tick'); });
    if (label) steps.insertAdjacentHTML('beforeend', `<li class="${kind}"><span class="st">${kind === 'run' ? '<span class="spinner sm"></span>' : kind === 'err' ? icon('alert') : icon('tick')}</span> ${esc(label)}</li>`);
  };
  btn.disabled = true; btn.classList.add('loading'); steps.innerHTML = '';
  try {
    const gh = state.gh;
    log('Checking for changes made elsewhere');
    const cur = await gh.readText(CONTENT_PATH);
    if (cur && state.remoteSha && cur.sha !== state.remoteSha) {
      const ok = await confirmDlg('Content changed on GitHub', 'Someone (or another device) published after you opened the editor. Publishing now will overwrite those changes.', 'Overwrite', true);
      if (!ok) { log('Cancelled', 'err'); return; }
    }
    const refs = referencedPaths(state.content);
    const pend = await pending.all();
    const uploads = [...pend].filter(([p]) => refs.has(p));
    log('Checking files in the repository');
    let tree = [];
    try { tree = await gh.treePaths(''); } catch {}
    const deletes = tree.filter((p) => p.startsWith('assets/uploads/') && !refs.has(p) && !p.endsWith('.gitkeep'));
    const files = [
      { path: CONTENT_PATH, text: JSON.stringify(state.content, null, 2) + '\n' },
      ...uploads.map(([path, blob]) => ({ path, blob })),
      ...deletes.map((path) => ({ path, delete: true })),
    ];
    // Custom pages need their own HTML file; removed custom pages lose theirs
    const html = new Set(tree.filter((p) => /^[^/]+\.html$/.test(p)));
    let shell = null;
    for (const pg of state.content.pages.filter((x) => x.custom)) {
      if (html.has(`${pg.id}.html`)) continue;
      shell ||= await (await fetch(ROOT + 'about.html', { cache: 'no-store' })).text();
      files.push({ path: `${pg.id}.html`, text: pageShell(shell, pg) });
    }
    const pub = JSON.parse(state.published || '{}');
    for (const old of (pub.pages || []).filter((x) => x.custom)) {
      if (!state.content.pages.some((x) => x.id === old.id) && html.has(`${old.id}.html`)) files.push({ path: `${old.id}.html`, delete: true });
    }
    files.push({ path: 'sitemap.xml', text: sitemapXml() });
    const commit = await gh.commit(files, message, (label) => log(label));
    log(`Published ${uploads.length ? `with ${uploads.length} new file${uploads.length > 1 ? 's' : ''}` : ''}${deletes.length ? `, removed ${deletes.length} unused` : ''}`, 'ok');

    state.published = JSON.stringify(state.content);
    state.remoteSha = (await gh.readText(CONTENT_PATH))?.sha || null;
    localStorage.removeItem(DRAFT_KEY);
    try { await pending.clear(); } catch {}
    updateDirty();

    steps.insertAdjacentHTML('afterend', `<div class="publish-done" id="pubDone">
      <div class="done-badge">${icon('check')}</div>
      <div><b>Changes committed</b><p class="muted">GitHub Pages is rebuilding your site. <span id="liveState"><span class="spinner sm"></span> Waiting for it to go live…</span></p>
      <p><a href="${esc(commit.html_url || `https://github.com/${gh.owner}/${gh.repo}/commit/${commit.sha}`)}" target="_blank" rel="noopener">${icon('github')} View commit</a> · <a href="${ROOT}index.html" target="_blank" rel="noopener">${icon('globe')} Open site</a></p></div></div>`);
    watchLive();
  } catch (e) {
    console.error(e);
    log(`Publish failed: ${e.message}`, 'err');
    toast('Publish failed. Your draft is safe; try again.', 'err');
  } finally { btn.disabled = false; btn.classList.remove('loading'); }
}

function pageShell(tpl, pg) {
  const name = [state.content.settings.prefix, state.content.settings.name].filter(Boolean).join(' ');
  const e = (x) => esc(x);
  return tpl.replace(/data-page="[^"]*"/, `data-page="${pg.id}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${e(pg.label)} | ${e(name)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${e(pg.label)} | ${e(name)}"`)
    .replace(/about\.html/g, `${pg.id}.html`);
}
function sitemapXml() {
  const base = (state.content.settings.seo?.siteUrl || location.origin + '/').replace(/\/?$/, '/');
  const urls = state.content.pages.filter((p) => p.visible !== false).map((p) => `  <url><loc>${base}${p.id === 'home' ? '' : p.id + '.html'}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

async function watchLive() {
  const target = state.published;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const live = await (await fetch(ROOT + CONTENT_PATH + '?v=' + Date.now(), { cache: 'no-store' })).json();
      if (JSON.stringify(live) === target) {
        const el = $('#liveState');
        if (el) el.innerHTML = `${icon('check')} Your site is live with the new changes.`;
        toast('Your site is live', 'ok');
        return;
      }
    } catch {}
  }
  const el = $('#liveState');
  if (el) el.textContent = 'Still building. Check the site again in a minute.';
}

/* ------------------------------------------------------------------ boot */
function bindChrome() {
  $('#menuToggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#sidebarScrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#sidebarNav').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-sec]');
    if (!a) return;
    e.preventDefault(); go(a.dataset.sec);
  });
  addEventListener('hashchange', () => { const id = location.hash.slice(1); if ((id in SECTIONS || id.startsWith('page:')) && id !== state.section && state.content) go(id); });
  $('#publishBtn').addEventListener('click', () => go('publish'));
  $('#previewBtn').addEventListener('click', preview);
  $('#lockBtn').addEventListener('click', () => lock(state.mode === 'github' ? 'Locked. Your draft is saved.' : ''));
  $('#themeBtn').addEventListener('click', () => {
    const r = document.documentElement;
    r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', r.dataset.theme); } catch {}
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.content) { e.preventDefault(); saveDraft(); toast('Draft saved', 'ok'); }
  });
}

// Clickjacking defence: the admin never runs inside someone else's frame
if (window.top !== window.self) {
  document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">The admin portal cannot be embedded in another page.</p>';
  throw new Error('Framed admin blocked');
}
injectSprite();
setIconResolver(asset);
bindChrome();
if (!window.isSecureContext || !crypto.subtle) {
  $('#login').innerHTML = `<div class="login-card glass"><h1>Secure connection required</h1><p class="muted">Open the admin portal over HTTPS (or localhost).</p></div>`;
} else {
  session.resume().then(async (cfg) => {
    if (!cfg) return renderLogin();
    try { await connect(cfg); } catch { await session.clear(); renderLogin('Please sign in again.'); }
  });
}
