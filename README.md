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

## Important: connecting your real module is a later step

The current panel manages module access **in its own database only**. It is not yet connected to your Android module or another app/server. When you are ready, provide the module's API shape and authentication requirements (do not send real tokens/passwords). The integration can be added within this **same project folder**: the server-side module actions/API are in `server.js`, and the browser interface is in `public/index.html` and `public/app.js`. We will change only the relevant integration files and update this guide; you do not need to root the device or modify unrelated module files just to use the panel.

## Use the panel

1. Select **Add module**, and enter a display name and unique module ID.
2. Choose **Activate**, enter a whole number of days (1–3650), and confirm.
3. If you add days while a module is already active, those days extend its existing expiry.
4. Choose **Deactivate** to turn access off immediately.
5. The activity history records creation, each activation/renewal, manual deactivation, and expiry. Select **Load older events** to page through the complete history.

Activation expiry is checked when the panel reads or changes module data. It does not require a continuously running background scheduler.

## API outline

All management endpoints require the signed admin session cookie and same-origin requests:

- `POST /api/login`, `POST /api/logout`, `GET /api/session`
- `GET /api/modules`, `POST /api/modules`
- `POST /api/modules/:id/activate` with `{ "days": 30 }`
- `POST /api/modules/:id/deactivate`
- `GET /api/history?limit=50&offset=0`
- `GET /api/health` (public health check)

The database and API keep the full event history; the dashboard loads it in pages of 50.
