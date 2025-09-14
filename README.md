# SocialFlow (Vanilla JS + Supabase)

A fast, modern single-page social app inspired by Instagram. Built with vanilla HTML, CSS, and JavaScript, using Supabase for Auth, Database, Storage, and Realtime.

## Quick Start

1) Paste your Supabase credentials
- Open `script.js`
- Find the commented lines near the top:
```
// const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
// const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```
- Replace them with your actual values (uncomment them).

2) Serve the site locally
- Use any static server. Examples for Windows PowerShell:
```
# Python 3
python -m http.server 5173
# Node (if installed)
npx serve -l 5173
```
- Open http://localhost:5173

3) Deploy
- Host static files on Netlify, Vercel, or any static host. Just deploy the folder.

## Supabase Setup

1) Create a Supabase project and get your `Project URL` and `anon` key.

2) Database schema (SQL)
Run this SQL in Supabase SQL Editor:

```sql
-- Users profile table (1:1 with auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  avatar_url text,
  bio text,
  created_at timestamp with time zone default now()
);
-- Allow NULL emails (e.g., phone auth); enforce uniqueness only when email is present
create unique index if not exists users_email_unique on public.users(email) where email is not null;

-- Posts
create table if not exists public.posts (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  image_url text,
  caption text,
  created_at timestamp with time zone default now()
);
create index if not exists idx_posts_created on public.posts (created_at desc);
create index if not exists idx_posts_user on public.posts (user_id);

-- Comments
create table if not exists public.comments (
  id bigserial primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamp with time zone default now()
);
create index if not exists idx_comments_post on public.comments (post_id);

-- Messages (direct messages)
create table if not exists public.messages (
  id bigserial primary key,
  room text not null,
  sender text not null,
  receiver text not null,
  text text not null,
  created_at timestamp with time zone default now()
);
create index if not exists idx_messages_room on public.messages (room);

-- Row Level Security
alter table public.users enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.messages enable row level security;

-- Policies (drop-if-exists for idempotence)
-- Users can read profiles; users can update their own profile
drop policy if exists "Users are readable" on public.users;
create policy "Users are readable" on public.users for select using (true);
drop policy if exists "User can insert self" on public.users;
create policy "User can insert self" on public.users for insert with check (auth.uid() = id);
drop policy if exists "User can update self" on public.users;
create policy "User can update self" on public.users for update using (auth.uid() = id);

-- Posts readable by all; insert by logged in; delete/update only owner
drop policy if exists "Read posts" on public.posts;
create policy "Read posts" on public.posts for select using (true);
drop policy if exists "Insert posts" on public.posts;
create policy "Insert posts" on public.posts for insert with check (auth.uid() = user_id);
drop policy if exists "Update own posts" on public.posts;
create policy "Update own posts" on public.posts for update using (auth.uid() = user_id);
drop policy if exists "Delete own posts" on public.posts;
create policy "Delete own posts" on public.posts for delete using (auth.uid() = user_id);

-- Comments readable by all; insert by logged in
drop policy if exists "Read comments" on public.comments;
create policy "Read comments" on public.comments for select using (true);
drop policy if exists "Insert comments" on public.comments;
create policy "Insert comments" on public.comments for insert with check (auth.uid() = user_id);

-- Messages readable/insertable by participants only (using JWT email claim); null-safe
drop policy if exists "Read my messages" on public.messages;
create policy "Read my messages" on public.messages
  for select using ((auth.jwt() ->> 'email') is not null and (auth.jwt() ->> 'email') in (sender, receiver));
drop policy if exists "Insert my messages" on public.messages;
create policy "Insert my messages" on public.messages
  for insert with check ((auth.jwt() ->> 'email') is not null and (auth.jwt() ->> 'email') in (sender, receiver));

-- Trigger: Keep users row in sync with auth.users
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.users (id, email, avatar_url, bio)
  values (new.id, new.email, null, '')
  on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
```

3) Storage
- Buckets: `post-images` (public), `avatars` (public)
- Turn on public access and a CDN if available for speed.

4) Realtime
- Enable Realtime on tables: `comments`, `messages`.
- In the Supabase dashboard Realtime config, add INSERT events for these tables.

## Performance Tips
- Client-side image compression reduces upload time and bandwidth.
- Pagination is used for feed and comments; lazy-loading images.
- Realtime subscriptions are scoped to table and filtered per room for chat.
- Minimal CSS and no frameworks to keep initial load small.

## Where to paste keys
In `script.js` near the top, replace the commented placeholders for `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Search for `Paste your Supabase credentials`.

## Features
- Auth-first flow: dedicated login/signup page; redirects to feed after auth
- Feed: create posts (image + caption), reverse-chronological, infinite scroll
- Comments: realtime under each post
- Profile: avatar upload, bio, grid of your posts
- Modern uploader: drag-drop, preview, character counter, progress
- Chat: sidebar friends list from recent peers; realtime DMs by room, debounced input
- Theming: Light/Dark with localStorage

## Notes
- This is a vanilla SPA using History API routing. All data interactions occur via Supabase JS client.
- For production, serve with HTTP caching and gzip/brotli.
