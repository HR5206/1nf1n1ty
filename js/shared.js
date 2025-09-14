import PocketBase from 'https://unpkg.com/pocketbase@0.21.3/dist/pocketbase.es.mjs';

export const pb = new PocketBase('http://127.0.0.1:8090');

// DOM helpers
export const $ = (s, r=document)=> r.querySelector(s);
export const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));

// Theme
const THEME_KEY = 'sd_theme';
export function applyTheme(mode){ document.documentElement.classList.toggle('dark', mode==='dark'); }
export function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved=== 'dark' || saved=== 'light') applyTheme(saved);
  else if(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
  $('#themeToggle')?.addEventListener('click', ()=>{
    const isDark = !document.documentElement.classList.contains('dark');
    applyTheme(isDark?'dark':'light');
    localStorage.setItem(THEME_KEY, isDark?'dark':'light');
  });
}

// Utils
export function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]||c)); }
export function toDate(x){ try{ return x? new Date(x): new Date(); }catch{ return new Date(); } }
export function sanitizeUsername(s){
  const v = (s||'').toLowerCase().replace(/[^a-z0-9_.-]/g,'').replace(/^[_.-]+|[_.-]+$/g,'');
  return v.slice(0, 30);
}
export async function makeAvatarFromEmail(email){
  try{
    const letter = (email||'?').trim().charAt(0).toUpperCase() || '?';
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=120;
    const ctx = canvas.getContext('2d');
    let h=0; for(const ch of email){ h = (h*31 + ch.charCodeAt(0))>>>0; }
    const hue = h % 360; ctx.fillStyle = `hsl(${hue},65%,55%)`;
    ctx.fillRect(0,0,120,120);
    ctx.fillStyle='#fff'; ctx.font='700 64px Inter, Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(letter, 60, 68);
    return canvas.toDataURL('image/png');
  }catch{ return 'https://placehold.co/120x120?text=?'; }
}
export async function dataUrlToBlob(dataUrl){
  // Use fetch for simplicity; supported in modern browsers for data URLs
  const res = await fetch(dataUrl);
  return await res.blob();
}
export async function compressImage(file, maxW=1280, quality=0.85){
  if(!file || !file.type?.startsWith('image/')) return null;
  const img = new Image(); const url = URL.createObjectURL(file);
  await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; }); URL.revokeObjectURL(url);
  const scale = Math.min(1, maxW/img.width); const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
  const canvas = document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
  const blob = await new Promise(res=> canvas.toBlob(res,'image/jpeg',quality));
  return blob;
}
export function displayName(user){
  const uname = (user?.username||'').trim();
  if(uname) return uname;
  const id = (user?.id||'').toString();
  if(id) return `User-${id.slice(-4)}`;
  return 'User';
}

// Auth helpers
export function isAuthed(){ return !!pb.authStore.model; }
export function ensureAuthedOrRedirect(){ if(!isAuthed()) { location.href = './index.html'; return false; } return true; }

export function initNavAuthControls(){
  const loginBtn = $('#loginBtn');
  const logoutBtn = $('#logoutBtn');
  if(isAuthed()){
    loginBtn?.setAttribute('hidden','');
    logoutBtn?.removeAttribute('hidden');
  }else{
    logoutBtn?.setAttribute('hidden','');
    loginBtn?.removeAttribute('hidden');
  }
  logoutBtn?.addEventListener('click', ()=>{ pb.authStore.clear(); location.href='./index.html'; });
}
