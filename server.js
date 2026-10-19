require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');

const requiredEnvironment = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}
if (process.env.ADMIN_PASSWORD.length < 12) {
  throw new Error('ADMIN_PASSWORD must be at least 12 characters long.');
}
if (Buffer.byteLength(process.env.SESSION_SECRET, 'utf8') < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters.');
}

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

const COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Host-mafia_session'
  : 'mafia_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessionKey = Buffer.from(process.env.SESSION_SECRET, 'utf8');
const passwordSalt = crypto.randomBytes(16);
const passwordHash = crypto.scryptSync(process.env.ADMIN_PASSWORD, passwordSalt, 64);
const secureCookie = process.env.NODE_ENV === 'production';

const databasePath = path.resolve(process.env.DB_PATH || './data/panel.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
  CREATE TABLE IF NOT EXISTS modules (
    id TEXT PRIMARY KEY,
    module_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    activated_at TEXT,
    expires_at TEXT,
    current_duration_days INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS module_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id TEXT NOT NULL REFERENCES modules(id),
    module_key TEXT NOT NULL,
    module_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('created', 'activated', 'deactivated', 'expired')),
    duration_days INTEGER,
    activated_at TEXT,
    expires_at TEXT,
    occurred_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    session_id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS module_events_occurred_at_idx
    ON module_events(occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS module_events_module_id_idx
    ON module_events(module_id, id DESC);
  CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx
    ON admin_sessions(expires_at);
`);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      upgradeInsecureRequests: secureCookie ? [] : null,
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(express.json({ limit: '20kb' }));
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function signSession(sessionId, expiration) {
  const payload = Buffer.from(JSON.stringify({ id: sessionId, exp: expiration })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSignedSession(token) {
  const separator = token.lastIndexOf('.');
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = crypto.createHmac('sha256', sessionKey).update(payload).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return null;
  }
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof session.id !== 'string' || !Number.isSafeInteger(session.exp) || session.exp <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function setSessionCookie(res, value, maxAge) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`,
  ];
  if (secureCookie) attributes.push('Secure');
  res.set('Set-Cookie', attributes.join('; '));
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'A same-origin request is required.' });
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
}

function requireAuth(req, res, next) {
  const signedSession = readSignedSession(readCookie(req, COOKIE_NAME));
  const session = signedSession
    ? db.prepare('SELECT expires_at FROM admin_sessions WHERE session_id = ?').get(signedSession.id)
    : null;
  if (!session || session.expires_at <= Date.now()) {
    setSessionCookie(res, '', 0);
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  next();
}

function cleanExpiredModules() {
  const expired = db.prepare(`
    SELECT id, module_key, name, activated_at, expires_at, current_duration_days
    FROM modules
    WHERE enabled = 1 AND expires_at <= ?
  `).all(new Date().toISOString());

  const expire = db.transaction((rows) => {
    for (const module of rows) {
      db.prepare(`
        UPDATE modules
        SET enabled = 0, activated_at = NULL, expires_at = NULL, current_duration_days = NULL
        WHERE id = ?
      `).run(module.id);
      db.prepare(`
        INSERT INTO module_events
          (module_id, module_key, module_name, action, duration_days, activated_at, expires_at, occurred_at)
        VALUES (?, ?, ?, 'expired', ?, ?, ?, ?)
      `).run(
        module.id,
        module.module_key,
        module.name,
        module.current_duration_days,
        module.activated_at,
        module.expires_at,
        module.expires_at,
      );
    }
  });
  expire(expired);
}

function validModuleId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/login', requireSameOrigin, loginLimiter, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const candidate = crypto.scryptSync(password, passwordSalt, 64);
  const passwordMatches = crypto.timingSafeEqual(candidate, passwordHash);
  const usernameMatches = username === process.env.ADMIN_USERNAME;
  if (!passwordMatches || !usernameMatches) {
    return res.status(401).json({ error: 'The username or password is incorrect.' });
  }
  const expiration = Date.now() + SESSION_TTL_MS;
  const sessionId = crypto.randomUUID();
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions (session_id, expires_at) VALUES (?, ?)').run(sessionId, expiration);
  setSessionCookie(res, signSession(sessionId, expiration), SESSION_TTL_MS);
  res.json({ username: process.env.ADMIN_USERNAME, expiresAt: new Date(expiration).toISOString() });
});

app.post('/api/logout', requireSameOrigin, (req, res) => {
  const session = readSignedSession(readCookie(req, COOKIE_NAME));
  if (session) {
    db.prepare('DELETE FROM admin_sessions WHERE session_id = ?').run(session.id);
  }
  setSessionCookie(res, '', 0);
  res.status(204).end();
});

app.get('/api/session', requireAuth, (_req, res) => {
  res.json({ username: process.env.ADMIN_USERNAME });
});

app.get('/api/modules', requireAuth, (_req, res) => {
  cleanExpiredModules();
  const modules = db.prepare(`
    SELECT id, module_key AS moduleKey, name, enabled, activated_at AS activatedAt,
      expires_at AS expiresAt, current_duration_days AS currentDurationDays, created_at AS createdAt
    FROM modules
    ORDER BY created_at DESC
  `).all().map((module) => ({ ...module, enabled: Boolean(module.enabled) }));
  const activeCount = modules.filter((module) => module.enabled).length;
  res.json({ modules, summary: { total: modules.length, active: activeCount, inactive: modules.length - activeCount } });
});

app.post('/api/modules', requireSameOrigin, requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const moduleKey = typeof req.body?.moduleKey === 'string' ? req.body.moduleKey.trim() : '';
  if (!name || name.length > 80) {
    return res.status(400).json({ error: 'Module name is required and must be 80 characters or fewer.' });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(moduleKey)) {
    return res.status(400).json({ error: 'Module ID must be 1-64 letters, numbers, dots, underscores, or hyphens.' });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO modules (id, module_key, name, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, moduleKey, name, createdAt);
    db.prepare(`
      INSERT INTO module_events
        (module_id, module_key, module_name, action, occurred_at)
      VALUES (?, ?, ?, 'created', ?)
    `).run(id, moduleKey, name, createdAt);
  });
  try {
    create();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A module with that ID already exists.' });
    }
    throw error;
  }
  res.status(201).json({ id, moduleKey, name, enabled: false, createdAt });
});

app.post('/api/modules/:id/activate', requireSameOrigin, requireAuth, (req, res) => {
  const days = req.body?.days;
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    return res.status(400).json({ error: 'Activation duration must be a whole number from 1 to 3650 days.' });
  }
  if (!validModuleId(req.params.id)) return res.status(400).json({ error: 'Invalid module ID.' });
  cleanExpiredModules();
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return res.status(404).json({ error: 'Module not found.' });

  const now = new Date();
  const nowIso = now.toISOString();
  const isActive = module.enabled === 1 && module.expires_at > nowIso;
  const activatedAt = isActive ? module.activated_at : nowIso;
  const baseTime = isActive ? new Date(module.expires_at) : now;
  const expiresAt = new Date(baseTime.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const activate = db.transaction(() => {
    db.prepare(`
      UPDATE modules
      SET enabled = 1, activated_at = ?, expires_at = ?, current_duration_days = ?
      WHERE id = ?
    `).run(activatedAt, expiresAt, days, module.id);
    db.prepare(`
      INSERT INTO module_events
        (module_id, module_key, module_name, action, duration_days, activated_at, expires_at, occurred_at)
      VALUES (?, ?, ?, 'activated', ?, ?, ?, ?)
    `).run(module.id, module.module_key, module.name, days, nowIso, expiresAt, nowIso);
  });
  activate();
  res.json({ id: module.id, enabled: true, activatedAt, expiresAt, daysAdded: days });
});

app.post('/api/modules/:id/deactivate', requireSameOrigin, requireAuth, (req, res) => {
  if (!validModuleId(req.params.id)) return res.status(400).json({ error: 'Invalid module ID.' });
  cleanExpiredModules();
  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return res.status(404).json({ error: 'Module not found.' });
  if (module.enabled !== 1) return res.status(409).json({ error: 'This module is already inactive.' });

  const now = new Date().toISOString();
  const deactivate = db.transaction(() => {
    db.prepare(`
      UPDATE modules
      SET enabled = 0, activated_at = NULL, expires_at = NULL, current_duration_days = NULL
      WHERE id = ?
    `).run(module.id);
    db.prepare(`
      INSERT INTO module_events
        (module_id, module_key, module_name, action, duration_days, activated_at, expires_at, occurred_at)
      VALUES (?, ?, ?, 'deactivated', ?, ?, ?, ?)
    `).run(
      module.id,
      module.module_key,
      module.name,
      module.current_duration_days,
      module.activated_at,
      module.expires_at,
      now,
    );
  });
  deactivate();
  res.json({ id: module.id, enabled: false, deactivatedAt: now });
});

app.get('/api/history', requireAuth, (req, res) => {
  cleanExpiredModules();
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isInteger(offset) || offset < 0) {
    return res.status(400).json({ error: 'History limit must be 1-100 and offset must be zero or greater.' });
  }
  const total = db.prepare('SELECT COUNT(*) AS total FROM module_events').get().total;
  const events = db.prepare(`
    SELECT id, module_key AS moduleKey, module_name AS moduleName, action,
      duration_days AS durationDays, activated_at AS activatedAt, expires_at AS expiresAt,
      occurred_at AS occurredAt
    FROM module_events
    ORDER BY occurred_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  res.json({ events, total, limit, offset });
});

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  etag: true,
  maxAge: secureCookie ? '1h' : 0,
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  res.status(500).json({ error: 'An internal server error occurred.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mafia Anonymous panel listening on port ${PORT}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
