'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DATA_FILE = process.env.DATA_FILE || '/tmp/licenses.json';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const sessions = new Map();
const loginFailures = new Map();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
if (Buffer.byteLength(ADMIN_PASSWORD, 'utf8') < 12) {
  throw new Error('Set ADMIN_PASSWORD to a secret of at least 12 characters before starting.');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readLicenses() {
  try {
    const contents = fs.readFileSync(DATA_FILE, 'utf8');
    const licenses = JSON.parse(contents);
    if (!Array.isArray(licenses)) throw new Error('License data must be a JSON array.');
    return licenses;
  } catch (error) {
    if (error.code === 'ENOENT') {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, '[]\n', { encoding: 'utf8', flag: 'wx' });
      return [];
    }
    throw new Error(`Could not read license data at ${DATA_FILE}: ${error.message}`);
  }
}

let licenses = readLicenses();

function saveLicenses() {
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(licenses, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
}

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'Request body must be a JSON object.'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function safeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function getCookie(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return '';
}

function getSession(request) {
  const id = getCookie(request, 'ma_session');
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    return null;
  }
  return { id, ...session };
}

function requireAdmin(request) {
  const session = getSession(request);
  if (!session) throw new HttpError(401, 'Admin login required.');
  return session;
}

function requireCsrf(request, session) {
  const token = request.headers['x-csrf-token'];
  if (typeof token !== 'string' || !safeEqual(token, session.csrfToken)) {
    throw new HttpError(403, 'Invalid security token. Refresh the panel and try again.');
  }
}

function normalizeSerial(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter a serial number.');
  const serial = value.trim().toUpperCase();
  if (serial.length < 8 || serial.length > 100 || !/^[A-Z0-9-]+$/.test(serial)) {
    throw new HttpError(400, 'Serial number format is invalid.');
  }
  return serial;
}

function serialHash(serial) {
  return crypto.createHash('sha256').update(serial, 'utf8').digest('hex');
}

function validateDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new HttpError(400, 'Days must be a whole number from 1 to 3650.');
  }
  return days;
}

function adminLicenseList() {
  const now = Date.now();
  return licenses.map((license) => ({
    hint: license.hint,
    createdAt: license.createdAt,
    expiresAt: license.expiresAt,
    active: license.active && license.expiresAt > now,
  }));
}

function panelPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mafia Anonymous | License Panel</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #0b0b0f; color: #f5f5f7; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px 16px; }
    main { width: min(820px, 100%); margin: auto; }
    h1 { margin-bottom: 4px; color: #c4a7ff; }
    .muted { color: #aaa6b5; }
    section { background: #15141b; border: 1px solid #302b3a; border-radius: 12px; padding: 20px; margin: 20px 0; }
    label { display: block; margin: 12px 0 6px; font-weight: 600; }
    input { width: 100%; padding: 11px; border-radius: 7px; border: 1px solid #494354; background: #0d0c11; color: white; }
    button { cursor: pointer; border: 0; border-radius: 7px; padding: 10px 15px; margin: 12px 8px 0 0; color: white; background: #6841a5; font-weight: 700; }
    button.secondary { background: #44404d; }
    button.danger { background: #a23c51; }
    #notice { min-height: 24px; color: #d5c2ff; overflow-wrap: anywhere; }
    #newSerial { padding: 12px; background: #0d0c11; border-radius: 7px; overflow-wrap: anywhere; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th, td { padding: 11px 8px; border-bottom: 1px solid #302b3a; }
    .active { color: #8be2a7; } .inactive { color: #ff9a9a; }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
<main>
  <h1>Mafia Anonymous</h1>
  <div class="muted">Module license activation control panel</div>
  <div id="notice" role="status" aria-live="polite"></div>
  <section id="loginBox">
    <h2>Admin login</h2>
    <form id="loginForm">
      <label for="password">Admin password</label>
      <input id="password" type="password" autocomplete="current-password" required>
      <button type="submit">Login</button>
    </form>
  </section>
  <div id="dashboard" hidden>
    <section>
      <h2>Activate a module</h2>
      <p class="muted">Naya serial banayen ya mojooda serial ko dobara activate/extend karen.</p>
      <label for="serial">Serial (naye serial ke liye khaali chhor dein)</label>
      <input id="serial" autocomplete="off" placeholder="MA-...">
      <label for="days">Activation days (1-3650)</label>
      <input id="days" type="number" min="1" max="3650" step="1" value="30">
      <button id="activateButton" type="button">Activate / extend</button>
      <div id="serialOutput" hidden>
        <p>New serial — isay abhi copy kar len; baad mein dobara dikhaya nahi jayega:</p>
        <div id="newSerial"></div>
      </div>
    </section>
    <section>
      <h2>Deactivate a module</h2>
      <label for="deactivateSerial">Serial</label>
      <input id="deactivateSerial" autocomplete="off" placeholder="MA-...">
      <button id="deactivateButton" class="danger" type="button">Deactivate now</button>
    </section>
    <section>
      <h2>Issued serials</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Serial</th><th>Status</th><th>Expires</th></tr></thead>
          <tbody id="licenseRows"></tbody>
        </table>
      </div>
      <button id="refreshButton" class="secondary" type="button">Refresh list</button>
      <button id="logoutButton" class="secondary" type="button">Logout</button>
    </section>
  </div>
</main>
<script>
  let csrfToken = '';
  const notice = document.getElementById('notice');
  const dashboard = document.getElementById('dashboard');
  const loginBox = document.getElementById('loginBox');

  function showMessage(message) { notice.textContent = message; }
  async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed.');
    return result;
  }
  function setLoggedIn(value) {
    loginBox.hidden = value;
    dashboard.hidden = !value;
  }
  async function loadLicenses() {
    const result = await api('/api/admin/licenses');
    const rows = document.getElementById('licenseRows');
    rows.replaceChildren();
    for (const license of result.licenses) {
      const row = document.createElement('tr');
      for (const value of [license.hint, license.active ? 'Active' : 'Inactive/expired',
        license.expiresAt ? new Date(license.expiresAt).toLocaleString() : '—']) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      row.children[1].className = license.active ? 'active' : 'inactive';
      rows.append(row);
    }
  }
  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: document.getElementById('password').value })
      });
      csrfToken = result.csrfToken;
      setLoggedIn(true);
      showMessage('Login ho gaya.');
      await loadLicenses();
    } catch (error) { showMessage(error.message); }
  });
  document.getElementById('activateButton').addEventListener('click', async () => {
    try {
      const result = await api('/api/admin/licenses/activate', {
        method: 'POST',
        body: JSON.stringify({
          serial: document.getElementById('serial').value,
          days: document.getElementById('days').value
        })
      });
      const output = document.getElementById('serialOutput');
      output.hidden = !result.generated;
      if (result.generated) document.getElementById('newSerial').textContent = result.serial;
      document.getElementById('serial').value = '';
      showMessage(result.generated ? 'Naya serial activate ho gaya.' : 'Serial activate/extend ho gaya.');
      await loadLicenses();
    } catch (error) { showMessage(error.message); }
  });
  document.getElementById('deactivateButton').addEventListener('click', async () => {
    try {
      await api('/api/admin/licenses/deactivate', {
        method: 'POST',
        body: JSON.stringify({ serial: document.getElementById('deactivateSerial').value })
      });
      document.getElementById('deactivateSerial').value = '';
      showMessage('Serial deactivate kar diya gaya.');
      await loadLicenses();
    } catch (error) { showMessage(error.message); }
  });
  document.getElementById('refreshButton').addEventListener('click', async () => {
    try { await loadLicenses(); showMessage('List update ho gayi.'); }
    catch (error) { showMessage(error.message); }
  });
  document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', { method: 'POST', body: '{}' });
      csrfToken = '';
      setLoggedIn(false);
      showMessage('Logout ho gaya.');
    } catch (error) { showMessage(error.message); }
  });
  (async () => {
    try {
      await api('/api/admin/licenses');
      const result = await api('/api/admin/csrf');
      csrfToken = result.csrfToken;
      setLoggedIn(true);
      await loadLicenses();
    } catch (error) {
      setLoggedIn(false);
      if (error.message !== 'Admin login required.') showMessage(error.message);
    }
  })();
</script>
</body>
</html>`;
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/') {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(panelPage());
    return;
  }

  if (request.method === 'POST' && pathname === '/api/license/check') {
    const body = await readBody(request);
    const serial = normalizeSerial(body.serial);
    const license = licenses.find((item) => item.serialHash === serialHash(serial));
    const active = Boolean(license && license.active && license.expiresAt > Date.now());
    sendJson(response, 200, {
      active,
      expiresAt: license ? license.expiresAt : null,
      reason: active ? null : license && license.expiresAt <= Date.now() ? 'expired' : 'inactive_or_unknown',
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/admin/login') {
    const ip = request.socket.remoteAddress || 'unknown';
    const failure = loginFailures.get(ip);
    if (failure && failure.lockedUntil > Date.now()) {
      throw new HttpError(429, 'Too many failed logins. Try again later.');
    }
    const body = await readBody(request);
    if (typeof body.password !== 'string' || !safeEqual(body.password, ADMIN_PASSWORD)) {
      const current = failure && failure.windowStartedAt > Date.now() - 15 * 60 * 1000
        ? failure
        : { count: 0, windowStartedAt: Date.now(), lockedUntil: 0 };
      current.count += 1;
      if (current.count >= 8) current.lockedUntil = Date.now() + 15 * 60 * 1000;
      loginFailures.set(ip, current);
      throw new HttpError(401, 'Password ghalat hai.');
    }
    loginFailures.delete(ip);
    const id = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    sessions.set(id, { csrfToken, expiresAt: Date.now() + SESSION_TTL_MS });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    sendJson(response, 200, { csrfToken }, {
      'Set-Cookie': `ma_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`,
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/admin/csrf') {
    const session = requireAdmin(request);
    sendJson(response, 200, { csrfToken: session.csrfToken });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/admin/licenses') {
    requireAdmin(request);
    sendJson(response, 200, { licenses: adminLicenseList() });
    return;
  }

  if (request.method === 'POST' && pathname.startsWith('/api/admin/')) {
    const session = requireAdmin(request);
    requireCsrf(request, session);

    if (pathname === '/api/admin/logout') {
      sessions.delete(session.id);
      sendJson(response, 200, { ok: true }, {
        'Set-Cookie': 'ma_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      });
      return;
    }

    const body = await readBody(request);
    if (pathname === '/api/admin/licenses/activate') {
      const days = validateDays(body.days);
      const generated = typeof body.serial !== 'string' || body.serial.trim() === '';
      const serial = generated
        ? `MA-${crypto.randomBytes(24).toString('hex').toUpperCase()}`
        : normalizeSerial(body.serial);
      const hash = serialHash(serial);
      const existing = licenses.find((item) => item.serialHash === hash);
      const now = Date.now();
      const baseTime = existing && existing.active && existing.expiresAt > now
        ? existing.expiresAt
        : now;
      const updated = {
        serialHash: hash,
        hint: `...${serial.slice(-6)}`,
        createdAt: existing ? existing.createdAt : now,
        expiresAt: baseTime + days * 24 * 60 * 60 * 1000,
        active: true,
      };
      if (existing) Object.assign(existing, updated);
      else licenses.push(updated);
      saveLicenses();
      sendJson(response, 200, { ok: true, generated, ...(generated ? { serial } : {}) });
      return;
    }

    if (pathname === '/api/admin/licenses/deactivate') {
      const serial = normalizeSerial(body.serial);
      const license = licenses.find((item) => item.serialHash === serialHash(serial));
      if (!license) throw new HttpError(404, 'Serial not found.');
      license.active = false;
      saveLicenses();
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  throw new HttpError(404, 'Not found.');
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent || response.destroyed) return;
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error('Request failed:', error);
    sendJson(response, 500, { error: 'Internal server error.' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mafia Anonymous panel listening on port ${PORT}`);
  console.log(`License data file: ${DATA_FILE}`);
});
