import { sb, $, $$, initTheme, ensureAuthedOrRedirect, displayName, initNavAuthControls, subscribeTable, imageUrl, escapeHTML } from './shared.js';

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
const newChatBtn = $('#newChat');
const userPicker = $('#userPicker');
const userPickerList = $('#userPickerList');
const userSearch = $('#userSearch');
const closeUserPicker = $('#closeUserPicker');

function roomId(a, b){ const arr=[a,b].sort(); return `dm:${arr[0]}::${arr[1]}`; }

let unsubUsers=null; let unsubChat=null; let currentPeer=null;
let allUsersCache = [];
const CONTACTS_KEY = 'sd_chat_contacts';
let existingPeerIds = new Set();
let pickerBase = [];
function loadContacts(){
  try{ return JSON.parse(localStorage.getItem(CONTACTS_KEY)||'[]'); }catch{ return []; }
}
function saveContacts(list){ try{ localStorage.setItem(CONTACTS_KEY, JSON.stringify(list||[])); }catch{} }
function upsertContact(user){
  if(!user?.id) return;
  const list = loadContacts();
  const i = list.findIndex(x=> x.id === user.id);
  const base = { id: user.id, username: user.username||'', email: user.email||'', avatar_url: user.avatar_url||'' };
  if(i>=0) list[i] = { ...list[i], ...base };
  else list.unshift(base);
  saveContacts(list);
  renderContacts(list);
}
function renderContacts(list){
  const arr = list || loadContacts();
  friendsList.innerHTML = (arr||[]).map(u=>{
    const av = u.avatar_url? imageUrl(u.avatar_url, { bust: true }) : 'https://placehold.co/48x48';
    const name = displayName(u);
    return `<li class="friend" data-id="${u.id}" data-email="${u.email||''}" data-username="${u.username||''}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name}</span></div></li>`;
  }).join('');
}

function subscribeUsers(){
  if(unsubUsers){ try{unsubUsers()}catch{} unsubUsers=null; }
  const render = async ()=>{
    if(!me){ friendsList.innerHTML=''; return; }
    const { data: users } = await sb.from('profiles').select('id, username, email, avatar_url');
    allUsersCache = (users||[]).filter(u=> u.id !== me.id);
    // Keep rendering contacts list in sidebar
    renderContacts(loadContacts());
  };
  render();
  unsubUsers = subscribeTable('profiles', '', render);
}

friendsList?.addEventListener('click', (e)=>{
  const li = e.target.closest('.friend'); if(!li) return;
  const chosenName = (li.dataset.username||'').trim();
  currentPeer = { id: li.dataset.id, email: li.dataset.email, username: chosenName };
  const headerName = chosenName || currentPeer.email || `User-${String(currentPeer.id||'').slice(-4)}`;
  chatHeader.textContent = headerName;
  subscribeChat();
  if(chatInput){ chatInput.placeholder = `Message ${headerName}...`; chatInput.focus(); }
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

// New chat button opens user picker
newChatBtn?.addEventListener('click', async ()=>{
  await refreshExistingPeers();
  // Refresh peers and compute candidates: users not in contacts and no existing messages
  const contacts = loadContacts();
  const contactIds = new Set((contacts||[]).map(c=> c.id));
  pickerBase = allUsersCache.filter(u=> !contactIds.has(u.id) && !existingPeerIds.has(u.id));
  // Initial render without filter
  userPickerList.innerHTML = pickerBase.length ? pickerBase.map(u=>{
    const av = u.avatar_url? imageUrl(u.avatar_url, { bust: true }) : 'https://placehold.co/48x48';
    const name = displayName(u);
    return `<li class="friend" data-pick-id="${u.id}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name}</span><span class="last" style="font-size:.9em">${u.email||''}</span></div></li>`;
  }).join('') : '<li class="muted">No users available</li>';
  userPicker?.showModal();
  userSearch?.focus();
});

closeUserPicker?.addEventListener('click', ()=> userPicker?.close());

// Filter users in picker
userSearch?.addEventListener('input', ()=>{
  const q = userSearch.value.trim().toLowerCase();
  const base = pickerBase || [];
  const filtered = q ? base.filter(u=> {
    const name = (displayName(u)||'').toLowerCase();
    return (u.username||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) || name.includes(q);
  }) : base;
  userPickerList.innerHTML = filtered.length ? filtered.map(u=>{
    const av = u.avatar_url? imageUrl(u.avatar_url, { bust: true }) : 'https://placehold.co/48x48';
    const name = displayName(u);
    return `<li class="friend" data-pick-id="${u.id}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name}</span><span class="last" style="font-size:.9em">${u.email||''}</span></div></li>`;
  }).join('') : '<li class="muted">No users found</li>';
});

// Select user to start chat
userPickerList?.addEventListener('click', (e)=>{
  const li = e.target.closest('.friend'); if(!li) return;
  const uid = li.getAttribute('data-pick-id');
  const u = (pickerBase||[]).find(x=> x.id === uid) || allUsersCache.find(x=> x.id === uid);
  if(!u) return;
  // Add to contacts and open conversation
  upsertContact(u);
  userPicker?.close();
  // Simulate clicking that contact in sidebar
  const targetLi = friendsList.querySelector(`[data-id="${u.id}"]`);
  if(targetLi){ targetLi.click(); }
});
