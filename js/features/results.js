/* Resultados de los estudiantes: tabla, detalle de un intento y CSV. */
import { EXAM_COLS, fullExam, q, rpc } from '../core/api.js';
import { sb } from '../core/config.js';
import { levelFor } from '../core/levels.js';
import { go } from '../core/router.js';
import { cvButtons } from './coeval.js';
import { isAdmin, state } from '../core/state.js';
import { ask, download, toast } from '../core/ui.js';
import { $, esc, fdate, fmt, norm } from '../core/util.js';

export const loaders = {
  async results(examId) {
    const [exams, attempts, owners, cvmap] = await Promise.all([
      q(sb.from('exams').select(EXAM_COLS).order('created_at', { ascending: false })),
      q(sb.from('attempts').select('id,exam_id,student_name,email,started_at,ended_at,score,score_auto,score_edited_at,max_score,flags').order('started_at', { ascending: false })),
      // la administración ve los exámenes de todos y necesita saber de quién es cada uno
      isAdmin() ? q(sb.from('profiles').select('id,email')).then(r => Object.fromEntries(r.map(p => [p.id, p.email]))) : {},
      isAdmin() ? q(sb.from('coevals').select('id,attempt_id,code').not('attempt_id', 'is', null)).then(r => Object.fromEntries(r.map(c => [c.attempt_id, c]))) : {}]);
    state.cache.exams = exams; state.cache.attempts = attempts;
    return { exams, attempts: attempts.filter(a => !examId || a.exam_id === examId), examId, owners, cvmap };
  }
};

export const views = {
  results: ({ exams, attempts, examId, owners, cvmap }) => {
    const admin = isAdmin();
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
    <div class="card tablewrap">${attempts.length ? `<table><thead><tr><th>Estudiante</th><th>Examen</th>${admin ? '<th>Profesor</th>' : ''}<th>Nota</th><th>Nivel</th><th>Fecha</th><th>Alertas</th><th></th></tr></thead><tbody>
    ${attempts.map(a => {
      const ex = exams.find(e => e.id === a.exam_id);
      return `<tr><td><b>${esc(a.student_name)}</b>${a.email ? `<br><span class="mut">${esc(a.email)}</span>` : ''}</td><td>${esc(ex ? ex.title : '')}</td>${admin ? `<td>${esc(owners[ex?.owner] || '')}</td>` : ''}
      <td style="white-space:nowrap">${a.ended_at ? `<b>${a.score}</b>/${a.max_score}${a.score_edited_at ? ` <span class="tag warn" title="Nota automática: ${a.score_auto}">editada</span>` : ''}${admin ? ` <button class="sm ghost" data-act="editscore" data-id="${a.id}" data-score="${a.score}" data-max="${a.max_score}" title="Modificar la nota a mano">✎</button>` : ''}` : '<span class="tag warn">en curso</span>'}</td>
      <td>${a.ended_at && a.max_score ? (l => `<span class="tag ${esc(l.cls)}">${esc(l.name)}</span>`)(levelFor(Math.round(a.score / a.max_score * 100), ex?.levels)) : '<span class="mut">—</span>'}</td><td>${fdate(a.started_at)}</td>
      <td>${a.flags.length ? `<span class="tag bad">${a.flags.length}</span>` : '<span class="mut">—</span>'}</td>
      <td class="row"><button class="sm sec" data-act="detail" data-id="${a.id}">Ver</button>
      ${admin ? cvButtons(a, cvmap) : ''}<button class="sm danger" data-act="delatt" data-id="${a.id}">✕</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty"><div class="ic">📭</div>Sin intentos todavía.</div>'}</div>`;
  }
};

export const acts = {
  results: el => go('results', el?.dataset.id || ''),
  detail: el => showDetail(el.dataset.id),
  closemodal: () => $('.modal')?.remove(),
  /* Solo la administración (el servidor lo vuelve a comprobar) */
  editscore: el => {
    const m = document.createElement('div'); m.className = 'modal small';
    m.innerHTML = `<div class="card"><h3>Modificar la nota</h3>
      <p class="mut">Se guarda la nota automática original y la nota queda marcada como editada.</p>
      <label>Nueva nota (0 a ${esc(el.dataset.max)})</label><input id="newscore" type="number" min="0" max="${esc(el.dataset.max)}" step="any" inputmode="decimal" value="${esc(el.dataset.score)}">
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button>
      <button data-act="dosetscore" data-id="${esc(el.dataset.id)}" data-max="${esc(el.dataset.max)}">Guardar</button></div></div>`;
    document.body.appendChild(m); $('#newscore').select();
  },
  dosetscore: async el => {
    const v = $('#newscore').value.trim(), n = +v;
    if (v === '' || !(n >= 0 && n <= +el.dataset.max)) return toast(`La nota debe estar entre 0 y ${el.dataset.max}.`, 'err');
    await rpc('admin_set_score', { p_attempt: el.dataset.id, p_score: n });
    $('.modal')?.remove(); toast('Nota modificada', 'ok'); go('results', $('#resfilter')?.value || '');
  },
  delatt: async el => {
    if (!await ask('¿Borrar este intento?', 'Borrar')) return;
    await q(sb.from('attempts').delete().eq('id', el.dataset.id)); go('results', $('#resfilter')?.value || '');
  },
  csv: async el => {
    const { exams, attempts } = await loaders.results(el.dataset.id || '');
    const rows = [['Estudiante', 'Correo', 'Examen', 'Nota', 'Máximo', 'Inicio', 'Fin', 'Alertas']];
    attempts.forEach(a => rows.push([a.student_name, a.email || '', exams.find(e => e.id === a.exam_id)?.title, a.score ?? '', a.max_score ?? '', fdate(a.started_at), a.ended_at ? fdate(a.ended_at) : '', a.flags.length]));
    download('resultados.csv', '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }
};

export async function showDetail(id) {
  const [a, shots] = await Promise.all([
    q(sb.from('attempts').select('*').eq('id', id).single()),
    q(sb.from('shots').select('taken_at,img').eq('attempt_id', id).order('taken_at'))]);
  const ex = await fullExam(a.exam_id).catch(() => null);
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><div class="row"><h3 class="grow">${esc(a.student_name)}${a.email ? ' · ' + esc(a.email) : ''} — ${esc(ex?.title || '')}</h3><button class="sm sec" data-act="closemodal">Cerrar</button></div>
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
