# Mafia Anonymous — Module Control Panel

A Node.js admin dashboard for registering modules, enabling them for a chosen number of days, deactivating them, and reviewing a persistent event history.

## Important: module connection

This starter manages module access **inside its own database**. The actual module/server integration is not connected yet because its API, authentication method, and module details have not been provided. The panel cannot change an external module until that integration is added. Share those details later (without sharing live passwords or tokens) to wire the activation actions to your server.

## Run locally

Requirements: Node.js 22 or newer and npm.

1. Open a terminal in this project folder.
2. Install dependencies:

   ```powershell
   npm.cmd install
   ```

3. Copy `.env.example` to `.env`. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Edit `.env` and set:
   - `ADMIN_USERNAME` to your chosen admin username (for example, `Admin anonymous`).
   - `ADMIN_PASSWORD` to a unique password of at least 12 characters.
   - `SESSION_SECRET` to a random secret of at least 32 characters. Generate one with:

     ```powershell
     node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
     ```

   The username and password shared in chat are not stored in the source. Because that password has been shared, choose a different, unique password before exposing the panel to the internet.
5. Start the panel:

   ```powershell
   npm.cmd start
   ```

6. Open `http://localhost:3000`. Use the admin credentials from `.env`. Use **Sign out** or close/navigate away from the panel to revoke the session; sessions also expire after eight hours.

The SQLite database is created at `data/panel.sqlite` by default. Keep the `data` folder safe and back it up regularly.

## Use the panel

1. Select **Add module**, and enter a display name and unique module ID.
2. Choose **Activate**, enter a whole number of days (1–3650), and confirm.
3. If you add days while a module is already active, those days extend its existing expiry.
4. Choose **Deactivate** to turn access off immediately.
5. The activity history records creation, each activation/renewal, manual deactivation, and expiry. Select **Load older events** to page through the complete history.

Activation expiry is checked when the panel reads or changes module data. It does not require a continuously running background scheduler.

## Deploy with GitHub and Coolify

1. Create a **new private GitHub repository** for this project, then upload the contents of this folder. Do not upload `.env`, database files, passwords, or tokens. `.gitignore` excludes local secrets and data.
2. In Coolify, create a new application from that GitHub repository and select **Dockerfile** as the build pack.
3. Set the application port to `3000`.
4. In the application's environment settings, add:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `ADMIN_USERNAME` — your admin username
   - `ADMIN_PASSWORD` — a unique, strong password (12+ characters; use a password manager)
   - `SESSION_SECRET` — a new random secret, generated with the command above
   - `DB_PATH=/app/data/panel.sqlite`
5. Add a persistent Coolify storage mount at **`/app/data`**. Without this mount, the SQLite database may be lost when the container is rebuilt or replaced.
6. Configure your domain and HTTPS in Coolify, deploy, then check `https://your-domain/api/health` returns `{"status":"ok"}` and sign in through the domain.
7. Keep the database volume and environment secrets backed up securely. Test restoring a database backup before relying on it.

Do not expose the service over plain HTTP in production. Coolify should terminate HTTPS, and `NODE_ENV=production` enables secure session cookies.

## API outline

All management endpoints require the signed admin session cookie and same-origin requests:

- `POST /api/login`, `POST /api/logout`, `GET /api/session`
- `GET /api/modules`, `POST /api/modules`
- `POST /api/modules/:id/activate` with `{ "days": 30 }`
- `POST /api/modules/:id/deactivate`
- `GET /api/history?limit=50&offset=0`
- `GET /api/health` (public health check)

The database and API keep the full event history; the dashboard loads it in pages of 50.
