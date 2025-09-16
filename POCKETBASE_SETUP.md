# Team 1nf1n1ty Social Media App — PocketBase (Free, self‑hosted) Setup

PocketBase gives you a zero-dependency backend (SQLite + REST/Realtime) that you can run locally or deploy for free. We’ll wire auth, posts, comments, likes, profile, and chat with realtime subscriptions.

## 1) Download & run PocketBase (Windows)
- Download latest Windows zip: https://pocketbase.io/docs/
- Extract it, e.g. to `C:\tools\pocketbase\`
- Run PocketBase server (PowerShell):
```powershell
cd C:\tools\pocketbase\
./pocketbase.exe serve
```
- Open Admin UI: http://127.0.0.1:8090/_/
- Create the admin account when prompted.

## 2) Create collections & fields
In the Admin UI → Collections → Create collection for each:

1) users (Auth collection)
- Type: Auth
- Fields:
  - bio (text, optional)
  - avatar (file, image, optional, max 1)
    - username (text, optional, unique suggested)

2) posts
- Fields:
  - user (relation → users, required)
  - caption (text)
  - image (file, image, optional, max 1)
  - created (autofilled created time — built-in)

3) comments
- Fields:
  - post (relation → posts, required)
  - user (relation → users, required)
  - text (text, required)
  - created (autofilled)

4) likes
- Fields:
  - post (relation → posts, required)
  - user (relation → users, required, unique with post)
  - created (autofilled)
  - Create a compound unique index on (post, user) via collection indexes: `CREATE UNIQUE INDEX likes_post_user ON likes (post, user);`

5) messages
- Fields:
  - room (text, required)
  - text (text, required)
  - sender (relation → users, required)
  - receiver (relation → users, required)
  - created (autofilled)

## 3) Access rules (development)
During dev, you can allow authenticated users to read/write appropriately.

Important:
- Enter rule expressions WITHOUT quotes or backticks. For example, type `true` as just: true
- If signup still fails, temporarily disable “Require email verification” in the users (Auth) collection options during development.

- users (auth):
  - List rule: `@request.auth.id != ""`
  - View rule: `@request.auth.id != ""`
  - Create rule: `true` (for signup) → In the UI, enter: true
  - Update rule: `@request.auth.id = id`
  - Optionally enforce unique usernames by adding an index in the users collection: `CREATE UNIQUE INDEX users_username_unique ON users (username);`

- posts:
  - List/View: `true`
  - Create: `@request.auth.id != ""`
  - Update/Delete: `@request.auth.id = user.id`

- comments:
  - List/View: `true`
  - Create: `@request.auth.id != ""`
  - Update/Delete: `@request.auth.id = user.id`

- likes:
  - List/View: `true`
  - Create/Delete: `@request.auth.id != ""`

- messages:
  - List/View: `@request.auth.id != ""` and `(sender.id = @request.auth.id) || (receiver.id = @request.auth.id)`
  - Create: same as above

Note: PocketBase rule language: https://pocketbase.io/docs/collections-rules/

## 4) Client SDK
You don’t need to add any extra script tag. This project already imports the ESM build inside `script.pocketbase.js`:
```js
import PocketBase from 'https://unpkg.com/pocketbase@0.22.21/dist/pocketbase.es.mjs';
```

Notes:
- Don’t load `pocketbase.umd.js` with `type="module"` — UMD is not an ES module and will fail.
- If you prefer the UMD global in another project, use:
  ```html
  <script src="https://unpkg.com/pocketbase@0.22.21/dist/pocketbase.umd.js"></script>
  ```
  and then: `const pb = new window.PocketBase('http://127.0.0.1:8090')`. This is NOT needed here.

## 5) Point Team 1nf1n1ty Social Media App to PocketBase
- Start PocketBase server on http://127.0.0.1:8090
- Create a few test users from the Admin UI (or sign up from the app)
- Switch `index.html` to use `script.pocketbase.js` (see below)

## 6) Deployment tips
- You can embed `pocketbase.exe` next to your static site and run it on a cheap/free VM; it’s a single binary with SQLite db.
- For public deployments, tighten the rules and enable file size/type limits.

If you want, I can pre-create a PocketBase migration (JSON) for import to speed this up.

---

# Containerize PocketBase (Docker)

This repo includes a `Dockerfile` that builds a tiny Alpine-based image which downloads and runs the PocketBase Linux binary. Data is stored under `/data` so you can mount a volume.

## Build (Windows PowerShell)

```powershell
docker build -t pocketbase-socflow:latest .
```

## Run locally with volume

```powershell
# Creates a local folder for persistent data (DB, uploads)
$DataPath = "${PWD}/pb_data"
if (!(Test-Path $DataPath)) { New-Item -ItemType Directory -Path $DataPath | Out-Null }

docker run --rm -it -p 8090:8080 -v "$DataPath:/data" pocketbase-socflow:latest
# Admin UI: http://localhost:8090/_/
```

Notes:
- The container listens on `0.0.0.0:8080` internally; we publish it as host port `8090`.
- All PocketBase data (SQLite DB and uploads) will be created under `pb_data` in your project directory.

## Fly.io (optional)

If you want a free/low-cost public URL, deploy this container to Fly.io:

```powershell
# Install flyctl (one-time)
iwr https://fly.io/install.ps1 -useb | iex
fly auth signup

# Initialize (creates fly.toml; choose a name when prompted)
fly launch --no-deploy

# Create a persistent volume (1GB example). Pick a region close to you, e.g. iad, fra, sin
fly volumes create pb_data --size 1 --region iad

# Edit fly.toml to mount the volume
# Add:
# [[mounts]]
#   source = "pb_data"
#   destination = "/data"

# Deploy
fly deploy

# Open Admin UI at the app URL printed after deploy, e.g.:
# https://<your-app>.fly.dev/_/
```

After deploying, set CORS allowed origins in the Admin UI → Settings → CORS (add your production site and `http://localhost:5173` for local dev). Then update your frontend to point to your hosted PocketBase URL in `js/shared.js`:

```js
// shared.js
export const pb = new PocketBase('https://your-app.fly.dev');
```
