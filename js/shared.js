import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function readMeta(name){
  try{ return document?.querySelector?.(`meta[name="${name}"]`)?.getAttribute?.('content') || null; }
  catch{ return null; }
}

const SB_URL = readMeta('supabase-url')
  || (typeof window !== 'undefined' && (window.SUPABASE_URL || window.SB_URL))
  || (typeof localStorage !== 'undefined' && (localStorage.getItem('SUPABASE_URL') || localStorage.getItem('SB_URL')))
  || '';
const SB_ANON = readMeta('supabase-anon-key')
  || (typeof window !== 'undefined' && (window.SUPABASE_ANON_KEY || window.SB_ANON))
  || (typeof localStorage !== 'undefined' && (localStorage.getItem('SUPABASE_ANON_KEY') || localStorage.getItem('SB_ANON')))
  || '';

export const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: true, autoRefreshToken: true } });

let currentUser = null;
// Initialize current user and keep in sync
sb.auth.getUser().then(res=>{ currentUser = res.data?.user || null; }).catch(()=>{});
sb.auth.onAuthStateChange((_event, session)=>{ currentUser = session?.user || null; });

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
  const uname = (user?.username||user?.display_name||'').trim();
  if(uname) return uname;
  const id = (user?.id||user?.user_id||'').toString();
  if(id) return `User-${id.slice(-4)}`;
  return 'User';
}

// Auth helpers (Supabase)
export function getUserSync(){ return currentUser; }
export async function getUser(){ try{ const r = await sb.auth.getUser(); return r.data.user || null; }catch{ return null; } }
export async function ensureAuthedOrRedirect(){ const u = await getUser(); if(!u){ location.href = './index.html'; return false; } return true; }

export function initNavAuthControls(){
  const loginBtn = $('#loginBtn');
  const logoutBtn = $('#logoutBtn');
  const refresh = ()=>{ const u = getUserSync(); if(u){ loginBtn?.setAttribute('hidden',''); logoutBtn?.removeAttribute('hidden'); } else { logoutBtn?.setAttribute('hidden',''); loginBtn?.removeAttribute('hidden'); } };
  refresh();
  sb.auth.onAuthStateChange(()=> refresh());
  logoutBtn?.addEventListener('click', async ()=>{ await sb.auth.signOut(); location.href='./index.html'; });
}

// Storage helpers
export const IMAGES_BUCKET = 'images';
export function imageUrl(path){ if(!path) return ''; const { data } = sb.storage.from(IMAGES_BUCKET).getPublicUrl(path); return data?.publicUrl || ''; }
export async function uploadImage(path, file){ return sb.storage.from(IMAGES_BUCKET).upload(path, file, { upsert: true, contentType: file?.type||'application/octet-stream' }); }

// Realtime helper
export function subscribeTable(table, filter, handler){
  const chan = sb.channel(`realtime:${table}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, payload => handler(payload))
    .subscribe();
  return ()=>{ try{ sb.removeChannel(chan); }catch{} };
}
