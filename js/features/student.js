/* Flujo del estudiante: ingreso, examen en curso (guardado, cámara, alertas) y envío. */
import { q, rpc } from '../core/api.js';
import { levelFor } from '../core/levels.js';
import { app, render } from '../core/router.js';
import { cleanupRun, stopStream } from '../core/run.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { $, esc, fmt, norm, wait } from '../core/util.js';
import { audioPlayHTML } from './audio.js';

export const views = {
  join: p => `
    <div class="card center"><h2>Presentar examen</h2>
      <label>Código del examen</label><input id="jcode" autocomplete="off" value="${esc(p?.code || '')}" style="text-transform:uppercase">
      <label>Tu nombre completo</label><input id="jname" autocomplete="name">
      <label>Tu correo electrónico</label><input id="jemail" type="email" autocomplete="email" inputmode="email">
      <div id="camwrap" hidden><p class="mut camhint">📷 Este examen requiere cámara. Verifica que te veas bien.</p>
        <video id="cam" autoplay muted playsinline></video></div>
      <p id="jmsg" class="mut"></p>
      <div class="row"><button class="lg grow" data-act="start" id="startbtn">Continuar</button><button class="ghost" data-act="home">Volver</button></div>
    </div>`,
  exam: () => {
    const { info, at } = state.run;
    const qs = at.order.map(id => info.questions.find(x => x.id === id));
    return `<div class="examhead"><div class="row"><h2 class="grow">${esc(info.title)}</h2>
      <span class="savestate" id="savestate"></span><span id="timer">--:--</span></div>
      <div class="bar"><i id="prog"></i></div></div>
    <div class="examwrap"><div>
      ${qs.map((x, i) => `<div class="card qcard" id="q${i}"><div class="row"><span class="qnum">${i + 1}</span><span class="mut">${x.points} ${x.points == 1 ? 'punto' : 'puntos'}</span></div>
        <p style="white-space:pre-wrap;margin:.6rem 0">${esc(x.text)}</p>
        ${audioPlayHTML(x)}
        ${x.type === 'mc' ? x.options.map((o, oi) => `<label class="ans"><input type="radio" name="${x.id}" data-qid="${x.id}" value="${oi}" ${at.answers[x.id] === oi ? 'checked' : ''}>${esc(o)}</label>`).join('')
        : `<input data-qid="${x.id}" placeholder="Escribe tu respuesta" value="${esc(at.answers[x.id] ?? '')}" autocomplete="off">`}
      </div>`).join('')}
      <button class="lg" data-act="finish">Enviar examen</button></div>
      <aside class="side"><div class="card">
        ${info.camera ? '<video id="cam" autoplay muted playsinline></video>' : ''}
        <div class="nav">${qs.map((x, i) => `<a href="#q${i}" id="n${i}">${i + 1}</a>`).join('')}</div></div></aside></div>`;
  },
  done: p => {
    const pct = p.show && p.max ? Math.round(p.score / p.max * 100) : 0, lv = levelFor(pct, p.levels);
    return `
    <div class="card center" style="text-align:center;max-width:560px"><img class="logo-sm" src="logo.webp" alt="Calvary Christian School"><h2>Examen enviado</h2>
      ${p.show ? `<div class="big">${p.score} / ${p.max}</div><p class="mut">${pct}%</p>
        <p><span class="tag lvl ${esc(lv.cls)}">Nivel: ${esc(lv.name)}</span></p>
        <p class="lvltext">${esc(lv.text)}</p>` : '<p class="mut">Tu profesor te dará los resultados.</p>'}
      ${p.auto ? '<p class="mut">Se envió automáticamente al terminar el tiempo.</p>' : ''}
      <button data-act="home" style="margin-top:1rem">Volver al inicio</button></div>`;
  }
};

export const acts = {
  start: startFlow,
  finish: async () => { if (await ask('¿Enviar el examen? No podrás cambiar tus respuestas.', 'Enviar')) finishExam(false); }
};

export const tokKey = (code, email) => `att:${code}:${norm(email)}`;

export const setMsg = (t, bad) => { const m = $('#jmsg'); m.textContent = t; m.className = bad ? 'wrong' : 'mut'; };

export async function startFlow() {
  const code = $('#jcode').value.trim().toUpperCase(), name = $('#jname').value.trim(), email = $('#jemail').value.trim();
  if (!code) return setMsg('Escribe el código del examen.', true);
  if (!name) return setMsg('Escribe tu nombre.', true);
  if (!/^\S+@\S+\.\S+$/.test(email)) return setMsg('Escribe un correo electrónico válido.', true);
  setMsg('');
  let info;
  try { info = await rpc('student_exam_info', { p_code: code }); } catch (e) { return setMsg(e.message, true); }
  if (info.camera && !state.stream) {
    $('#camwrap').hidden = false;
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      $('#cam').srcObject = state.stream;
      $('#startbtn').textContent = 'Comenzar examen';
      return setMsg('Cámara lista. Verifica que se te vea y pulsa “Comenzar examen”.');
    } catch (err) {
      return setMsg('No se pudo acceder a la cámara (' + err.name + '). Este examen la exige: permite el acceso en el navegador y reintenta.', true);
    }
  }
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(tokKey(code, email)) || '{}'); } catch { }
  let r;
  setMsg('Entrando al examen…');
  await wait(Math.random() * 2500); // reparte la entrada cuando toda la clase pulsa a la vez
  try { r = await rpc('student_start', { p_code: code, p_name: name, p_email: email, p_token: saved.token || null }); }
  catch (e) { return setMsg(e.message, true); }
  if (r.expired) { stopStream(); return setMsg('Tu tiempo para este examen ya terminó.', true); }
  try { localStorage.setItem(tokKey(code, email), JSON.stringify({ token: r.token })); } catch { }
  runExam(r);
}

export function runExam(r) {
  const offset = new Date(r.now).getTime() - Date.now();
  const end = new Date(r.started_at).getTime() + r.minutes * 60000;
  const at = { id: r.attempt_id, token: r.token, order: r.order, answers: r.answers || {} };
  let local = {}; try { local = JSON.parse(localStorage.getItem('ans:' + r.attempt_id) || '{}'); } catch { }
  const unsynced = Object.keys(local).some(k => JSON.stringify(local[k]) !== JSON.stringify(at.answers[k]));
  Object.assign(at.answers, local); // respaldo de este navegador: más reciente que el servidor si hubo un corte
  let plays = {}; try { plays = JSON.parse(localStorage.getItem('plays:' + r.attempt_id) || '{}'); } catch { }
  state.run = { info: r, at, timers: [], handlers: [], dirty: unsynced, last: {}, end, offset, plays };
  render('exam');
  window.scrollTo(0, 0);
  if (state.stream && r.camera) {
    const v = $('#cam'); v.srcObject = state.stream;
    const shoot = () => {
      if (!v.videoWidth) return;
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      c.getContext('2d').drawImage(v, 0, 0, 240, 180);
      rpc('student_shot', { p_attempt: at.id, p_token: at.token, p_img: c.toDataURL('image/jpeg', .5) }).catch(() => { });
    };
    setTimeout(shoot, 1500 + Math.random() * 8000);
    state.run.timers.push(setInterval(shoot, 600000));
    state.stream.getVideoTracks()[0].addEventListener('ended', () => flag('La cámara se desconectó o se apagó'));
  } else stopStream();
  const on = (t, ev, fn) => { t.addEventListener(ev, fn); state.run.handlers.push([t, ev, fn]); };
  on(document, 'visibilitychange', () => document.hidden && flag('Cambió de pestaña o minimizó la ventana'));
  on(window, 'blur', () => !document.hidden && flag('La ventana perdió el foco'));
  on(document, 'copy', () => flag('Intentó copiar texto'));
  on(document, 'paste', () => flag('Intentó pegar texto'));
  on(window, 'beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
  const tm = $('#timer');
  const tick = () => {
    const left = state.run.end - (Date.now() + state.run.offset);
    tm.textContent = '⏱ ' + fmt(left); tm.classList.toggle('low', left < 300000);
    if (left <= 0 && !state.run.finishing) finishExam(true);
  };
  tick(); state.run.timers.push(setInterval(tick, 500));
  state.run.timers.push(setInterval(() => state.run.dirty && saveAnswers(), 8000));
  markNav();
}

export async function saveAnswers() {
  if (!state.run || state.run.finishing || state.run.saving) return;
  const st = $('#savestate'); state.run.saving = true; state.run.dirty = false;
  try { await rpc('student_save', { p_attempt: state.run.at.id, p_token: state.run.at.token, p_answers: state.run.at.answers }); state.run.fails = 0; if (st) st.textContent = '✓ Guardado'; }
  catch (e) {
    if (!state.run) return;
    if (/agotado|enviado|no válido/i.test(e.message)) { if (st) st.textContent = '⚠ ' + e.message; return; } // no se arregla reintentando
    state.run.dirty = true; state.run.fails = (state.run.fails || 0) + 1; clearTimeout(state.run.retryT);
    state.run.retryT = setTimeout(saveAnswers, Math.min(30000, 2000 * 2 ** state.run.fails) + Math.random() * 1000); // espera creciente + aleatoria
    if (st) st.textContent = '⚠ Sin conexión, reintentando…';
  } finally { if (state.run) state.run.saving = false; }
}

export function flag(msg) {
  if (!state.run || state.run.finishing) return;
  const now = Date.now(); if (now - (state.run.last[msg] || 0) < 2000) return; state.run.last[msg] = now;
  rpc('student_flag', { p_attempt: state.run.at.id, p_token: state.run.at.token, p_msg: msg }).catch(() => { });
}

export function markNav() {
  if (!state.run) return;
  let n = 0;
  state.run.at.order.forEach((id, i) => { const a = state.run.at.answers[id], d = a !== undefined && a !== ''; if (d) n++; $('#n' + i)?.classList.toggle('done', d); });
  const p = $('#prog'); if (p) p.style.width = (n / state.run.at.order.length * 100) + '%';
}

export async function finishExam(auto) {
  if (!state.run || state.run.finishing) return;
  state.run.finishing = true; clearTimeout(state.run.saveT);
  const { at } = state.run;
  app.insertAdjacentHTML('afterbegin', '<div class="loading" id="sending">Enviando examen…</div>');
  for (; ;) {
    try {
      const r = await rpc('student_submit', { p_attempt: at.id, p_token: at.token, p_answers: at.answers });
      try { localStorage.removeItem('ans:' + at.id); } catch { }
      cleanupRun();
      render('done', { show: r.show, score: r.score, max: r.max, levels: r.levels, auto });
      return;
    } catch (e) {
      if (!state.run) return;
      toast('No se pudo enviar (' + e.message + '). Reintentando…', 'err');
      await wait(3000);
    }
  }
}
window.addEventListener('pagehide', stopStream);
