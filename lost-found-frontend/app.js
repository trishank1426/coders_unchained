/* ===== Settings ===== */
// true  = use the Node + MySQL backend (see the lost-found-backend folder).
// false = demo mode: sign-in and reports are stored only in this browser.
const USE_BACKEND = true;
// Local development (Live Server or a file opened directly) talks to the API on port 3000.
// When the backend serves the site itself (deployment), the API is on the same address.
const API = (location.protocol === 'file:' || ['5500', '5501'].includes(location.port))
  ? 'http://localhost:3000/api'
  : '/api';

const MAX_PHOTOS = 5;
const MAX_PHOTO_MB = 5;
const PAGE_SIZE = 12;

const $ = (id) => document.getElementById(id);
const state = {
  type: 'found',            // report form: 'found' | 'lost'
  session: JSON.parse(localStorage.getItem('lf_session') || 'null'),
  authMode: 'signin',       // 'signin' | 'signup'
  photos: [],               // report form photos: { file, url }
  // feed
  filter: 'all',            // 'all' | 'lost' | 'found'
  query: '',
  cat: '',
  items: [],
  counts: { lost: 0, found: 0 },
  page: 1,
  hasMore: false,
  loaded: false,
  error: '',
};

// A demo session has no real token. Drop it when switching to the backend.
if (USE_BACKEND && state.session && state.session.token === 'demo') {
  state.session = null;
  localStorage.removeItem('lf_session');
}

/* ===== Toast ===== */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ===== Server requests ===== */
async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (state.session && state.session.token) headers.Authorization = `Bearer ${state.session.token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: payload });
  } catch {
    throw new Error('Cannot reach the server. Is the backend running?');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.session && !path.startsWith('/auth/')) {
      clearSession();
      throw new Error('Your session expired. Please sign in again.');
    }
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

/* ===== Demo-mode storage (this browser only) ===== */
function loadReports() {
  try { return JSON.parse(localStorage.getItem('lf_reports') || '[]'); }
  catch { return []; }
}
function saveReports(list) {
  try {
    localStorage.setItem('lf_reports', JSON.stringify(list));
  } catch {
    throw new Error('Browser storage is full. Try fewer or smaller photos, or delete old reports.');
  }
}
const reportKey = (r) => r.id || r.createdAt;

/* ===== Item shape used by the page ===== */
const fromApi = (i) => ({
  id: String(i.id), type: i.type, title: i.title, description: i.description,
  category: i.category, location: i.location, date: i.date, createdAt: i.createdAt,
  reporterName: i.reporterName, ownerKey: String(i.reporterId),
  photos: i.photos.map((p) => p.url), thumbs: i.photos.map((p) => p.thumbUrl), status: i.status,
});
const fromDemo = (r) => ({
  id: String(reportKey(r)), type: r.type, title: r.title, description: r.description || '',
  category: r.category, location: r.location || '', date: r.date || '', createdAt: r.createdAt,
  reporterName: r.reporterName || r.reportedBy, ownerKey: r.reportedBy,
  photos: r.photos || [], thumbs: [], status: r.status || 'open',
  contactWhatsapp: r.reporterWhatsapp || null,
});
function isOwner(r) {
  if (!state.session) return false;
  return USE_BACKEND
    ? String(state.session.user.id) === r.ownerKey
    : state.session.user.email === r.ownerKey;
}

/* ===== Lost / Found toggle (report form) ===== */
function setType(type) {
  state.type = type;
  const found = type === 'found';
  $('tab-found').setAttribute('aria-pressed', found);
  $('tab-lost').setAttribute('aria-pressed', !found);
  $('date-label').textContent = found ? 'Date Found' : 'Date Lost';
  $('submit-btn').textContent = found ? 'Post Found Item' : 'Post Lost Item';
  $('description').placeholder = found
    ? 'Describe the item in detail... (leave out one detail only the owner would know)'
    : 'Describe the item in detail...';
}
$('tab-found').onclick = () => setType('found');
$('tab-lost').onclick = () => setType('lost');

/* ===== Photos (report form) ===== */
function renderPhotos() {
  const wrap = $('thumbs');
  wrap.replaceChildren();
  state.photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = `Photo ${i + 1}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `Remove photo ${i + 1}`);
    x.onclick = () => {
      URL.revokeObjectURL(p.url);
      state.photos.splice(i, 1);
      renderPhotos();
    };
    d.append(img, x);
    wrap.append(d);
  });
  $('add-photo').hidden = state.photos.length >= MAX_PHOTOS;
}

$('add-photo').onclick = () => $('photo-input').click();
$('photo-input').addEventListener('change', (e) => {
  $('photo-err').textContent = '';
  for (const file of e.target.files) {
    if (state.photos.length >= MAX_PHOTOS) {
      $('photo-err').textContent = `You can add up to ${MAX_PHOTOS} photos.`;
      break;
    }
    if (!file.type.startsWith('image/')) {
      $('photo-err').textContent = `${file.name} is not an image.`;
      continue;
    }
    if (file.size > MAX_PHOTO_MB * 1024 * 1024) {
      $('photo-err').textContent = `${file.name} is larger than ${MAX_PHOTO_MB} MB.`;
      continue;
    }
    state.photos.push({ file, url: URL.createObjectURL(file) });
  }
  e.target.value = '';
  renderPhotos();
});

// Demo mode only: shrink a photo so it fits in browser storage.
function shrinkImage(file, max = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };
    img.src = url;
  });
}

/* ===== Auth UI ===== */
function renderAuth() {
  const area = $('auth-area');
  area.replaceChildren();
  if (state.session) {
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = (state.session.user.name || '?')[0].toUpperCase();
    av.setAttribute('aria-hidden', 'true');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = state.session.user.name;
    const out = document.createElement('button');
    out.className = 'pill';
    out.textContent = 'Sign out';
    out.onclick = () => { clearSession(); toast('Signed out'); };
    area.append(av, who);
    if (!state.session.user.whatsapp) {
      const wa = document.createElement('button');
      wa.className = 'pill wa-missing';
      wa.textContent = 'Add WhatsApp';
      wa.onclick = () => openAuth('whatsapp');
      area.append(wa);
    }
    area.append(out);
  } else {
    const a = document.createElement('button');
    a.className = 'pill';
    a.textContent = 'Sign in';
    a.onclick = () => openAuth('signin');
    const b = document.createElement('button');
    b.className = 'pill solid';
    b.textContent = 'Sign up';
    b.onclick = () => openAuth('signup');
    area.append(a, b);
  }
  $('signin-hint').hidden = !!state.session;
}

function clearSession() {
  state.session = null;
  localStorage.removeItem('lf_session');
  renderAuth();
  renderFeed(); // owner buttons disappear
}

function openAuth(mode) {
  state.authMode = mode;
  const up = mode === 'signup';
  const wa = mode === 'whatsapp'; // signed-in user adding / changing their WhatsApp number
  $('auth-title').textContent = wa ? 'Add your WhatsApp number' : up ? 'Create your account' : 'Sign in';
  $('auth-sub').textContent = wa
    ? 'So the owner or finder of an item can message you directly.'
    : 'Use your college email so others know the report is genuine.';
  $('auth-submit').textContent = wa ? 'Save number' : up ? 'Create account' : 'Sign in';
  $('name-field').hidden = !up;
  $('email-field').hidden = wa;
  $('password-field').hidden = wa;
  $('wa-field').hidden = !(up || wa);
  $('switch-row').hidden = wa;
  $('auth-password').autocomplete = up ? 'new-password' : 'current-password';
  $('switch-text').textContent = up ? 'Already have an account?' : 'New to Lost & Found?';
  $('auth-switch').textContent = up ? 'Sign in' : 'Create an account';
  $('auth-err').textContent = '';
  if (!$('auth-dialog').open) $('auth-dialog').showModal();
  (up ? $('auth-name') : wa ? $('auth-wa') : $('auth-email')).focus();
}

$('auth-switch').onclick = () => openAuth(state.authMode === 'signin' ? 'signup' : 'signin');
$('auth-cancel').onclick = () => $('auth-dialog').close();
$('hint-signin').onclick = () => openAuth('signin');

// Reads the country code + number fields. Returns digits only, e.g. "919876543210", or null.
function readWhatsapp() {
  const national = $('auth-wa').value.replace(/\D/g, '').replace(/^0+/, '');
  const full = $('auth-cc').value + national;
  return national && /^[1-9]\d{7,14}$/.test(full) ? full : null;
}

async function authenticate(mode, { name, email, password, whatsapp }) {
  if (USE_BACKEND) {
    const data = await api(mode === 'signup' ? '/auth/register' : '/auth/login', {
      method: 'POST',
      body: mode === 'signup' ? { name, email, password, whatsapp } : { email, password },
    });
    return { token: data.token, user: data.user };
  }
  // Demo mode: no password is stored or checked. Do not use for real.
  return { token: 'demo', user: { name: name || email.split('@')[0], email, whatsapp: whatsapp || null } };
}

async function saveWhatsapp(whatsapp) {
  if (USE_BACKEND) {
    const data = await api('/me', { method: 'PATCH', body: { whatsapp } });
    state.session.user = data.user;
  } else {
    state.session.user.whatsapp = whatsapp;
  }
  localStorage.setItem('lf_session', JSON.stringify(state.session));
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const up = state.authMode === 'signup';
  const err = $('auth-err');

  // Signed-in user adding a WhatsApp number to an existing account
  if (state.authMode === 'whatsapp') {
    const wa = readWhatsapp();
    if (!wa) return (err.textContent = 'Enter a valid WhatsApp number (digits only, without the country code).');
    $('auth-submit').disabled = true;
    try {
      await saveWhatsapp(wa);
      $('auth-form').reset();
      $('auth-dialog').close();
      renderAuth();
      toast('WhatsApp number saved');
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      $('auth-submit').disabled = false;
    }
    return;
  }

  const name = $('auth-name').value.trim();
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  const whatsapp = up ? readWhatsapp() : null;

  if (up && !name) return (err.textContent = 'Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = 'Enter a valid email address.');
  if (password.length < 8) return (err.textContent = 'Password must be at least 8 characters.');
  if (up && !whatsapp) return (err.textContent = 'Enter a valid WhatsApp number (digits only, without the country code).');

  $('auth-submit').disabled = true;
  try {
    state.session = await authenticate(state.authMode, { name, email, password, whatsapp });
    localStorage.setItem('lf_session', JSON.stringify(state.session));
    $('auth-form').reset();
    $('auth-dialog').close();
    renderAuth();
    renderFeed();
    toast(`Signed in as ${state.session.user.name}`);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    $('auth-submit').disabled = false;
  }
});

/* ===== Report form ===== */
function setInvalid(id, msg) {
  $(id).classList.toggle('is-invalid', !!msg);
  $(`${id}-err`).textContent = msg || '';
}

$('date').max = new Date().toISOString().slice(0, 10);

$('report-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!state.session) return openAuth('signin');

  const title = $('title').value.trim();
  const category = $('category').value;
  setInvalid('title', title ? '' : 'Please enter a title.');
  setInvalid('category', category ? '' : 'Please choose a category.');
  if (!title || !category) return;

  const report = {
    type: state.type,
    title,
    description: $('description').value.trim(),
    category,
    location: $('location').value,
    date: $('date').value,
  };

  $('submit-btn').disabled = true;
  try {
    await submitReport(report, state.photos.map((p) => p.file));
    toast(state.type === 'found' ? 'Found item posted. Thank you!' : 'Lost item posted. We hope it turns up!');
    $('report-form').reset();
    state.photos.forEach((p) => URL.revokeObjectURL(p.url));
    state.photos = [];
    renderPhotos();
    await loadFeed();
    if (window.innerWidth < 1024) $('feed').scrollIntoView();
  } catch (ex) {
    toast(ex.message || 'Could not post the report.');
  } finally {
    $('submit-btn').disabled = false;
  }
});

async function submitReport(report, files) {
  if (USE_BACKEND) {
    const fd = new FormData();
    Object.entries(report).forEach(([k, v]) => fd.append(k, v));
    files.forEach((f) => fd.append('photos', f));
    await api('/items', { method: 'POST', form: fd });
    return;
  }
  const stored = {
    ...report,
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    reportedBy: state.session.user.email,
    reporterName: state.session.user.name,
    reporterWhatsapp: state.session.user.whatsapp || null,
    createdAt: new Date().toISOString(),
    photos: await Promise.all(files.map((f) => shrinkImage(f))),
  };
  const all = loadReports();
  all.unshift(stored);
  saveReports(all);
}

/* ===== Front page feed ===== */
function formatDay(r) {
  const d = r.date ? new Date(r.date + 'T00:00') : new Date(r.createdAt);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} hr ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

const span = (cls, text) => {
  const s = document.createElement('span');
  s.className = cls;
  if (text !== undefined) s.textContent = text;
  return s;
};

function renderCard(r) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'item';
  btn.setAttribute('aria-label', `${r.type === 'lost' ? 'Lost' : 'Found'}: ${r.title}. Open details`);

  const photo = span('item-photo');
  const cover = r.thumbs[0] || r.photos[0];
  if (cover) {
    const img = document.createElement('img');
    img.src = cover;
    img.alt = '';
    img.loading = 'lazy';
    photo.append(img);
  } else {
    const ph = span('ph', r.type === 'lost' ? '🔍' : '📦');
    ph.setAttribute('aria-hidden', 'true');
    photo.append(ph);
  }
  photo.append(span(`badge ${r.type}`, r.type === 'lost' ? 'Lost' : 'Found'));

  const body = span('item-body');
  body.append(span('item-title', r.title));
  body.append(span('item-meta', [r.category, r.location].filter(Boolean).join(' · ')));
  if (r.description) body.append(span('item-desc', r.description));
  body.append(span('item-foot', `${r.type === 'lost' ? 'Lost' : 'Found'} ${formatDay(r)} · posted ${timeAgo(r.createdAt)}`));

  btn.append(photo, body);
  btn.onclick = () => openDetail(r);
  return btn;
}

function renderFeed() {
  const total = state.counts.lost + state.counts.found;
  $('count-all').textContent = total;
  $('count-lost').textContent = state.counts.lost;
  $('count-found').textContent = state.counts.found;

  $('items').replaceChildren(...state.items.map(renderCard));
  $('load-more').hidden = !state.hasMore;

  const empty = $('empty');
  const filtering = state.filter !== 'all' || state.cat || state.query;
  let msg = '';
  if (state.error) msg = state.error;
  else if (!state.loaded) msg = 'Loading items…';
  else if (!state.items.length) {
    msg = filtering
      ? 'No items match your search. Try a different word or filter.'
      : 'Nothing has been reported yet. Use the form to post the first lost or found item.';
  }
  empty.textContent = msg;
  empty.hidden = !msg;
}

let feedRequest = 0;
async function loadFeed({ append = false } = {}) {
  const mine = ++feedRequest;
  const q = state.query.toLowerCase();
  try {
    if (USE_BACKEND) {
      const page = append ? state.page + 1 : 1;
      const params = new URLSearchParams({ page, limit: PAGE_SIZE });
      if (state.filter !== 'all') params.set('type', state.filter);
      if (state.cat) params.set('category', state.cat);
      if (state.query) params.set('q', state.query);
      if (append) $('load-more').disabled = true;
      const data = await api(`/items?${params}`);
      if (mine !== feedRequest) return;
      const list = data.items.map(fromApi);
      state.items = append ? state.items.concat(list) : list;
      state.page = data.page;
      state.hasMore = data.page < data.pages;
      state.counts = data.counts;
    } else {
      const base = loadReports().map(fromDemo).filter((r) =>
        r.status === 'open' &&
        (!state.cat || r.category === state.cat) &&
        (!q || [r.title, r.description, r.location, r.category].join(' ').toLowerCase().includes(q)));
      state.counts = {
        lost: base.filter((r) => r.type === 'lost').length,
        found: base.filter((r) => r.type === 'found').length,
      };
      state.items = base.filter((r) => state.filter === 'all' || r.type === state.filter);
      state.hasMore = false;
    }
    state.error = '';
  } catch (err) {
    if (mine !== feedRequest) return;
    state.items = [];
    state.hasMore = false;
    state.error = err.message;
  } finally {
    if (mine === feedRequest) {
      state.loaded = true;
      $('load-more').disabled = false;
      renderFeed();
    }
  }
}

document.querySelectorAll('.filter-tabs button').forEach((b) => {
  b.onclick = () => {
    state.filter = b.dataset.filter;
    document.querySelectorAll('.filter-tabs button').forEach((o) =>
      o.setAttribute('aria-pressed', o === b));
    loadFeed();
  };
});
let searchTimer;
$('search').addEventListener('input', (e) => {
  state.query = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadFeed(), 250);
});
$('filter-category').addEventListener('change', (e) => { state.cat = e.target.value; loadFeed(); });
$('load-more').onclick = () => loadFeed({ append: true });

// Fill the category filter from the form's own category list so they stay in sync.
[...$('category').options].filter((o) => o.value !== '').forEach((o) => {
  const opt = document.createElement('option');
  opt.value = o.value;
  opt.textContent = o.textContent;
  $('filter-category').append(opt);
});

/* ===== WhatsApp ===== */
function whatsappLink(number, r) {
  const me = state.session ? state.session.user.name : '';
  const text = r.type === 'found'
    ? `Hi ${r.reporterName}, I'm ${me}. I saw your found-item post "${r.title}" on Campus Lost & Found. I think it's mine.`
    : `Hi ${r.reporterName}, I'm ${me}. I saw your lost-item post "${r.title}" on Campus Lost & Found. I think I have found it.`;
  return `https://wa.me/${encodeURIComponent(number)}?text=${encodeURIComponent(text)}`;
}

function whatsappIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'currentColor');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.25-1.38A9.9 9.9 0 1 0 12.04 2Zm0 1.8a8.1 8.1 0 1 1-4.13 15.07l-.3-.18-3.1.82.83-3.03-.2-.31A8.1 8.1 0 0 1 12.04 3.8Zm-3.2 3.9c-.17 0-.45.06-.69.32-.24.26-.9.88-.9 2.15s.92 2.5 1.05 2.67c.13.17 1.8 2.88 4.45 3.92 2.2.87 2.65.7 3.13.65.48-.04 1.55-.63 1.77-1.24.22-.6.22-1.13.15-1.24-.06-.1-.24-.17-.5-.3-.26-.13-1.55-.77-1.79-.86-.24-.09-.41-.13-.59.13-.17.26-.68.86-.83 1.03-.15.17-.3.2-.57.07-.26-.13-1.1-.4-2.1-1.29-.77-.69-1.3-1.54-1.45-1.8-.15-.26-.02-.4.11-.53.12-.12.26-.3.39-.45.13-.15.17-.26.26-.43.09-.17.04-.33-.02-.46-.07-.13-.59-1.42-.81-1.94-.21-.5-.43-.43-.59-.44h-.5Z');
  svg.append(p);
  return svg;
}

/* ===== Item detail ===== */
async function openDetail(r) {
  // The poster's email and WhatsApp number are only sent by the server to signed-in users.
  let contactEmail = null;
  let contactWhatsapp = null;
  if (USE_BACKEND) {
    if (state.session && !isOwner(r)) {
      try {
        const full = (await api(`/items/${r.id}`)).item;
        contactEmail = full.contactEmail;
        contactWhatsapp = full.contactWhatsapp;
      } catch (err) {
        return toast(err.message);
      }
    }
  } else {
    contactEmail = r.ownerKey;
    contactWhatsapp = r.contactWhatsapp;
  }

  const body = $('detail-body');
  body.replaceChildren();

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'd-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.onclick = () => $('detail-dialog').close();

  const badge = document.createElement('span');
  badge.className = `badge ${r.type}`;
  badge.style.position = 'static';
  badge.style.display = 'inline-block';
  badge.textContent = r.type === 'lost' ? 'Lost' : 'Found';

  const h = document.createElement('h2');
  h.id = 'detail-title';
  h.className = 'd-title';
  h.textContent = r.title;

  body.append(close, badge, h);

  if (r.photos.length) {
    const main = document.createElement('img');
    main.className = 'd-main';
    main.src = r.photos[0];
    main.alt = `Photo of ${r.title}`;
    body.append(main);
    if (r.photos.length > 1) {
      const strip = document.createElement('div');
      strip.className = 'd-thumbs';
      r.photos.forEach((src, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Show photo ${i + 1}`);
        b.setAttribute('aria-current', i === 0);
        const t = document.createElement('img');
        t.src = r.thumbs[i] || src;
        t.alt = '';
        b.append(t);
        b.onclick = () => {
          main.src = src;
          strip.querySelectorAll('button').forEach((o) => o.setAttribute('aria-current', o === b));
        };
        strip.append(b);
      });
      body.append(strip);
    }
  } else {
    const ph = document.createElement('div');
    ph.className = 'd-ph';
    ph.textContent = r.type === 'lost' ? '🔍' : '📦';
    ph.setAttribute('aria-hidden', 'true');
    body.append(ph);
  }

  const dl = document.createElement('dl');
  dl.className = 'd-list';
  const row = (k, v) => {
    if (!v) return;
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  };
  row('Category', r.category);
  row('Location', r.location);
  row(r.type === 'lost' ? 'Date lost' : 'Date found', formatDay(r));
  row('Posted by', r.reporterName);
  row('Posted', timeAgo(r.createdAt));
  body.append(dl);

  if (r.description) {
    const p = document.createElement('p');
    p.className = 'd-desc';
    p.textContent = r.description;
    body.append(p);
  }

  const actions = document.createElement('div');
  actions.className = 'd-actions';

  if (isOwner(r)) {
    const resolve = document.createElement('button');
    resolve.type = 'button';
    resolve.className = 'submit';
    resolve.textContent = 'Mark as resolved';
    resolve.onclick = async () => {
      try {
        await setStatus(r, 'resolved');
        $('detail-dialog').close();
        toast('Marked as resolved. It is no longer listed.');
        loadFeed();
      } catch (err) { toast(err.message); }
    };
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost danger';
    del.textContent = 'Delete my post';
    del.onclick = async () => {
      if (!confirm('Delete this post? This cannot be undone.')) return;
      try {
        await deleteItem(r);
        $('detail-dialog').close();
        toast('Post deleted');
        loadFeed();
      } catch (err) { toast(err.message); }
    };
    actions.append(resolve, del);
  } else if (state.session && contactWhatsapp) {
    // Opens a WhatsApp chat with the poster, with a first message already typed in.
    const a = document.createElement('a');
    a.className = 'submit whatsapp';
    a.append(whatsappIcon(), document.createTextNode(r.type === 'lost' ? 'I found this: chat on WhatsApp' : 'This is mine: chat on WhatsApp'));
    a.href = whatsappLink(contactWhatsapp, r);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    actions.append(a);
    if (contactEmail) {
      const mail = document.createElement('a');
      mail.className = 'ghost';
      mail.textContent = 'Email instead';
      mail.href = `mailto:${contactEmail}?subject=${encodeURIComponent('Lost & Found: ' + r.title)}`;
      actions.append(mail);
    }
  } else if (state.session && contactEmail) {
    // This poster has no WhatsApp number on file (older account): fall back to email.
    const a = document.createElement('a');
    a.className = 'submit';
    a.textContent = r.type === 'lost' ? 'I found this' : 'This is mine';
    a.href = `mailto:${contactEmail}?subject=${encodeURIComponent('Lost & Found: ' + r.title)}`;
    actions.append(a);
  } else {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'submit';
    b.textContent = 'Sign in to contact';
    b.onclick = () => { $('detail-dialog').close(); openAuth('signin'); };
    actions.append(b);
  }
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'ghost';
  done.textContent = 'Close';
  done.onclick = () => $('detail-dialog').close();
  actions.append(done);
  body.append(actions);

  if (state.session && contactWhatsapp && !isOwner(r)) {
    const note = document.createElement('p');
    note.className = 'd-note';
    note.textContent = `This opens WhatsApp with a message to ${r.reporterName}. Only share proof of ownership, never send money.`;
    body.append(note);
  }

  $('detail-dialog').showModal();
}

async function setStatus(r, status) {
  if (USE_BACKEND) return api(`/items/${r.id}`, { method: 'PATCH', body: { status } });
  saveReports(loadReports().map((x) => (String(reportKey(x)) === r.id ? { ...x, status } : x)));
}
async function deleteItem(r) {
  if (USE_BACKEND) return api(`/items/${r.id}`, { method: 'DELETE' });
  saveReports(loadReports().filter((x) => String(reportKey(x)) !== r.id));
}

// Close dialogs when the backdrop is clicked.
['detail-dialog', 'auth-dialog'].forEach((id) => {
  $(id).addEventListener('click', (e) => {
    const box = $(id).getBoundingClientRect();
    const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
    if (outside) $(id).close();
  });
});

/* ===== Start ===== */
// Sessions saved before the WhatsApp feature do not know the user's number yet.
if (USE_BACKEND && state.session && state.session.user && state.session.user.whatsapp === undefined) {
  api('/me').then((d) => {
    state.session.user = d.user;
    localStorage.setItem('lf_session', JSON.stringify(state.session));
    renderAuth();
  }).catch(() => {});
}
setType('found');
renderPhotos();
renderAuth();
renderFeed();
loadFeed();