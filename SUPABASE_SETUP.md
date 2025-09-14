# Supabase Setup (SocialFlow)

Follow these steps to provision the database schema, RLS policies, Storage bucket, and Realtime for this app.

## 1) Create a Supabase project
- Go to https://supabase.com/dashboard and create a new project.
- After it’s ready, open Project Settings → API and note:
  - Project URL (named `supabaseUrl`)
  - anon public key (named `anon`)

## 2) Apply the schema
- Open SQL Editor → New Query.
- Paste the contents of `supabase/schema.sql` and click `RUN`.
- Re-run is safe; it uses `if not exists` where possible.

Tables created:
- `profiles` (linked to `auth.users`)
- `posts`, `comments`, `likes`
- `messages` (DMs)
- RLS policies allow users to manage their own data and read others where appropriate.
- A public Storage bucket `images` is created with public-read and authenticated-write policies.

## 3) Enable Realtime on tables
The SQL already adds the tables to the `supabase_realtime` publication. If needed, verify in Realtime settings:
- Realtime → Database → ensure `public.profiles`, `public.posts`, `public.comments`, `public.likes`, `public.messages` are enabled.

## 4) Configure Auth email templates (optional)
- If you plan to use magic links or email confirmations, configure them under Authentication → Email Templates.
- This app uses email/password auth by default.

### Disable email confirmations (sign up without confirming)
If you want accounts to be created and usable immediately without email confirmation:
- Go to Authentication → Providers → Email
- Toggle "Confirm email" OFF
- Save changes

With confirmation disabled, Supabase will return a session on successful sign up. The app can then use that session directly without a second login.

## 5) Insert your project keys into the app
In each HTML page (`index.html`, `feed.html`, `profile.html`, `chat.html`) there are meta tags:

```html
<meta name="supabase-url" content="https://YOUR-PROJECT.supabase.co" />
<meta name="supabase-anon-key" content="YOUR-ANON-KEY" />
```

Replace with your actual values from Step 1. Alternatively, you can set them at runtime via `localStorage` keys `SUPABASE_URL` and `SUPABASE_ANON_KEY` for testing.

## 6) First-run flow
- Visit `index.html` (serve the folder with any static server).
- Sign up with email + password.
- The app will create your `profiles` row. You can then upload an avatar from Profile and post images in the Feed.

## 7) Notes
- Storage paths used:
  - Avatars: `avatars/<userId>.jpg`
  - Posts: `posts/<postId>.jpg`
- If you change bucket name, update `IMAGES_BUCKET` in `js/shared.js`.
- All RLS policies assume authenticated users; unauthenticated access is not supported in this app.

## 8) Troubleshooting
- 42501 (permission denied): Ensure you ran `schema.sql` and that RLS policies exist.
- Storage upload fails: Confirm the `images` bucket exists and you’re signed in; bucket is public-read and authenticated-write.
- Realtime not firing: Verify the tables are in the `supabase_realtime` publication and Realtime is enabled for the project.
- Profiles missing: After signup, reload the page to ensure session is established; profile upsert happens post-login.

---
If you want a single-click setup, paste `supabase/schema.sql` into SQL Editor and run once. That’s it.
