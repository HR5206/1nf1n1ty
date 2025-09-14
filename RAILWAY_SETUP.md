# Deploy PocketBase to Railway

This repo is ready to run PocketBase on Railway using Docker. Railway automatically builds the `Dockerfile` and runs your app, providing a public URL and an environment variable `PORT`.

## One‑time setup (UI flow)
1. Push this repo to GitHub (already done if you see commits).
2. Go to https://railway.app → New Project → Deploy from GitHub → select this repository.
3. Railway will build the Docker image and run it. No changes needed.
4. Once deployed, open the service → visit the URL shown by Railway, then append `/_/` to open the PocketBase Admin UI.

Example: `https://your-service.up.railway.app/_/`

## Persistent data (SQLite + uploads)
- This image stores data at `/data` inside the container.
- In Railway → your service → “Storage” tab → add a Volume and mount it at `/data`.
- This ensures your database and uploads survive restarts.

## CORS and frontend
- In PocketBase Admin → Settings → CORS, add your site origins (e.g. `http://localhost:5500`, `https://<your-pages>.github.io`, etc.).
- The frontend can discover PocketBase URL without code changes. Use one of:
  - Add a meta tag in your HTML head:
    ```html
    <meta name="pocketbase-url" content="https://your-service.up.railway.app">
    ```
  - Or set at runtime: `window.PB_URL = 'https://your-service.up.railway.app'` before your modules load.
  - Or in dev tools: `localStorage.setItem('PB_URL', 'https://your-service.up.railway.app')`.

## First‑time admin setup
- Visit `https://<your-service>.up.railway.app/_/` and create the admin.
- Create collections/rules per `POCKETBASE_SETUP.md` or import a snapshot if you have one.

## Optional: Railway CLI
If you prefer CLI, install Node.js, then install Railway CLI and deploy from local:

```powershell
npm i -g @railway/cli
railway login
railway init
railway up
```

But the GitHub → Railway UI flow is the easiest.
