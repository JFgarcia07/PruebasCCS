/* Resultados de los estudiantes: tabla, detalle de un intento y CSV. */
import { EXAM_COLS, fullExam, q } from '../core/api.js';
import { sb } from '../core/config.js';
import { levelFor } from '../core/levels.js';
import { go } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, download } from '../core/ui.js';
import { $, esc, fdate, fmt, norm } from '../core/util.js';

export const loaders = {
  async results(examId) {
    const [exams, attempts] = await Promise.all([
      q(sb.from('exams').select(EXAM_COLS).order('created_at', { ascending: false })),
      q(sb.from('attempts').select('id,exam_id,student_name,started_at,ended_at,score,max_score,flags').order('started_at', { ascending: false }))]);
    state.cache.exams = exams;
    return { exams, attempts: attempts.filter(a => !examId || a.exam_id === examId), examId };
  }
};

export const views = {
  results: ({ exams, attempts, examId }) => {
    const done = attempts.filter(a => a.ended_at && a.max_score);
    const avg = done.length ? Math.round(done.reduce((s, a) => s + a.score / a.max_score, 0) / done.length * 100) : null;
    const alerts = attempts.reduce((s, a) => s + a.flags.length, 0);
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Resultados</h2>
      <button class="sec" data-act="reports">📝 Ver reportes de estudiantes</button>
      <select id="resfilter" style="width:auto"><option value="">Todos los exámenes</option>
      ${exams.map(e => `<option value="${e.id}" ${e.id === examId ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select>
      <button class="sec" data-act="csv" data-id="${examId || ''}">⬇ CSV</button></div>
    <div class="stats"><div class="stat"><b>${attempts.length}</b><span>Intentos</span></div>
      <div class="stat"><b>${avg === null ? '—' : avg + '%'}</b><span>Promedio</span></div>
      <div class="stat"><b>${alerts}</b><span>Alertas de conducta</span></div></div>
    <div class="card tablewrap">${attempts.length ? `<table><thead><tr><th>Estudiante</th><th>Examen</th><th>Nota</th><th>Nivel</th><th>Fecha</th><th>Alertas</th><th></th></tr></thead><tbody>
    ${attempts.map(a => {
      const ex = exams.find(e => e.id === a.exam_id);
      return `<tr><td><b>${esc(a.student_name)}</b></td><td>${esc(ex ? ex.title : '')}</td>
      <td>${a.ended_at ? `<b>${a.score}</b>/${a.max_score}` : '<span class="tag warn">en curso</span>'}</td>
      <td>${a.ended_at && a.max_score ? (l => `<span class="tag ${esc(l.cls)}">${esc(l.name)}</span>`)(levelFor(Math.round(a.score / a.max_score * 100), ex?.levels)) : '<span class="mut">—</span>'}</td><td>${fdate(a.started_at)}</td>
      <td>${a.flags.length ? `<span class="tag bad">${a.flags.length}</span>` : '<span class="mut">—</span>'}</td>
      <td class="row"><button class="sm sec" data-act="detail" data-id="${a.id}">Ver</button>
      <button class="sm danger" data-act="delatt" data-id="${a.id}">✕</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty"><div class="ic">📭</div>Sin intentos todavía.</div>'}</div>`;
  }
};

export const acts = {
  results: el => go('results', el?.dataset.id || ''),
  detail: el => showDetail(el.dataset.id),
  closemodal: () => $('.modal')?.remove(),
  delatt: async el => {
    if (!await ask('¿Borrar este intento?', 'Borrar')) return;
    await q(sb.from('attempts').delete().eq('id', el.dataset.id)); go('results', $('#resfilter')?.value || '');
  },
  csv: async el => {
    const { exams, attempts } = await loaders.results(el.dataset.id || '');
    const rows = [['Estudiante', 'Examen', 'Nota', 'Máximo', 'Inicio', 'Fin', 'Alertas']];
    attempts.forEach(a => rows.push([a.student_name, exams.find(e => e.id === a.exam_id)?.title, a.score ?? '', a.max_score ?? '', fdate(a.started_at), a.ended_at ? fdate(a.ended_at) : '', a.flags.length]));
    download('resultados.csv', '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }
};

export async function showDetail(id) {
  const [a, shots] = await Promise.all([
    q(sb.from('attempts').select('*').eq('id', id).single()),
    q(sb.from('shots').select('taken_at,img').eq('attempt_id', id).order('taken_at'))]);
  const ex = await fullExam(a.exam_id).catch(() => null);
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><div class="row"><h3 class="grow">${esc(a.student_name)} — ${esc(ex?.title || '')}</h3><button class="sm sec" data-act="closemodal">Cerrar</button></div>
    <p>Nota: <b>${a.score ?? '—'}/${a.max_score ?? '—'}</b>${a.ended_at && a.max_score ? (p => ` (${p} %) · Nivel: <b>${esc(levelFor(p, ex?.levels).name)}</b>`)(Math.round(a.score / a.max_score * 100)) : ''} · Inicio: ${fdate(a.started_at)}${a.ended_at ? ' · Duración: ' + fmt(new Date(a.ended_at) - new Date(a.started_at)) : ''}</p>
    <h4>Alertas (${a.flags.length})</h4>${a.flags.length ? '<ul>' + a.flags.map(f => `<li>${new Date(f.t).toLocaleTimeString('es')} — ${esc(f.msg)}</li>`).join('') + '</ul>' : '<p class="mut">Sin alertas.</p>'}
    <h4>Fotos de la cámara (${shots.length})</h4><div class="shots">${shots.map(s => `<img src="${s.img}" title="${new Date(s.taken_at).toLocaleTimeString('es')}">`).join('') || '<span class="mut">Sin fotos.</span>'}</div>
    <h4 style="margin-top:1rem">Respuestas</h4>${ex ? ex.questions.map((x, i) => {
    const r = a.answers[x.id];
    const ok = x.type === 'mc' ? r === x.correct : r !== undefined && x.answers.some(z => norm(z) === norm(r));
    const given = r === undefined || r === '' ? '<i>sin respuesta</i>' : esc(x.type === 'mc' ? x.options[r] : r);
    const key = x.type === 'mc' ? x.options[x.correct] : x.answers.join(' | ');
    return `<div class="ansline"><b>${i + 1}.</b> ${esc(x.text)}<br><span class="${ok ? 'right' : 'wrong'}">${ok ? '✔' : '✘'} ${given}</span>${ok ? '' : ` <span class="mut">(correcta: ${esc(key)})</span>`}</div>`;
  }).join('') : '<p class="mut">El examen ya no existe.</p>'}</div>`;
  document.body.appendChild(m);
}
