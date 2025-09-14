# SastraDaily — PocketBase (Free, self‑hosted) Setup

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
import PocketBase from 'https://unpkg.com/pocketbase@0.21.3/dist/pocketbase.es.mjs';
```

Notes:
- Don’t load `pocketbase.umd.js` with `type="module"` — UMD is not an ES module and will fail.
- If you prefer the UMD global in another project, use:
  ```html
  <script src="https://unpkg.com/pocketbase@0.21.3/dist/pocketbase.umd.js"></script>
  ```
  and then: `const pb = new window.PocketBase('http://127.0.0.1:8090')`. This is NOT needed here.

## 5) Point SastraDaily to PocketBase
- Start PocketBase server on http://127.0.0.1:8090
- Create a few test users from the Admin UI (or sign up from the app)
- Switch `index.html` to use `script.pocketbase.js` (see below)

## 6) Deployment tips
- You can embed `pocketbase.exe` next to your static site and run it on a cheap/free VM; it’s a single binary with SQLite db.
- For public deployments, tighten the rules and enable file size/type limits.

If you want, I can pre-create a PocketBase migration (JSON) for import to speed this up.
