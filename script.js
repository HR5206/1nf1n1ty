// SocialFlow (LocalStorage edition) - no backend required
// Features:
// - Signup/Login with email+password stored (hashed) in localStorage
// - Email is used as display name
// - Feed and profile stubbed locally (images optional)
// - Chat shows all users except current; messages sync instantly across tabs using BroadcastChannel + storage events

// Storage keys
const LS_KEYS = {
  users: 'sf_users',            // Array<User>
  session: 'sf_session',        // { email }
  messages: 'sf_messages',      // Array<Message>
  posts: 'sf_posts',            // Array<Post>
  likes: 'sf_likes',            // { [postId]: string[] }
  comments: 'sf_comments',      // Array<Comment>
};

// Types (for docs)
// User { email: string, pass: string(hash), avatar_url?: string, bio?: string, created_at: iso }
// Message { id: string, room: string, text: string, sender: string, receiver: string, created_at: iso }
// Post { id: string, image_url?: string, caption?: string, user: string(email), created_at: iso }

// Simple hash (not secure, just obfuscation for demo)
async function hash(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// Persist helpers
function readJSON(key, fallback){
  try{ return JSON.parse(localStorage.getItem(key)) ?? fallback; }catch{ return fallback; }
}
function writeJSON(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

// Broadcast for realtime updates across tabs
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('sf-bus') : null;
function broadcast(type, payload){
  if(bc){ bc.postMessage({ type, payload }); }
}

// DOM helpers
const $ = (sel, root=document)=> root.querySelector(sel);
const $$ = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

// Router
const routes = {
  '/': ()=> show('route-feed'),
  '/auth': ()=> show('route-auth'),
  '/profile': ()=> show('route-profile'),
  '/chat': ()=> { show('route-chat'); renderUsersList(); renderChat(); },
};
function show(id){ $$('.route').forEach(r=>r.classList.add('hidden')); const el = document.getElementById(id); if(el) el.classList.remove('hidden'); }
function navigate(path){ history.pushState({}, '', path); (routes[path]||routes['/'])(); }
window.addEventListener('popstate', ()=>{ (routes[location.pathname]||routes['/'])(); });
$('.nav').addEventListener('click', e=>{ const b=e.target.closest('[data-route]'); if(!b) return; navigate(b.getAttribute('data-route')); });

// Session
let me = null; // { email }
function getUsers(){ return readJSON(LS_KEYS.users, []); }
function setUsers(arr){ writeJSON(LS_KEYS.users, arr); }
function getMessages(){ return readJSON(LS_KEYS.messages, []); }
function setMessages(arr){ writeJSON(LS_KEYS.messages, arr); broadcast('messages:update', null); }
function getPosts(){ return readJSON(LS_KEYS.posts, []); }
function setPosts(arr){ writeJSON(LS_KEYS.posts, arr); broadcast('posts:update', null); }
function getLikes(){ return readJSON(LS_KEYS.likes, {}); }
function setLikes(obj){ writeJSON(LS_KEYS.likes, obj); broadcast('likes:update', null); }

function getRoom(a,b){ const [x,y] = [a,b].sort(); return `dm:${x}::${y}`; }

function loadSession(){ me = readJSON(LS_KEYS.session, null); }
function saveSession(sess){ writeJSON(LS_KEYS.session, sess); me = sess; }
function clearSession(){ localStorage.removeItem(LS_KEYS.session); me = null; }

// Auth page
document.getElementById('authLogin')?.addEventListener('click', login);
async function login(){
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const password = document.getElementById('authPassword').value;
  const users = getUsers();
  const u = users.find(x=>x.email===email);
  const errEl = document.getElementById('authPageError'); errEl.hidden = true;
  if(!u){ errEl.textContent='Account not found. Try Sign up.'; errEl.hidden=false; return; }
  const hp = await hash(password);
  if(u.pass !== hp){ errEl.textContent='Invalid password.'; errEl.hidden=false; return; }
  saveSession({ email });
  afterAuth();
}

document.getElementById('authSignup')?.addEventListener('click', signup);
async function signup(){
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authPageError'); errEl.hidden = true;
  if(!email || !password || password.length<6){ errEl.textContent='Enter valid email and 6+ char password.'; errEl.hidden=false; return; }
  const users = getUsers();
  if(users.some(x=>x.email===email)){ errEl.textContent='Email already registered.'; errEl.hidden=false; return; }
  const hp = await hash(password);
  const user = { email, pass: hp, created_at: new Date().toISOString(), bio: 'Hey there! I\'m using 1nf1n1ty Social Media App.', avatar_url: await makeAvatarFromEmail(email) };
  users.push(user); setUsers(users);
  saveSession({ email });
  afterAuth();
}

async function afterAuth(){
  // Update header buttons
  document.getElementById('logoutBtn').hidden = false;
  document.getElementById('loginBtn').hidden = true;
  document.getElementById('profileEmail').textContent = me.email;
  await renderProfile();
  renderFeed();
  navigate('/');
}

function getUser(email){ return getUsers().find(u=>u.email===email) || null; }

// Header actions
$('#loginBtn').addEventListener('click', ()=> navigate('/auth'));
$('#logoutBtn').addEventListener('click', ()=>{ clearSession(); document.getElementById('logoutBtn').hidden=true; document.getElementById('loginBtn').hidden=false; navigate('/auth'); });

// Theme toggle persists class
(function(){
  const key='sf-theme'; const saved = localStorage.getItem(key);
  if(saved==='dark') document.documentElement.classList.add('dark');
  $('#themeToggle').addEventListener('click', ()=>{ document.documentElement.classList.toggle('dark'); localStorage.setItem(key, document.documentElement.classList.contains('dark')?'dark':'light'); });
})();

// Feed (local)
function renderFeed(){
  const list = document.getElementById('feedList'); if(!list) return;
  const posts = getPosts().sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  list.innerHTML = posts.map(p=>{
  const u = getUser(p.user);
  const avatar = (u && u.avatar_url) ? u.avatar_url : 'https://placehold.co/64x64?text=' + encodeURIComponent((p.user||'?')[0]?.toUpperCase()||'?');
    const likes = getLikes();
    const arr = likes[p.id]||[]; const count = arr.length; const liked = me && arr.includes(me.email);
    return `<li class="post" data-id="${p.id}">
      <header class="row">
        <img class="avatar" src="${avatar}" alt="avatar"/>
        <div><div><strong>${p.user}</strong></div><div class="muted">${new Date(p.created_at).toLocaleString()}</div></div>
      </header>
  <div class="media" data-media="${p.id}">${p.image_url?`<img loading="lazy" src="${p.image_url}" alt="post media"/>`:''}<div class="dbl-heart" id="h_${p.id}">❤</div></div>
      <div class="actions">
        <button class="btn" data-like="${p.id}">${liked?'💙 Liked':'❤ Like'}</button>
        <button class="btn" data-comment-focus="${p.id}">💬 Comment</button>
      </div>
  <div class="likes" data-likes="${p.id}" data-open-likes="${p.id}">${count?`${count} ${count===1?'like':'likes'}`:''}</div>
      <div class="caption"><strong>${p.user}</strong> ${escape(p.caption||'')}</div>
  <ul class="comments" id="c_${p.id}"></ul>
      <div class="comment-input"><input data-cin="${p.id}" type="text" placeholder="Add a comment..." maxlength="200"/><button class="btn" data-csend="${p.id}">Post</button></div>
    </li>`;
  }).join('');
  document.getElementById('statPosts').textContent = String(posts.filter(x=>x.user===me?.email).length);
  // hydrate comments and likes from local (optional future: likes map)
  posts.forEach(p=> renderComments(p.id));
}

function renderComments(postId){
  const ul = document.getElementById(`c_${postId}`); if(!ul) return;
  const arr = getComments().filter(c=>c.postId===postId).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
  const max = 2;
  let html = '';
  if(arr.length>max){
    const first = arr.slice(0,max);
    html += first.map(c=>`<li><strong>${c.author}</strong> ${escape(c.text)}</li>`).join('');
    html += `<li><button class="btn" data-viewall="${postId}">View all ${arr.length} comments</button></li>`;
  } else {
    html = arr.map(c=>`<li><strong>${c.author}</strong> ${escape(c.text)}</li>`).join('');
  }
  ul.innerHTML = html;
}

// Post uploader (image optional, caption only allowed)
const postImage = document.getElementById('postImage');
const browseImage = document.getElementById('browseImage');
const previewImage = document.getElementById('previewImage');
const captionEl = document.getElementById('postCaption');
const captionCount = document.getElementById('captionCount');
const postSubmit = document.getElementById('postSubmit');

browseImage?.addEventListener('click', ()=> postImage.click());
postImage?.addEventListener('change', ()=>{ const f=postImage.files?.[0]; if(f){ const url=URL.createObjectURL(f); previewImage.src=url; previewImage.classList.remove('hidden'); }});
captionEl?.addEventListener('input', ()=> captionCount.textContent = String(captionEl.value.length));
postSubmit?.addEventListener('click', async ()=>{
  if(!me){ navigate('/auth'); return; }
  const caption = captionEl.value.trim();
  let image_url = null;
  const file = postImage.files?.[0];
  if(file){ image_url = await fileToDataURL(file); }
  if(!caption && !image_url) return;
  const posts = getPosts();
  posts.push({ id: crypto.randomUUID(), image_url, caption, user: me.email, created_at: new Date().toISOString() });
  setPosts(posts); // broadcasts posts:update
  // reset
  captionEl.value=''; captionCount.textContent='0'; previewImage.classList.add('hidden'); postImage.value='';
  renderFeed();
});

function fileToDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function escape(s){ return s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

// Profile
$('#changeAvatar').addEventListener('click', ()=> $('#avatarInput').click());
$('#saveProfile').addEventListener('click', async ()=>{
  if(!me){ navigate('/auth'); return; }
  const users = getUsers();
  const u = users.find(x=>x.email===me.email); if(!u) return;
  u.bio = document.getElementById('bioInput').value.trim();
  const file = document.getElementById('avatarInput').files?.[0];
  if(file){ u.avatar_url = await fileToDataURL(file); }
  setUsers(users);
  document.getElementById('profileBio').textContent = u.bio || '—';
  if(u.avatar_url) document.getElementById('profileAvatar').src = u.avatar_url;
  renderFeed(); await renderProfile();
});

async function renderProfile(){
  if(!me) return;
  const u = getUser(me.email); if(!u) return;
  document.getElementById('profileEmail').textContent = me.email;
  document.getElementById('profileBio').textContent = u.bio || "Hey there! I'm using 1nf1n1ty Social Media App.";
  if(u.avatar_url){ document.getElementById('profileAvatar').src = u.avatar_url; }
  else { document.getElementById('profileAvatar').src = await makeAvatarFromEmail(me.email); }
  // grid of my posts
  const my = getPosts().filter(p=>p.user===me.email);
  document.getElementById('profileGrid').innerHTML = my.map(p=>`
    <div class="grid-item" data-pid="${p.id}" style="position:relative">
      <img loading="lazy" src="${p.image_url}" alt="post"/>
      <button class="btn" data-delete-post="${p.id}" style="position:absolute;top:6px;right:6px;">Delete</button>
    </div>
  `).join('');
  document.getElementById('statPosts').textContent = String(my.length);
}

// Generate a simple avatar from first letter of email
async function makeAvatarFromEmail(email){
  try{
    const letter = (email||'?').trim().charAt(0).toUpperCase() || '?';
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=120;
    const ctx = canvas.getContext('2d');
    // Pick a color based on hash
    let h=0; for(const ch of email){ h = (h*31 + ch.charCodeAt(0))>>>0; }
    const hue = h % 360; ctx.fillStyle = `hsl(${hue},65%,55%)`;
    ctx.fillRect(0,0,120,120);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 64px Inter, Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(letter, 60, 68);
    return canvas.toDataURL('image/png');
  }catch{ return 'https://placehold.co/120x120?text=?'; }
}

// Delete post: remove from posts, its comments, and likes; broadcast and refresh
document.getElementById('app')?.addEventListener('click', (e)=>{
  const del = e.target.closest('[data-delete-post]');
  if(del){
    const pid = del.getAttribute('data-delete-post');
    // posts
    const posts = getPosts().filter(p=>p.id!==pid); setPosts(posts);
    // comments
    const comments = getComments().filter(c=>c.postId!==pid); setComments(comments);
    // likes
    const likes = getLikes(); delete likes[pid]; setLikes(likes);
    renderFeed(); renderProfile();
  }
});

// Chat
const friendsList = document.getElementById('friendsList');
const chatHeader = document.getElementById('chatHeader');
const chatList = document.getElementById('chatList');
const chatInput = document.getElementById('chatInput');
const chatForm = document.getElementById('chatForm');

let currentPeer = null; // email

function renderUsersList(){
  const users = getUsers();
  const others = me ? users.filter(u=>u.email!==me.email) : users;
  friendsList.innerHTML = others.map(u=>{
    const avatar = u.avatar_url || 'https://placehold.co/48x48';
    return `<li class="friend" data-email="${u.email}"><div class="avatar-wrap"><img class="avatar" src="${avatar}" alt=""/></div><div class="meta"><span class="name">${u.email}</span></div></li>`;
  }).join('');
}

friendsList?.addEventListener('click', (e)=>{
  const li = e.target.closest('.friend'); if(!li) return;
  currentPeer = li.dataset.email; chatHeader.textContent = currentPeer; renderChat();
});

function renderChat(){
  if(!currentPeer){ chatList.innerHTML=''; return; }
  const room = getRoom(me.email, currentPeer);
  const msgs = getMessages().filter(m=>m.room===room).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
  chatList.innerHTML = msgs.map(m=>`<li class="message ${m.sender===me.email?'out':'in'}">${escape(m.text)}</li>`).join('');
  chatList.scrollTop = chatList.scrollHeight;
}

chatForm?.addEventListener('submit', (e)=>{
  e.preventDefault();
  if(!me || !currentPeer) return;
  const text = chatInput.value.trim(); if(!text) return;
  const room = getRoom(me.email, currentPeer);
  const arr = getMessages();
  arr.push({ id: crypto.randomUUID(), room, text, sender: me.email, receiver: currentPeer, created_at: new Date().toISOString() });
  setMessages(arr);
  chatInput.value='';
  renderChat();
});

// Feed interactions: comments and like buttons
document.getElementById('app')?.addEventListener('click', (e)=>{
  const btnComment = e.target.closest('[data-csend]');
  if(btnComment){
    if(!me) return navigate('/auth');
    const postId = btnComment.getAttribute('data-csend');
    const input = document.querySelector(`[data-cin="${postId}"]`);
    const text = input.value.trim(); if(!text) return;
    const arr = getComments();
    arr.push({ id: crypto.randomUUID(), postId, text, author: me.email, created_at: new Date().toISOString() });
    setComments(arr); // broadcasts comments:update
    input.value = '';
    renderComments(postId);
    return;
  }
  const likeBtn = e.target.closest('[data-like]');
  if(likeBtn){
    if(!me) return navigate('/auth');
    const postId = likeBtn.getAttribute('data-like');
    const likes = getLikes();
    const arr = likes[postId] || [];
    const i = arr.indexOf(me.email);
    if(i>=0) arr.splice(i,1); else arr.push(me.email);
    likes[postId] = arr;
    setLikes(likes);
    // Update UI in place
    const count = arr.length; const liked = arr.includes(me.email);
    likeBtn.textContent = liked ? '💙 Liked' : '❤ Like';
    const likesEl = document.querySelector(`[data-likes="${postId}"]`);
    if(likesEl) likesEl.textContent = count?`${count} ${count===1?'like':'likes'}`:'';
    return;
  }
  const focusBtn = e.target.closest('[data-comment-focus]');
  if(focusBtn){ const postId = focusBtn.getAttribute('data-comment-focus'); document.querySelector(`[data-cin="${postId}"]`)?.focus(); }

  // Expand all comments
  const va = e.target.closest('[data-viewall]');
  if(va){
    const postId = va.getAttribute('data-viewall');
    const ul = document.getElementById(`c_${postId}`);
    const arr = getComments().filter(c=>c.postId===postId).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
    ul.innerHTML = arr.map(c=>`<li><strong>${c.author}</strong> ${escape(c.text)}</li>`).join('');
    return;
  }

  // Open likes modal when clicking likes line
  const openLikes = e.target.closest('[data-open-likes]');
  if(openLikes){
    const postId = openLikes.getAttribute('data-open-likes');
    const likes = getLikes()[postId]||[];
    const ul = document.getElementById('likesList');
    ul.innerHTML = likes.length ? likes.map(em=>{
      const u = getUser(em);
      const avatar = u?.avatar_url || 'https://placehold.co/32x32';
      return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${avatar}" alt=""/><span>${em}</span></li>`;
    }).join('') : '<li class="muted">No likes yet</li>';
    document.getElementById('likesModal').showModal();
    return;
  }
});

// Likes modal close
document.getElementById('closeLikes')?.addEventListener('click', ()=> document.getElementById('likesModal').close());

// Double-tap to like on media
let lastTapTime = 0;
document.getElementById('app')?.addEventListener('click', (e)=>{
  const media = e.target.closest('[data-media]');
  if(!media) return;
  const now = Date.now();
  if(now - lastTapTime < 300){
    const postId = media.getAttribute('data-media');
    // simulate like toggle to liked
    const likes = getLikes();
    const arr = likes[postId] || [];
    if(me && !arr.includes(me.email)){
      arr.push(me.email); likes[postId]=arr; setLikes(likes);
      // animate heart
      const heart = document.getElementById(`h_${postId}`);
      if(heart){ heart.classList.add('show'); setTimeout(()=> heart.classList.remove('show'), 600); }
      renderFeed();
    }
  }
  lastTapTime = now;
}, true);

// Support Enter-to-login on auth page
document.getElementById('authPageForm')?.addEventListener('submit', (e)=>{ e.preventDefault(); login(); });

// New chat button navigates to chat view
document.getElementById('newChat')?.addEventListener('click', ()=> navigate('/chat'));

// Realtime across tabs
if(bc){
  bc.onmessage = (ev)=>{
    if(ev?.data?.type === 'messages:update'){
      if(location.pathname === '/chat') renderChat();
      renderUsersList();
    }
    if(ev?.data?.type === 'likes:update' || ev?.data?.type === 'comments:update' || ev?.data?.type === 'posts:update'){
      renderFeed();
      if(location.pathname === '/profile') renderProfile();
    }
  };
}
window.addEventListener('storage', (e)=>{
  if(e.key === LS_KEYS.messages){ if(location.pathname === '/chat') renderChat(); renderUsersList(); }
  if(e.key === LS_KEYS.users){ renderUsersList(); }
  if(e.key === LS_KEYS.likes || e.key === LS_KEYS.comments || e.key === LS_KEYS.posts){ renderFeed(); if(location.pathname === '/profile') renderProfile(); }
});

// Initialize app
function init(){
  loadSession();
  if(me){
    document.getElementById('logoutBtn').hidden=false; document.getElementById('loginBtn').hidden=true;
    document.getElementById('profileEmail').textContent = me.email;
    renderProfile();
    renderFeed();
    (routes[location.pathname]||routes['/'])();
  } else {
    routes['/auth']();
  }
}

init();
