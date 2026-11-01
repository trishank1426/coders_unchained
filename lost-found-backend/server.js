require('dotenv').config();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const { pool, initDatabase } = require('./db');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  console.error('Set JWT_SECRET (16+ characters) in your .env file. See .env.example.');
  process.exit(1);
}

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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
// WhatsApp numbers are stored as digits only, country code included (e.g. 919876543210).
// That is the format wa.me links need. E.164 allows at most 15 digits.
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

const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const fileUrl = (req, name) => `${baseUrl(req)}/uploads/${name}`;

const signToken = (user) => jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, whatsapp: u.whatsapp || null });

async function userFromRequest(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const [rows] = await pool.query('SELECT id, name, email, whatsapp FROM users WHERE id = ?', [sub]);
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
// Photos are re-encoded with sharp: this proves they are real images, removes
// hidden data such as GPS location, fixes rotation, and creates a thumbnail.
async function processPhoto(buffer, written) {
  const id = crypto.randomUUID();
  const filename = `${id}.jpg`;
  const thumb = `${id}_thumb.jpg`;
  written.push(filename, thumb);
  try {
    const image = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: '#ffffff' });
    const full = await image
      .clone()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(UPLOAD_DIR, filename));
    await image
      .clone()
      .resize({ width: 480, height: 360, fit: 'cover' })
      .jpeg({ quality: 75 })
      .toFile(path.join(UPLOAD_DIR, thumb));
    return { filename, thumb, size: full.size };
  } catch {
    throw new HttpError(400, 'One of the photos could not be read. Use a JPG, PNG, WebP or GIF image.');
  }
}

async function removeFiles(names) {
  await Promise.all(
    names.map((n) => fsp.unlink(path.join(UPLOAD_DIR, path.basename(n))).catch(() => {}))
  );
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
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // lets the website show the photos
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'], // blob: = photo previews before upload
      'upgrade-insecure-requests': null,       // the HTTPS proxy handles this; keeps plain-http local runs working
    },
  },
}));
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: '50kb' }));

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' })
);

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
    const [r] = await pool.query('INSERT INTO users (name, email, password_hash, whatsapp) VALUES (?, ?, ?, ?)', [name, email, hash, whatsapp]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That email is already registered. Try signing in.');
    throw err;
  }
  const user = { id, name, email, whatsapp };
  res.status(201).json({ user: publicUser(user), token: signToken(user) });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = clean(req.body?.email, 255).toLowerCase();
  const password = req.body?.password;
  if (!isEmail(email) || typeof password !== 'string') throw new HttpError(400, 'Enter your email and password.');

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) throw new HttpError(401, 'Wrong email or password.');
  res.json({ user: publicUser(user), token: signToken(user) });
}));

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// Lets older accounts (created before WhatsApp was added) or anyone changing number set it.
app.patch('/api/me', requireAuth, wrap(async (req, res) => {
  const whatsapp = normalizeWhatsapp(req.body?.whatsapp);
  if (!whatsapp) throw new HttpError(400, 'Enter a valid WhatsApp number with country code.');
  await pool.query('UPDATE users SET whatsapp = ? WHERE id = ?', [whatsapp, req.user.id]);
  res.json({ user: publicUser({ ...req.user, whatsapp }) });
}));

// ---------- Items ----------
function buildFilters({ type, category, q, status = 'open' }) {
  const where = ['i.status = ?'];
  const params = [status];
  if (type) { where.push('i.type = ?'); params.push(type); }
  if (category) { where.push('i.category = ?'); params.push(category); }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push('(i.title LIKE ? OR i.description LIKE ? OR i.location LIKE ? OR i.category LIKE ?)');
    params.push(like, like, like, like);
  }
  return { sql: where.join(' AND '), params };
}

async function loadPhotos(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await pool.query(
    'SELECT item_id, filename, thumb_filename FROM item_photos WHERE item_id IN (?) ORDER BY position, id',
    [ids]
  );
  for (const p of rows) {
    if (!map.has(p.item_id)) map.set(p.item_id, []);
    map.get(p.item_id).push(p);
  }
  return map;
}

function serialize(req, row, photos = [], contact) {
  const item = {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description || '',
    category: row.category,
    location: row.location || '',
    date: row.event_date || '',
    status: row.status,
    createdAt: row.created_at,
    reporterId: row.user_id,
    reporterName: row.reporter_name,
    photos: photos.map((p) => ({ url: fileUrl(req, p.filename), thumbUrl: fileUrl(req, p.thumb_filename) })),
  };
  if (contact) { // contact details are only sent to signed-in users
    item.contactEmail = contact.email;
    item.contactWhatsapp = contact.whatsapp || null;
  }
  return item;
}

async function fetchItem(req, id, includeContact) {
  const [rows] = await pool.query(
    `SELECT i.*, u.name AS reporter_name, u.email AS reporter_email, u.whatsapp AS reporter_whatsapp
     FROM items i JOIN users u ON u.id = i.user_id WHERE i.id = ?`,
    [id]
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'Item not found.');
  const photos = (await loadPhotos([id])).get(id) || [];
  return serialize(req, row, photos, includeContact ? { email: row.reporter_email, whatsapp: row.reporter_whatsapp } : undefined);
}

app.get('/api/items', wrap(async (req, res) => {
  const type = ['lost', 'found'].includes(req.query.type) ? req.query.type : null;
  const category = clean(req.query.category, 60) || null;
  const q = clean(req.query.q, 100) || null;
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);

  const f = buildFilters({ type, category, q, status });
  const [rows] = await pool.query(
    `SELECT i.*, u.name AS reporter_name
     FROM items i JOIN users u ON u.id = i.user_id
     WHERE ${f.sql}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT ? OFFSET ?`,
    [...f.params, limit, (page - 1) * limit]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM items i WHERE ${f.sql}`, f.params);

  // Tab counts ignore the lost/found choice but respect search and category.
  const b = buildFilters({ category, q, status });
  const [countRows] = await pool.query(
    `SELECT i.type, COUNT(*) AS n FROM items i WHERE ${b.sql} GROUP BY i.type`, b.params
  );
  const counts = { lost: 0, found: 0 };
  countRows.forEach((r) => { counts[r.type] = r.n; });

  const photos = await loadPhotos(rows.map((r) => r.id));
  res.json({
    items: rows.map((r) => serialize(req, r, photos.get(r.id))),
    page, limit, total, pages: Math.max(Math.ceil(total / limit), 1), counts,
  });
}));

app.get('/api/items/:id', optionalAuth, wrap(async (req, res) => {
  res.json({ item: await fetchItem(req, toId(req.params.id), !!req.user) });
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

  const written = [];
  let conn;
  let itemId;
  try {
    const photos = [];
    for (const file of req.files || []) photos.push(await processPhoto(file.buffer, written));

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO items (user_id, type, title, description, category, location, event_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, type, title, description || null, category, location || null, date || null]
    );
    itemId = r.insertId;
    for (let i = 0; i < photos.length; i++) {
      await conn.query(
        'INSERT INTO item_photos (item_id, filename, thumb_filename, size_bytes, position) VALUES (?, ?, ?, ?, ?)',
        [itemId, photos[i].filename, photos[i].thumb, photos[i].size, i]
      );
    }
    await conn.commit();
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    await removeFiles(written);
    throw err;
  } finally {
    if (conn) conn.release();
  }

  res.status(201).json({ item: await fetchItem(req, itemId, false) });
}));

async function ownedItem(req) {
  const id = toId(req.params.id);
  const [rows] = await pool.query('SELECT id, user_id FROM items WHERE id = ?', [id]);
  if (!rows[0]) throw new HttpError(404, 'Item not found.');
  if (rows[0].user_id !== req.user.id) throw new HttpError(403, 'You can only change your own posts.');
  return id;
}

app.patch('/api/items/:id', requireAuth, wrap(async (req, res) => {
  const id = await ownedItem(req);
  const status = req.body?.status;
  if (!['open', 'resolved'].includes(status)) throw new HttpError(400, 'Status must be open or resolved.');
  await pool.query('UPDATE items SET status = ? WHERE id = ?', [status, id]);
  res.json({ item: await fetchItem(req, id, false) });
}));

app.delete('/api/items/:id', requireAuth, wrap(async (req, res) => {
  const id = await ownedItem(req);
  const photos = (await loadPhotos([id])).get(id) || [];
  await pool.query('DELETE FROM items WHERE id = ?', [id]); // photo rows go with it
  await removeFiles(photos.flatMap((p) => [p.filename, p.thumb_filename]));
  res.status(204).end();
}));

// ---------- Website ----------
// When the frontend folder is present, this server also serves the website itself,
// so one address (and one deployment) covers both the site and the API.
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
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  try {
    await initDatabase();
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code === 'ECONNREFUSED') console.error('Cannot reach MySQL. Is it running? Check DB_HOST and DB_PORT in .env.');
    else if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('MySQL rejected the login. Check DB_USER and DB_PASSWORD in .env.');
    else console.error('Database setup failed:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`Lost & Found running on http://localhost:${PORT}`));
})();
