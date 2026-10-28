/* Pistas de audio: subida a Storage, editor y reproducción con límite de usos. */
import { sb } from '../core/config.js';
import { redraw } from '../core/router.js';
import { state } from '../core/state.js';
import { toast } from '../core/ui.js';
import { $, esc, uid } from '../core/util.js';

export const AUDIO_MAX = 10 * 1024 * 1024, AUDIO_INLINE = 1.5 * 1024 * 1024;
/* El audio se sube a Supabase Storage (CDN) y el examen guarda solo el enlace: así cada estudiante
   no descarga MB de audio dentro de la base de datos al iniciar. Si falla la subida, se incrusta (≤1.5 MB). */
export async function uploadAudio(f, mpeg) {
  const type = mpeg ? 'audio/mpeg' : f.type, ext = (f.name.match(/\.(\w{2,5})$/) || [])[1] || 'mp3';
  const path = `${state.session.user.id}/${Date.now()}-${uid()}.${ext.toLowerCase()}`;
  const { error } = await sb.storage.from('audios').upload(path, f, { contentType: type, cacheControl: '31536000' });
  if (!error) return sb.storage.from('audios').getPublicUrl(path).data.publicUrl;
  if (f.size > AUDIO_INLINE) throw new Error('No se pudo subir el audio (' + error.message + '). ¿Ejecutaste la sección de Storage de schema.sql?');
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  return url.startsWith('data:audio/') ? url : url.replace(/^data:[^;,]*/, 'data:audio/mpeg');
}
export function audioEditHTML(x, i) {
  if (x.audio) return `<div class="audbox"><label>Pista de audio</label>
    <audio controls preload="metadata" src="${esc(x.audio)}"></audio>
    <div class="row"><span class="mut">Reproducciones permitidas (0 = sin límite)</span>
      <input style="width:80px" type="number" min="0" data-q="${i}" data-f="plays" value="${x.plays || 0}">
      <span class="grow"></span><button class="sm danger" data-act="delaudio" data-q="${i}">Quitar audio</button></div></div>`;
  return `<div class="audbox"><label>Pista de audio (opcional)</label>
    <div class="row"><input type="file" accept="audio/*,.mp3,.mpeg,.mpga,.mpg" data-afile="${i}" style="flex:1">
      <input type="text" data-q="${i}" data-aurl placeholder="…o pega un enlace https:// a un .mp3" style="flex:1"></div>
    <span class="mut">Archivo de hasta 10 MB (MP3 recomendado) o enlace directo.</span></div>`;
}
export function audioPlayHTML(x) {
  if (!x.audio) return '';
  const left = x.plays ? x.plays - (state.run.plays[x.id] || 0) : null;
  return `<div class="audbox" id="aud-${x.id}">${left === 0 ? '<span class="mut">🔇 Ya usaste todas las reproducciones de este audio.</span>'
    : `<audio controls controlsList="nodownload noplaybackrate" preload="auto" data-aqid="${x.id}" src="${esc(x.audio)}"></audio>`}
    ${left === null ? '' : `<span class="mut" data-aleft="${x.id}">Reproducciones restantes: ${left}</span>`}</div>`;
}
/* Los eventos de media no burbujean: se capturan a nivel de documento.
   Una reproducción se cuenta al iniciarla (no al terminar); pausar y seguir no cuenta.
   Con límite, se bloquea adelantar/retroceder para que no se pueda rebobinar. */
export const audioInfo = e => {
  const qid = e.target.dataset?.aqid;
  return qid && state.run ? { el: e.target, qid, x: state.run.info.questions.find(z => z.id === qid) } : null;
};
document.addEventListener('play', e => {
  const a = audioInfo(e); if (!a || a.el._counted) return;
  a.el._counted = true;
  state.run.plays[a.qid] = (state.run.plays[a.qid] || 0) + 1;
  try { localStorage.setItem('plays:' + state.run.at.id, JSON.stringify(state.run.plays)); } catch { }
  if (!a.x.plays) return;
  $(`[data-aleft="${a.qid}"]`).textContent = 'Reproducciones restantes: ' + Math.max(0, a.x.plays - state.run.plays[a.qid]);
}, true);
document.addEventListener('timeupdate', e => { const a = audioInfo(e); if (a && !a.el.seeking) a.el._t = a.el.currentTime; }, true);
document.addEventListener('seeking', e => {
  const a = audioInfo(e);
  if (a && a.x.plays && a.el._t !== undefined && Math.abs(a.el.currentTime - a.el._t) > .7) a.el.currentTime = a.el._t;
}, true);
document.addEventListener('ended', e => {
  const a = audioInfo(e); if (!a) return;
  a.el._counted = false; a.el._t = 0;
  if (a.x.plays && a.x.plays - state.run.plays[a.qid] <= 0) $('#aud-' + a.qid).innerHTML = '<span class="mut">🔇 Ya usaste todas las reproducciones de este audio.</span>';
}, true);

/* Cambios en los campos de audio del editor (los llama events.js) */
export async function onAudioFile(t) {
    const f = t.files[0], x = state.ed.questions[+t.dataset.afile];
    // Un .mpeg/.mpg suele venir como video/mpeg; el audio MPEG es el mismo formato que MP3 (audio/mpeg)
    const mpeg = /\.(mp3|mpeg|mpg|mpga)$/i.test(f.name) && (!f.type || /^(audio|video)\/mpeg$/.test(f.type));
    if (!f.type.startsWith('audio/') && !mpeg) { t.value = ''; return toast('Elige un archivo de audio.', 'err'); }
    if (f.size > AUDIO_MAX) { t.value = ''; return toast('El audio pesa más de 10 MB. Comprímelo o usa un enlace.', 'err'); }
    toast('Subiendo audio…');
    try { x.audio = await uploadAudio(f, mpeg); } catch (err) { t.value = ''; return toast(err.message, 'err'); }
    redraw('editor');
}
export function onAudioUrl(t) {
    const v = t.value.trim(), x = state.ed.questions[+t.dataset.q];
    if (!v) return;
    if (!/^https:\/\//i.test(v)) return toast('El enlace debe empezar con https://', 'err');
    x.audio = v; redraw('editor');
}
