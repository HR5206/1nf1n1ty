import { sb, $, $$, initTheme, ensureAuthedOrRedirect, displayName, initNavAuthControls, subscribeTable, imageUrl, escapeHTML, infinityBadge } from './shared.js';

initTheme();
initNavAuthControls();
await ensureAuthedOrRedirect();
const { data: userWrap } = await sb.auth.getUser();
const me = userWrap?.user;

const friendsList = $('#friendsList');
const chatHeader = $('#chatHeader');
const chatList = $('#chatList');
const chatInput = $('#chatInput');
const chatForm = $('#chatForm');
const sidebarSearch = $('#sidebarSearch');

function roomId(a, b){ const arr=[a,b].sort(); return `dm:${arr[0]}::${arr[1]}`; }

let unsubUsers=null; let unsubChat=null; let currentPeer=null;
let allUsersCache = [];
// Namespace contacts per user to avoid cross-account mixing in localStorage
const CONTACTS_KEY = me ? `sd_chat_contacts:${me.id}` : 'sd_chat_contacts';
let existingPeerIds = new Set();
// Unread tracking (per user) using last-read timestamps per peerId in localStorage
const LAST_READ_KEY = me ? `sd_chat_last_read:${me.id}` : 'sd_chat_last_read';
let lastRead = {};
try{ lastRead = JSON.parse(localStorage.getItem(LAST_READ_KEY)||'{}'); }catch{ lastRead = {}; }
const unreadCounts = Object.create(null); // { [peerId]: number }
function saveLastRead(){ try{ localStorage.setItem(LAST_READ_KEY, JSON.stringify(lastRead||{})); }catch{} }
function markConversationRead(peerId, ts){ if(!peerId) return; lastRead[peerId] = ts || new Date().toISOString(); saveLastRead(); unreadCounts[peerId]=0; renderAllUsers(allUsersCache); }
async function recomputeUnreadForPeer(peerId){
  if(!peerId || !me) return 0;
  const since = lastRead[peerId] || '1970-01-01T00:00:00.000Z';
  try{
    const { count } = await sb
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('receiver', me.id)
      .eq('sender', peerId)
      .gt('created_at', since);
    const n = typeof count === 'number' ? count : 0;
    unreadCounts[peerId] = n;
    return n;
  }catch{ unreadCounts[peerId]=0; return 0; }
}
async function recomputeAllUnreadCounts(){
  const users = allUsersCache || [];
  for(const u of (users||[])){
    await recomputeUnreadForPeer(u.id);
  }
  renderAllUsers(users);
}
function sanitizeContacts(list){
  const arr = Array.isArray(list)? list : [];
  return arr.filter(c=> c && c.id && String(c.id) !== String(me?.id||''));
}
function loadContacts(){
  try{ return sanitizeContacts(JSON.parse(localStorage.getItem(CONTACTS_KEY)||'[]')); }catch{ return []; }
}
function saveContacts(list){ try{ localStorage.setItem(CONTACTS_KEY, JSON.stringify(sanitizeContacts(list)||[])); }catch{} }
// One-time migrations:
// - v1: initial clear
// - v2: force clear contacts globally once more
// - v3: namespacing contacts per user; remove old global key to prevent cross-account leak
try{
  const v1 = localStorage.getItem('sd_chat_contacts_migrated_v1');
  const v2 = localStorage.getItem('sd_chat_contacts_migrated_v2');
  const v3 = localStorage.getItem('sd_chat_contacts_migrated_v3');
  const v4 = localStorage.getItem('sd_chat_contacts_migrated_v4');
  const v5 = localStorage.getItem('sd_chat_contacts_migrated_v5');
  if(!v1){
    localStorage.removeItem(CONTACTS_KEY);
    localStorage.setItem('sd_chat_contacts_migrated_v1', '1');
  }
  if(!v2){
    localStorage.removeItem(CONTACTS_KEY);
    localStorage.setItem('sd_chat_contacts_migrated_v2', '1');
    try{ localStorage.setItem('sd_chat_contacts_reset_at', new Date().toISOString()); }catch{}
  }
  if(!v3){
    // Remove old global key unconditionally to avoid showing contacts from other signed-in users
    try{ localStorage.removeItem('sd_chat_contacts'); }catch{}
    localStorage.setItem('sd_chat_contacts_migrated_v3', '1');
  }
  if(!v4){
    // Clear all possible keys related to contacts (global and per-user patterns)
    try{
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(!k) continue;
        if(k=== 'sd_chat_contacts' || k.startsWith('sd_chat_contacts:')){
          try{ localStorage.removeItem(k); }catch{}
        }
      }
    }catch{}
    try{ localStorage.setItem('sd_chat_contacts_reset_at', new Date().toISOString()); }catch{}
    localStorage.setItem('sd_chat_contacts_migrated_v4', '1');
  }
  if(!v5){
    try{
      const keys = [];
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(k && (k=== 'sd_chat_contacts' || k.startsWith('sd_chat_contacts:'))){ keys.push(k); }
      }
      for(const k of keys){ try{ localStorage.removeItem(k); }catch{} }
    }catch{}
    try{ localStorage.setItem('sd_chat_contacts_reset_at', new Date().toISOString()); }catch{}
    localStorage.setItem('sd_chat_contacts_migrated_v5', '1');
  }
}catch{}
function upsertContact(user){
  if(!user?.id) return;
  // Never add self as a contact
  if(String(user.id) === String(me?.id||'')) return;
  const list = loadContacts();
  const i = list.findIndex(x=> x.id === user.id);
  const base = { id: user.id, username: user.username||'', email: user.email||'', avatar_url: user.avatar_url||'' };
  if(i>=0) list[i] = { ...list[i], ...base };
  else list.unshift(base);
  saveContacts(list);
  renderAllUsers(allUsersCache);
}

// Briefly highlight a contact in the list (visual notification without toast)
function highlightContact(peerId){
  try{
    const li = friendsList?.querySelector?.(`[data-id="${peerId}"]`);
    if(li){
      li.classList.add('highlight');
      setTimeout(()=> li.classList.remove('highlight'), 1400);
    }
  }catch{}
}
function renderContacts(list){
  const arr = sanitizeContacts(list || loadContacts());
  // Also ensure current user is excluded from UI rendering, as a safety net
  const filtered = (arr||[]).filter(u=> String(u.id) !== String(me?.id||''));
  if(!filtered || filtered.length===0){
    friendsList.innerHTML = '<li class="muted">No users</li>';
    return;
  }
  friendsList.innerHTML = (filtered||[]).map(u=>{
    const full = allUsersCache.find(x=> String(x.id) === String(u.id)) || u;
    const av = full.avatar_url? imageUrl(full.avatar_url) : 'https://placehold.co/48x48';
    const name = displayName(full);
    const unread = unreadCounts[full.id]||0;
    const badge = unread>0 ? `<span class="badge" aria-label="${unread} unread">${unread}</span>` : '';
    return `<li class="friend" data-id="${full.id}" data-email="${full.email||''}" data-username="${full.username||''}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name} ${infinityBadge(full)}</span></div>${badge}</li>`;
  }).join('');
}

// Render the full user directory (excluding me), filtered by sidebar search
function renderAllUsers(users){
  const base = (users||[]).filter(u=> String(u.id) !== String(me?.id||''));
  const q = (sidebarSearch?.value||'').trim().toLowerCase();
  const arr = q ? base.filter(u=>{
    const name = (displayName(u)||'').toLowerCase();
    return (u.username||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) || name.includes(q);
  }) : base;
  if(!arr.length){ friendsList.innerHTML = '<li class="muted">No users</li>'; return; }
  friendsList.innerHTML = arr.map(u=>{
    const av = u.avatar_url? imageUrl(u.avatar_url) : 'https://placehold.co/48x48';
    const name = displayName(u);
    const unread = unreadCounts[u.id]||0;
    const badge = unread>0 ? `<span class="badge" aria-label="${unread} unread">${unread}</span>` : '';
    return `<li class="friend" data-id="${u.id}" data-email="${u.email||''}" data-username="${u.username||''}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name} ${infinityBadge(u)}</span></div>${badge}</li>`;
  }).join('');
}

function subscribeUsers(){
  if(unsubUsers){ try{unsubUsers()}catch{} unsubUsers=null; }
  const render = async ()=>{
    if(!me){ friendsList.innerHTML=''; return; }
  const { data: users } = await sb.from('profiles').select('id, username, email, avatar_url, bio');
    allUsersCache = (users||[]).filter(u=> u.id !== me.id);
    // Prune contacts that no longer exist in profiles (deleted users)
    try{
      const existingIds = new Set((users||[]).map(u=> String(u.id)));
      const contacts = loadContacts();
      const pruned = contacts.filter(c=> existingIds.has(String(c.id)));
      if(pruned.length !== contacts.length){
        saveContacts(pruned);
        // If currently chatting with a removed user, reset the chat pane
        if(currentPeer && !existingIds.has(String(currentPeer.id))){
          currentPeer = null;
          chatHeader.innerHTML = 'Select a conversation';
          chatList.innerHTML = '';
          if(chatInput){ chatInput.placeholder = 'Message...'; }
        }
      }
    }catch{}
    // Render the full user directory in the sidebar (with search)
    renderAllUsers(allUsersCache);
    await recomputeAllUnreadCounts();
  };
  render();
  unsubUsers = subscribeTable('profiles', '', render);
}

friendsList?.addEventListener('click', (e)=>{
  const li = e.target.closest('.friend'); if(!li) return;
  const chosenName = (li.dataset.username||'').trim();
  const full = allUsersCache.find(x=> String(x.id) === String(li.dataset.id)) || null;
  currentPeer = full ? full : { id: li.dataset.id, email: li.dataset.email, username: chosenName };
  const headerName = chosenName || currentPeer.username || currentPeer.email || `User-${String(currentPeer.id||'').slice(-4)}`;
  chatHeader.innerHTML = `${headerName} ${infinityBadge(currentPeer)}`;
  subscribeChat();
  if(chatInput){ chatInput.placeholder = `Message ${headerName}...`; chatInput.focus(); }
  // Mark conversation read when opened
  markConversationRead(currentPeer.id);
});

function subscribeChat(){
  if(unsubChat){ try{unsubChat()}catch{} unsubChat=null; }
  chatList.innerHTML=''; if(!me || !currentPeer) return;
  const room = roomId(me.id, currentPeer.id);
  const filter = `room=eq.${room}`;
  const handler = async ()=>{
    const { data: msgs } = await sb.from('messages').select('id, text, sender, receiver, created_at').eq('room', room).order('created_at', { ascending: true });
    chatList.innerHTML = (msgs||[]).map(m=>{
      const own = m.sender===me.id;
      const text = escapeHTML(m.text||'');
      const delBtn = own ? '<button class="msg-del" title="Delete" aria-label="Delete message">🗑</button>' : '';
      return `<li class="message ${own?'out':'in'}" data-id="${m.id}">${text}${delBtn}</li>`;
    }).join('');
    chatList.scrollTop = chatList.scrollHeight;
    // Update last-read to last message time to clear unread for this peer
    try{
      const last = (msgs||[]).length ? (msgs[msgs.length-1].created_at || new Date().toISOString()) : new Date().toISOString();
      markConversationRead(currentPeer.id, last);
    }catch{}
  };
  handler();
  unsubChat = subscribeTable('messages', filter, handler);
}

chatForm?.addEventListener('submit', async (e)=>{
  e.preventDefault(); if(!me||!currentPeer) return;
  const text = chatInput.value.trim(); if(!text) return;
  if(currentPeer.id === me.id) return;
  const room = roomId(me.id, currentPeer.id);
  await sb.from('messages').insert({ room, text, sender: me.id, receiver: currentPeer.id });
  chatInput.value='';
  // Count/toast removed per rollback
});

// Delete message (only own outgoing messages)
chatList?.addEventListener('click', async (e)=>{
  const btn = e.target.closest?.('.msg-del');
  if(!btn) return;
  const li = btn.closest?.('li.message');
  const id = li?.dataset?.id;
  if(!id) return;
  // Basic confirm
  const ok = window.confirm('Delete this message?');
  if(!ok) return;
  // Guard: delete only if you are the sender (RLS should also enforce this server-side)
  const { error } = await sb.from('messages').delete().eq('id', id).eq('sender', me?.id||'');
  if(error){
    alert('Failed to delete message: ' + (error.message||'Unknown error'));
    return;
  }
  // Optimistic remove; realtime will also refresh the list
  try{ li.remove(); }catch{}
});

subscribeUsers();
await refreshExistingPeers();
await recomputeAllUnreadCounts();

// Build the set of peers you've already chatted with (either direction)
async function refreshExistingPeers(){
  if(!me) { existingPeerIds = new Set(); return; }
  try{
    const { data: msgs } = await sb.from('messages').select('sender, receiver').or(`sender.eq.${me.id},receiver.eq.${me.id}`);
    const s = new Set();
    for(const m of (msgs||[])){
      const other = m.sender === me.id ? m.receiver : m.sender;
      if(other && other !== me.id) s.add(other);
    }
    existingPeerIds = s;
  }catch{ existingPeerIds = new Set(); }
}

// Sidebar search re-renders list
sidebarSearch?.addEventListener('input', ()=> renderAllUsers(allUsersCache));

// Toast helper removed per rollback

// Realtime: update unread on incoming messages (receiver = me)
try{
  const filter = `receiver=eq.${me?.id||''}`;
  subscribeTable('messages', filter, async (payload)=>{
    try{
      const m = payload?.new || payload?.record || null;
      if(!m || !m.sender || m.receiver !== me?.id) return;
      const senderId = m.sender;
      // Ensure sender exists in cache; hydrate if missing
      try{
        let prof = allUsersCache.find(u=> String(u.id) === String(senderId));
        if(!prof){
          const { data: u } = await sb.from('profiles').select('id, username, email, avatar_url, bio').eq('id', senderId).single();
          prof = u || { id: senderId };
          allUsersCache = [prof, ...allUsersCache];
          renderAllUsers(allUsersCache);
        }
      }catch{}
      // If currently viewing this peer, mark read immediately using this message timestamp
      if(currentPeer && String(currentPeer.id) === String(senderId)){
        markConversationRead(senderId, m.created_at || new Date().toISOString());
        return;
      }
      // Otherwise recompute unread for that peer
      await recomputeUnreadForPeer(senderId);
  renderAllUsers(allUsersCache);
      // Subtle highlight to notify an update (unread increment)
      highlightContact(senderId);
    }catch{}
  });
}catch{}
