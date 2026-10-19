# Mafia Anonymous — Module Control Panel

A secure, browser-based admin dashboard for registering modules, enabling them for a chosen number of days, deactivating them, and reviewing a persistent event history.

## Browser-only setup — no terminal or root access

You do **not** need to install Node.js on your computer, open PowerShell, use a terminal, root a phone, or change the Android module files. Publish this project to GitHub and deploy it using Coolify's web dashboard; after deployment, sign in and manage it in your web browser.

### 1. Upload this panel folder to GitHub

1. Sign in to GitHub in your browser and create a **private** repository, for example `mafia-anonymous-panel`.
2. Open this project's `mafia-anonymous-panel` folder in File Explorer. Upload the contents of this folder to your new repository using GitHub's **Add file → Upload files** page. Keep `public` as a folder so the `index.html`, `styles.css`, and `app.js` paths stay together.
3. Include `Dockerfile`, `package.json`, `package-lock.json`, `server.js`, and `public`. You may also include `.gitignore`, `.dockerignore`, `.env.example`, and this `README.md`.
4. Do **not** upload `.env`, any password, a session secret, `node_modules`, or a database file. The `.gitignore` file excludes local secrets and data.
5. Commit the uploaded files using GitHub's web page.

### 2. Deploy from the Coolify website

1. Sign in to your Coolify web dashboard and create a new application from your GitHub repository. Authorize GitHub access if Coolify asks.
2. Select the `mafia-anonymous-panel` repository and its branch. Choose the **Dockerfile** build pack; the included Dockerfile installs the application dependencies for you.
3. In the application's settings, set the exposed/application port to **3000**.
4. In **Environment Variables**, add the following values directly in Coolify:
   - `NODE_ENV` — `production`
   - `PORT` — `3000`
   - `ADMIN_USERNAME` — your chosen admin name, for example `Admin anonymous`
   - `ADMIN_PASSWORD` — a new, unique password with at least 12 characters. Do **not** reuse the password previously shared in chat.
   - `SESSION_SECRET` — a newly generated random secret of at least 32 characters. Use the password manager's password/secret generator; keep the secret private.
   - `DB_PATH` — `/app/data/panel.sqlite`
5. In Coolify's persistent storage settings, add a volume mounted at **`/app/data`**. Without it, records may disappear if the application container is replaced.
6. Add your domain in Coolify, enable its automatic HTTPS certificate, and deploy.
7. Open `https://your-domain/api/health` in a browser. If deployment succeeded, the page shows `{"status":"ok"}`. Then open `https://your-domain` and sign in with the username and password you set in Coolify.

All of these setup actions are in GitHub/Coolify's web pages. You are not connecting to your phone as root. The included Dockerfile runs the server as an unprivileged `node` user. Save the credentials in a password manager; **never** add them to GitHub files or send them in chat. Sign out when finished; sessions are also revoked on leaving the page and expire after eight hours.

### 3. Keep your module data

Module records and event history are stored in SQLite on the Coolify volume at `/app/data/panel.sqlite`. Keep that volume when redeploying, arrange regular backups through your server/Coolify backup options, and test restoring a backup before relying on it.

## Connect a module, app, or GPS service

The panel now keeps a separate license for each module/serial-number pair. In **Serial access**, register a serial without activating it, activate it for 1–3650 days, add time to an active license, pause it, resume it, or deactivate it. Pausing freezes the remaining access time; the expiry moves forward by the duration of the pause when resumed. All serial changes and status transitions are included in the persistent activity history.

To enforce access, the app or service that protects the module must call the panel's server-side check endpoint when it starts or performs a protected action:

```http
POST /api/access/check
Content-Type: application/json

{ "moduleKey": "core-access", "serialNumber": "CUSTOMER-SERIAL-001" }
```

An active license returns `{ "allowed": true, "status": "active", "expiresAt": "..." }`. An inactive, paused, expired, or unknown serial returns `allowed: false`. Requests are rate-limited. Call this endpoint from a trusted app backend/service where possible; do not put the admin password or session secret in a mobile app. A panel entry alone cannot change an already-installed app's interface or enforce licensing: that app must be wired to check the endpoint and hide/disable the protected functionality when access is denied. No phone rooting is required.

Future modules use the same integration contract: register the module once in the panel, use its unique module ID as `moduleKey`, then have its backend submit the installed serial to `/api/access/check`. Admin-only serial management and license-list endpoints require the signed panel session; the check endpoint returns only the access result and expiry.

## Use the panel

1. Select **Add module**, and enter a display name and unique module ID.
2. Open **Serial access** on the module, enter a device serial number, then choose **Register inactive** or **Activate / add days**.
3. Activation duration is a whole number of days from 1–3650. Adding days to an active serial extends its expiry.
4. Use **Pause**, **Resume**, or **Deactivate** beside a serial to manage its access.
5. The activity history records module and serial creation, activation/renewal, pause/resume, deactivation, and expiry. Select **Load older events** to page through the complete history.

Activation expiry is checked when the panel reads or changes module data. It does not require a continuously running background scheduler.

## API outline

All management endpoints require the signed admin session cookie and same-origin requests:

- `POST /api/login`, `POST /api/logout`, `GET /api/session`
- `GET /api/modules`, `POST /api/modules`
- `POST /api/modules/:id/activate` with `{ "days": 30 }`
- `POST /api/modules/:id/deactivate`
- `GET /api/modules/:id/licenses`
- `POST /api/modules/:id/licenses` with `{ "serialNumber": "CUSTOMER-SERIAL-001" }` (register inactive)
- `POST /api/modules/:id/licenses/activate` with `{ "serialNumber": "CUSTOMER-SERIAL-001", "days": 30 }`
- `POST /api/modules/:id/licenses/:licenseId/pause`, `/resume`, or `/deactivate`
- `POST /api/access/check` with `{ "moduleKey": "core-access", "serialNumber": "CUSTOMER-SERIAL-001" }` (public, rate-limited access check)
- `GET /api/history?limit=50&offset=0`
- `GET /api/health` (public health check)

The database and API keep the full module and serial-license event history; the dashboard loads it in pages of 50. Module-wide activation endpoints remain available for existing integrations; serial-license status is managed independently through the license endpoints.
