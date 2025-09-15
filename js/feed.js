import { sb, $, $$, initTheme, ensureAuthedOrRedirect, displayName, compressImage, initNavAuthControls, imageUrl, uploadImage, subscribeTable } from './shared.js';

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
  if(author?.avatar_url){ avatarUrl = imageUrl(author.avatar_url, { bust: true }); }
  const when = toDate(p.created_at || p.created).toLocaleString();
  const mediaUrl = p.image_path ? imageUrl(p.image_path) : '';
  li.innerHTML = `
    <header class="row">
      <img class="avatar" src="${avatarUrl}" alt="avatar"/>
      <div><div><strong>${displayName(author)||''}</strong></div><div class="muted">${when}</div></div>
    </header>
    <div class="media" data-media="${p.id}">${mediaUrl?`<img loading="lazy" src="${mediaUrl}" alt="post media"/>`:''}<div class="dbl-heart" id="h_${p.id}">❤</div></div>
    <div class="actions">
      <button class="btn" data-like="${p.id}">❤ Like</button>
      <button class="btn" data-comment-focus="${p.id}">💬 Comment</button>
    </div>
    <div class="likes" data-likes="${p.id}" data-open-likes="${p.id}"></div>
    <div class="caption"><strong>${displayName(author)||''}</strong> ${(p.caption||'')}</div>
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
    const { data: list } = await sb.from('likes').select('user_id').eq('post_id', postId);
    const likeBtn = document.querySelector(`[data-like="${postId}"]`);
    const likesDiv = document.querySelector(`[data-likes="${postId}"]`);
    const liked = !!(me && list?.some(l=> l.user_id === me.id));
    if(likeBtn){
      likeBtn.textContent = liked? '❤️ Liked' : '❤️ Like';
      likeBtn.classList.toggle('active', !!liked);
    }
    const n = list?.length||0; if(likesDiv){ likesDiv.textContent = n? `${n} ${n===1?'like':'likes'}` : ''; }
  };
  handler();
  unsubLikes.set(postId, subscribeTable('likes', `post_id=eq.${postId}`, handler));
}

function subscribeComments(postId, firstN=null){
  if(unsubComments.has(postId)){ try{unsubComments.get(postId)()}catch{} }
  const handler = async ()=>{
    const { data: list } = await sb.from('comments').select('id, text, created_at, user_id, profiles(*)').eq('post_id', postId).order('created_at', { ascending: true });
    const items = firstN? (list||[]).slice(0, firstN) : (list||[]);
    const ul = document.getElementById(`c_${postId}`); if(!ul) return;
    let html = items.map(c=> `<li><strong>${displayName(c.profiles)||''}</strong> ${c.text||''}</li>`).join('');
    if(firstN && (list?.length||0)>items.length){ html += `<li><button class="btn" data-viewall="${postId}">View all ${list.length} comments</button></li>`; }
    ul.innerHTML = html;
  };
  handler();
  unsubComments.set(postId, subscribeTable('comments', `post_id=eq.${postId}`, handler));
}

async function loadAndRenderFeed(){
  const list = $('#feedList'); if(!list) return;
  for(const [,u] of unsubLikes){ try{u()}catch{} } unsubLikes.clear();
  for(const [,u] of unsubComments){ try{u()}catch{} } unsubComments.clear();
  list.innerHTML='';
  const { data: items } = await sb.from('posts').select('id, caption, image_path, created_at, user_id, profiles(*)').order('created_at', { ascending: false }).limit(FEED_PAGE);
  for(const p of (items||[])){
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
  unsubPosts = subscribeTable('posts', '', ()=> loadAndRenderFeed());
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
  const f = postImage.files?.[0]; const caption = captionEl.value.trim();
  if(!me) return;
  let fileBlob = null;
  if(f){ fileBlob = await compressImage(f, 1280, 0.85) || f; }
  // Ensure my profile row exists (in case signup bypassed profile upsert)
  try{ await sb.from('profiles').upsert({ id: me.id, email: me.email }, { onConflict: 'id' }); }catch{}
  const { data: rec, error } = await sb.from('posts').insert({ user_id: me.id, caption }).select('id').single();
  // Optimistically refresh feed so the new post appears immediately
  try{ await loadAndRenderFeed(); }catch{}
  if(!error && rec && fileBlob){
    const path = `posts/${rec.id}.jpg`;
    await uploadImage(path, fileBlob);
    await sb.from('posts').update({ image_path: path }).eq('id', rec.id);
    // Refresh again so the image shows once uploaded
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
      .select('user_id, profiles(id, username, email, avatar_url)')
      .eq('post_id', pid);
    const ul = $('#likesList');
    ul.innerHTML = (likes && likes.length) ? likes.map(l=>{
      const u = l.profiles;
      const av = u?.avatar_url ? imageUrl(u.avatar_url) : 'https://placehold.co/32x32';
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
  await sb.from('comments').insert({ post_id: pid, user_id: me.id, text });
    input.value=''; return;
  }
  const likeBtn = e.target.closest('[data-like]');
  if(likeBtn){
    const pid = likeBtn.getAttribute('data-like');
  if(!me) return;
  const { data: existing } = await sb.from('likes').select('id').eq('post_id', pid).eq('user_id', me.id).limit(1);
  if(existing && existing.length){ await sb.from('likes').delete().eq('id', existing[0].id); likeBtn.textContent='❤ Like'; likeBtn.classList.remove('active'); }
  else { await sb.from('likes').insert({ post_id: pid, user_id: me.id }); likeBtn.textContent='❤ Liked'; likeBtn.classList.add('active'); }
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
  if(!me) return;
  const { data: existing } = await sb.from('likes').select('id').eq('post_id', pid).eq('user_id', me.id).limit(1);
  if(!existing || !existing.length){ await sb.from('likes').insert({ post_id: pid, user_id: me.id }); const heart = document.getElementById(`h_${pid}`); if(heart){ heart.classList.add('show'); setTimeout(()=>heart.classList.remove('show'), 600); } }
  }
  lastTap = now;
}, true);

subscribeFeed();
