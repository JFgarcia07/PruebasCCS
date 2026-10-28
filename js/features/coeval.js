/* Coevaluación docente: la administración crea una coevaluación de un estudiante y comparte el enlace; cada docente
   (sin cuenta) elige su curso y califica los criterios de la rúbrica. La administración ve todo lo recopilado. */
import { q, rpc } from '../core/api.js';
import { sb } from '../core/config.js';
import { cvKey, cvScore, cvTotalCriteria, DEFAULT_COEVAL } from '../core/coeval-rubric.js';
import { go, redraw, render } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { $, esc, fdate, norm } from '../core/util.js';

const cvStoreKey = (code, course) => `cv:${code}:${norm(course)}`;
const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length * 100) / 100 : null;
const num = v => v === null ? '—' : v;

export const loaders = {
  async coevals() {
    const [list, ents] = await Promise.all([
      q(sb.from('coevals').select('id,title,student_name,grade_level,period,code,courses,created_at').order('created_at', { ascending: false })),
      q(sb.from('coeval_entries').select('coeval_id'))]);
    state.cache.coevals = list;
    const counts = {}; ents.forEach(e => counts[e.coeval_id] = (counts[e.coeval_id] || 0) + 1);
    return { list, counts };
  },
  async coevview(id) {
    const [cv, entries] = await Promise.all([
      q(sb.from('coevals').select('*').eq('id', id).single()),
      q(sb.from('coeval_entries').select('*').eq('coeval_id', id).order('course'))]);
    return { cv, entries };
  },
  async coevform({ code }) {
    const info = await rpc('coeval_info', { p_code: code });
    let teacher = ''; try { teacher = localStorage.getItem('cv:teacher') || ''; } catch { }
    state.cf = { code, info, course: '', teacher, scores: {}, comment: '', token: null };
    return state.cf;
  }
};

export const views = {
  coevals: ({ list, counts }) => `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Coevaluación docente</h2>
      <button data-act="newcoeval">＋ Enviar coevaluación</button></div>
    <p class="mut">Crea la coevaluación de un estudiante y comparte el enlace con sus docentes: cada uno elige su curso y califica los criterios de la rúbrica (comportamiento y académico). Aquí ves todo lo recopilado.</p>
    ${list.length ? list.map(c => `<div class="card ex-card"><div class="grow"><h3 style="margin-bottom:.2rem">${esc(c.title)}</h3>
        <div class="tags"><span class="tag">👤 ${esc(c.student_name)}</span>${c.grade_level ? `<span class="tag">${esc(c.grade_level)}</span>` : ''}${c.period ? `<span class="tag">${esc(c.period)}</span>` : ''}
        <span class="tag">Código <span class="code">${esc(c.code)}</span></span>
        <span class="tag ok">${counts[c.id] || 0}${c.courses.length ? ' / ' + c.courses.length : ''} docentes respondieron</span></div></div>
        <div class="row"><button class="sm sec" data-act="copycvlink" data-code="${esc(c.code)}">🔗 Copiar enlace</button>
        <button class="sm" data-act="coevview" data-id="${c.id}">Resultados</button>
        <button class="sm sec" data-act="editcoeval" data-id="${c.id}">Editar</button>
        <button class="sm danger" data-act="delcoeval" data-id="${c.id}">Borrar</button></div></div>`).join('')
      : '<div class="card empty"><div class="ic">🤝</div><p>Aún no has enviado coevaluaciones.</p><button data-act="newcoeval">Crear la primera</button></div>'}`,

  coevedit: () => {
    const c = state.cv;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${c._new ? 'Nueva coevaluación' : 'Editar coevaluación'}</h2>
      <button class="ghost" data-act="coevals">Cancelar</button><button data-act="savecoeval">Guardar</button></div>
    <div class="card"><div class="grid">
      <div><label>Título</label><input data-cve="title" value="${esc(c.title)}" placeholder="Ej. Coevaluación de la unidad 3"></div>
      <div><label>Nombre del estudiante</label><input data-cve="student_name" value="${esc(c.student_name)}"></div>
      <div><label>Grado / sección (opcional)</label><input data-cve="grade_level" value="${esc(c.grade_level)}" placeholder="Ej. 5.º primaria B"></div>
      <div><label>Período (opcional)</label><input data-cve="period" value="${esc(c.period)}" placeholder="Ej. Unidad 3 · 2026"></div>
      <div><label>Código del enlace</label><input data-cve="code" value="${esc(c.code)}"></div></div>
      <label>Cursos (opcional, uno por línea)</label>
      <textarea data-cve="coursesTxt" placeholder="Matemática&#10;Comunicación y Lenguaje&#10;Ciencias Naturales">${esc(c.coursesTxt)}</textarea>
      <span class="mut">Si los escribes, cada docente elegirá su curso de esta lista (y verás cuáles faltan). Si lo dejas vacío, cada docente escribe su curso.</span>
      <p class="mut">Rúbrica: <b>Comportamiento (10 pts)</b> y <b>Académico (10 pts)</b>, con 6 criterios cada una, calificados de 1 a 4.</p></div>`;
  },

  coevview: ({ cv, entries }) => {
    const R = cv.rubric, sc = entries.map(e => cvScore(R, e.scores));
    const missing = cv.courses.filter(c => !entries.some(e => norm(e.course) === norm(c)));
    const partAvg = i => avg(sc.map(s => s.parts[i].points));
    const totalAvg = avg(sc.map(s => s.total));
    const outOf = R.sections.reduce((a, s) => a + s.points, 0);
    const head = entries.map(e => `<th style="text-align:center;min-width:90px" title="${esc(e.teacher_name)}">${esc(e.course)}</th>`).join('');
    const rows = R.sections.map(s => `<tr><td colspan="${entries.length + 2}" style="background:var(--pri-soft)"><b>${s.id}. ${esc(s.name)}</b></td></tr>` +
      s.criteria.map(c => {
        const vals = entries.map(e => +e.scores[cvKey(s, c)] || 0), a = avg(vals.filter(Boolean));
        return `<tr><td><b>${esc(c.name)}</b></td>${vals.map(v => `<td style="text-align:center"><span class="lv lv${v}" title="${v ? esc(R.levels.find(l => l.v === v)?.name) : ''}">${v || '—'}</span></td>`).join('')}
          <td style="text-align:center"><b>${num(a)}</b></td></tr>`;
      }).join('')).join('');
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${esc(cv.title)}</h2>
      <button class="ghost" data-act="coevals">← Coevaluaciones</button>
      <button class="sec" data-act="copycvlink" data-code="${esc(cv.code)}">🔗 Copiar enlace</button></div>
    <div class="card"><div class="tags" style="margin:0"><span class="tag">👤 ${esc(cv.student_name)}</span>${cv.grade_level ? `<span class="tag">${esc(cv.grade_level)}</span>` : ''}${cv.period ? `<span class="tag">${esc(cv.period)}</span>` : ''}
      <span class="tag">Código <span class="code">${esc(cv.code)}</span></span></div></div>
    <div class="stats"><div class="stat"><b>${entries.length}${cv.courses.length ? ' / ' + cv.courses.length : ''}</b><span>Docentes respondieron</span></div>
      ${R.sections.map((s, i) => `<div class="stat"><b>${num(partAvg(i))}</b><span>${esc(s.name)} (promedio de ${s.points})</span></div>`).join('')}
      <div class="stat"><b>${num(totalAvg)}</b><span>Total promedio (de ${outOf})</span></div></div>
    ${missing.length ? `<div class="card"><b>Pendientes (${missing.length}):</b> <span class="mut">${missing.map(esc).join(' · ')}</span></div>` : ''}
    ${entries.length ? `
    <div class="card tablewrap"><table><thead><tr><th>Curso</th><th>Docente</th>${R.sections.map(s => `<th>${esc(s.name)} /${s.points}</th>`).join('')}<th>Total /${outOf}</th><th>Fecha</th><th></th></tr></thead><tbody>
      ${entries.map((e, i) => `<tr><td><b>${esc(e.course)}</b></td><td>${esc(e.teacher_name)}</td>
        ${sc[i].parts.map(p => `<td>${p.points} <span class="mut">(${p.raw}/${p.max})</span></td>`).join('')}
        <td><b>${sc[i].total}</b></td><td>${fdate(e.updated_at)}</td>
        <td><button class="sm danger" data-act="delcoentry" data-id="${e.id}" data-cid="${cv.id}">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <h3 style="margin-top:1.4rem">Detalle por criterio</h3>
    <p class="mut">Nivel que dio cada docente (4 = ${esc(R.levels[0].name)} … 1 = ${esc(R.levels[R.levels.length - 1].name)}) y el promedio de cada criterio.</p>
    <div class="card tablewrap"><table class="matrix"><thead><tr><th>Criterio</th>${head}<th style="text-align:center">Promedio</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${entries.some(e => e.comment) ? `<h3 style="margin-top:1.4rem">Comentarios</h3>${entries.filter(e => e.comment).map(e => `<div class="card"><b>${esc(e.course)}</b> <span class="mut">· ${esc(e.teacher_name)}</span>
      <p style="white-space:pre-wrap;margin:.4rem 0 0">${esc(e.comment)}</p></div>`).join('')}` : ''}`
    : '<div class="card empty"><div class="ic">📭</div>Aún ningún docente ha respondido. Comparte el enlace.</div>'}`;
  },

  coevform: () => {
    const f = state.cf, i = f.info, R = i.rubric, mine = !!f.token;
    return `
    <div class="card" style="max-width:980px;margin:1rem auto"><div style="text-align:center"><img class="logo-sm" src="logo.webp" alt="Calvary Christian School"></div>
      <h2 style="text-align:center">${esc(i.title)}</h2>
      <div class="tags" style="justify-content:center"><span class="tag">👤 ${esc(i.student_name)}</span>${i.grade_level ? `<span class="tag">${esc(i.grade_level)}</span>` : ''}${i.period ? `<span class="tag">${esc(i.period)}</span>` : ''}</div>
      <div class="grid"><div><label>Tu nombre</label><input data-cvf="teacher" value="${esc(f.teacher)}" autocomplete="name"></div>
        <div><label>Curso que impartes</label>${i.courses.length ? `<select data-cvf="course"><option value="">Selecciona…</option>
          ${i.courses.map(c => `<option value="${esc(c)}" ${norm(c) === norm(f.course) ? 'selected' : ''}>${esc(c)}${i.filled.some(x => norm(x) === norm(c)) ? ' (ya registrado)' : ''}</option>`).join('')}</select>`
          : `<input data-cvf="course" value="${esc(f.course)}" placeholder="Ej. Matemática">`}</div></div>
      ${mine ? '<p class="mut">Ya registraste este curso: puedes corregir tu coevaluación.</p>' : ''}
      <p class="mut">Marca, en cada criterio, la descripción que mejor representa al estudiante.</p>
      ${R.sections.map(s => `<h3 style="margin-top:1.2rem;color:var(--pri)">${s.id}. ${esc(s.name)} (${s.points} puntos)</h3>
        <div class="tablewrap"><table class="rub"><thead><tr><th>Criterio</th>${R.levels.map(l => `<th>${l.v} · ${esc(l.name)}</th>`).join('')}</tr></thead><tbody>
        ${s.criteria.map(c => `<tr><th class="crit">${esc(c.name)}</th>${R.levels.map(l => `<td><label class="rcell"><input type="radio" name="cv-${cvKey(s, c)}" data-cvk="${cvKey(s, c)}" value="${l.v}" ${+f.scores[cvKey(s, c)] === l.v ? 'checked' : ''}><span>${esc(c.desc[l.v])}</span></label></td>`).join('')}</tr>`).join('')}
        </tbody></table></div>`).join('')}
      <div id="cvsum" class="card" style="margin:1rem 0 0;background:var(--pri-soft)">${summaryHTML()}</div>
      <label>Comentario sobre el estudiante (opcional)</label>
      <textarea data-cvf="comment" maxlength="2000" placeholder="Fortalezas, áreas a reforzar…">${esc(f.comment)}</textarea>
      <div class="row" style="margin-top:1.1rem"><button class="lg grow" data-act="coevsend">${mine ? 'Guardar cambios' : 'Enviar coevaluación'}</button></div></div>`;
  },

  coevdone: ({ course }) => `
    <div class="card center" style="text-align:center;max-width:520px"><img class="logo-sm" src="logo.webp" alt="Calvary Christian School">
      <h2>¡Gracias!</h2><p>Tu coevaluación de <b>${esc(course)}</b> quedó registrada.</p>
      <button class="sec" data-act="coevagain">Corregir mi registro</button></div>`
};

/* Resumen en vivo de la coevaluación mientras el docente marca criterios */
function summaryHTML() {
  const R = state.cf.info.rubric, s = cvScore(R, state.cf.scores), done = s.parts.reduce((a, p) => a + p.done, 0), n = cvTotalCriteria(R);
  return `<div class="row">${s.parts.map(p => `<span><b>${esc(p.name)}:</b> ${p.points} / ${p.outOf}</span>`).join('<span class="mut">·</span>')}
    <span class="mut">·</span><span><b>Total:</b> ${s.total} / ${s.outOf}</span><span class="grow"></span><span class="mut">${done} de ${n} criterios marcados</span></div>`;
}
function cvSummary() { const el = $('#cvsum'); if (el) el.innerHTML = summaryHTML(); }

/* Entradas del formulario (las llama events.js) */
export function onCoevalInput(t) {
  if (t.dataset.cve) state.cv[t.dataset.cve] = t.value;
  else if (t.dataset.cvf) state.cf[t.dataset.cvf] = t.value;
  else if (t.dataset.cvk) { state.cf.scores[t.dataset.cvk] = +t.value; cvSummary(); }
}
/* Si este navegador ya registró el curso elegido, recupera ese registro para poder corregirlo */
export async function loadMineCv() {
  const f = state.cf, course = f.course; f.token = null;
  let tk = null; try { tk = course && localStorage.getItem(cvStoreKey(f.code, course)); } catch { }
  if (tk) {
    try {
      const m = await rpc('coeval_my_entry', { p_code: f.code, p_course: course, p_token: tk });
      if (m && f.course === course) { f.token = tk; f.teacher = m.teacher; f.scores = m.scores; f.comment = m.comment; }
    } catch { }
  }
  redraw('coevform');
}

export const acts = {
  coevals: () => go('coevals'),
  newcoeval: () => {
    state.cv = { _new: true, title: '', student_name: '', grade_level: '', period: '', code: Math.random().toString(36).slice(2, 8).toUpperCase(), coursesTxt: '' };
    go('coevedit');
  },
  editcoeval: el => {
    const c = JSON.parse(JSON.stringify(state.cache.coevals.find(x => x.id === el.dataset.id)));
    state.cv = { ...c, coursesTxt: c.courses.join('\n') };
    go('coevedit');
  },
  savecoeval: async () => {
    const c = state.cv, title = c.title.trim(), student = c.student_name.trim(), code = c.code.trim().toUpperCase();
    if (!title) return toast('Pon un título a la coevaluación.', 'err');
    if (!student) return toast('Escribe el nombre del estudiante.', 'err');
    if (!/^[A-Z0-9_-]+$/.test(code)) return toast('El código solo puede llevar letras, números, - y _.', 'err');
    const courses = [...new Map(c.coursesTxt.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => [norm(s), s])).values()];
    const row = { title, student_name: student, grade_level: c.grade_level.trim(), period: c.period.trim(), code, courses };
    try {
      await q(c._new ? sb.from('coevals').insert({ ...row, rubric: DEFAULT_COEVAL }) : sb.from('coevals').update(row).eq('id', c.id));
    } catch (e) { throw new Error(e.code === '23505' ? 'Ya existe otra coevaluación con ese código.' : e.message); }
    toast('Coevaluación guardada. Copia el enlace y envíalo a los docentes.', 'ok'); go('coevals');
  },
  delcoeval: async el => {
    if (!await ask('¿Borrar la coevaluación y todo lo registrado?', 'Borrar')) return;
    await q(sb.from('coevals').delete().eq('id', el.dataset.id)); go('coevals');
  },
  copycvlink: async el => {
    const url = location.origin + location.pathname + '#/coevaluacion/' + el.dataset.code;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); } catch { prompt('Copia el enlace:', url); }
  },
  coevview: el => go('coevview', el.dataset.id),
  delcoentry: async el => {
    if (!await ask('¿Borrar este registro?', 'Borrar')) return;
    await q(sb.from('coeval_entries').delete().eq('id', el.dataset.id)); go('coevview', el.dataset.cid);
  },
  coevsend: async () => {
    const f = state.cf, i = f.info, n = cvTotalCriteria(i.rubric);
    if (!f.teacher.trim()) return toast('Escribe tu nombre.', 'err');
    if (!f.course.trim()) return toast('Indica el curso.', 'err');
    if (Object.keys(f.scores).length < n) return toast(`Faltan criterios por calificar (${Object.keys(f.scores).length} de ${n}).`, 'err');
    const r = await rpc('coeval_submit', { p_code: f.code, p_course: f.course, p_teacher: f.teacher, p_scores: f.scores, p_comment: f.comment, p_token: f.token });
    try { localStorage.setItem(cvStoreKey(f.code, r.course), r.token); localStorage.setItem('cv:teacher', f.teacher.trim()); } catch { }
    f.token = r.token; f.course = r.course;
    if (!i.filled.some(x => norm(x) === norm(r.course))) i.filled.push(r.course);
    render('coevdone', { course: r.course });
  },
  coevagain: () => render('coevform')
};
