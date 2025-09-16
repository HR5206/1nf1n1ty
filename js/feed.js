import { sb, $, $$, initTheme, ensureAuthedOrRedirect, displayName, compressImage, initNavAuthControls, imageUrl, uploadImage, subscribeTable, infinityBadge } from './shared.js';

initTheme();
initNavAuthControls();
await ensureAuthedOrRedirect();
const { data: userWrap } = await sb.auth.getUser();
const me = userWrap?.user;

function toDate(x){ try{ return x? new Date(x): new Date(); }catch{ return new Date(); } }

const FEED_PAGE=12;
async function buildPostElement(p){
  const li = document.createElement('li'); li.className='post'; li.dataset.id=p.id;
  const author = p.profiles || p.profile || p.user;
  let avatarUrl = 'https://placehold.co/64x64';
  if(author?.avatar_url){
    // Avoid cache-busting avatars to leverage browser/CDN cache on slow connections
    avatarUrl = imageUrl(author.avatar_url);
  }
  const when = toDate(p.created_at || p.created).toLocaleString();
  const img = p.image_path ? imageUrl(p.image_path) : null;
  li.innerHTML = `
    <header class="row">
      <img class="avatar" src="${avatarUrl}" alt="avatar"/>
      <div><div><strong>${displayName(author)||''}</strong> ${infinityBadge(author)}</div><div class="muted">${when}</div></div>
    </header>
    <div class="media" data-media="${p.id}">
      ${img ? `<img loading="lazy" src="${img}" alt="post image"/>` : ''}
      <div class="dbl-heart" id="h_${p.id}">❤</div>
    </div>
    <div class="actions">
      <button class="btn" data-like="${p.id}">❤ Like</button>
      <button class="btn" data-open-comments="${p.id}">💬 Comment</button>
    </div>
    <div class="likes-row">
      <div class="likes" data-likes="${p.id}" data-open-likes="${p.id}"></div>
      <div class="comments-count" id="cm_${p.id}" data-open-comments="${p.id}"></div>
    </div>
    <div class="caption"><strong>${displayName(author)||''}</strong> ${(p.caption||'')}</div>
    <div class="comment-input">
      <input type="text" placeholder="Add a comment..." data-cin="${p.id}" />
      <button class="btn" type="button" data-csend="${p.id}">Post</button>
    </div>
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
    // Lightweight: use head count for totals and a tiny query for my like
    let list = [];
    let total = 0;
    try{ const { count } = await sb.from('likes').select('id', { count: 'exact', head: true }).eq('post_id', postId); total = count||0; }catch{}
    if(me){ try{ const { data: ex } = await sb.from('likes').select('user_id').eq('post_id', postId).eq('user_id', me.id).limit(1); list = ex||[]; }catch{} }
    const likeBtn = document.querySelector(`[data-like="${postId}"]`);
    const likesDiv = document.querySelector(`[data-likes="${postId}"]`);
    const liked = !!(me && list?.some(l=> l.user_id === me.id));
    if(likeBtn){
      likeBtn.textContent = liked? '❤️ Liked' : '❤️ Like';
      likeBtn.classList.toggle('active', !!liked);
    }
  const n = total||0; if(likesDiv){ likesDiv.textContent = `${n} ${n===1?'like':'likes'}`; }
  };
  handler();
  unsubLikes.set(postId, subscribeTable('likes', `post_id=eq.${postId}`, handler));
}

function subscribeComments(postId, firstN=null){
  if(unsubComments.has(postId)){ try{unsubComments.get(postId)()}catch{} }
  const handler = async ()=>{
    // Fetch only what we need for inline view
    const { data: items } = await sb
      .from('comments')
      .select('id, text, created_at, user_id, profiles(id, username, email, avatar_url, bio)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(firstN||2);
    const ul = document.getElementById(`c_${postId}`);
    const countEl = document.getElementById(`cm_${postId}`);
    if(ul){
      let html = items.map(c=> {
        const canDel = me && c.user_id === me.id;
        const del = canDel ? ` <button class="msg-del" data-del-comment="${c.id}" title="Delete" aria-label="Delete comment">🗑</button>` : '';
        return `<li><strong>${displayName(c.profiles)||''}</strong> ${infinityBadge(c.profiles)} ${c.text||''}${del}</li>`;
      }).join('');
      ul.innerHTML = html;
    }
    // Get total count without rows
    let total = 0; try{ const { count } = await sb.from('comments').select('id', { count: 'exact', head: true }).eq('post_id', postId); total = count||0; }catch{}
    if(countEl){ countEl.textContent = total ? `View all ${total} ${total===1?'comment':'comments'}` : ''; countEl.style.visibility = total? 'visible' : 'hidden'; }
  };
  handler();
  unsubComments.set(postId, subscribeTable('comments', `post_id=eq.${postId}`, handler));
}

async function loadAndRenderFeed(){
  const list = $('#feedList'); if(!list) return;
  for(const [,u] of unsubLikes){ try{u()}catch{} } unsubLikes.clear();
  for(const [,u] of unsubComments){ try{u()}catch{} } unsubComments.clear();
  list.innerHTML='';
  const { data: items } = await sb
    .from('posts')
    .select('id, caption, image_path, created_at, user_id, profiles(id, username, email, avatar_url, bio)')
    .order('created_at', { ascending: false })
    .limit(FEED_PAGE);
  for(const p of (items||[])){
    const li = await buildPostElement(p);
    list.appendChild(li);
    subscribeLikes(p.id);
    subscribeComments(p.id, 2);
  }
}

// Debounced reload to reduce chatter on low bandwidth
let __feedReloadTimer = null;
function scheduleFeedReload(){
  if(__feedReloadTimer){ clearTimeout(__feedReloadTimer); }
  __feedReloadTimer = setTimeout(()=>{ loadAndRenderFeed().catch(()=>{}); __feedReloadTimer=null; }, 500);
}

function subscribeFeed(){
  const list = $('#feedList'); if(!list) return;
  if(unsubPosts){ try{unsubPosts()}catch{} unsubPosts=null; }
  scheduleFeedReload();
  unsubPosts = subscribeTable('posts', '', (payload)=>{
    const ev = payload?.eventType;
    if(ev === 'INSERT' || ev === 'UPDATE' || ev === 'DELETE') scheduleFeedReload();
  });
}

// Removed carousel logic for single-image posts

// Uploader handlers
const dropzone = $('#dropzone');
const postImage = $('#postImage');
const browseImage = $('#browseImage');
const previewImage = $('#previewImage');
const removeImageBtn = $('#removeImage');
// no image counter in single-image mode
const dzInstructions = dropzone ? dropzone.querySelector('.dz-instructions') : null;
const captionEl = $('#postCaption');
const captionCount = $('#captionCount');
const postSubmit = $('#postSubmit');

let previewBlobUrl = null;
function hidePreview(){
  if(previewBlobUrl){ try{ URL.revokeObjectURL(previewBlobUrl); }catch{} previewBlobUrl=null; }
  if(previewImage){ previewImage.classList.add('hidden'); previewImage.removeAttribute('src'); }
  if(dropzone){ dropzone.classList.remove('has-preview'); }
  if(dzInstructions){ dzInstructions.classList.remove('hidden'); }
}
function showPreview(file){
  if(!file) return hidePreview();
  if(previewBlobUrl){ try{ URL.revokeObjectURL(previewBlobUrl); }catch{} }
  previewBlobUrl = URL.createObjectURL(file);
  previewImage.src = previewBlobUrl;
  previewImage.classList.remove('hidden');
  if(dropzone){ dropzone.classList.add('has-preview'); }
  if(dzInstructions){ dzInstructions.classList.add('hidden'); }
}
// Initial state and error guard so "null/broken" image never shows
hidePreview();
previewImage?.addEventListener('error', hidePreview);

browseImage?.addEventListener('click', ()=> postImage.click());
postImage?.addEventListener('change', ()=>{
  const files = Array.from(postImage.files||[]).filter(f=> f.type?.startsWith('image/'));
  const f = files?.[0];
  if(f) { showPreview(f); }
  else { hidePreview(); }
});
// Remove selected image
removeImageBtn?.addEventListener('click', ()=>{
  if(postImage){
    try{ postImage.value = ''; }catch{}
  }
  hidePreview();
});
// Drag & drop support for the dropzone
if(dropzone){
  const stop = (ev)=>{ ev.preventDefault(); ev.stopPropagation(); };
  ['dragenter','dragover'].forEach(evt=> dropzone.addEventListener(evt, (e)=>{ stop(e); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(evt=> dropzone.addEventListener(evt, (e)=>{ stop(e); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e)=>{
    const files = e.dataTransfer?.files; if(!files || !files.length) return;
    const imgs = Array.from(files).filter(f=> f.type?.startsWith('image/'));
    if(!imgs.length) return;
    // Assign dropped files to the hidden input so submit flow works (replaces selection)
    try{
      const dt = new DataTransfer();
      imgs.forEach(f=> dt.items.add(f));
      postImage.files = dt.files;
    }catch{}
    // Preview first image and update count
    showPreview(imgs[0]);
  });
  // Keyboard access: Enter/Space opens file picker
  dropzone.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); browseImage?.click(); }
  });
}
captionEl?.addEventListener('input', ()=> captionCount.textContent = String(captionEl.value.length));
// Initialize caption counter on load
if(captionEl && captionCount){ captionCount.textContent = String(captionEl.value.length); }
postSubmit?.addEventListener('click', async ()=>{
  const files = Array.from(postImage.files||[]).filter(f=> f.type?.startsWith('image/'));
  const f = files?.[0]; const caption = captionEl.value.trim();
  if(!me) return;
  let fileBlob = null;
  if(f){ fileBlob = await compressImage(f, 1280, 0.85) || f; }
  // Ensure my profile row exists (in case signup bypassed profile upsert)
  try{ await sb.from('profiles').upsert({ id: me.id, email: me.email }, { onConflict: 'id' }); }catch{}
  const { data: rec, error } = await sb.from('posts').insert({ user_id: me.id, caption }).select('id').single();
  // Optimistically refresh feed so the new post appears immediately
  try{ await loadAndRenderFeed(); }catch{}
  if(!error && rec && f){
    const ext = (f.type && f.type.includes('png'))? 'png' : 'jpg';
    const path = `posts/${rec.id}.${ext}`;
    await uploadImage(path, fileBlob || f);
    await sb.from('posts').update({ image_path: path }).eq('id', rec.id);
    try{ await loadAndRenderFeed(); }catch{}
  }
  // Reset uploader UI
  postImage.value=''; captionEl.value=''; captionCount.textContent='0'; hidePreview();
});

// Likes modal
$('#app')?.addEventListener('click', async (e)=>{
  const openLikes = e.target.closest('[data-open-likes]');
  if(openLikes){
    const pid = openLikes.getAttribute('data-open-likes');
    const { data: likes } = await sb.from('likes')
      .select('user_id, profiles(id, username, email, avatar_url, bio)')
      .eq('post_id', pid);
  const ul = $('#likesList');
    ul.innerHTML = (likes && likes.length) ? likes.map(l=>{
      const u = l.profiles;
      const av = u?.avatar_url ? imageUrl(u.avatar_url) : 'https://placehold.co/32x32';
      const name = displayName(u);
      return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${av}" alt=""/><span>${name} ${infinityBadge(u)}</span></li>`;
    }).join('') : '<li class="muted">No likes yet</li>';
    $('#likesModal').showModal();
  }
});
$('#closeLikes')?.addEventListener('click', ()=> $('#likesModal').close());

// Comments/likes actions
$('#app')?.addEventListener('click', async (e)=>{
  // Inline add-comment input
  const cbtn = e.target.closest('[data-csend]');
  if(cbtn){
    const pid = cbtn.getAttribute('data-csend');
    const input = document.querySelector(`[data-cin="${pid}"]`);
    const text = input.value.trim(); if(!text) return;
    if(!me) return;
    await sb.from('comments').insert({ post_id: pid, user_id: me.id, text });
    input.value=''; return;
  }
  const likeBtn = e.target.closest('[data-like]');
  if(likeBtn){
    const pid = likeBtn.getAttribute('data-like');
  if(!me) return;
  const { data: existing } = await sb.from('likes').select('id').eq('post_id', pid).eq('user_id', me.id).limit(1);
  const likesDiv = document.querySelector(`[data-likes="${pid}"]`);
  // Parse current displayed count for optimistic update
  let n = 0;
  if(likesDiv){
    const m = /^(\d+)/.exec(likesDiv.textContent||'');
    n = m ? parseInt(m[1], 10) : 0;
  }
  if(existing && existing.length){
    // Optimistically decrement
    if(likesDiv){ likesDiv.textContent = `${Math.max(0, n-1)} ${n-1===1?'like':'likes'}`; }
    likeBtn.textContent='❤ Like'; likeBtn.classList.remove('active');
    await sb.from('likes').delete().eq('id', existing[0].id);
  } else {
    // Optimistically increment
    if(likesDiv){ likesDiv.textContent = `${n+1} ${(n+1)===1?'like':'likes'}`; }
    likeBtn.textContent='❤ Liked'; likeBtn.classList.add('active');
    await sb.from('likes').insert({ post_id: pid, user_id: me.id });
  }
    return;
  }
  // Comment button opens the comments modal
  const va = e.target.closest('[data-open-comments]');
  if(va){
    const pid = va.getAttribute('data-open-comments');
    // Store current post id for the modal to allow refresh after deletions
    window.__currentCommentsPostId = pid;
    const { data: list } = await sb.from('comments').select('id, text, created_at, user_id, profiles(*)').eq('post_id', pid).order('created_at', { ascending: true });
    const ul = $('#commentsList');
    ul.innerHTML = (list && list.length) ? list.map(c=>{
      const u = c.profiles;
      const av = u?.avatar_url ? imageUrl(u.avatar_url) : 'https://placehold.co/32x32';
      const name = displayName(u) || '';
      const when = toDate(c.created_at).toLocaleString();
      const text = c.text || '';
      const canDel = me && c.user_id === me.id;
      const del = canDel ? `<button class="msg-del" data-del-comment="${c.id}" title="Delete" aria-label="Delete comment" style="margin-left:8px">🗑</button>` : '';
      return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${av}" alt=""/><div><div><strong>${name}</strong> ${infinityBadge(u)} <span class="muted" style="font-size:.9em">· ${when}</span></div><div>${text} ${del}</div></div></li>`;
    }).join('') : '<li class="muted">No comments yet</li>';
    $('#commentsModal').showModal();
    return;
  }
});
// Allow Enter key to submit inline comment
$('#app')?.addEventListener('keydown', async (e)=>{
  const input = e.target.closest('input[data-cin]');
  if(!input) return;
  if(e.key === 'Enter'){
    e.preventDefault();
    const pid = input.getAttribute('data-cin');
    const text = input.value.trim(); if(!text) return;
    if(!me) return;
    await sb.from('comments').insert({ post_id: pid, user_id: me.id, text });
    input.value='';
  }
});
$('#closeComments')?.addEventListener('click', ()=> $('#commentsModal').close());

// Delete comment actions (inline or modal)
$('#app')?.addEventListener('click', async (e)=>{
  const del = e.target.closest('[data-del-comment]');
  if(!del) return;
  const id = del.getAttribute('data-del-comment');
  if(!id || !me) return;
  const ok = window.confirm('Delete this comment?');
  if(!ok) return;
  const { error } = await sb.from('comments').delete().eq('id', id).eq('user_id', me.id);
  if(error){ alert('Failed to delete comment'); return; }
  try{
    // If modal is open, refresh its list using stored post id
    const pid = window.__currentCommentsPostId;
    if(pid && document.getElementById('commentsModal')?.open){
      const { data: list } = await sb.from('comments').select('id, text, created_at, user_id, profiles(*)').eq('post_id', pid).order('created_at', { ascending: true });
      const ul = $('#commentsList');
      ul.innerHTML = (list && list.length) ? list.map(c=>{
        const u = c.profiles;
        const av = u?.avatar_url ? imageUrl(u.avatar_url) : 'https://placehold.co/32x32';
        const name = displayName(u) || '';
        const when = toDate(c.created_at).toLocaleString();
        const text = c.text || '';
        const canDel = me && c.user_id === me.id;
        const d = canDel ? `<button class="msg-del" data-del-comment="${c.id}" title="Delete" aria-label="Delete comment" style="margin-left:8px">🗑</button>` : '';
        return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${av}" alt=""/><div><div><strong>${name}</strong> ${infinityBadge(u)} <span class="muted" style="font-size:.9em">· ${when}</span></div><div>${text} ${d}</div></div></li>`;
      }).join('') : '<li class="muted">No comments yet</li>';
    }
  }catch{}
});

// Also catch delete clicks inside the comments modal
$('#commentsModal')?.addEventListener('click', async (e)=>{
  const del = e.target.closest('[data-del-comment]');
  if(!del) return;
  const id = del.getAttribute('data-del-comment');
  if(!id || !me) return;
  const ok = window.confirm('Delete this comment?');
  if(!ok) return;
  const { error } = await sb.from('comments').delete().eq('id', id).eq('user_id', me.id);
  if(error){ alert('Failed to delete comment'); return; }
  try{
    const pid = window.__currentCommentsPostId;
    if(pid){
      const { data: list } = await sb.from('comments').select('id, text, created_at, user_id, profiles(*)').eq('post_id', pid).order('created_at', { ascending: true });
      const ul = $('#commentsList');
      ul.innerHTML = (list && list.length) ? list.map(c=>{
        const u = c.profiles;
        const av = u?.avatar_url ? imageUrl(u.avatar_url) : 'https://placehold.co/32x32';
        const name = displayName(u) || '';
        const when = toDate(c.created_at).toLocaleString();
        const text = c.text || '';
        const canDel = me && c.user_id === me.id;
        const d = canDel ? `<button class=\"msg-del\" data-del-comment=\"${c.id}\" title=\"Delete\" aria-label=\"Delete comment\" style=\"margin-left:8px\">🗑</button>` : '';
        return `<li class="row"><img class="avatar" style="width:32px;height:32px" src="${av}" alt=""/><div><div><strong>${name}</strong> ${infinityBadge(u)} <span class="muted" style="font-size:.9em">· ${when}</span></div><div>${text} ${d}</div></div></li>`;
      }).join('') : '<li class="muted">No comments yet</li>';
    }
  }catch{}
});

// double-tap like
let lastTap=0;
$('#app')?.addEventListener('click', async (e)=>{
  const media = e.target.closest('[data-media]'); if(!media) return;
  const now = Date.now();
  if(now - lastTap < 300){
    const pid = media.getAttribute('data-media');
  if(!me) return;
  const { data: existing } = await sb.from('likes').select('id').eq('post_id', pid).eq('user_id', me.id).limit(1);
  if(!existing || !existing.length){ await sb.from('likes').insert({ post_id: pid, user_id: me.id }); const heart = document.getElementById(`h_${pid}`); if(heart){ heart.classList.add('show'); setTimeout(()=>heart.classList.remove('show'), 600); } }
  }
  lastTap = now;
}, true);

subscribeFeed();

// Image viewer (zoom & pan)
const imageViewer = $('#imageViewer');
const viewerImage = $('#viewerImage');
const zoomInBtn = $('#zoomInBtn');
const zoomOutBtn = $('#zoomOutBtn');
const zoomResetBtn = $('#zoomResetBtn');
const closeViewerBtn = $('#closeViewerBtn');

let vZoom = 1;
let vX = 0, vY = 0;
let isPanning = false; let panStartX = 0, panStartY = 0; let imgStartX=0, imgStartY=0;

function applyViewerTransform(){
  if(viewerImage){ viewerImage.style.transform = `translate(${vX}px, ${vY}px) scale(${vZoom})`; }
}
function openViewer(src){
  if(!imageViewer || !viewerImage) return;
  viewerImage.src = src;
  vZoom = 1; vX = 0; vY = 0; applyViewerTransform();
  imageViewer.showModal();
}
function closeViewer(){ imageViewer?.close(); }

$('#app')?.addEventListener('click', (e)=>{
  const img = e.target.closest('.media img');
  if(img && img.src){ openViewer(img.src); }
});

zoomInBtn?.addEventListener('click', ()=>{ vZoom = Math.min(6, vZoom * 1.2); applyViewerTransform(); });
zoomOutBtn?.addEventListener('click', ()=>{ vZoom = Math.max(0.2, vZoom / 1.2); applyViewerTransform(); });
zoomResetBtn?.addEventListener('click', ()=>{ vZoom = 1; vX=0; vY=0; applyViewerTransform(); });
closeViewerBtn?.addEventListener('click', closeViewer);

// Wheel zoom
imageViewer?.addEventListener('wheel', (e)=>{
  if(!viewerImage) return;
  e.preventDefault();
  const delta = Math.sign(e.deltaY);
  const prev = vZoom;
  vZoom = delta > 0 ? Math.max(0.2, vZoom / 1.1) : Math.min(6, vZoom * 1.1);
  // Zoom toward cursor center: optional simple approach keeps translation
  applyViewerTransform();
}, { passive: false });

// Pan
viewerImage?.addEventListener('mousedown', (e)=>{ isPanning = true; panStartX = e.clientX; panStartY = e.clientY; imgStartX = vX; imgStartY = vY; });
window.addEventListener('mouseup', ()=>{ isPanning = false; });
window.addEventListener('mousemove', (e)=>{ if(!isPanning) return; vX = imgStartX + (e.clientX - panStartX); vY = imgStartY + (e.clientY - panStartY); applyViewerTransform(); });

// Close on backdrop click (click outside card)
imageViewer?.addEventListener('click', (e)=>{ if(e.target === imageViewer){ closeViewer(); } });
