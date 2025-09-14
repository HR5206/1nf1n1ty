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

function roomId(a, b){ const arr=[a,b].sort(); return `dm:${arr[0]}::${arr[1]}`; }

let unsubUsers=null; let unsubChat=null; let currentPeer=null;

function subscribeUsers(){
  if(unsubUsers){ try{unsubUsers()}catch{} unsubUsers=null; }
  const render = async ()=>{
    if(!me){ friendsList.innerHTML=''; return; }
    const { data: users } = await sb.from('profiles').select('id, username, email, avatar_url');
    const others = (users||[]).filter(u=> u.id !== me.id);
    friendsList.innerHTML = others.map(u=>{
      const av = u.avatar_url? imageUrl(u.avatar_url) : 'https://placehold.co/48x48';
      const name = displayName(u);
      return `<li class="friend" data-id="${u.id}" data-email="${u.email||''}" data-username="${u.username||''}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name}</span></div></li>`;
    }).join('');
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
    chatList.innerHTML = msgs.map(m=> {
      const mine = m.sender === me.id;
      const text = escapeHTML(m.text||'');
      const delBtn = mine ? `<button class="msg-del" title="Delete" data-del="${m.id}">🗑</button>` : '';
      return `<li class="message ${mine?'out':'in'}" data-mid="${m.id}"><span class="msg-text">${text}</span> ${delBtn}</li>`;
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

// Delete message (only own messages show the button)
chatList?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('[data-del]');
  if(!btn) return;
  const id = btn.getAttribute('data-del');
  if(!id) return;
  const ok = confirm('Delete this message?');
  if(!ok) return;
  try{
    btn.setAttribute('disabled','');
    // Only allow deleting messages sent by me (RLS should also enforce this)
    await sb.from('messages').delete().eq('id', id).eq('sender', me.id);
    // Optimistic UI removal (realtime will also refresh)
    const li = document.querySelector(`.message[data-mid="${id}"]`);
    li?.remove();
  }catch(ex){
    console.error('Delete message failed', ex);
    alert(ex?.message || 'Failed to delete message');
  }finally{
    btn.removeAttribute('disabled');
  }
});

subscribeUsers();
