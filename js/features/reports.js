/* Reportes automáticos (solo administración): de cada estudiante se suman todos sus exámenes, sus entrevistas y su coevaluación.
   La rúbrica de tipo reporte interpreta el total; la nota se puede ajustar a mano y el informe se descarga en PDF. */
import { q, rpc } from '../core/api.js';
import { sb } from '../core/config.js';
import { buildStudents, INTERVIEW_MODES, INTERVIEW_TYPES, summarize } from '../core/report-calc.js';
import { INTERVIEW_RUBRICS } from '../core/interview-rubrics.js';
import { allReportsZip, reportPDF } from '../core/report-pdf.js';
import { go, render } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { $, esc, fdate, norm } from '../core/util.js';

const fmtD = d => fdate(d).split(',')[0];
const levels = () => state.rep.rubrics.find(r => r.id === state.rep.rubricId)?.levels || null;
const rubricName = () => state.rep.rubrics.find(r => r.id === state.rep.rubricId)?.name || '';
const student = key => state.rep.students.find(s => s.key === key);
const lvTag = l => l ? `<span class="tag ${esc(l.cls)}">${esc(l.name)}</span>` : '<span class="mut">—</span>';
/* Puntos de una parte: «23 / 50» y, entre paréntesis, cuántos exámenes o entrevistas son */
const partTxt = (p, count = true) => p.n || p.excluded ? `${p.max || !p.excluded ? `${p.score} / ${p.max}` : 'no cuenta'}${p.excluded ? ' <span class="tag warn" title="Hay entrevistas excluidas por la administración">excl.</span>' : count && p.n > 1 ? ` <span class="mut">(${p.n})</span>` : ''}` : '<span class="mut">—</span>';
/* «a padres (en cero), al estudiante (no se toma en cuenta)» */
const exclList = p => p.rows.filter(r => r.mode).map(r => `${r.type === 'padre' ? 'a padres' : 'al estudiante'} (${INTERVIEW_MODES[r.mode]})`).join(', ');
const pctTxt = (a, b) => b ? Math.round(a / b * 100) + ' %' : '—';

export const loaders = {
  /* Una sola carga con columnas mínimas; los totales se calculan aquí (en el navegador) */
  async reports() {
    let [attempts, exams, interviews, rubs, evals, overrides] = await Promise.all([
      q(sb.from('attempts').select('exam_id,student_name,email,ended_at,score,max_score,score_edited_at').order('started_at', { ascending: false })),
      q(sb.from('exams').select('id,title,admission')),
      q(sb.from('interviews').select('subject_name,subject_type,child_name,interviewer,scores,held_on,created_at')),
      q(sb.from('rubrics').select('id,name,kind,levels').eq('kind', 'report').order('name')),
      q(sb.from('coevaluations').select('student_key,scores,comment,updated_at')),
      q(sb.from('report_overrides').select('*'))]);
    const adm = new Set(exams.filter(e => e.admission).map(e => e.id));   // solo las pruebas de admisión cuentan en los reportes
    attempts = attempts.filter(a => adm.has(a.exam_id)); exams = exams.filter(e => adm.has(e.id));
    const reportRubrics = rubs.filter(r => r.kind === 'report');
    let saved = ''; try { saved = localStorage.getItem('rep:rubric') || ''; } catch { }
    state.rep = { students: buildStudents({ attempts, exams, interviews, evals, overrides }),
      rubrics: reportRubrics, rubricId: reportRubrics.some(r => r.id === saved) ? saved : '' };
    return state.rep;
  }
};

const rowHTML = s => {
  const m = summarize(s, levels());
  return `<tr data-find="${esc(norm(s.name + ' ' + s.email))}">
    <td><b>${esc(s.name)}</b>${s.email ? `<br><span class="mut">${esc(s.email)}</span>` : ''}</td>
    <td>${partTxt(m.parts.exams)}</td><td>${partTxt(m.parts.interviews)}</td><td>${partTxt(m.parts.coeval, false)}</td>
    <td style="white-space:nowrap">${m.empty ? '<span class="mut">—</span>' : `<b>${m.total}</b> / ${m.max}${m.adjusted ? ' <span class="tag warn" title="Nota ajustada a mano">ajustada</span>' : ''}`}</td>
    <td>${m.empty ? '' : m.pct + ' %'}</td><td>${m.empty ? '' : lvTag(m.level)}</td>
    <td class="row"><button class="sm" data-act="repstudent" data-key="${esc(s.key)}">Ver</button>
      <button class="sm sec" data-act="reppdf" data-key="${esc(s.key)}" ${m.empty ? 'disabled' : ''} title="Descargar PDF">⬇ PDF</button></td></tr>`;
};

export const views = {
  reports: () => {
    const { students, rubrics, rubricId } = state.rep, ms = students.map(s => summarize(s, levels()));
    const withData = ms.filter(m => !m.empty), avg = withData.length ? Math.round(withData.reduce((a, m) => a + m.pct, 0) / withData.length) : null;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Reportes de estudiantes</h2>
      <select id="reprubric" style="width:auto" title="Rúbrica de reporte que interpreta el total">
        <option value="">Escala predeterminada</option>${rubrics.map(r => `<option value="${r.id}" ${r.id === rubricId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
    <p class="mut">Se genera solo: de cada estudiante se suman <b>todos sus exámenes, sus entrevistas y su coevaluación</b>. La rúbrica de reporte (elegida arriba) dice qué nivel le corresponde. Puedes ajustar la nota a mano y descargar el informe en PDF.</p>
    <div class="stats"><div class="stat"><b>${students.length}</b><span>Estudiantes</span></div>
      <div class="stat"><b>${students.filter(s => s.coeval).length}</b><span>Con coevaluación</span></div>
      <div class="stat"><b>${students.filter(s => s.override?.manual_total != null).length}</b><span>Notas ajustadas</span></div>
      <div class="stat"><b>${avg === null ? '—' : avg + ' %'}</b><span>Promedio general</span></div></div>
    <div class="row" style="margin-bottom:.8rem"><input id="repq" class="grow" placeholder="Buscar por nombre o correo…" autocomplete="off">
      <button data-act="repall" ${students.length ? '' : 'disabled'}>⬇ Descargar todos (ZIP)</button></div>
    <div class="card tablewrap">${students.length ? `<table><thead><tr><th>Estudiante</th><th>Exámenes</th><th>Entrevistas</th><th>Coevaluación</th><th>Total</th><th>%</th><th>Nivel</th><th></th></tr></thead>
      <tbody id="reprows">${students.map(rowHTML).join('')}</tbody></table>`
      : '<div class="empty"><div class="ic">📭</div>Aún no hay estudiantes que hayan presentado un examen.</div>'}</div>`;
  },

  repstudent: () => {
    const s = student(state.rs), m = summarize(s, levels()), ex = s.exams, iv = s.interviews, cv = s.coeval;
    const sub = (list, span = 3, pct = 1) => { const a = Math.round(list.reduce((x, e) => x + e.score, 0) * 100) / 100, b = Math.round(list.reduce((x, e) => x + e.max, 0) * 100) / 100; return `<tr class="subtot"><td colspan="${span}"><b>Subtotal</b></td><td><b>${a} / ${b}</b></td>${pct ? `<td>${pctTxt(a, b)}</td>` : ''}</tr>`; };
    return `
    <div class="row" style="margin-bottom:1rem"><button class="ghost" data-act="repback">← Reportes</button><span class="grow"></span>
      <button class="sec" data-act="repemail" data-key="${esc(s.key)}">✉ Cambiar correo</button>
      <button class="sec" data-act="repiv" data-key="${esc(s.key)}">Excluir entrevistas</button>
      <button class="sec" data-act="repadjust" data-key="${esc(s.key)}">✎ Ajustar nota</button>
      <button data-act="reppdf" data-key="${esc(s.key)}" ${m.empty ? 'disabled' : ''}>⬇ Descargar PDF</button></div>
    <div class="paper">
      <div class="paper-head"><img src="logo-white.webp" alt="Calvary Christian School"><div><b>Calvary Christian School</b><span>Informe integral del estudiante</span></div></div>
      <div class="paper-body">
        <div class="paper-student"><small>ESTUDIANTE</small><h2>${esc(s.name)}</h2>${s.email ? `<span class="mut">${esc(s.email)}</span>` : ''}</div>
        <div class="sumbox">
          <div><small>TOTAL ACUMULADO</small><div class="sumbig">${m.empty ? '—' : `${m.total} <span>/ ${m.max}</span>`}</div>${m.empty ? '' : `<span class="mut">${m.pct} %</span>`}</div>
          <div class="sumlvl">${m.level ? `<small>NIVEL${rubricName() ? ' · ' + esc(rubricName()) : ''}</small><div>${lvTag(m.level)}</div>` : ''}</div>
          ${m.empty ? '' : `<p class="mut sumtext" style="margin:0">Exámenes <b>${m.parts.exams.score} / ${m.parts.exams.max}</b> · Entrevistas <b>${m.parts.interviews.max ? m.parts.interviews.score + ' / ' + m.parts.interviews.max : 'no se toman en cuenta'}</b> · Coevaluación <b>${m.parts.coeval.score} / ${m.parts.coeval.max}</b></p>`}
          ${m.scaled ? `<p class="mut sumtext" style="margin:0">Las entrevistas no se toman en cuenta: el total se calcula con lo que sí cuenta (<b>${m.scaled.score} / ${m.scaled.max}</b>) y se lleva a 100.</p>` : ''}
          ${!m.empty && m.max !== 100 && !Object.values(m.parts.interviews.modes).includes('skip') ? `<p class="sumtext" style="margin:0;color:var(--warn)">⚠ El máximo posible de este estudiante suma <b>${m.max}</b>, no 100: tiene ${m.parts.exams.n} ${m.parts.exams.n === 1 ? 'examen terminado' : 'exámenes terminados'} (${m.parts.exams.max} pts), ${m.parts.interviews.n} ${m.parts.interviews.n === 1 ? 'entrevista' : 'entrevistas'} (${m.parts.interviews.max} pts) y ${m.parts.coeval.n ? 'coevaluación (' + m.parts.coeval.max + ' pts)' : 'sin coevaluación'}. Revisa las tablas de abajo.</p>` : ''}
          ${m.level && m.level.text ? `<p class="lvltext sumtext">${esc(m.level.text)}</p>` : ''}
          ${m.parts.interviews.excluded ? `<p class="mut sumtext">✎ Entrevistas excluidas: ${exclList(m.parts.interviews)}.
            <button class="sm ghost" data-act="dorepiv" data-key="${esc(s.key)}" data-reset="1">Usar las entrevistas reales</button></p>` : ''}
          ${m.adjusted ? `<p class="mut sumtext">✎ Nota ajustada manualmente (suma automática: ${m.auto}).${s.override.reason ? ' Motivo: ' + esc(s.override.reason) : ''}
            <button class="sm ghost" data-act="repclear" data-key="${esc(s.key)}">Quitar ajuste</button></p>` : ''}
        </div>

        <h3 class="sec-title">Exámenes</h3>
        ${ex.length ? `<div class="tablewrap"><table class="rep"><thead><tr><th>Examen</th><th>Fecha</th><th></th><th>Nota</th><th>%</th></tr></thead><tbody>
          ${ex.map(e => `<tr><td><b>${esc(e.title)}</b>${e.edited ? ' <span class="tag warn">nota editada</span>' : ''}</td><td>${fmtD(e.date)}</td><td></td><td>${e.score} / ${e.max}</td><td>${pctTxt(e.score, e.max)}</td></tr>`).join('')}${sub(ex)}</tbody></table></div>` : '<p class="mut">Sin exámenes registrados.</p>'}

        <h3 class="sec-title">Entrevistas</h3>
        ${m.parts.interviews.rows.length ? `<div class="tablewrap"><table class="rep"><thead><tr><th>Rúbrica</th><th>Entrevistado / Entrevistador</th><th>Fecha</th><th>Puntos</th></tr></thead><tbody>
          ${m.parts.interviews.rows.map(i => i.mode
            ? `<tr><td><b>${esc(i.rubric)}</b></td><td><span class="tag warn">Excluida · ${esc(INTERVIEW_MODES[i.mode])}</span></td><td></td><td>${i.mode === 'skip' ? '—' : `${i.score} / ${i.max}`}</td></tr>`
            : `<tr><td><b>${esc(i.rubric)}</b></td><td>${esc(i.who)}${i.interviewer ? ` <span class="mut">· ${esc(i.interviewer)}</span>` : ''}</td><td>${fmtD(i.date)}</td><td>${i.score} / ${i.max}</td></tr>`).join('')}${sub(m.parts.interviews.rows, 3, 0)}</tbody></table></div>` : '<p class="mut">Sin entrevistas registradas.</p>'}

        <h3 class="sec-title">Coevaluación docente</h3>
        ${cv ? `<div class="tablewrap"><table class="rep"><thead><tr><th>Área</th><th></th><th>Porcentaje</th><th>Puntos</th><th></th></tr></thead><tbody>
          ${cv.parts.map(p => `<tr><td><b>${esc(p.name)}</b></td><td></td><td>${p.pct} %</td><td>${p.points} / ${p.outOf}</td><td></td></tr>`).join('')}
          <tr class="subtot"><td colspan="3"><b>Total coevaluación</b></td><td><b>${cv.score} / ${cv.max}</b></td><td></td></tr></tbody></table></div>
          ${cv.comment ? `<p style="white-space:pre-wrap"><b>Comentario:</b> ${esc(cv.comment)}</p>` : ''}` : '<p class="mut">Sin coevaluación registrada.</p>'}
      </div>
      <div class="paper-foot">Calvary Christian School · Documento confidencial</div>
    </div>`;
  }
};

/* Búsqueda de la lista: solo muestra u oculta filas (lo llama events.js) */
export function onRepFilter() {
  const text = norm($('#repq').value);
  document.querySelectorAll('#reprows tr').forEach(r => { r.hidden = !r.dataset.find.includes(text); });
}
/* Cambia la rúbrica de reporte con la que se interpretan los totales (se recuerda en este navegador) */
export function onRepRubric(t) {
  state.rep.rubricId = t.value;
  try { localStorage.setItem('rep:rubric', t.value); } catch { }
  const y = scrollY; render('reports'); scrollTo(0, y);
}

export const acts = {
  reports: () => go('reports'),
  repback: () => { render('reports'); window.scrollTo(0, 0); },
  repstudent: el => { state.rs = el.dataset.key; render('repstudent'); window.scrollTo(0, 0); },
  /* Un .zip con un PDF por cada estudiante que ya tiene notas */
  repall: async () => {
    const items = state.rep.students.map(s => ({ s, sum: summarize(s, levels()) })).filter(x => !x.sum.empty);
    if (!items.length) return toast('Todavía no hay reportes con notas para descargar.', 'err');
    toast(`Generando ${items.length} ${items.length === 1 ? 'informe' : 'informes'}…`);
    await allReportsZip(items, rubricName());
  },
  reppdf: async el => { const s = student(el.dataset.key); await reportPDF(s, summarize(s, levels()), rubricName()); },
  repadjust: el => {
    const s = student(el.dataset.key), m = summarize(s, levels());
    if (m.empty) return toast('Este estudiante todavía no tiene notas.', 'err');
    const d = document.createElement('div'); d.className = 'modal small';
    d.innerHTML = `<div class="card"><h3>Ajustar la nota de ${esc(s.name)}</h3>
      <p class="mut">La suma automática es <b>${m.auto} / ${m.max}</b>. La nota que escribas reemplaza a la suma en el informe.</p>
      <label>Nota final (0 a ${m.max})</label><input id="adjval" type="number" min="0" max="${m.max}" step="any" inputmode="decimal" value="${m.total}">
      <label>Motivo (opcional)</label><textarea id="adjwhy" maxlength="500">${esc(s.override?.reason || '')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button>
      <button data-act="dorepadjust" data-key="${esc(s.key)}" data-max="${m.max}">Guardar</button></div></div>`;
    document.body.appendChild(d); $('#adjval').select();
  },
  dorepadjust: async el => {
    const s = student(el.dataset.key), v = $('#adjval').value.trim(), n = +v, max = +el.dataset.max;
    if (v === '' || !(n >= 0 && n <= max)) return toast(`La nota debe estar entre 0 y ${max}.`, 'err');
    await saveOverride(s, { manual_total: n, reason: $('#adjwhy').value.trim().slice(0, 500) });
    $('.modal')?.remove(); toast('Nota ajustada', 'ok'); render('repstudent');
  },
  repclear: async el => {
    const s = student(el.dataset.key);
    if (!await ask('¿Quitar el ajuste y volver a la suma automática?', 'Quitar')) return;
    await saveOverride(s, { manual_total: null, reason: '' }); render('repstudent');
  },
  /* Excluir entrevistas: cada una (a padres / al estudiante) se puede usar tal cual, o excluir en cero, con puntaje completo o sin tomarla en cuenta */
  repiv: el => {
    const s = student(el.dataset.key), cur = s.override?.interview_modes || {};
    const d = document.createElement('div'); d.className = 'modal small';
    d.innerHTML = `<div class="card"><h3>Entrevistas de ${esc(s.name)}</h3>
      <p class="mut">Elige qué hacer con cada entrevista en el reporte. «En cero» y «puntaje completo» siguen sumando sus 15 puntos al máximo; «no tomarla en cuenta» la quita del reporte.</p>
      ${INTERVIEW_TYPES.map(t => `<div style="margin:.7rem 0"><b>${esc(INTERVIEW_RUBRICS[t].name)}</b> <span class="mut">(${INTERVIEW_RUBRICS[t].total} pts)</span>
        ${[['', 'Usar la entrevista real'], ['zero', 'Excluir: en cero'], ['full', 'Excluir: con puntaje completo'], ['skip', 'Excluir: no tomarla en cuenta']].map(([v, n]) =>
          `<label class="chk"><input type="radio" name="ivmode-${t}" value="${v}" ${v === (cur[t] || '') ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div>`).join('')}
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button>
      <button data-act="dorepiv" data-key="${esc(s.key)}">Guardar</button></div></div>`;
    document.body.appendChild(d);
  },
  dorepiv: async el => {
    const s = student(el.dataset.key), modes = {};
    if (!el.dataset.reset) for (const t of INTERVIEW_TYPES) { const v = document.querySelector(`input[name="ivmode-${t}"]:checked`)?.value; if (v) modes[t] = v; }
    await saveOverride(s, { interview_modes: modes });
    $('.modal')?.remove(); toast(Object.keys(modes).length ? 'Entrevistas excluidas' : 'Se usan las entrevistas reales', 'ok'); render('repstudent');
  },
  /* El correo identifica al estudiante: se cambia en todos sus intentos, su coevaluación y su ajuste de nota */
  repemail: el => {
    const s = student(el.dataset.key);
    const d = document.createElement('div'); d.className = 'modal small';
    d.innerHTML = `<div class="card"><h3>Cambiar el correo de ${esc(s.name)}</h3>
      <p class="mut">Se actualiza en todos sus exámenes, en su coevaluación y en su ajuste de nota. ${s.email ? 'Correo actual: <b>' + esc(s.email) + '</b>.' : 'Este estudiante no tiene correo registrado.'}</p>
      <label>Nuevo correo</label><input id="newemail" type="email" value="${esc(s.email)}" autocomplete="off">
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button>
      <button data-act="dorepemail" data-key="${esc(s.key)}">Guardar</button></div></div>`;
    document.body.appendChild(d); $('#newemail').select();
  },
  dorepemail: async el => {
    const s = student(el.dataset.key), email = $('#newemail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe un correo electrónico válido.', 'err');
    await rpc('admin_change_student_email', { p_key: s.key, p_email: email });
    $('.modal')?.remove(); toast('Correo actualizado', 'ok');
    await go('reports');   // se vuelve a cargar: el estudiante ahora se identifica con el correo nuevo
    const nk = email.toLowerCase();
    if (state.rep?.students.some(x => x.key === nk)) { state.rs = nk; render('repstudent'); }
  }
};

/* Un solo registro por estudiante con el ajuste de nota y/o el modo de entrevistas; si no queda nada, se borra */
async function saveOverride(s, patch) {
  const o = { manual_total: s.override?.manual_total ?? null, interview_modes: s.override?.interview_modes ?? {}, reason: s.override?.reason || '', ...patch };
  if (o.manual_total === null && !Object.keys(o.interview_modes).length) { await q(sb.from('report_overrides').delete().eq('student_key', s.key)); s.override = null; return; }
  s.override = await q(sb.from('report_overrides').upsert({ student_key: s.key, student_name: s.name, ...o, updated_at: new Date().toISOString() }, { onConflict: 'student_key' }).select().single());
}
