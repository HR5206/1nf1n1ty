// SastraDaily — Firebase Edition (Auth + Firestore + Storage)
// Switch to this file in index.html once you complete the Firebase setup.

// Imports (Firebase v10 modular via ESM CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as fbSignOut, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import { getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, query, where, orderBy, limit, startAfter, serverTimestamp, onSnapshot, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import { getStorage, ref as sRef, uploadBytes, uploadString, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';

// 1) Paste your Firebase config here (Firebase Console → Project settings → Web app)
const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_AUTH_DOMAIN",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_STORAGE_BUCKET",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// Helpers
const $ = (sel, root=document)=> root.querySelector(sel);
const $$ = (sel, root=document)=> Array.from(root.querySelectorAll(sel));
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
function toDate(x){ try{ return x?.toDate ? x.toDate() : (x? new Date(x): new Date()); }catch{ return new Date(); } }
function escapeHTML(s){ return s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]||c)); }

// Avatar generation from email first letter (original)
async function makeAvatarFromEmail(email){
  try{
    const letter = (email||'?').trim().charAt(0).toUpperCase() || '?';
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=120;
    const ctx = canvas.getContext('2d');
    let h=0; for(const ch of String(email||'?')){ h = (h*31 + ch.charCodeAt(0))>>>0; }
    const hue = h % 360; ctx.fillStyle = `hsl(${hue},65%,55%)`;
    ctx.fillRect(0,0,120,120);
    ctx.fillStyle = '#ffffff'; ctx.font = '700 64px Inter, Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(letter, 60, 68);
    return canvas.toDataURL('image/png');
  }catch{ return 'https://placehold.co/120x120?text=?'; }
}

// Firebase init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Router
const routes = {
  '/': ()=> show('route-feed'),
  '/auth': ()=> show('route-auth'),
  '/profile': ()=> show('route-profile'),
  '/chat': ()=> { show('route-chat'); subscribeUsersList(); subscribeChatForCurrent(); },
};
function show(id){ $$('.route').forEach(el=>el.classList.add('hidden')); const el = document.getElementById(id); if(el) el.classList.remove('hidden'); }
function navigate(path){ history.pushState({},'',path); (routes[path]||routes['/'])(); }
window.addEventListener('popstate', ()=>{ (routes[location.pathname]||routes['/'])(); });
$('.nav').addEventListener('click', e=>{ const b=e.target.closest('[data-route]'); if(!b) return; navigate(b.getAttribute('data-route')); });

// Session
let me = null; // { uid, email, avatar_url?, bio? }
async function getUserDoc(uid){ return (await getDoc(doc(db,'users',uid))).data()||null; }
async function setUserDoc(uid, data){ await setDoc(doc(db,'users',uid), data, { merge: true }); }

// Realtime subscriptions state
let unsubPosts = null;
const unsubLikes = new Map(); // postId -> () => void
const unsubComments = new Map(); // postId -> { unsub: fn, firstN: number|null }
let unsubUsers = null; // friends list
let unsubChat = null; // room messages
function cleanupFeedSubscribers(){
  if(unsubPosts){ try{ unsubPosts(); }catch{} unsubPosts=null; }
  for(const [,u] of unsubLikes){ try{ u(); }catch{} }
  unsubLikes.clear();
  for(const [,v] of unsubComments){ try{ v.unsub?.(); }catch{} }
  unsubComments.clear();
}

// Auth handlers
document.getElementById('authLogin')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const password = document.getElementById('authPassword').value;
  const err = document.getElementById('authPageError'); err.hidden = true;
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(ex){ err.textContent = ex?.message||'Login failed'; err.hidden=false; }
});
document.getElementById('authSignup')?.addEventListener('click', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const password = document.getElementById('authPassword').value;
  const err = document.getElementById('authPageError'); err.hidden = true;
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;
    // default avatar and bio
    const avatarData = await makeAvatarFromEmail(email);
    const avatarRef = sRef(storage, `avatars/${uid}.png`);
    await uploadString(avatarRef, avatarData, 'data_url');
    const avatar_url = await getDownloadURL(avatarRef);
  await setUserDoc(uid, { email, bio: "Hey there! I'm using 1nf1n1ty Social Media App.", avatar_url, created_at: serverTimestamp() });
  }catch(ex){ err.textContent = ex?.message||'Signup failed'; err.hidden=false; }
});
document.getElementById('authPageForm')?.addEventListener('submit', (e)=>{ e.preventDefault(); document.getElementById('authLogin')?.click(); });
document.getElementById('loginBtn')?.addEventListener('click', ()=> navigate('/auth'));
document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{ await fbSignOut(auth); });

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    me = null;
    document.getElementById('logoutBtn').hidden=true; document.getElementById('loginBtn').hidden=false;
    cleanupFeedSubscribers();
    if(unsubUsers){ try{unsubUsers();}catch{} unsubUsers=null; }
    if(unsubChat){ try{unsubChat();}catch{} unsubChat=null; }
    navigate('/auth');
    return;
  }
  const uid = user.uid;
  const profile = await getUserDoc(uid);
  me = { uid, email: user.email, ...profile };
  document.getElementById('logoutBtn').hidden=false; document.getElementById('loginBtn').hidden=true;
  document.getElementById('profileEmail').textContent = me.email;
  await renderProfile();
  subscribeFeed();
  subscribeUsersList();
  if(location.pathname === '/auth') navigate('/');
});

// Image helpers
async function fileToDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
async function compressImage(file, maxW=1280, quality=0.85){
  if(!file || !file.type.startsWith('image/')) return null;
  const img = new Image(); const url = URL.createObjectURL(file);
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; }); URL.revokeObjectURL(url);
  const scale = Math.min(1, maxW/img.width); const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
  const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const blob = await new Promise(res=> canvas.toBlob(res,'image/jpeg',quality));
  return blob;
}

// Posts CRUD
const FEED_PAGE=12;
function postSkeletonHTML(p, avatar){
  const when = toDate(p.created_at).toLocaleString();
  return `
    <header class="row">
      <img class="avatar" src="${avatar}" alt="avatar"/>
      <div><div><strong>${p.user_email||''}</strong></div><div class="muted">${when}</div></div>
    </header>
    <div class="media" data-media="${p.id}">${p.image_url?`<img loading="lazy" src="${p.image_url}" alt="post media"/>`:''}<div class="dbl-heart" id="h_${p.id}">❤</div></div>
    <div class="actions">
      <button class="btn" data-like="${p.id}">❤ Like</button>
      <button class="btn" data-comment-focus="${p.id}">💬 Comment</button>
    </div>
    <div class="likes" data-likes="${p.id}" data-open-likes="${p.id}"></div>
    <div class="caption"><strong>${p.user_email||''}</strong> ${escapeHTML(p.caption||'')}</div>
    <ul class="comments" id="c_${p.id}"></ul>
    <div class="comment-input"><input data-cin="${p.id}" type="text" placeholder="Add a comment..." maxlength="200"/><button class="btn" data-csend="${p.id}">Post</button></div>
  `;
}

async function buildPostElement(p){
  const li = document.createElement('li'); li.className='post'; li.dataset.id = p.id;
  let avatar = 'https://placehold.co/64x64';
  try{ const author = await getDoc(doc(db,'users',p.user_id)); const u=author.data(); avatar = u?.avatar_url || avatar; }catch{}
  li.innerHTML = postSkeletonHTML(p, avatar);
  return li;
}

function subscribeLikes(postId){
  if(unsubLikes.has(postId)){ try{unsubLikes.get(postId)();}catch{} }
  const likesCol = collection(db,'posts',postId,'likes');
  const unsub = onSnapshot(likesCol, (snap)=>{
    const likeBtn = document.querySelector(`[data-like="${postId}"]`);
    const likesDiv = document.querySelector(`[data-likes="${postId}"]`);
    const count = snap.size;
    const liked = !!(me && snap.docs.some(d=> d.id===me.uid));
    if(likeBtn){ likeBtn.textContent = liked? '\u2764 Liked' : '\u2764 Like'; likeBtn.classList.toggle('active', !!liked); }
    if(likesDiv){ likesDiv.textContent = count? `${count} ${count===1?'like':'likes'}` : ''; }
  });
  unsubLikes.set(postId, unsub);
}

function subscribeComments(postId, firstN=null){
  // replace existing
  const current = unsubComments.get(postId);
  if(current){ try{ current.unsub(); }catch{} }
  let qRef = query(collection(db,'posts', postId, 'comments'), orderBy('created_at','asc'));
  if(firstN) qRef = query(qRef, limit(firstN));
  const unsub = onSnapshot(qRef, async (snap)=>{
    const ul = document.getElementById(`c_${postId}`); if(!ul) return;
    const items = snap.docs.map(d=> d.data());
    let html = items.map(c=>`<li><strong>${c.user_email}</strong> ${escapeHTML(c.text||'')}</li>`).join('');
    if(firstN){
      try{
        const cnt = await getCountFromServer(collection(db,'posts',postId,'comments'));
        const total = cnt.data().count || 0;
        if(total>items.length){ html += `<li><button class="btn" data-viewall="${postId}">View all ${total} comments</button></li>`; }
      }catch{}
    }
    ul.innerHTML = html;
  });
  unsubComments.set(postId, { unsub, firstN });
}

function subscribeFeed(){
  const list = document.getElementById('feedList'); if(!list) return;
  cleanupFeedSubscribers();
  const qRef = query(collection(db,'posts'), orderBy('created_at','desc'), limit(FEED_PAGE));
  unsubPosts = onSnapshot(qRef, async (snap)=>{
    // rebuild feed for simplicity and correctness
    for(const [,u] of unsubLikes){ try{u();}catch{} } unsubLikes.clear();
    for(const [,v] of unsubComments){ try{v.unsub();}catch{} } unsubComments.clear();
    list.innerHTML = '';
    for(const d of snap.docs){
      const p = { id: d.id, ...d.data() };
      const li = await buildPostElement(p);
      list.appendChild(li);
      subscribeLikes(p.id);
      subscribeComments(p.id, 2);
    }
  });
}

// Likes toggle
async function toggleLike(postId){
  if(!me) return navigate('/auth');
  const likeDoc = doc(db,'posts',postId,'likes',me.uid);
  const exists = (await getDoc(likeDoc)).exists();
  if(exists) await deleteDoc(likeDoc); else await setDoc(likeDoc, { user_id: me.uid, email: me.email, created_at: serverTimestamp() });
}

// Uploader
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
  if(!me) return navigate('/auth');
  const file = postImage.files?.[0]; const caption = captionEl.value.trim();
  let image_url=null, image_path=null;
  if(file){ const blob = await compressImage(file, 1280, 0.85); const p=`posts/${me.uid}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`; const r=sRef(storage,p); await uploadBytes(r, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }); image_url=await getDownloadURL(r); image_path=p; }
  await addDoc(collection(db,'posts'), { user_id: me.uid, user_email: me.email, caption, image_url, image_path, created_at: serverTimestamp() });
  // reset
  postImage.value=''; captionEl.value=''; captionCount.textContent='0'; previewImage.classList.add('hidden');
});

// Profile
document.getElementById('changeAvatar')?.addEventListener('click', ()=> document.getElementById('avatarInput').click());
document.getElementById('saveProfile')?.addEventListener('click', async ()=>{
  if(!me) return navigate('/auth');
  const bio = document.getElementById('bioInput').value.trim();
  const f = document.getElementById('avatarInput').files?.[0];
  let avatar_url = me.avatar_url;
  if(f){ const blob = await compressImage(f, 512, 0.9); const r=sRef(storage, `avatars/${me.uid}.jpg`); await uploadBytes(r, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }); avatar_url = await getDownloadURL(r); }
  await setUserDoc(me.uid, { bio: bio || "Hey there! I'm using 1nf1n1ty Social Media App.", avatar_url });
  const profile = await getUserDoc(me.uid); me = { ...me, ...profile };
  await renderProfile();
});

async function renderProfile(){
  if(!me) return;
  const p = await getUserDoc(me.uid);
  document.getElementById('profileEmail').textContent = me.email;
  document.getElementById('profileBio').textContent = p?.bio || "Hey there! I'm using 1nf1n1ty Social Media App.";
  const img = document.getElementById('profileAvatar');
  img.src = p?.avatar_url || await makeAvatarFromEmail(me.email);
  // my posts grid
  const snap = await getDocs(query(collection(db,'posts'), where('user_id','==',me.uid), orderBy('created_at','desc'), limit(60)));
  const grid = document.getElementById('profileGrid');
  grid.innerHTML = snap.docs.map(d=>{ const x=d.data(); return `<div class="grid-item" data-pid="${d.id}" style="position:relative"><img loading="lazy" src="${x.image_url||''}" alt="post"/><button class="btn" data-delete-post="${d.id}" style="position:absolute;top:6px;right:6px;">Delete</button></div>`; }).join('');
  document.getElementById('statPosts').textContent = String(snap.size);
}

// Delete post (doc + image + subcollections)
document.getElementById('app')?.addEventListener('click', async (e)=>{
  const del = e.target.closest('[data-delete-post]');
  if(del){
    const pid = del.getAttribute('data-delete-post');
    const pd = await getDoc(doc(db,'posts',pid)); if(!pd.exists()) return;
    const p = pd.data();
    // delete comments
    const cs = await getDocs(collection(db,'posts',pid,'comments'));
    await Promise.all(cs.docs.map(c=> deleteDoc(doc(db,'posts',pid,'comments',c.id))));
    // delete likes
    const ls = await getDocs(collection(db,'posts',pid,'likes'));
    await Promise.all(ls.docs.map(l=> deleteDoc(doc(db,'posts',pid,'likes',l.id))));
    // delete image from storage
    if(p.image_path){ try{ await deleteObject(sRef(storage, p.image_path)); }catch{} }
    await deleteDoc(doc(db,'posts',pid));
    await renderProfile();
    return;
  }
});

// Comments & Likes & View-All & Likes modal & Double-tap
document.getElementById('app')?.addEventListener('click', async (e)=>{
  // Comment Post
  const cbtn = e.target.closest('[data-csend]');
  if(cbtn){
    if(!me) return navigate('/auth');
    const pid = cbtn.getAttribute('data-csend');
    const input = document.querySelector(`[data-cin="${pid}"]`);
    const text = input.value.trim(); if(!text) return;
    await addDoc(collection(db,'posts',pid,'comments'), { text, user_id: me.uid, user_email: me.email, created_at: serverTimestamp() });
    input.value=''; return;
  }
  // Like toggle
  const likeBtn = e.target.closest('[data-like]');
  if(likeBtn){
    const pid = likeBtn.getAttribute('data-like');
    await toggleLike(pid);
    return;
  }
  // Focus comment input
  const focusBtn = e.target.closest('[data-comment-focus]');
  if(focusBtn){ const pid = focusBtn.getAttribute('data-comment-focus'); document.querySelector(`[data-cin="${pid}"]`)?.focus(); return; }
  // View all comments
  const va = e.target.closest('[data-viewall]');
  if(va){ const pid = va.getAttribute('data-viewall'); subscribeComments(pid, null); return; }
  // Likes modal
  const openLikes = e.target.closest('[data-open-likes]');
  if(openLikes){
    const pid = openLikes.getAttribute('data-open-likes');
    const ls = await getDocs(collection(db,'posts',pid,'likes'));
    const ul = document.getElementById('likesList');
    const items = await Promise.all(ls.docs.map(async d=>{
      const udoc = await getDoc(doc(db,'users', d.id)); const u=udoc.data();
      const avatar = u?.avatar_url || 'https://placehold.co/32x32'; const em = u?.email||'';
      return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${avatar}" alt=""/><span>${em}</span></li>`;
    }));
    ul.innerHTML = items.length? items.join('') : '<li class="muted">No likes yet</li>';
    document.getElementById('likesModal').showModal();
    return;
  }
});
document.getElementById('closeLikes')?.addEventListener('click', ()=> document.getElementById('likesModal').close());

// Double-tap like
let lastTap=0;
document.getElementById('app')?.addEventListener('click', async (e)=>{
  const media = e.target.closest('[data-media]');
  if(!media) return;
  const now = Date.now();
  if(now - lastTap < 300){
    const pid = media.getAttribute('data-media');
    // like (ensure liked)
    const likeDoc = doc(db,'posts',pid,'likes', me?.uid||'');
    if(me && !(await getDoc(likeDoc)).exists()){
      await setDoc(likeDoc, { user_id: me.uid, email: me.email, created_at: serverTimestamp() });
      const heart = document.getElementById(`h_${pid}`); if(heart){ heart.classList.add('show'); setTimeout(()=>heart.classList.remove('show'), 600); }
    }
  }
  lastTap = now;
}, true);

// Chat (basic Firestore)
const friendsList = document.getElementById('friendsList');
const chatHeader = document.getElementById('chatHeader');
const chatList = document.getElementById('chatList');
const chatInput = document.getElementById('chatInput');
const chatForm = document.getElementById('chatForm');
document.getElementById('newChat')?.addEventListener('click', ()=> navigate('/chat'));
let currentPeer = null; // email

function subscribeUsersList(){
  if(unsubUsers){ try{unsubUsers();}catch{} unsubUsers=null; }
  if(!friendsList) return;
  unsubUsers = onSnapshot(collection(db,'users'), (snap)=>{
    if(!me){ friendsList.innerHTML=''; return; }
    const others = snap.docs.map(d=>d.data()).filter(u=> u.email !== me.email);
    friendsList.innerHTML = others.map(u=>`<li class="friend" data-email="${u.email}"><div class="avatar-wrap"><img class="avatar" src="${u.avatar_url||'https://placehold.co/48x48'}" alt=""/></div><div class="meta"><span class="name">${u.email}</span></div></li>`).join('');
  });
}
friendsList?.addEventListener('click', (e)=>{ const li = e.target.closest('.friend'); if(!li) return; currentPeer = li.dataset.email; chatHeader.textContent=currentPeer; subscribeChatForCurrent(); });

function subscribeChatForCurrent(){
  if(unsubChat){ try{unsubChat();}catch{} unsubChat=null; }
  chatList.innerHTML=''; if(!me || !currentPeer) return;
  const a = [me.email, currentPeer].sort(); const room = `dm:${a[0]}::${a[1]}`;
  const qRef = query(collection(db,'messages'), where('room','==',room), orderBy('created_at','asc'), limit(50));
  unsubChat = onSnapshot(qRef, (snap)=>{
    chatList.innerHTML = snap.docs.map(d=>{ const m=d.data(); return `<li class="message ${m.sender===me.email?'out':'in'}">${escapeHTML(m.text||'')}</li>`; }).join('');
    chatList.scrollTop = chatList.scrollHeight;
  });
}
chatForm?.addEventListener('submit', async (e)=>{
  e.preventDefault(); if(!me||!currentPeer) return;
  const text = chatInput.value.trim(); if(!text) return;
  const a = [me.email, currentPeer].sort(); const room = `dm:${a[0]}::${a[1]}`;
  await addDoc(collection(db,'messages'), { room, text, sender: me.email, receiver: currentPeer, created_at: serverTimestamp() });
  chatInput.value='';
});

// Init route on load
(routes[location.pathname]||routes['/'])();
