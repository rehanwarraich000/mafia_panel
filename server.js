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

  CREATE TABLE IF NOT EXISTS module_licenses (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id),
    serial_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'paused', 'inactive')),
    activated_at TEXT,
    expires_at TEXT,
    current_duration_days INTEGER,
    paused_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (module_id, serial_number)
  );

  CREATE TABLE IF NOT EXISTS license_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_id TEXT NOT NULL REFERENCES module_licenses(id),
    module_key TEXT NOT NULL,
    module_name TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    action TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS module_licenses_module_id_idx
    ON module_licenses(module_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS license_events_occurred_at_idx
    ON license_events(occurred_at DESC, id DESC);
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

const accessCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many access checks. Try again later.' },
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

function cleanExpiredLicenses() {
  const now = new Date().toISOString();
  const expired = db.prepare(`
    SELECT license.id, license.serial_number, license.current_duration_days,
      license.activated_at, license.expires_at, module.module_key, module.name
    FROM module_licenses AS license
    JOIN modules AS module ON module.id = license.module_id
    WHERE license.status = 'active' AND license.expires_at <= ?
  `).all(now);

  const expire = db.transaction((rows) => {
    for (const license of rows) {
      db.prepare(`
        UPDATE module_licenses
        SET status = 'inactive', activated_at = NULL, expires_at = NULL,
          current_duration_days = NULL, paused_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, license.id);
      db.prepare(`
        INSERT INTO license_events
          (license_id, module_key, module_name, serial_number, action, duration_days,
            activated_at, expires_at, occurred_at)
        VALUES (?, ?, ?, ?, 'expired', ?, ?, ?, ?)
      `).run(
        license.id,
        license.module_key,
        license.name,
        license.serial_number,
        license.current_duration_days,
        license.activated_at,
        license.expires_at,
        license.expires_at,
      );
    }
  });
  expire(expired);
}

function validModuleId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

function normalizeSerial(value) {
  if (typeof value !== 'string') return null;
  const serial = value.trim().toUpperCase();
  if (!serial || serial.length > 128 || /[\u0000-\u001f\u007f]/.test(serial)) return null;
  return serial;
}

function validLicenseId(value) {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

function recordLicenseEvent(license, action, occurredAt, durationDays = null, activatedAt = null, expiresAt = null) {
  db.prepare(`
    INSERT INTO license_events
      (license_id, module_key, module_name, serial_number, action, duration_days,
        activated_at, expires_at, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    license.id,
    license.module_key,
    license.name,
    license.serial_number,
    action,
    durationDays,
    activatedAt,
    expiresAt,
    occurredAt,
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/access/check', accessCheckLimiter, (req, res) => {
  const moduleKey = typeof req.body?.moduleKey === 'string' ? req.body.moduleKey.trim() : '';
  const serialNumber = normalizeSerial(req.body?.serialNumber);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(moduleKey) || !serialNumber) {
    return res.status(400).json({ error: 'A valid module ID and serial number are required.' });
  }
  cleanExpiredLicenses();
  const license = db.prepare(`
    SELECT license.status, license.expires_at
    FROM module_licenses AS license
    JOIN modules AS module ON module.id = license.module_id
    WHERE module.module_key = ? AND license.serial_number = ?
  `).get(moduleKey, serialNumber);
  const allowed = Boolean(license && license.status === 'active'
    && license.expires_at && license.expires_at > new Date().toISOString());
  res.json({
    allowed,
    status: allowed ? 'active' : (license?.status || 'not_found'),
    expiresAt: allowed ? license.expires_at : null,
  });
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

app.get('/api/modules/:id/licenses', requireAuth, (req, res) => {
  if (!validModuleId(req.params.id)) return res.status(400).json({ error: 'Invalid module ID.' });
  cleanExpiredLicenses();
  const module = db.prepare('SELECT id FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return res.status(404).json({ error: 'Module not found.' });
  const licenses = db.prepare(`
    SELECT id, serial_number AS serialNumber, status, activated_at AS activatedAt,
      expires_at AS expiresAt, current_duration_days AS currentDurationDays,
      created_at AS createdAt, updated_at AS updatedAt
    FROM module_licenses
    WHERE module_id = ?
    ORDER BY created_at DESC
  `).all(req.params.id);
  res.json({ licenses });
});

app.post('/api/modules/:id/licenses', requireSameOrigin, requireAuth, (req, res) => {
  if (!validModuleId(req.params.id)) return res.status(400).json({ error: 'Invalid module ID.' });
  const serialNumber = normalizeSerial(req.body?.serialNumber);
  if (!serialNumber) {
    return res.status(400).json({ error: 'Serial number is required and must be 128 characters or fewer.' });
  }
  const module = db.prepare('SELECT id, module_key, name FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return res.status(404).json({ error: 'Module not found.' });
  const now = new Date().toISOString();
  const license = { ...module, id: crypto.randomUUID(), serial_number: serialNumber };
  const register = db.transaction(() => {
    db.prepare(`
      INSERT INTO module_licenses
        (id, module_id, serial_number, status, created_at, updated_at)
      VALUES (?, ?, ?, 'inactive', ?, ?)
    `).run(license.id, module.id, serialNumber, now, now);
    recordLicenseEvent(license, 'serial_added', now);
  });
  try {
    register();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'That serial number is already registered for this module.' });
    }
    throw error;
  }
  res.status(201).json({
    id: license.id,
    serialNumber,
    status: 'inactive',
    createdAt: now,
  });
});

app.post('/api/modules/:id/licenses/activate', requireSameOrigin, requireAuth, (req, res) => {
  if (!validModuleId(req.params.id)) return res.status(400).json({ error: 'Invalid module ID.' });
  const serialNumber = normalizeSerial(req.body?.serialNumber);
  const days = req.body?.days;
  if (!serialNumber) {
    return res.status(400).json({ error: 'Serial number is required and must be 128 characters or fewer.' });
  }
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    return res.status(400).json({ error: 'Activation duration must be a whole number from 1 to 3650 days.' });
  }
  cleanExpiredLicenses();
  const module = db.prepare('SELECT id, module_key, name FROM modules WHERE id = ?').get(req.params.id);
  if (!module) return res.status(404).json({ error: 'Module not found.' });
  let license = db.prepare(`
    SELECT id, module_id, serial_number, status, activated_at, expires_at, current_duration_days, paused_at
    FROM module_licenses WHERE module_id = ? AND serial_number = ?
  `).get(module.id, serialNumber);
  if (license?.status === 'paused') {
    return res.status(409).json({ error: 'This serial is paused. Resume it before adding activation days.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const isActive = license?.status === 'active' && license.expires_at > nowIso;
  const activatedAt = isActive ? license.activated_at : nowIso;
  const baseTime = isActive ? new Date(license.expires_at) : now;
  const expiresAt = new Date(baseTime.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const licenseId = license?.id || crypto.randomUUID();
  const activation = db.transaction(() => {
    if (!license) {
      db.prepare(`
        INSERT INTO module_licenses
          (id, module_id, serial_number, status, activated_at, expires_at,
            current_duration_days, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
      `).run(licenseId, module.id, serialNumber, nowIso, expiresAt, days, nowIso, nowIso);
      license = {
        id: licenseId,
        module_id: module.id,
        serial_number: serialNumber,
        status: 'active',
        activated_at: activatedAt,
        expires_at: expiresAt,
        current_duration_days: days,
      };
    } else {
      db.prepare(`
        UPDATE module_licenses
        SET status = 'active', activated_at = ?, expires_at = ?,
          current_duration_days = ?, paused_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        activatedAt,
        expiresAt,
        (isActive ? (license.current_duration_days || 0) : 0) + days,
        nowIso,
        license.id,
      );
      license.status = 'active';
      license.activated_at = activatedAt;
      license.expires_at = expiresAt;
    }
    recordLicenseEvent({ ...module, ...license, serial_number: serialNumber }, 'activated', nowIso, days, nowIso, expiresAt);
  });
  activation();
  res.json({ id: licenseId, serialNumber, status: 'active', activatedAt, expiresAt, daysAdded: days });
});

app.post('/api/modules/:id/licenses/:licenseId/pause', requireSameOrigin, requireAuth, (req, res) => {
  if (!validModuleId(req.params.id) || !validLicenseId(req.params.licenseId)) {
    return res.status(400).json({ error: 'Invalid module or serial record ID.' });
  }
  cleanExpiredLicenses();
  const license = db.prepare(`
    SELECT license.*, module.module_key, module.name
    FROM module_licenses AS license
    JOIN modules AS module ON module.id = license.module_id
    WHERE license.id = ? AND license.module_id = ?
  `).get(req.params.licenseId, req.params.id);
  if (!license) return res.status(404).json({ error: 'Serial number not found for this module.' });
  if (license.status !== 'active') return res.status(409).json({ error: 'Only an active serial can be paused.' });

  const now = new Date().toISOString();
  const pause = db.transaction(() => {
    db.prepare(`
      UPDATE module_licenses SET status = 'paused', paused_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, license.id);
    recordLicenseEvent(license, 'paused', now, license.current_duration_days, license.activated_at, license.expires_at);
  });
  pause();
  res.json({ id: license.id, status: 'paused', pausedAt: now, expiresAt: license.expires_at });
});

app.post('/api/modules/:id/licenses/:licenseId/resume', requireSameOrigin, requireAuth, (req, res) => {
  if (!validModuleId(req.params.id) || !validLicenseId(req.params.licenseId)) {
    return res.status(400).json({ error: 'Invalid module or serial record ID.' });
  }
  const license = db.prepare(`
    SELECT license.*, module.module_key, module.name
    FROM module_licenses AS license
    JOIN modules AS module ON module.id = license.module_id
    WHERE license.id = ? AND license.module_id = ?
  `).get(req.params.licenseId, req.params.id);
  if (!license) return res.status(404).json({ error: 'Serial number not found for this module.' });
  if (license.status !== 'paused' || !license.paused_at || !license.expires_at) {
    return res.status(409).json({ error: 'Only a paused serial can be resumed.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    new Date(license.expires_at).getTime() - new Date(license.paused_at).getTime() + now.getTime(),
  ).toISOString();
  const resume = db.transaction(() => {
    db.prepare(`
      UPDATE module_licenses SET status = 'active', expires_at = ?, paused_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(expiresAt, nowIso, license.id);
    recordLicenseEvent(license, 'resumed', nowIso, license.current_duration_days, license.activated_at, expiresAt);
  });
  resume();
  res.json({ id: license.id, status: 'active', expiresAt });
});

app.post('/api/modules/:id/licenses/:licenseId/deactivate', requireSameOrigin, requireAuth, (req, res) => {
  if (!validModuleId(req.params.id) || !validLicenseId(req.params.licenseId)) {
    return res.status(400).json({ error: 'Invalid module or serial record ID.' });
  }
  cleanExpiredLicenses();
  const license = db.prepare(`
    SELECT license.*, module.module_key, module.name
    FROM module_licenses AS license
    JOIN modules AS module ON module.id = license.module_id
    WHERE license.id = ? AND license.module_id = ?
  `).get(req.params.licenseId, req.params.id);
  if (!license) return res.status(404).json({ error: 'Serial number not found for this module.' });
  if (license.status === 'inactive') return res.status(409).json({ error: 'This serial is already inactive.' });

  const now = new Date().toISOString();
  const deactivate = db.transaction(() => {
    db.prepare(`
      UPDATE module_licenses
      SET status = 'inactive', activated_at = NULL, expires_at = NULL,
        current_duration_days = NULL, paused_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, license.id);
    recordLicenseEvent(license, 'deactivated', now, license.current_duration_days, license.activated_at, license.expires_at);
  });
  deactivate();
  res.json({ id: license.id, status: 'inactive', deactivatedAt: now });
});

app.get('/api/history', requireAuth, (req, res) => {
  cleanExpiredModules();
  cleanExpiredLicenses();
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isInteger(offset) || offset < 0) {
    return res.status(400).json({ error: 'History limit must be 1-100 and offset must be zero or greater.' });
  }
  const total = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM module_events) +
      (SELECT COUNT(*) FROM license_events) AS total
  `).get().total;
  const events = db.prepare(`
    SELECT id, module_key AS moduleKey, module_name AS moduleName, action,
      duration_days AS durationDays, activated_at AS activatedAt, expires_at AS expiresAt,
      occurred_at AS occurredAt, NULL AS serialNumber, 0 AS eventType
    FROM module_events
    UNION ALL
    SELECT id, module_key AS moduleKey, module_name AS moduleName, action,
      duration_days AS durationDays, activated_at AS activatedAt, expires_at AS expiresAt,
      occurred_at AS occurredAt, serial_number AS serialNumber, 1 AS eventType
    FROM license_events
    ORDER BY occurredAt DESC, eventType DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  res.json({ events, total, limit, offset });
});

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  etag: true,
  maxAge: secureCookie ? '1h' : 0,
  setHeaders(res, filePath) {
    if (['.html', '.js', '.css'].includes(path.extname(filePath))) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// Yahan root route add kar diya gaya hai taake browser mein seedha index.html load ho:
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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