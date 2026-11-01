require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { pool, initDatabase } = require('./db');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('Set JWT_SECRET (16+ characters) in your environment.');
  process.exit(1);
}

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Supabase client for storage uploads.
// Falls back to the anon key if the service role key is not available
// (the photos bucket has public upload policies enabled).
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (s) => typeof s === 'string' && s.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const normalizeWhatsapp = (v) => {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
};
const toId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found');
  return n;
};

const baseUrl = () => process.env.PUBLIC_URL || '';
const storageUrl = (name) =>
  `${SUPABASE_URL}/storage/v1/object/public/photos/${name}`;

const signToken = (user) => jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, whatsapp: u.whatsapp || null });

async function userFromRequest(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT id, name, email, whatsapp FROM users WHERE id = $1', [sub]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

const requireAuth = wrap(async (req, res, next) => {
  const user = await userFromRequest(req);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  req.user = user;
  next();
});

const optionalAuth = wrap(async (req, res, next) => {
  req.user = await userFromRequest(req);
  next();
});

// ---------- Image hosting ----------
async function processPhoto(buffer) {
  const id = crypto.randomUUID();
  const filename = `${id}.jpg`;
  const thumb = `${id}_thumb.jpg`;

  try {
    const image = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: '#ffffff' });
    const fullBuf = await image
      .clone()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const thumbBuf = await image
      .clone()
      .resize({ width: 480, height: 360, fit: 'cover' })
      .jpeg({ quality: 75 })
      .toBuffer();

    const { error: err1 } = await supabase.storage.from('photos').upload(filename, fullBuf, { contentType: 'image/jpeg' });
    if (err1) throw err1;
    const { error: err2 } = await supabase.storage.from('photos').upload(thumb, thumbBuf, { contentType: 'image/jpeg' });
    if (err2) throw err2;

    return { filename, thumb, size: fullBuf.length };
  } catch {
    throw new HttpError(400, 'One of the photos could not be read. Use a JPG, PNG, WebP or GIF image.');
  }
}

async function removeFiles(names) {
  for (const n of names) {
    await supabase.storage.from('photos').remove([n]);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 12, fieldSize: 20_000 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new HttpError(400, 'Only image files can be uploaded.')),
});

// ---------- App ----------
const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'],
      'upgrade-insecure-requests': null,
    },
  },
}));
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: '50kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'You are posting too fast. Try again later.' },
});

// ---------- Auth ----------
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const name = clean(req.body?.name, 100);
  const email = clean(req.body?.email, 255).toLowerCase();
  const password = req.body?.password;
  const whatsapp = normalizeWhatsapp(req.body?.whatsapp);
  if (!name) throw new HttpError(400, 'Enter your full name.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!whatsapp) throw new HttpError(400, 'Enter a valid WhatsApp number with country code.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Password must be 8 to 128 characters.');
  }

  const hash = await bcrypt.hash(password, 12);
  let id;
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, whatsapp) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, hash, whatsapp]
    );
    id = rows[0].id;
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'That email is already registered. Try signing in.');
    throw err;
  }
  const user = { id, name, email, whatsapp };
  res.status(201).json({ user: publicUser(user), token: signToken(user) });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = clean(req.body?.email, 255).toLowerCase();
  const password = req.body?.password;
  if (!isEmail(email) || typeof password !== 'string') throw new HttpError(400, 'Enter your email and password.');

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) throw new HttpError(401, 'Wrong email or password.');
  res.json({ user: publicUser(user), token: signToken(user) });
}));

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/me', requireAuth, wrap(async (req, res) => {
  const whatsapp = normalizeWhatsapp(req.body?.whatsapp);
  if (!whatsapp) throw new HttpError(400, 'Enter a valid WhatsApp number with country code.');
  await pool.query('UPDATE users SET whatsapp = $1 WHERE id = $2', [whatsapp, req.user.id]);
  res.json({ user: publicUser({ ...req.user, whatsapp }) });
}));

// ---------- Items ----------
function buildFilters({ type, category, q, status = 'open' }) {
  const where = ['i.status = $1'];
  const params = [status];
  let idx = 2;
  if (type) { where.push(`i.type = $${idx++}`); params.push(type); }
  if (category) { where.push(`i.category = $${idx++}`); params.push(category); }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(`(i.title ILIKE $${idx} OR i.description ILIKE $${idx} OR i.location ILIKE $${idx} OR i.category ILIKE $${idx})`);
    params.push(like);
    idx++;
  }
  return { sql: where.join(' AND '), params, nextIdx: idx };
}

async function loadPhotos(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const { rows } = await pool.query(
    'SELECT item_id, filename, thumb_filename FROM item_photos WHERE item_id = ANY($1) ORDER BY position, id',
    [ids]
  );
  for (const p of rows) {
    if (!map.has(p.item_id)) map.set(p.item_id, []);
    map.get(p.item_id).push(p);
  }
  return map;
}

function serialize(row, photos = [], contact) {
  const item = {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description || '',
    category: row.category,
    location: row.location || '',
    date: row.event_date ? row.event_date.toISOString().slice(0, 10) : '',
    status: row.status,
    createdAt: row.created_at,
    reporterId: row.user_id,
    reporterName: row.reporter_name,
    photos: photos.map((p) => ({ url: storageUrl(p.filename), thumbUrl: storageUrl(p.thumb_filename) })),
  };
  if (contact) {
    item.contactEmail = contact.email;
    item.contactWhatsapp = contact.whatsapp || null;
  }
  return item;
}

async function fetchItem(id, includeContact) {
  const { rows } = await pool.query(
    `SELECT i.*, u.name AS reporter_name, u.email AS reporter_email, u.whatsapp AS reporter_whatsapp
     FROM items i JOIN users u ON u.id = i.user_id WHERE i.id = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Item not found.');
  const photos = (await loadPhotos([id])).get(id) || [];
  return serialize(row, photos, includeContact ? { email: row.reporter_email, whatsapp: row.reporter_whatsapp } : undefined);
}

app.get('/api/items', wrap(async (req, res) => {
  const type = ['lost', 'found'].includes(req.query.type) ? req.query.type : null;
  const category = clean(req.query.category, 60) || null;
  const q = clean(req.query.q, 100) || null;
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);

  const f = buildFilters({ type, category, q, status });
  const offsetIdx = f.nextIdx;
  const limitIdx = offsetIdx + 1;
  const { rows } = await pool.query(
    `SELECT i.*, u.name AS reporter_name
     FROM items i JOIN users u ON u.id = i.user_id
     WHERE ${f.sql}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...f.params, limit, (page - 1) * limit]
  );
  const totalRes = await pool.query(`SELECT COUNT(*) AS total FROM items i WHERE ${f.sql}`, f.params);

  const b = buildFilters({ category, q, status });
  const countRes = await pool.query(
    `SELECT i.type, COUNT(*) AS n FROM items i WHERE ${b.sql} GROUP BY i.type`, b.params
  );
  const counts = { lost: 0, found: 0 };
  countRes.rows.forEach((r) => { counts[r.type] = parseInt(r.n, 10); });

  const photos = await loadPhotos(rows.map((r) => r.id));
  const total = parseInt(totalRes.rows[0].total, 10);
  res.json({
    items: rows.map((r) => serialize(r, photos.get(r.id))),
    page, limit, total, pages: Math.max(Math.ceil(total / limit), 1), counts,
  });
}));

app.get('/api/items/:id', optionalAuth, wrap(async (req, res) => {
  res.json({ item: await fetchItem(toId(req.params.id), !!req.user) });
}));

app.post('/api/items', requireAuth, postLimiter, upload.array('photos', MAX_PHOTOS), wrap(async (req, res) => {
  const type = req.body.type;
  const title = clean(req.body.title, 120);
  const description = clean(req.body.description, 1000);
  const category = clean(req.body.category, 60);
  const location = clean(req.body.location, 60);
  const date = clean(req.body.date, 10);

  if (!['lost', 'found'].includes(type)) throw new HttpError(400, 'Choose lost or found.');
  if (!title) throw new HttpError(400, 'Enter a title.');
  if (!category) throw new HttpError(400, 'Choose a category.');
  if (date) {
    const d = new Date(`${date}T00:00:00Z`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
    if (!valid) throw new HttpError(400, 'Enter a valid date.');
    if (d.getTime() > Date.now() + 36 * 3600 * 1000) throw new HttpError(400, 'The date cannot be in the future.');
  }

  const uploaded = [];
  let itemId;
  try {
    const photos = [];
    for (const file of req.files || []) {
      const p = await processPhoto(file.buffer);
      uploaded.push(p.filename, p.thumb);
      photos.push(p);
    }

    await pool.query('BEGIN');
    const insRes = await pool.query(
      `INSERT INTO items (user_id, type, title, description, category, location, event_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user.id, type, title, description || null, category, location || null, date || null]
    );
    itemId = insRes.rows[0].id;
    for (let i = 0; i < photos.length; i++) {
      await pool.query(
        'INSERT INTO item_photos (item_id, filename, thumb_filename, size_bytes, position) VALUES ($1, $2, $3, $4, $5)',
        [itemId, photos[i].filename, photos[i].thumb, photos[i].size, i]
      );
    }
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    await removeFiles(uploaded);
    throw err;
  }

  res.status(201).json({ item: await fetchItem(itemId, false) });
}));

async function ownedItem(req) {
  const id = toId(req.params.id);
  const { rows } = await pool.query('SELECT id, user_id FROM items WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Item not found.');
  if (rows[0].user_id !== req.user.id) throw new HttpError(403, 'You can only change your own posts.');
  return id;
}

app.patch('/api/items/:id', requireAuth, wrap(async (req, res) => {
  const id = await ownedItem(req);
  const status = req.body?.status;
  if (!['open', 'resolved'].includes(status)) throw new HttpError(400, 'Status must be open or resolved.');
  await pool.query('UPDATE items SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
  res.json({ item: await fetchItem(id, false) });
}));

app.delete('/api/items/:id', requireAuth, wrap(async (req, res) => {
  const id = await ownedItem(req);
  const photos = (await loadPhotos([id])).get(id) || [];
  await pool.query('DELETE FROM items WHERE id = $1', [id]);
  await removeFiles(photos.flatMap((p) => [p.filename, p.thumb_filename]));
  res.status(204).end();
}));

// ---------- Website ----------
const fs = require('fs');
const path = require('path');
const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR || path.join(__dirname, '..', 'lost-found-frontend'));
if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  app.use(express.static(FRONTEND_DIR, { maxAge: '1h', dotfiles: 'deny' }));
}

// ---------- Errors ----------
app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const msg = {
      LIMIT_FILE_SIZE: `Each photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`,
      LIMIT_FILE_COUNT: `You can upload up to ${MAX_PHOTOS} photos.`,
      LIMIT_UNEXPECTED_FILE: `You can upload up to ${MAX_PHOTOS} photos.`,
    }[err.code] || 'The upload was not accepted.';
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// ---------- Start ----------
(async () => {
  try {
    await initDatabase();
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('Database setup failed:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`Lost & Found running on http://localhost:${PORT}`));
})();
