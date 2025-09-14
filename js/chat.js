import { pb, $, $$, initTheme, ensureAuthedOrRedirect, displayName, initNavAuthControls } from './shared.js';

initTheme();
initNavAuthControls();
if(!ensureAuthedOrRedirect()) throw new Error('Not authed');

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
    const me = pb.authStore.model; if(!me){ friendsList.innerHTML=''; return; }
    const users = await pb.collection('users').getFullList();
    const others = users.filter(u=> u.id !== me.id);
    friendsList.innerHTML = others.map(u=>{
      const av = u.avatar? pb.files.getUrl(u, u.avatar, { thumb: '48x48' }): 'https://placehold.co/48x48';
      const name = displayName(u);
      return `<li class="friend" data-id="${u.id}" data-email="${u.email||''}" data-username="${u.username||''}"><div class="avatar-wrap"><img class="avatar" src="${av}" alt=""/></div><div class="meta"><span class="name">${name}</span></div></li>`;
    }).join('');
  };
  render();
  unsubUsers = pb.collection('users').subscribe('*', render);
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
  chatList.innerHTML=''; const me = pb.authStore.model; if(!me || !currentPeer) return;
  const room = roomId(me.id, currentPeer.id);
  const filter = `room="${room}" && (sender="${me.id}" || receiver="${me.id}")`;
  const handler = async ()=>{
    const msgs = await pb.collection('messages').getFullList({ filter, sort: '+created' });
    chatList.innerHTML = msgs.map(m=> `<li class="message ${m.sender===me.id?'out':'in'}">${(m.text||'')}</li>`).join('');
    chatList.scrollTop = chatList.scrollHeight;
  };
  handler();
  unsubChat = pb.collection('messages').subscribe('*', handler, { filter });
}

chatForm?.addEventListener('submit', async (e)=>{
  e.preventDefault(); const me = pb.authStore.model; if(!me||!currentPeer) return;
  const text = chatInput.value.trim(); if(!text) return;
  if(currentPeer.id === me.id) return;
  const room = roomId(me.id, currentPeer.id);
  await pb.collection('messages').create({ room, text, sender: me.id, receiver: currentPeer.id });
  chatInput.value='';
});

subscribeUsers();
