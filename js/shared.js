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
  if(saved=== 'dark' || saved=== 'light') {
    applyTheme(saved);
  } else {
    // Default to dark when unset; fall back to prefers-color-scheme if needed
    const defaultMode = 'dark';
    applyTheme(defaultMode);
    try{ localStorage.setItem(THEME_KEY, defaultMode); }catch{}
  }
  $('#themeToggle')?.addEventListener('click', ()=>{
    const isDark = !document.documentElement.classList.contains('dark');
    applyTheme(isDark?'dark':'light');
    localStorage.setItem(THEME_KEY, isDark?'dark':'light');
    // Refresh theme-dependent assets like the logo
    try{ initLogo(); }catch{}
  });
}

// Logo init: set the header logo from one place (supports light/dark variants)
const LOGO_KEY = 'sd_logo_src';
const LOGO_LIGHT_KEY = 'sd_logo_src_light';
const LOGO_DARK_KEY = 'sd_logo_src_dark';
export function initLogo(){
  try{
    const el = document.getElementById('siteLogo'); if(!el) return;
    const isDark = document.documentElement.classList.contains('dark');
    // Meta tags allow specifying per-theme logos
    const metaSingle = document.querySelector('meta[name="app-logo"]')?.getAttribute('content');
    const metaLight = document.querySelector('meta[name="app-logo-light"]')?.getAttribute('content');
    const metaDark  = document.querySelector('meta[name="app-logo-dark"]')?.getAttribute('content');
    // LocalStorage overrides
    const savedSingle = localStorage.getItem(LOGO_KEY);
    const savedLight = localStorage.getItem(LOGO_LIGHT_KEY);
    const savedDark  = localStorage.getItem(LOGO_DARK_KEY);
    const DEFAULT_SRC = './assets/1nf1n1ty.webp';
    const current = el.getAttribute('src') || '';
    const isPlaceholder = current.startsWith('data:image/gif');
    // Resolve best source for current theme
    const themed = isDark
      ? (metaDark || savedDark)
      : (metaLight || savedLight);
    const fallback = metaSingle || savedSingle || (isPlaceholder ? '' : current) || DEFAULT_SRC;
    const src = themed || fallback;
    if(src && el.getAttribute('src') !== src) el.setAttribute('src', src);
  }catch{}
}
export function setLogo(src){
  try{
    if(src){
      localStorage.setItem(LOGO_KEY, src);
      $('#siteLogo')?.setAttribute('src', src);
    }
  }catch{}
}
export function setLogoForTheme(srcLight, srcDark){
  try{
    if(srcLight) localStorage.setItem(LOGO_LIGHT_KEY, srcLight);
    if(srcDark)  localStorage.setItem(LOGO_DARK_KEY, srcDark);
    initLogo();
  }catch{}
}

// Utils
export function escapeHTML(s){ return (s||'').replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]||c)); }
export function toDate(x){ try{ return x? new Date(x): new Date(); }catch{ return new Date(); } }
export function sanitizeUsername(s){
  const v = (s||'').toLowerCase().replace(/[^a-z0-9_.-]/g,'').replace(/^[_.-]+|[_.-]+$/g,'');
  return v.slice(0, 30);
}
export async function makeAvatarFromEmail(email){
  // Original simple canvas-based letter avatar
  try{
    const letter = (email||'?').trim().charAt(0).toUpperCase() || '?';
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=120;
    const ctx = canvas.getContext('2d');
    let h=0; for(const ch of String(email||'?')){ h = (h*31 + ch.charCodeAt(0))>>>0; }
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

// Team 1nf1n1ty badge helpers
export function hasInfinityTag(user){
  try{
    const bio = (user?.bio||'').toString();
    // Case-insensitive whole-word match for "1nf1n1ty"
    return /\b1nf1n1ty\b/i.test(bio);
  }catch{ return false; }
}
export function infinityBadge(user){
  return hasInfinityTag(user)
    ? `<span class="badge-1nf1n1ty" title="Team 1nf1n1ty"><img src="./assets/1nf1n1ty.webp" alt="1nf1n1ty"/></span>`
    : '';
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
export function imageUrl(path, opts){
  if(!path) return '';
  const { data } = sb.storage.from(IMAGES_BUCKET).getPublicUrl(path);
  let url = data?.publicUrl || '';
  if(opts?.bust){ url += (url.includes('?') ? '&' : '?') + 't=' + Date.now(); }
  return url;
}
export async function uploadImage(path, file){ return sb.storage.from(IMAGES_BUCKET).upload(path, file, { upsert: true, contentType: file?.type||'application/octet-stream' }); }

// Realtime helper
export function subscribeTable(table, filter, handler){
  const chan = sb.channel(`realtime:${table}:${Math.random().toString(36).slice(2)}`);
  const details = { event: '*', schema: 'public', table };
  if (filter && String(filter).trim().length) details.filter = filter;
  chan.on('postgres_changes', details, payload => handler(payload)).subscribe();
  return ()=>{ try{ sb.removeChannel(chan); }catch{} };
}
