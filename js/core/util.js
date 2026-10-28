/* Utilidades puras (sin estado ni DOM propio). */

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
export const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = s / 3600 | 0; return (h ? h + ':' : '') + String(s % 3600 / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const fdate = t => new Date(t).toLocaleString('es');
export const wait = ms => new Promise(r => setTimeout(r, ms));
