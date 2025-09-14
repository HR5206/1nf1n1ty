// SastraDaily — PocketBase Edition (Auth + Collections + Realtime)
// Run PocketBase at http://127.0.0.1:8090 and switch index.html to this file.

import PocketBase from 'https://unpkg.com/pocketbase@0.21.3/dist/pocketbase.es.mjs';

const pb = new PocketBase('http://127.0.0.1:8090');

// Helpers
const $ = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));
function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]||c)); }
function toDate(x){ try{ return x? new Date(x): new Date(); }catch{ return new Date(); } }
function sanitizeUsername(s){
  const v = (s||'').toLowerCase().replace(/[^a-z0-9_.-]/g,'').replace(/^[_.-]+|[_.-]+$/g,'');
  return v.slice(0, 30);
}
function randomSuffix(n=4){ return Math.random().toString(36).slice(2, 2+n); }
async function generateUsernameFromEmail(email){
  const local = (email||'user').split('@')[0]||'user';
  const base = sanitizeUsername(local) || `user-${randomSuffix()}`;
  let candidate = base;
  try{
    const exists = await pb.collection('users').getFullList({ filter: `username="${candidate}"`, limit: 1 });
    if(exists.length) candidate = `${base}-${randomSuffix()}`;
  }catch{}
  return candidate;
}
async function makeAvatarFromEmail(email){
  try{
    const letter = (email||'?').trim().charAt(0).toUpperCase() || '?';
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=120;
    const ctx = canvas.getContext('2d');
    let h=0; for(const ch of email){ h = (h*31 + ch.charCodeAt(0))>>>0; }
    const hue = h % 360; ctx.fillStyle = `hsl(${hue},65%,55%)`;
    ctx.fillRect(0,0,120,120);
    ctx.fillStyle='#fff'; ctx.font='700 64px Inter, Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(letter, 60, 68);
    return canvas.toDataURL('image/png');
  }catch{ return 'https://placehold.co/120x120?text=?'; }
}

// Router
const routes = {
  '/': ()=> show('route-feed'),
  '/auth': ()=> show('route-auth'),
  '/profile': ()=> show('route-profile'),
  '/chat': ()=> { show('route-chat'); subscribeUsers(); subscribeChat(); },
};
function show(id){ $$('.route').forEach(e=>e.classList.add('hidden')); const el=document.getElementById(id); if(el) el.classList.remove('hidden'); }
function navigate(path){ history.pushState({},'',path); (routes[path]||routes['/'])(); }
window.addEventListener('popstate', ()=> (routes[location.pathname]||routes['/'])());
$('.nav')?.addEventListener('click', e=>{ const b=e.target.closest('[data-route]'); if(b) navigate(b.dataset.route); });

// Theme toggle
const THEME_KEY = 'sd_theme';
function applyTheme(mode){ document.documentElement.classList.toggle('dark', mode==='dark'); }
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved=== 'dark' || saved=== 'light') applyTheme(saved);
  else if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
}
initTheme();
$('#themeToggle')?.addEventListener('click', ()=>{
  const isDark = !document.documentElement.classList.contains('dark');
  applyTheme(isDark?'dark':'light');
  localStorage.setItem(THEME_KEY, isDark?'dark':'light');
});

// Auth shortcuts
let me = null; // { id, email, bio?, avatar? }
function isAuthed(){ return !!pb.authStore.model; }
function ensureAuth(){ if(!isAuthed()) navigate('/auth'); return isAuthed(); }

// Auth UI
$('#authLogin')?.addEventListener('click', async ()=>{
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPassword').value;
  const err = $('#authPageError'); err.hidden=true;
  try{
    await pb.collection('users').authWithPassword(email, password);
  }catch(ex){ err.textContent = ex?.message||'Login failed'; err.hidden=false; }
});
$('#authSignup')?.addEventListener('click', async ()=>{
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPassword').value;
  const rawUsername = $('#authUsername')?.value || '';
  let username = sanitizeUsername(rawUsername.trim());
  const err = $('#authPageError'); err.hidden=true;
  try{
    const base = { email, password, passwordConfirm: password, bio: "Hey there! I'm using SastraDaily." };
    if(username) base.username = username; // persist only if user provided one
    const rec = await pb.collection('users').create(base);
    // Authenticate first (required for Update rule @request.auth.id = id)
    await pb.collection('users').authWithPassword(email, password);
    // Create avatar image from letter and upload (now authenticated)
    try{
      const dataUrl = await makeAvatarFromEmail(email);
      const blob = await (await fetch(dataUrl)).blob();
      await pb.collection('users').update(rec.id, { avatar: blob });
    }catch{}
    // Ensure username persisted exactly as typed (in case of schema/race)
    if(username){
      try{
        const fresh = await pb.collection('users').getOne(rec.id);
        const desired = sanitizeUsername(rawUsername.trim());
        if(fresh && desired && fresh.username !== desired){
          await pb.collection('users').update(rec.id, { username: desired });
        }
      }catch{}
    }
  }catch(ex){ err.textContent = ex?.message||'Signup failed'; err.hidden=false; }
});
$('#authPageForm')?.addEventListener('submit', e=>{ e.preventDefault(); $('#authLogin')?.click(); });
$('#loginBtn')?.addEventListener('click', ()=> navigate('/auth'));
$('#logoutBtn')?.addEventListener('click', ()=> pb.authStore.clear());

pb.authStore.onChange(async (token, model)=>{
  if(!model){
    me=null;
    $('#logoutBtn').hidden=true; $('#loginBtn').hidden=false;
    cleanupSubscriptions();
    navigate('/auth');
    return;
  }
  me = model; // PocketBase auth model contains email and id
  $('#logoutBtn').hidden=false; $('#loginBtn').hidden=true;
  $('#profileEmail').textContent = me.email;
  await renderProfile();
  subscribeFeed();
  subscribeUsers();
  if(location.pathname==='/auth') navigate('/');
});

// Subscriptions state
let unsubPosts=null; const unsubLikes=new Map(); const unsubComments=new Map(); let unsubUsers=null; let unsubChat=null; let currentPeer=null;
function cleanupSubscriptions(){
  if(unsubPosts){ try{unsubPosts()}catch{} unsubPosts=null; }
  for(const [,u] of unsubLikes){ try{u()}catch{} } unsubLikes.clear();
  for(const [,u] of unsubComments){ try{u()}catch{} } unsubComments.clear();
  if(unsubUsers){ try{unsubUsers()}catch{} unsubUsers=null; }
  if(unsubChat){ try{unsubChat()}catch{} unsubChat=null; }
}

// Files
async function compressImage(file, maxW=1280, quality=0.85){
  if(!file || !file.type?.startsWith('image/')) return null;
  const img = new Image(); const url = URL.createObjectURL(file);
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; }); URL.revokeObjectURL(url);
  const scale = Math.min(1, maxW/img.width); const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
  const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const blob = await new Promise(res=> canvas.toBlob(res,'image/jpeg',quality));
  return blob;
}

// Feed
const FEED_PAGE=12;
function displayName(user){
  const uname = (user?.username||'').trim();
  if(uname) return uname;
  // Avoid relying on email visibility for others; build a friendly default
  const id = (user?.id||'').toString();
  if(id) return `User-${id.slice(-4)}`;
  return 'User';
}
function postHTML(p, avatarUrl){
  const when = toDate(p.created).toLocaleString();
  const imageUrl = p.image ? pb.files.getUrl(p, p.image) : '';
  return `
    <header class="row">
      <img class="avatar" src="${avatarUrl}" alt="avatar"/>
      <div><div><strong>${displayName(p.expand?.user)||''}</strong></div><div class="muted">${when}</div></div>
    </header>
    <div class="media" data-media="${p.id}">${imageUrl?`<img loading="lazy" src="${imageUrl}" alt="post media"/>`:''}<div class="dbl-heart" id="h_${p.id}">❤</div></div>
    <div class="actions">
      <button class="btn" data-like="${p.id}">❤ Like</button>
      <button class="btn" data-comment-focus="${p.id}">💬 Comment</button>
    </div>
    <div class="likes" data-likes="${p.id}" data-open-likes="${p.id}"></div>
  <div class="caption"><strong>${displayName(p.expand?.user)||''}</strong> ${escapeHTML(p.caption||'')}</div>
    <ul class="comments" id="c_${p.id}"></ul>
    <div class="comment-input"><input data-cin="${p.id}" type="text" placeholder="Add a comment..." maxlength="200"/><button class="btn" data-csend="${p.id}">Post</button></div>
  `;
}

async function buildPostElement(p){
  const li = document.createElement('li'); li.className='post'; li.dataset.id=p.id;
  const author = p.expand?.user;
  let avatarUrl = 'https://placehold.co/64x64';
  if(author?.avatar){ avatarUrl = pb.files.getUrl(author, author.avatar, { thumb: '64x64' }); }
  li.innerHTML = postHTML(p, avatarUrl);
  return li;
}

function subscribeFeed(){
  const list = $('#feedList'); if(!list) return;
  if(unsubPosts){ try{unsubPosts()}catch{} unsubPosts=null; }
  // Initial render
  loadAndRenderFeed();
  // Re-render on any posts changes
  unsubPosts = pb.collection('posts').subscribe('*', ()=>{
    loadAndRenderFeed();
  });
}

async function loadAndRenderFeed(){
  const list = $('#feedList'); if(!list) return;
  for(const [,u] of unsubLikes){ try{u()}catch{} } unsubLikes.clear();
  for(const [,u] of unsubComments){ try{u()}catch{} } unsubComments.clear();
  list.innerHTML='';
  const page = await pb.collection('posts').getList(1, FEED_PAGE, { sort: '-created', expand: 'user' });
  for(const p of page.items){
    const li = await buildPostElement(p);
    list.appendChild(li);
    subscribeLikes(p.id);
    subscribeComments(p.id, 2);
  }
}

function subscribeLikes(postId){
  if(unsubLikes.has(postId)){ try{unsubLikes.get(postId)()}catch{} }
  const handler = async ()=>{
    const list = await pb.collection('likes').getFullList({ filter: `post="${postId}"` });
    const liked = !!(me && list.some(l=> l.user === me.id));
    const likeBtn = document.querySelector(`[data-like="${postId}"]`);
    const likesDiv = document.querySelector(`[data-likes="${postId}"]`);
    if(likeBtn){ likeBtn.textContent = liked? '💙 Liked' : '❤ Like'; }
    if(likesDiv){ const n=list.length; likesDiv.textContent = n? `${n} ${n===1?'like':'likes'}` : ''; }
  };
  // Initial render
  handler();
  // Realtime updates filtered by post
  unsubLikes.set(postId, pb.collection('likes').subscribe('*', handler, { filter: `post="${postId}"` }));
}

function subscribeComments(postId, firstN=null){
  if(unsubComments.has(postId)){ try{unsubComments.get(postId)()}catch{} }
  const handler = async ()=>{
    const list = await pb.collection('comments').getFullList({
      filter: `post="${postId}"`,
      sort: '+created',
      expand: 'user',
    });
    const items = firstN? list.slice(0, firstN) : list;
    const ul = document.getElementById(`c_${postId}`); if(!ul) return;
  let html = items.map(c=> `<li><strong>${displayName(c.expand?.user)||''}</strong> ${escapeHTML(c.text||'')}</li>`).join('');
    if(firstN && list.length>items.length){ html += `<li><button class="btn" data-viewall="${postId}">View all ${list.length} comments</button></li>`; }
    ul.innerHTML = html;
  };
  handler();
  unsubComments.set(postId, pb.collection('comments').subscribe('*', handler, { filter: `post="${postId}"` }));
}

// Like toggle
async function toggleLike(postId){
  if(!ensureAuth()) return;
  const existing = await pb.collection('likes').getFullList({ filter: `post="${postId}" && user="${me.id}"`, limit: 1 });
  if(existing.length){ await pb.collection('likes').delete(existing[0].id); }
  else{ await pb.collection('likes').create({ post: postId, user: me.id }); }
}

// Uploader
const postImage = $('#postImage');
const browseImage = $('#browseImage');
const previewImage = $('#previewImage');
const captionEl = $('#postCaption');
const captionCount = $('#captionCount');
const postSubmit = $('#postSubmit');

browseImage?.addEventListener('click', ()=> postImage.click());
postImage?.addEventListener('change', ()=>{ const f=postImage.files?.[0]; if(f){ const url=URL.createObjectURL(f); previewImage.src=url; previewImage.classList.remove('hidden'); }});
captionEl?.addEventListener('input', ()=> captionCount.textContent = String(captionEl.value.length));
postSubmit?.addEventListener('click', async ()=>{
  if(!ensureAuth()) return;
  const f = postImage.files?.[0]; const caption = captionEl.value.trim();
  const data={ user: me.id, caption };
  let fileToSend = null;
  if(f){ const blob = await compressImage(f, 1280, 0.85); fileToSend = blob; }
  const rec = await pb.collection('posts').create(data);
  if(fileToSend){ await pb.collection('posts').update(rec.id, { image: fileToSend }); }
  postImage.value=''; captionEl.value=''; captionCount.textContent='0'; previewImage.classList.add('hidden');
});

// Profile
$('#changeAvatar')?.addEventListener('click', ()=> $('#avatarInput').click());
$('#saveProfile')?.addEventListener('click', async ()=>{
  if(!ensureAuth()) return;
  const bio = $('#bioInput').value.trim();
  const username = sanitizeUsername($('#usernameInput')?.value.trim());
  const f = $('#avatarInput').files?.[0];
  const data = { bio: bio || "Hey there! I'm using SastraDaily." };
  if(username) data.username = username;
  if(f){ const blob = await compressImage(f, 512, 0.9); data.avatar = blob; }
  await pb.collection('users').update(me.id, data);
  me = await pb.collection('users').getOne(me.id); // refresh
  await renderProfile();
  // Refresh chat users immediately so updated username appears in the sidebar
  subscribeUsers();
});

async function renderProfile(){
  if(!isAuthed()) return;
  me = await pb.collection('users').getOne(me.id);
  $('#profileEmail').textContent = me.email;
  $('#profileBio').textContent = me.bio || "Hey there! I'm using SastraDaily.";
  const usernameInput = $('#usernameInput'); if(usernameInput) usernameInput.value = me.username || '';
  const img = $('#profileAvatar');
  img.src = me.avatar ? pb.files.getUrl(me, me.avatar) : await makeAvatarFromEmail(me.email);
  // my posts
  const posts = await pb.collection('posts').getFullList({ filter: `user="${me.id}"`, sort: '-created' });
  const grid = $('#profileGrid');
  grid.innerHTML = posts.map(p=>{
    const url = p.image? pb.files.getUrl(p, p.image, { thumb: '640x640' }): '';
    return `<div class="grid-item" data-pid="${p.id}" style="position:relative"><img loading="lazy" src="${url}" alt="post"/><button class="btn" data-delete-post="${p.id}" style="position:absolute;top:6px;right:6px;">Delete</button></div>`;
  }).join('');
  $('#statPosts').textContent = String(posts.length);
}

// Delete post
$('#app')?.addEventListener('click', async (e)=>{
  const del = e.target.closest('[data-delete-post]');
  if(del){
    const pid = del.getAttribute('data-delete-post');
    // delete comments & likes first
    const cs = await pb.collection('comments').getFullList({ filter: `post="${pid}"` });
    await Promise.all(cs.map(c=> pb.collection('comments').delete(c.id)));
    const ls = await pb.collection('likes').getFullList({ filter: `post="${pid}"` });
    await Promise.all(ls.map(l=> pb.collection('likes').delete(l.id)));
    await pb.collection('posts').delete(pid);
    await renderProfile();
    return;
  }
});

// Comments, Likes, View-all, Likes modal, Double-tap
$('#app')?.addEventListener('click', async (e)=>{
  // comment
  const cbtn = e.target.closest('[data-csend]');
  if(cbtn){
    if(!ensureAuth()) return;
    const pid = cbtn.getAttribute('data-csend');
    const input = document.querySelector(`[data-cin="${pid}"]`);
    const text = input.value.trim(); if(!text) return;
    await pb.collection('comments').create({ post: pid, user: me.id, text });
    input.value=''; return;
  }
  // like toggle
  const likeBtn = e.target.closest('[data-like]');
  if(likeBtn){ const pid = likeBtn.getAttribute('data-like'); await toggleLike(pid); return; }
  // focus comment
  const focusBtn = e.target.closest('[data-comment-focus]');
  if(focusBtn){ const pid = focusBtn.getAttribute('data-comment-focus'); document.querySelector(`[data-cin="${pid}"]`)?.focus(); return; }
  // view all comments
  const va = e.target.closest('[data-viewall]');
  if(va){ const pid = va.getAttribute('data-viewall'); subscribeComments(pid, null); return; }
  // likes modal
  const openLikes = e.target.closest('[data-open-likes]');
  if(openLikes){
    const pid = openLikes.getAttribute('data-open-likes');
    const likes = await pb.collection('likes').getFullList({ filter: `post="${pid}"`, expand: 'user' });
    const ul = $('#likesList');
    ul.innerHTML = likes.length? likes.map(l=>{
      const u = l.expand?.user; const av = u?.avatar? pb.files.getUrl(u, u.avatar, { thumb:'32x32' }): 'https://placehold.co/32x32';
      const name = displayName(u);
      return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${av}" alt=""/><span>${name}</span></li>`;
    }).join('') : '<li class="muted">No likes yet</li>';
    $('#likesModal').showModal(); return;
  }
});
$('#closeLikes')?.addEventListener('click', ()=> $('#likesModal').close());

// double-tap like
let lastTap=0;
$('#app')?.addEventListener('click', async (e)=>{
  const media = e.target.closest('[data-media]'); if(!media) return;
  const now = Date.now();
  if(now - lastTap < 300){
    const pid = media.getAttribute('data-media');
    // ensure liked
    const existing = me? await pb.collection('likes').getFullList({ filter: `post="${pid}" && user="${me.id}"`, limit: 1 }) : [];
    if(me && !existing.length){ await pb.collection('likes').create({ post: pid, user: me.id }); const heart = document.getElementById(`h_${pid}`); if(heart){ heart.classList.add('show'); setTimeout(()=>heart.classList.remove('show'), 600); } }
  }
  lastTap = now;
}, true);

// Chat
const friendsList = $('#friendsList');
const chatHeader = $('#chatHeader');
const chatList = $('#chatList');
const chatInput = $('#chatInput');
const chatForm = $('#chatForm');
$('#newChat')?.addEventListener('click', ()=> navigate('/chat'));

function roomId(a, b){ const arr=[a,b].sort(); return `dm:${arr[0]}::${arr[1]}`; }

function subscribeUsers(){
  if(unsubUsers){ try{unsubUsers()}catch{} unsubUsers=null; }
  const render = async ()=>{
    if(!isAuthed()) { friendsList.innerHTML=''; return; }
    const users = await pb.collection('users').getFullList();
    const others = users.filter(u=> u.id !== me.id);
    friendsList.innerHTML = others.map(u=>{
      const av = u.avatar? pb.files.getUrl(u, u.avatar, { thumb: '48x48' }): 'https://placehold.co/48x48';
      const name = displayName(u);
      return `<li class="friend" data-id="${u.id}" data-email="${u.email||''}" data-username="${u.username||''}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name}</span></div></li>`;
    }).join('');
  };
  // Render immediately so the list shows without waiting for an update event
  render();
  // Then subscribe to future changes
  unsubUsers = pb.collection('users').subscribe('*', render);
}

friendsList?.addEventListener('click', (e)=>{
  const li = e.target.closest('.friend'); if(!li) return;
  const chosenName = (li.dataset.username||'').trim();
  currentPeer = { id: li.dataset.id, email: li.dataset.email, username: chosenName };
  const headerName = chosenName || currentPeer.email || `User-${String(currentPeer.id||'').slice(-4)}`;
  chatHeader.textContent = headerName;
  subscribeChat();
  const input = document.getElementById('chatInput');
  const label = headerName;
  if(input){ input.placeholder = `Message ${label}...`; input.focus(); }
});

function subscribeChat(){
  if(unsubChat){ try{unsubChat()}catch{} unsubChat=null; }
  chatList.innerHTML=''; if(!isAuthed() || !currentPeer) return;
  const room = roomId(me.id, currentPeer.id);
  const filter = `room="${room}" && (sender="${me.id}" || receiver="${me.id}")`;
  const handler = async ()=>{
    const msgs = await pb.collection('messages').getFullList({ filter, sort: '+created' });
    chatList.innerHTML = msgs.map(m=> `<li class="message ${m.sender===me.id?'out':'in'}">${escapeHTML(m.text||'')}</li>`).join('');
    chatList.scrollTop = chatList.scrollHeight;
  };
  handler();
  // Only receive realtime events for messages in this room that involve me
  unsubChat = pb.collection('messages').subscribe('*', handler, { filter });
}

chatForm?.addEventListener('submit', async (e)=>{
  e.preventDefault(); if(!isAuthed()||!currentPeer) return;
  const text = chatInput.value.trim(); if(!text) return;
  if(currentPeer.id === me.id) return; // do not allow sending to self
  const room = roomId(me.id, currentPeer.id);
  await pb.collection('messages').create({ room, text, sender: me.id, receiver: currentPeer.id });
  chatInput.value='';
});

// Init
(routes[location.pathname]||routes['/'])();
