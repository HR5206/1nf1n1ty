import { sb, $, initTheme, ensureAuthedOrRedirect, compressImage, initNavAuthControls, displayName, imageUrl, uploadImage } from './shared.js';

initTheme();
initNavAuthControls();
await ensureAuthedOrRedirect();
const { data: userWrap } = await sb.auth.getUser();
const me = userWrap?.user;

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
  const path = `avatars/${me.id}.jpg`;
  await uploadImage(path, blob || file);
  await sb.from('profiles').update({ avatar_url: path }).eq('id', me.id);
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
      const blob = await compressImage(f, 512, 0.9) || f;
      const path = `avatars/${me.id}.jpg`;
      await uploadImage(path, blob);
  await sb.from('profiles').upsert({ id: me.id, bio: bio || "Hey there! I'm using 1nf1n1ty Social Media App.", username: username||null, avatar_url: path }, { onConflict: 'id' });
    }else{
  await sb.from('profiles').upsert({ id: me.id, bio: bio || "Hey there! I'm using 1nf1n1ty Social Media App.", username: username||null }, { onConflict: 'id' });
    }
    // Optimistically reflect changes
    if(username) $('#profileUsername').textContent = username;
  $('#profileBio').textContent = bio || "Hey there! I'm using 1nf1n1ty Social Media App.";
    await renderProfile();
  }catch(ex){
    console.error('Failed to update profile', ex);
    alert(ex?.message || 'Failed to update profile');
  }
});

// Live preview for bio while typing
$('#bioInput')?.addEventListener('input', (e)=>{
  const v = (e.target?.value || '').trim();
  $('#profileBio').textContent = v || "Hey there! I'm using 1nf1n1ty Social Media App.";
});

async function renderProfile(){
  const { data: user } = await sb.from('profiles').select('*').eq('id', me.id).single();
  // Header details
  $('#profileUsername').textContent = displayName(user);
  $('#profileEmail').textContent = user?.email || me.email;
  $('#profileBio').textContent = (user?.bio) || "Hey there! I'm using 1nf1n1ty Social Media App.";
  const usernameInput = $('#usernameInput'); if(usernameInput) usernameInput.value = user.username || '';
  const bioInput = $('#bioInput'); if(bioInput) bioInput.value = user?.bio || '';
  const img = $('#profileAvatar');
  if (user?.avatar_url) {
    img.src = imageUrl(user.avatar_url, { bust: true });
  } else {
    img.src = 'https://placehold.co/120x120?text=' + encodeURIComponent((user?.email||me.email||'?').charAt(0).toUpperCase());
  }
  // Posts grid
  const { data: posts } = await sb.from('posts').select('id, image_path').eq('user_id', me.id).order('created_at', { ascending: false });
  const grid = $('#profileGrid');
  grid.innerHTML = (posts||[]).map(p=>{
    const url = p.image_path? imageUrl(p.image_path): '';
    return `<div class="grid-item" data-pid="${p.id}" style="position:relative"><img loading="lazy" src="${url}" alt="post"/><button class="btn gradient" data-delete-post="${p.id}" style="position:absolute;top:6px;right:6px;">Delete</button></div>`;
  }).join('');
  $('#statPosts').textContent = String((posts||[]).length);
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
    // Remove comments and likes first (if no DB cascade), then delete the post
    const { data: cs } = await sb.from('comments').select('id').eq('post_id', pid);
    const { data: ls } = await sb.from('likes').select('id').eq('post_id', pid);
    if(cs?.length) await sb.from('comments').delete().in('id', cs.map(c=> c.id));
    if(ls?.length) await sb.from('likes').delete().in('id', ls.map(l=> l.id));
    await sb.from('posts').delete().eq('id', pid);
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
// Realtime: any change to my profile or posts triggers a refresh
import { subscribeTable } from './shared.js';
const unsub1 = subscribeTable('profiles', `id=eq.${me.id}`, ()=> renderProfile());
const unsub2 = subscribeTable('posts', `user_id=eq.${me.id}`, ()=> renderProfile());
