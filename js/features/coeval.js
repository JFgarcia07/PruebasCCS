/* Coevaluación docente (solo administración): la administración ve a todos los estudiantes que han presentado algún examen
   y los califica ahí mismo con la rúbrica por defecto (comportamiento y académico, de 1 a 4 por criterio). */
import { q } from '../core/api.js';
import { sb } from '../core/config.js';
import { cvKey, cvScore, cvTotalCriteria, DEFAULT_COEVAL } from '../core/coeval-rubric.js';
import { go, render } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { $, esc, fdate, norm } from '../core/util.js';

const R = DEFAULT_COEVAL;
const OUT_OF = R.sections.reduce((a, s) => a + s.points, 0);
/* Un estudiante es su correo (o su nombre, en los intentos antiguos que no lo tienen), sin importar cuántos exámenes haya hecho */
const studentKey = a => a.email ? a.email.trim().toLowerCase() : 'n:' + norm(a.student_name);

export const loaders = {
  async coevals() {
    const [att, exams, list] = await Promise.all([
      q(sb.from('attempts').select('exam_id,student_name,email,grade').order('started_at', { ascending: false })),
      q(sb.from('exams').select('id,title')),
      q(sb.from('coevaluations').select('id,student_key,scores,comment,evaluator,updated_at'))]);
    const title = Object.fromEntries(exams.map(e => [e.id, e.title])), students = new Map();
    for (const a of att) {
      const k = studentKey(a); let s = students.get(k);
      if (!s) students.set(k, s = { key: k, name: a.student_name, email: a.email || '', grade: a.grade || '', exams: new Set() });
      if (!s.grade && a.grade) s.grade = a.grade;
      s.exams.add(title[a.exam_id] || 'Examen');
    }
    state.cv = { students: [...students.values()].sort((x, y) => x.name.localeCompare(y.name, 'es')), evals: new Map(list.map(e => [e.student_key, e])) };
    return state.cv;
  }
};

const rowHTML = (s, e) => {
  const sc = e ? cvScore(R, e.scores) : null, ex = [...s.exams];
  return `<tr data-find="${esc(norm(s.name + ' ' + s.email))}" data-done="${e ? 1 : 0}">
    <td><b>${esc(s.name)}</b>${s.email ? `<br><span class="mut">${esc(s.email)}</span>` : ''}${s.grade ? `<br><span class="tag">${esc(s.grade)}</span>` : ''}</td>
    <td class="mut" title="${esc(ex.join(' · '))}">${esc(ex.slice(0, 2).join(' · '))}${ex.length > 2 ? ` +${ex.length - 2}` : ''}</td>
    ${sc ? `${sc.parts.map(p => `<td>${p.points}</td>`).join('')}<td><b>${sc.total}</b></td><td class="mut">${fdate(e.updated_at)}</td>`
      : `<td colspan="${R.sections.length + 1}"><span class="tag warn">Pendiente</span></td><td></td>`}
    <td><button class="sm ${e ? 'sec' : ''}" data-act="coevfill" data-key="${esc(s.key)}">${e ? 'Editar' : 'Evaluar'}</button></td></tr>`;
};

export const views = {
  coevals: () => {
    const { students, evals } = state.cv, done = students.filter(s => evals.has(s.key));
    const avg = done.length ? Math.round(done.reduce((a, s) => a + cvScore(R, evals.get(s.key).scores).total, 0) / done.length * 100) / 100 : null;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Coevaluación docente</h2></div>
    <p class="mut">Estudiantes que han presentado algún examen. Pulsa <b>Evaluar</b> para calificar sus criterios de comportamiento y académico.</p>
    <div class="stats"><div class="stat"><b>${students.length}</b><span>Estudiantes</span></div>
      <div class="stat"><b>${done.length}</b><span>Evaluados</span></div>
      <div class="stat"><b>${students.length - done.length}</b><span>Pendientes</span></div>
      <div class="stat"><b>${avg === null ? '—' : avg}</b><span>Promedio (de ${OUT_OF})</span></div></div>
    <div class="row" style="margin-bottom:.8rem"><input id="cvq" class="grow" placeholder="Buscar por nombre o correo…" autocomplete="off">
      <select id="cvfilter" style="width:auto"><option value="">Todos</option><option value="0">Pendientes</option><option value="1">Evaluados</option></select></div>
    <div class="card tablewrap">${students.length ? `<table><thead><tr><th>Estudiante</th><th>Exámenes</th>${R.sections.map(s => `<th>${esc(s.name)} /${s.points}</th>`).join('')}<th>Total /${OUT_OF}</th><th>Actualizado</th><th></th></tr></thead>
      <tbody id="cvrows">${students.map(s => rowHTML(s, evals.get(s.key))).join('')}</tbody></table>`
      : '<div class="empty"><div class="ic">📭</div>Aún no hay estudiantes que hayan presentado un examen.</div>'}</div>`;
  },

  coevfill: () => {
    const f = state.cf;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Coevaluación · ${esc(f.name)}</h2>
      <button class="ghost" data-act="coevals">Cancelar</button><button data-act="coevsave">Guardar</button></div>
    <div class="card"><div class="tags" style="margin:0"><span class="tag">👤 ${esc(f.name)}</span>${f.email ? `<span class="tag">${esc(f.email)}</span>` : ''}${f.grade ? `<span class="tag">${esc(f.grade)}</span>` : ''}
      ${f.exams.map(t => `<span class="tag">📝 ${esc(t)}</span>`).join('')}</div>
      <p class="mut" style="margin:.6rem 0 0">Marca, en cada criterio, la descripción que mejor representa al estudiante.</p></div>
    ${R.sections.map(s => `<h3 style="margin-top:1.2rem;color:var(--pri)">${s.id}. ${esc(s.name)} (${s.points} puntos)</h3>
      <div class="card tablewrap" style="padding:0"><table class="rub"><thead><tr><th>Criterio</th>${R.levels.map(l => `<th>${l.v} · ${esc(l.name)}</th>`).join('')}</tr></thead><tbody>
      ${s.criteria.map(c => `<tr><th class="crit">${esc(c.name)}</th>${R.levels.map(l => `<td><label class="rcell"><input type="radio" name="cv-${cvKey(s, c)}" data-cvk="${cvKey(s, c)}" value="${l.v}" ${+f.scores[cvKey(s, c)] === l.v ? 'checked' : ''}><span>${esc(c.desc[l.v])}</span></label></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`).join('')}
    <div id="cvsum" class="card" style="background:var(--pri-soft)">${summaryHTML()}</div>
    <div class="card"><label style="margin-top:0">Comentario sobre el estudiante (opcional)</label>
      <textarea data-cvf="comment" maxlength="2000" placeholder="Fortalezas, áreas a reforzar…">${esc(f.comment)}</textarea>
      <div class="row" style="margin-top:1rem"><button class="lg grow" data-act="coevsave">Guardar coevaluación</button>
      ${f.id ? '<button class="danger" data-act="delcoeval">Quitar evaluación</button>' : ''}</div></div>`;
  }
};

/* Resumen en vivo mientras se marcan criterios */
function summaryHTML() {
  const s = cvScore(R, state.cf.scores), done = s.parts.reduce((a, p) => a + p.done, 0), n = cvTotalCriteria(R);
  return `<div class="row">${s.parts.map(p => `<span><b>${esc(p.name)}:</b> ${p.points} / ${p.outOf}</span>`).join('<span class="mut">·</span>')}
    <span class="mut">·</span><span><b>Total:</b> ${s.total} / ${s.outOf}</span><span class="grow"></span><span class="mut">${done} de ${n} criterios marcados</span></div>`;
}

/* Marcar un criterio / escribir el comentario (lo llama events.js) */
export function onCoevalInput(t) {
  if (t.dataset.cvk) { state.cf.scores[t.dataset.cvk] = +t.value; const el = $('#cvsum'); if (el) el.innerHTML = summaryHTML(); }
  else if (t.dataset.cvf) state.cf[t.dataset.cvf] = t.value;
}
/* Búsqueda y filtro de la lista: solo muestra u oculta filas, sin volver a pintar */
export function onCoevFilter() {
  const text = norm($('#cvq').value), st = $('#cvfilter').value;
  document.querySelectorAll('#cvrows tr').forEach(r => { r.hidden = !(r.dataset.find.includes(text) && (st === '' || r.dataset.done === st)); });
}

export const acts = {
  coevals: () => go('coevals'),
  coevfill: el => {
    const s = state.cv.students.find(x => x.key === el.dataset.key), e = state.cv.evals.get(s.key);
    state.cf = { key: s.key, name: s.name, email: s.email, grade: s.grade, exams: [...s.exams], id: e?.id || null, scores: { ...(e?.scores || {}) }, comment: e?.comment || '' };
    go('coevfill');
  },
  coevsave: async () => {
    const f = state.cf, n = cvTotalCriteria(R), got = Object.keys(f.scores).length;
    if (got < n) return toast(`Faltan criterios por calificar (${got} de ${n}).`, 'err');
    const row = { student_key: f.key, student_name: f.name, student_email: f.email || null, scores: f.scores, comment: f.comment.trim().slice(0, 2000),
      evaluator: state.profile?.name || state.profile?.email || '', updated_at: new Date().toISOString() };
    const saved = await q(sb.from('coevaluations').upsert(row, { onConflict: 'student_key' }).select('id,student_key,scores,comment,evaluator,updated_at').single());
    state.cv.evals.set(f.key, saved);
    toast('Coevaluación guardada', 'ok'); render('coevals'); window.scrollTo(0, 0);
  },
  delcoeval: async () => {
    const f = state.cf;
    if (!await ask('¿Quitar la evaluación de este estudiante?', 'Quitar')) return;
    await q(sb.from('coevaluations').delete().eq('id', f.id));
    state.cv.evals.delete(f.key); render('coevals'); window.scrollTo(0, 0);
  }
};
