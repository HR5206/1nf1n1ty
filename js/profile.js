import { pb, $, initTheme, ensureAuthedOrRedirect, compressImage, initNavAuthControls, displayName } from './shared.js';

initTheme();
initNavAuthControls();
if(!ensureAuthedOrRedirect()) throw new Error('Not authed');

const me = pb.authStore.model;

$('#changeAvatar')?.addEventListener('click', ()=> $('#avatarInput').click());
// Auto-upload avatar on file pick with live preview
$('#avatarInput')?.addEventListener('change', async (e)=>{
  try{
    const file = e.target?.files?.[0];
    if(!file) return;
    const url = URL.createObjectURL(file);
    const img = $('#profileAvatar');
    if(img) img.src = url; // immediate local preview
    const blob = await compressImage(file, 512, 0.9);
    const fd = new FormData();
    if(blob) fd.append('avatar', blob, 'avatar.jpg'); else fd.append('avatar', file, file.name||'avatar');
    await pb.collection('users').update(me.id, fd);
  }catch(ex){
    console.error('Avatar update failed', ex);
    alert(ex?.message || 'Failed to change avatar');
  }finally{
    try{ URL.revokeObjectURL($('#profileAvatar')?.src); }catch{}
    e.target.value = '';
    await renderProfile();
  }
});
$('#saveProfile')?.addEventListener('click', async ()=>{
  try{
    const bio = $('#bioInput').value.trim();
    const username = $('#usernameInput')?.value.trim();
    const f = $('#avatarInput').files?.[0];
    if(f){
      const fd = new FormData();
      fd.append('bio', bio || "Hey there! I'm using SastraDaily.");
      if(username) fd.append('username', username);
      const blob = await compressImage(f, 512, 0.9); if(blob) fd.append('avatar', blob, 'avatar.jpg'); else fd.append('avatar', f, f.name||'avatar');
      await pb.collection('users').update(me.id, fd);
    }else{
      const data = { bio: bio || "Hey there! I'm using SastraDaily." };
      if(username) data.username = username;
      await pb.collection('users').update(me.id, data);
    }
    // Optimistically reflect changes
    if(username) $('#profileUsername').textContent = username;
    $('#profileBio').textContent = bio || "Hey there! I'm using SastraDaily.";
    await renderProfile();
  }catch(ex){
    console.error('Failed to update profile', ex);
    alert(ex?.message || 'Failed to update profile');
  }
});

// Live preview for bio while typing
$('#bioInput')?.addEventListener('input', (e)=>{
  const v = (e.target?.value || '').trim();
  $('#profileBio').textContent = v || "Hey there! I'm using SastraDaily.";
});

async function renderProfile(){
  const user = await pb.collection('users').getOne(me.id);
  // Header details
  $('#profileUsername').textContent = displayName(user);
  $('#profileEmail').textContent = user.email;
  $('#profileBio').textContent = user.bio || "Hey there! I'm using SastraDaily.";
  const usernameInput = $('#usernameInput'); if(usernameInput) usernameInput.value = user.username || '';
  const bioInput = $('#bioInput'); if(bioInput) bioInput.value = user.bio || '';
  const img = $('#profileAvatar');
  img.src = user.avatar ? pb.files.getUrl(user, user.avatar) : 'https://placehold.co/120x120?text=' + encodeURIComponent((user.email||'?').charAt(0).toUpperCase());
  // Posts grid
  const posts = await pb.collection('posts').getFullList({ filter: `user="${user.id}"`, sort: '-created' });
  const grid = $('#profileGrid');
  grid.innerHTML = posts.map(p=>{
    const url = p.image? pb.files.getUrl(p, p.image, { thumb: '640x640' }): '';
    return `<div class="grid-item" data-pid="${p.id}" style="position:relative"><img loading="lazy" src="${url}" alt="post"/><button class="btn gradient" data-delete-post="${p.id}" style="position:absolute;top:6px;right:6px;">Delete</button></div>`;
  }).join('');
  $('#statPosts').textContent = String(posts.length);
}

// Delete post cascade (delegate on the grid for reliability)
$('#profileGrid')?.addEventListener('click', async (e)=>{
  const t = e.target;
  const el = (t instanceof Element) ? t.closest('[data-delete-post]') : null;
  if(!el) return;
  const pid = el.getAttribute('data-delete-post');
  if(!pid) return;
  const ok = confirm('Delete this post? This will also remove its likes and comments.');
  if(!ok) return;
  try{
    el.setAttribute('disabled','');
    // Remove comments and likes first, then delete the post
    const [cs, ls] = await Promise.all([
      pb.collection('comments').getFullList({ filter: `post="${pid}"` }),
      pb.collection('likes').getFullList({ filter: `post="${pid}"` })
    ]);
    await Promise.all([
      ...cs.map(c=> pb.collection('comments').delete(c.id)),
      ...ls.map(l=> pb.collection('likes').delete(l.id))
    ]);
    await pb.collection('posts').delete(pid);
    // Optimistic: remove card from DOM and update count
    const item = document.querySelector(`.grid-item[data-pid="${pid}"]`);
    item?.remove();
    const stat = $('#statPosts'); if(stat) stat.textContent = String(Math.max(0, (parseInt(stat.textContent||'0',10)||0)-1));
  }catch(ex){
    console.error('Failed to delete post', ex);
    alert(ex?.message || 'Failed to delete post. Check permissions.');
  }finally{
    el.removeAttribute('disabled');
    // Final sync to reflect realtime server state
    await renderProfile();
  }
});

// Realtime: subscribe to my user doc and my posts
renderProfile();
pb.collection('users').subscribe(me.id, ()=>{ renderProfile(); });
pb.collection('posts').subscribe('*', (e)=>{
  if(e?.record?.user === me.id) renderProfile();
});
