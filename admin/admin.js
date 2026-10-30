// Admin portal: edit every part of the portfolio, attach proof photos, and publish to GitHub.
import { injectSprite, icon, ICON_NAMES, setIconResolver, isImageIcon } from '../assets/js/icons.js';
import { DRAFT_KEY, ROOT, pending, registerBlob, registerBlobs, asset, readDraft } from '../assets/js/store.js';
import { GitHub } from './github.js';
import { createVault, openVault, loadVault, cacheVault, passwordStrength, session, VAULT_FILE } from './vault.js';
import { GROUPS, SECTIONS, HEADING_LABELS, PALETTES, SECTION_TYPES, LAYOUTS, CUSTOM_ITEM_FIELDS, RESERVED_PAGE_IDS } from './schema.js';
import { extractPalette, schemesFor, rgbToHex, rgbToHsl, hexToRgb } from './colors.js';
import { processImage, uploadPath, removeBackground } from './imagetools.js';

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
        <button type="button" class="link" id="offlineBtn">${icon('eye')} Edit offline (draft only)</button>
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
  $('#offlineBtn').addEventListener('click', () => startSession('local'));
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
          ${pwField('pass1', 'Password', 'new-password', 'minlength="10"')}
          ${pwField('pass2', 'Repeat password', 'new-password', 'minlength="10"')}
        </div>
        <div class="strength" id="strength"></div>
      </div></div>
      <p class="hint">${icon('lock')} Your GitHub token is encrypted with your email + password (AES-256, 600,000 PBKDF2 rounds) and saved in the repository. Without your password it is unreadable, so choose a strong, unique one.</p>
      <label class="check-row"><input type="checkbox" id="remember" checked /> <span>Keep me signed in on this device for 7 days</span></label>
      <p class="login-err" id="loginErr" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('shield')} <span>${isReset ? 'Save new login' : 'Create login & continue'}</span></button>
      <div class="login-links">
        <button type="button" class="link" id="offlineBtn">${icon('eye')} Explore the editor offline</button>
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
  $('#offlineBtn').addEventListener('click', () => startSession('local'));
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
    : `${icon('eye')}<div><b>Offline mode</b><small>Changes stay in this browser</small></div>`;
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

/* ------------------------------------------------------------------ form fields */
function buildForm(fields, obj, onChange) {
  const form = h('<div class="a-form"></div>');
  for (const f of fields) {
    const wrap = h(`<div class="a-field ${['textarea', 'list', 'proofs', 'image', 'palette', 'tags'].includes(f.type) ? 'full' : ''} t-${f.type}"></div>`);
    const id = `f-${f.key}-${Math.random().toString(36).slice(2, 7)}`;
    if (f.type !== 'bool') wrap.appendChild(h(`<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>`));
    wrap.appendChild(FIELD[f.type]?.(f, obj, onChange, id) || h('<span></span>'));
    if (f.hint) wrap.appendChild(h(`<p class="hint">${esc(f.hint)}</p>`));
    form.appendChild(wrap);
  }
  return form;
}

const FIELD = {
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
    const label = (v) => (isImageIcon(v) ? 'Custom image' : v || 'Choose icon');
    const el = h(`<button id="${id}" type="button" class="icon-pick">${icon(o[f.key] || 'sparkle')}<span>${esc(label(o[f.key]))}</span>${icon('chevron-down')}</button>`);
    el.addEventListener('click', async () => {
      const name = await iconPicker(o[f.key]);
      if (!name) return;
      o[f.key] = name;
      el.innerHTML = `${icon(name)}<span>${esc(label(name))}</span>${icon('chevron-down')}`;
      ch();
    });
    return el;
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
          ${src && f.cutout ? `<button type="button" class="btn btn-neu sm" data-act="bg">${icon('sparkle')} Remove background</button>` : ''}
          ${src ? `<button type="button" class="btn btn-neu sm danger" data-act="clear">${icon('trash')} Remove</button>` : ''}
          <p class="hint">${f.cutout ? 'Tip: a photo without background (transparent PNG) blends into the design.' : 'JPG, PNG or WebP. Resized and compressed automatically.'}</p>
        </div>`;
      $('input[type=file]', el).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        await withBusy(el, 'Optimising image…', async () => {
          const out = await processImage(file, { maxSize: f.max || 1600, keepAlpha: !!f.cutout });
          const path = uploadPath(file.name, out.ext);
          await pending.put(path, out.blob); registerBlob(path, out.blob);
          o[f.key] = path; ch(); render();
          toast(`Image ready (${fmtBytes(out.blob.size)})`, 'ok');
          if (f.cutout) setTimeout(() => offerColorMatch(path), 400);
        });
      });
      $('[data-act=clear]', el)?.addEventListener('click', () => { o[f.key] = ''; ch(); render(); });
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
            <button type="button" class="mini" data-act="left" data-i="${i}" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button>
            <button type="button" class="mini" data-act="right" data-i="${i}" aria-label="Move right" ${i === arr.length - 1 ? 'disabled' : ''}>${icon('chevron-right')}</button>
            <button type="button" class="mini danger" data-act="del" data-i="${i}" aria-label="Delete photo">${icon('trash')}</button>
          </div>
        </figure>`).join('')}
        <label class="proof-add" tabindex="0">${icon('camera')}<b>Add photos</b><small>Click or drop images</small><input type="file" accept="image/*" multiple hidden /></label>
      </div>`;
      $$('[data-cap]', el).forEach((inp) => inp.addEventListener('input', () => { arr[+inp.dataset.cap].caption = inp.value; ch(); }));
      $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => {
        const i = +b.dataset.i, a = b.dataset.act;
        if (a === 'del') arr.splice(i, 1);
        else if (a === 'left') [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        else [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        render(); ch();
      }));
      const zone = $('.proof-add', el);
      const addFiles = async (files) => {
        const imgs = [...files].filter((x) => x.type.startsWith('image/'));
        if (!imgs.length) return;
        await withBusy(el, `Optimising ${imgs.length} photo${imgs.length > 1 ? 's' : ''}…`, async (setMsg) => {
          for (let k = 0; k < imgs.length; k++) {
            setMsg(`Optimising photo ${k + 1} of ${imgs.length}…`);
            const out = await processImage(imgs[k], { maxSize: 1600 });
            const path = uploadPath(imgs[k].name, out.ext);
            await pending.put(path, out.blob); registerBlob(path, out.blob);
            arr.push({ src: path, caption: '' });
          }
          render(); ch();
          toast(`${imgs.length} photo${imgs.length > 1 ? 's' : ''} added`, 'ok');
        });
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
  const el = h(`<input id="${id}" class="a-input" type="${type}" ${f.max ? `maxlength="${f.max}"` : ''} placeholder="${esc(f.placeholder || '')}" />`);
  el.value = o[f.key] ?? '';
  el.addEventListener('input', () => { o[f.key] = el.value; ch(); });
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

function iconPicker(current) {
  return new Promise((resolve) => {
    const m = h(`<div class="a-modal" role="dialog" aria-modal="true" aria-label="Choose an icon">
      <div class="a-modal-backdrop"></div>
      <div class="a-modal-panel glass wide">
        <div class="a-modal-head"><span class="a-modal-icon">${icon('sparkle')}</span><h2>Choose an icon</h2></div>
        <div class="picker-tools">
          <div class="search-wrap">${icon('search')}<input class="a-input" placeholder="Search ${ICON_NAMES.length} icons…" /></div>
          <label class="btn btn-primary sm">${icon('upload')} Upload your own<input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden /></label>
        </div>
        ${isImageIcon(current) ? `<div class="current-img">${icon(current)}<span>Current: your uploaded icon</span></div>` : ''}
        <div class="icon-grid">${ICON_NAMES.map((n) => `<button type="button" data-n="${n}" class="${n === current ? 'active' : ''}" title="${n}">${icon(n)}<span>${n}</span></button>`).join('')}</div>
      </div></div>`);
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('show'));
    const done = (v) => { m.classList.remove('show'); setTimeout(() => m.remove(), 250); resolve(v); };
    const search = $('input', m);
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      $$('.icon-grid button', m).forEach((b) => { b.hidden = !b.dataset.n.includes(q); });
    });
    $$('.icon-grid button', m).forEach((b) => b.addEventListener('click', () => done(b.dataset.n)));
    $('input[type=file]', m).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const out = await processImage(file, { maxSize: 256, keepAlpha: true });
        const path = uploadPath(`icon-${file.name}`, out.ext);
        await pending.put(path, out.blob); registerBlob(path, out.blob);
        done(`img:${path}`);
        toast('Custom icon added', 'ok');
      } catch (ex) { toast(ex.message, 'err'); }
    });
    $('.a-modal-backdrop', m).addEventListener('click', () => done(null));
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
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
  const hk = sec.type === 'pageHero' ? sec.headingKey : meta.heading;
  const hd = sec.type === 'custom' ? sec.heading : state.content.headings?.[hk];
  const t = [hd?.title, hd?.highlight].filter(Boolean).join(' ');
  return { name: meta.label, sub: t || meta.desc || '', icon: sec.type === 'custom' ? (sec.heading?.icon || LAYOUT_ICON[sec.layout] || 'plus') : meta.icon };
}
const LAYOUT_ICON = { cards: 'box', timeline: 'clock', list: 'menu', text: 'file', gallery: 'image', stats: 'activity' };

function pagesView() {
  const pages = state.content.pages;
  const el = h(`<div class="view">${sectionHeader({ label: 'Pages & sections', icon: 'layers', desc: 'Add, remove, hide and reorder pages and every section on them.' },
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
          <button type="button" class="mini" data-act="open" data-i="${i}" aria-label="Edit sections">${icon('edit')}</button>
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
  const v = await dialog({
    title: 'Add a page', icon: 'file',
    body: `<div class="a-field"><label for="npLabel">Page name (shown in the menu)</label><input id="npLabel" class="a-input" placeholder="e.g. Volunteering" maxlength="40" /></div>
      <p class="hint">${icon('info')} You can add sections to it next. New pages go live after you publish.</p>`,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Create page', value: true, kind: 'primary' }],
  });
  const label = ($('#npLabel')?.value || '').trim();
  if (!v || !label) return;
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'page';
  while (RESERVED_PAGE_IDS.includes(id) || state.content.pages.some((p) => p.id === id)) id += '-2';
  state.content.headings[`page_${id}`] = { eyebrow: label, title: label, highlight: '', lead: '' };
  state.content.pages.push({ id, label, icon: 'file', visible: true, custom: true, sections: [
    { id: `pageHero-${rid()}`, type: 'pageHero', visible: true, headingKey: `page_${id}` },
    { id: `custom-${rid()}`, type: 'custom', visible: true, layout: 'cards', heading: { eyebrow: '', title: '', highlight: '', lead: '' }, items: [] },
  ] });
  saveDraft();
  go(`page:${id}`);
  toast('Page created', 'ok');
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
        <button type="button" class="btn btn-neu" id="pvPage">${icon('eye')} Preview page</button>
        <button type="button" class="btn btn-primary" id="addSec">${icon('plus')} Add section</button>
      </div>
    </header>
    <div class="card glass form-card page-settings"></div>
    <div class="item-list" id="secList"></div>
  </div>`);
  let t;
  $('.page-settings', el).appendChild(buildForm([
    { key: 'label', label: 'Menu label', type: 'text' },
    { key: 'icon', label: 'Menu icon', type: 'icon' },
    ...(page.id === 'home' ? [] : [{ key: 'visible', label: 'Show this page in the menu', type: 'bool' }]),
  ], page, () => { clearTimeout(t); t = setTimeout(saveDraft, 250); }));
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
  render();
  return el;
}

async function addSection(page, after) {
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
    page.sections.push(sec);
    saveDraft(); close(); after?.();
    setTimeout(() => openSectionEditor(page, page.sections.length - 1, after), 280);
  };
  $$('[data-custom]', m).forEach((b) => b.addEventListener('click', () => add({ id: `custom-${rid()}`, type: 'custom', visible: true, layout: b.dataset.custom, heading: { eyebrow: '', title: 'New section', highlight: '', lead: '' }, items: [], text: '' })));
  $$('[data-type]', m).forEach((b) => b.addEventListener('click', () => {
    const type = b.dataset.type;
    const sec = { id: `${type}-${rid()}`, type, visible: true };
    if (type === 'pageHero') {
      sec.headingKey = HERO_KEY[page.id] || `page_${page.id}`;
      state.content.headings[sec.headingKey] ||= { eyebrow: page.label, title: page.label, highlight: '', lead: '' };
    }
    add(sec);
  }));
  setTimeout(() => $('.type-card', m)?.focus(), 60);
}

const ITEM_FIELDS_BY_LAYOUT = {
  cards: ['icon', 'title', 'subtitle', 'date', 'text', 'tags', 'link', 'linkLabel', 'image', 'proofs'],
  timeline: ['icon', 'title', 'subtitle', 'date', 'text', 'link', 'proofs'],
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
  const start = JSON.stringify([sec, headCopy]);
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
    const headObj = sec.type === 'custom' ? sec.heading : headCopy;
    if (headObj) {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('edit')} Heading</h3>`));
      body.appendChild(buildForm([
        { key: 'eyebrow', label: 'Small label above', type: 'text' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'highlight', label: 'Gradient highlight', type: 'text' },
        { key: 'lead', label: 'Subtitle', type: 'textarea' },
        { key: 'logo', label: 'Section logo / icon image (optional)', type: 'image', cutout: false, max: 400 },
      ], headObj, () => {}));
    }
    if (sec.type === 'custom') {
      body.appendChild(h(`<h3 class="drawer-sub">${icon('layers')} Layout</h3>`));
      body.appendChild(buildForm([{ key: 'layout', label: 'Display as', type: 'select', options: LAYOUTS }], sec, () => renderBody()));
      if (sec.layout === 'text') {
        sec.button ||= { label: '', url: '' };
        body.appendChild(buildForm([
          { key: 'text', label: 'Text (blank line = new paragraph)', type: 'textarea' },
          { key: 'image', label: 'Image (optional)', type: 'image', max: 1600 },
        ], sec, () => {}));
        body.appendChild(buildForm([{ key: 'label', label: 'Button text (optional)', type: 'text' }, { key: 'url', label: 'Button link', type: 'url' }], sec.button, () => {}));
      } else {
        body.appendChild(h(`<h3 class="drawer-sub">${icon('menu')} Items</h3>`));
        body.appendChild(itemsEditor(sec));
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
  const items = sec.items;
  const keys = ITEM_FIELDS_BY_LAYOUT[sec.layout] || ITEM_FIELDS_BY_LAYOUT.cards;
  const fields = keys.map((k) => CUSTOM_ITEM_FIELDS.find((f) => f.key === k));
  if (sec.layout === 'gallery') fields.find((f) => f.key === 'title') && (fields[1] = { key: 'title', label: 'Caption', type: 'text' });
  if (sec.layout === 'stats') { fields[1] = { key: 'title', label: 'Number (e.g. 25+)', type: 'text' }; fields[2] = { key: 'subtitle', label: 'Label', type: 'text' }; }
  const el = h('<div class="acc"></div>');
  let open = -1;
  const render = () => {
    el.innerHTML = '';
    items.forEach((it, i) => {
      const row = h(`<div class="acc-item ${i === open ? 'open' : ''}">
        <div class="acc-head">
          <button type="button" class="acc-toggle" aria-expanded="${i === open}">${it.image ? `<img src="${esc(asset(it.image))}" alt="" />` : icon(it.icon || 'sparkle')}<span>${esc(it.title || 'Untitled item')}</span>${icon('chevron-down')}</button>
          <span class="row-actions">
            <button type="button" class="mini" data-a="up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="mini danger" data-a="del" aria-label="Delete item">${icon('trash')}</button>
          </span>
        </div>
        <div class="acc-body"></div>
      </div>`);
      if (i === open) $('.acc-body', row).appendChild(buildForm(fields, it, () => { $('.acc-toggle span', row).textContent = it.title || 'Untitled item'; }));
      $('.acc-toggle', row).addEventListener('click', () => { open = open === i ? -1 : i; render(); });
      $('[data-a=up]', row).addEventListener('click', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; open = -1; render(); });
      $('[data-a=del]', row).addEventListener('click', async () => {
        if (!(await confirmDlg('Delete this item?', esc(it.title || 'Untitled item'), 'Delete', true))) return;
        items.splice(i, 1); open = -1; render();
      });
      el.appendChild(row);
    });
    const add = h(`<button type="button" class="add-row">${icon('plus')} Add item</button>`);
    add.addEventListener('click', () => { items.push({ icon: 'sparkle', title: '', proofs: [] }); open = items.length - 1; render(); });
    el.appendChild(add);
  };
  render();
  return el;
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

const VIEWS = {
  dashboard() {
    const c = state.content;
    const tiles = ['projects', 'publications', 'awards', 'experience', 'certifications', 'skills', 'leadership', 'talks'].map((id) => SECTIONS[id]);
    const allProofs = [...referencedPaths(c)].filter((p) => p.startsWith('assets/uploads/')).length;
    const el = h(`<div class="view">
      <section class="hello glass">
        <div class="hello-text">
          <span class="eyebrow">${icon('sparkle')} ${state.mode === 'github' ? 'Connected to GitHub' : 'Offline mode'}</span>
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
    return el;
  },

  publish() {
    const changed = changedSections();
    const el = h(`<div class="view">${sectionHeader(SECTIONS.publish)}
      <div class="card glass publish-card">
        ${state.mode !== 'github' ? `
          <div class="notice">${icon('info')}<div><b>You're in offline mode.</b><p class="muted">Sign out and sign in with your email and password to publish. You can download your draft as a backup.</p></div></div>
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
