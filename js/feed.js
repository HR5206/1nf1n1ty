import { pb, $, $$, initTheme, isAuthed, ensureAuthedOrRedirect, displayName, compressImage, initNavAuthControls } from './shared.js';

initTheme();
initNavAuthControls();
if(!ensureAuthedOrRedirect()) throw new Error('Not authed');

function toDate(x){ try{ return x? new Date(x): new Date(); }catch{ return new Date(); } }

const FEED_PAGE=12;
async function buildPostElement(p){
  const li = document.createElement('li'); li.className='post'; li.dataset.id=p.id;
  const author = p.expand?.user;
  let avatarUrl = 'https://placehold.co/64x64';
  if(author?.avatar){ avatarUrl = pb.files.getUrl(author, author.avatar, { thumb: '64x64' }); }
  const when = toDate(p.created).toLocaleString();
  const imageUrl = p.image ? pb.files.getUrl(p, p.image) : '';
  li.innerHTML = `
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
    <div class="caption"><strong>${displayName(p.expand?.user)||''}</strong> ${(p.caption||'')}</div>
    <ul class="comments" id="c_${p.id}"></ul>
    <div class="comment-input"><input data-cin="${p.id}" type="text" placeholder="Add a comment..." maxlength="200"/><button class="btn" data-csend="${p.id}">Post</button></div>
  `;
  return li;
}

let unsubPosts=null; const unsubLikes=new Map(); const unsubComments=new Map();

function cleanup(){
  if(unsubPosts){ try{unsubPosts()}catch{} unsubPosts=null; }
  for(const [,u] of unsubLikes){ try{u()}catch{} } unsubLikes.clear();
  for(const [,u] of unsubComments){ try{u()}catch{} } unsubComments.clear();
}

function subscribeLikes(postId){
  if(unsubLikes.has(postId)){ try{unsubLikes.get(postId)()}catch{} }
  const handler = async ()=>{
    const list = await pb.collection('likes').getFullList({ filter: `post="${postId}"` });
    const likeBtn = document.querySelector(`[data-like="${postId}"]`);
    const likesDiv = document.querySelector(`[data-likes="${postId}"]`);
    const me = pb.authStore.model;
    const liked = !!(me && list.some(l=> l.user === me.id));
    if(likeBtn){ likeBtn.textContent = liked? '💙 Liked' : '❤ Like'; }
    if(likesDiv){ const n=list.length; likesDiv.textContent = n? `${n} ${n===1?'like':'likes'}` : ''; }
  };
  handler();
  unsubLikes.set(postId, pb.collection('likes').subscribe('*', handler, { filter: `post="${postId}"` }));
}

function subscribeComments(postId, firstN=null){
  if(unsubComments.has(postId)){ try{unsubComments.get(postId)()}catch{} }
  const handler = async ()=>{
    const list = await pb.collection('comments').getFullList({ filter: `post="${postId}"`, sort: '+created', expand: 'user' });
    const items = firstN? list.slice(0, firstN) : list;
    const ul = document.getElementById(`c_${postId}`); if(!ul) return;
    let html = items.map(c=> `<li><strong>${displayName(c.expand?.user)||''}</strong> ${c.text||''}</li>`).join('');
    if(firstN && list.length>items.length){ html += `<li><button class="btn" data-viewall="${postId}">View all ${list.length} comments</button></li>`; }
    ul.innerHTML = html;
  };
  handler();
  unsubComments.set(postId, pb.collection('comments').subscribe('*', handler, { filter: `post="${postId}"` }));
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

function subscribeFeed(){
  const list = $('#feedList'); if(!list) return;
  if(unsubPosts){ try{unsubPosts()}catch{} unsubPosts=null; }
  loadAndRenderFeed();
  unsubPosts = pb.collection('posts').subscribe('*', ()=> loadAndRenderFeed());
}

// Uploader handlers
const postImage = $('#postImage');
const browseImage = $('#browseImage');
const previewImage = $('#previewImage');
const captionEl = $('#postCaption');
const captionCount = $('#captionCount');
const postSubmit = $('#postSubmit');

let previewBlobUrl = null;
function hidePreview(){
  if(previewBlobUrl){ try{ URL.revokeObjectURL(previewBlobUrl); }catch{} previewBlobUrl=null; }
  if(previewImage){ previewImage.classList.add('hidden'); previewImage.removeAttribute('src'); }
}
function showPreview(file){
  if(!file) return hidePreview();
  if(previewBlobUrl){ try{ URL.revokeObjectURL(previewBlobUrl); }catch{} }
  previewBlobUrl = URL.createObjectURL(file);
  previewImage.src = previewBlobUrl;
  previewImage.classList.remove('hidden');
}
// Initial state and error guard so "null/broken" image never shows
hidePreview();
previewImage?.addEventListener('error', hidePreview);

browseImage?.addEventListener('click', ()=> postImage.click());
postImage?.addEventListener('change', ()=>{
  const f = postImage.files?.[0];
  if(f) showPreview(f); else hidePreview();
});
captionEl?.addEventListener('input', ()=> captionCount.textContent = String(captionEl.value.length));
postSubmit?.addEventListener('click', async ()=>{
  if(!isAuthed()) return;
  const f = postImage.files?.[0]; const caption = captionEl.value.trim();
  const me = pb.authStore.model;
  const data={ user: me.id, caption };
  let fileToSend = null;
  if(f){ const blob = await compressImage(f, 1280, 0.85); fileToSend = blob; }
  const rec = await pb.collection('posts').create(data);
  if(fileToSend){ await pb.collection('posts').update(rec.id, { image: fileToSend }); }
  // Reset uploader UI
  postImage.value=''; captionEl.value=''; captionCount.textContent='0'; hidePreview();
});

// Likes modal
$('#app')?.addEventListener('click', async (e)=>{
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
    $('#likesModal').showModal();
  }
});
$('#closeLikes')?.addEventListener('click', ()=> $('#likesModal').close());

// Comments/likes actions
$('#app')?.addEventListener('click', async (e)=>{
  const cbtn = e.target.closest('[data-csend]');
  if(cbtn){
    const pid = cbtn.getAttribute('data-csend');
    const input = document.querySelector(`[data-cin="${pid}"]`);
    const text = input.value.trim(); if(!text) return;
    const me = pb.authStore.model;
    await pb.collection('comments').create({ post: pid, user: me.id, text });
    input.value=''; return;
  }
  const likeBtn = e.target.closest('[data-like]');
  if(likeBtn){
    const pid = likeBtn.getAttribute('data-like');
    const me = pb.authStore.model; if(!me) return;
    const existing = await pb.collection('likes').getFullList({ filter: `post="${pid}" && user="${me.id}"`, limit: 1 });
    if(existing.length){ await pb.collection('likes').delete(existing[0].id); }
    else{ await pb.collection('likes').create({ post: pid, user: me.id }); }
    return;
  }
  const focusBtn = e.target.closest('[data-comment-focus]');
  if(focusBtn){ const pid = focusBtn.getAttribute('data-comment-focus'); document.querySelector(`[data-cin="${pid}"]`)?.focus(); return; }
  const va = e.target.closest('[data-viewall]');
  if(va){ const pid = va.getAttribute('data-viewall'); subscribeComments(pid, null); return; }
});

// double-tap like
let lastTap=0;
$('#app')?.addEventListener('click', async (e)=>{
  const media = e.target.closest('[data-media]'); if(!media) return;
  const now = Date.now();
  if(now - lastTap < 300){
    const pid = media.getAttribute('data-media');
    const me = pb.authStore.model; if(!me) return;
    const existing = await pb.collection('likes').getFullList({ filter: `post="${pid}" && user="${me.id}"`, limit: 1 });
    if(!existing.length){ await pb.collection('likes').create({ post: pid, user: me.id }); const heart = document.getElementById(`h_${pid}`); if(heart){ heart.classList.add('show'); setTimeout(()=>heart.classList.remove('show'), 600); } }
  }
  lastTap = now;
}, true);

subscribeFeed();
