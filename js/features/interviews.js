/* Entrevistas (solo administración, con alumnos o padres de familia): tabla de entrevistados × criterios de una rúbrica de entrevista. */
import { q } from '../core/api.js';
import { sb } from '../core/config.js';
import { go, redraw } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { $, esc } from '../core/util.js';

const TYPES = { alumno: 'Alumno', padre: 'Padre / madre' };
const scoreOf = (row, c) => Math.min(+c.max, Math.max(0, +row.scores[c.id] || 0));
const totalOf = (row, cr) => Math.round(cr.reduce((s, c) => s + scoreOf(row, c), 0) * 100) / 100;
const maxOf = cr => Math.round(cr.reduce((s, c) => s + +c.max, 0) * 100) / 100;
const totalTxt = (row, cr) => { const t = totalOf(row, cr), m = maxOf(cr); return `<b>${t}</b> / ${m} <span class="mut">(${m ? Math.round(t / m * 100) : 0} %)</span>`; };
/* Datos propios de cada tipo de entrevistado, en una línea */
const details = r => (r.subject_type === 'padre'
  ? [r.child_name && 'Hijo/a: ' + r.child_name, r.age && r.age + ' años', r.email]
  : [r.grade, r.age && r.age + ' años', r.guardian && 'Encargado: ' + r.guardian]).filter(Boolean).map(esc).join(' · ');

export const loaders = {
  /* Solo se pide la rúbrica elegida y sus entrevistas: la pantalla carga rápido aunque haya muchas */
  async interviews(rid) {
    const rubrics = await q(sb.from('rubrics').select('id,name,criteria').eq('kind', 'interview').order('name'));
    const id = (rubrics.find(r => r.id === rid) || rubrics[0])?.id || null;
    const rows = id ? await q(sb.from('interviews').select('*').eq('rubric_id', id).order('created_at')) : [];
    state.iv = { rubrics, rid: id, rows };
    return state.iv;
  }
};

export const views = {
  interviews: () => {
    const { rubrics, rid, rows } = state.iv;
    if (!rubrics.length) return `
      <h2>Entrevistas</h2>
      <div class="card empty"><div class="ic">🗣️</div><p>Primero crea una rúbrica de tipo <b>Entrevista</b> con los criterios y el valor de cada uno.</p>
        <button data-act="rubrics">Ir a Rúbricas</button></div>`;
    const cr = rubrics.find(r => r.id === rid).criteria;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Entrevistas</h2>
      <select id="ivfilter" style="width:auto">${rubrics.map(r => `<option value="${r.id}" ${r.id === rid ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <button data-act="addinterview">＋ Agregar entrevistado</button></div>
    <p class="mut">Escribe la nota de cada criterio (hasta su valor máximo); el total se calcula solo y se guarda al salir de cada casilla.</p>
    <div class="card tablewrap">${rows.length ? `<table><thead><tr><th>Entrevistado</th><th>Entrevistador</th><th>Totales</th>
      ${cr.map(c => `<th title="${esc(c.description || '')}">${esc(c.name)}<br><span class="mut">máx. ${esc(c.max)}</span></th>`).join('')}<th>Notas</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td style="min-width:200px"><b>${esc(r.subject_name)}</b> <span class="tag">${TYPES[r.subject_type] || ''}</span><br><span class="mut">${details(r)}</span></td>
        <td>${esc(r.interviewer)}</td>
        <td id="ivt-${r.id}" style="white-space:nowrap">${totalTxt(r, cr)}</td>
        ${cr.map(c => `<td><input style="width:72px" type="number" min="0" max="${esc(c.max)}" step="any" inputmode="decimal" data-iv="${r.id}" data-ic="${esc(c.id)}" value="${r.scores[c.id] ?? ''}"></td>`).join('')}
        <td><input style="min-width:170px" maxlength="2000" data-iv="${r.id}" data-ivnotes value="${esc(r.notes)}" placeholder="Observaciones"></td>
        <td class="row"><button class="sm sec" data-act="editinterview" data-id="${r.id}">Editar</button>
        <button class="sm danger" data-act="delinterview" data-id="${r.id}">✕</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><div class="ic">📭</div>Aún no hay entrevistados. Pulsa “Agregar entrevistado”.</div>'}</div>`;
  }
};

/* Formulario (alta y edición). Alumno: nombre, grado, edad, encargado. Padre: nombre, hijo/a, edad, correo. Siempre: entrevistador. */
function ivForm(row) {
  const r = row || { subject_type: 'alumno', interviewer: state.profile?.name || state.profile?.email || '' };
  const m = document.createElement('div'); m.className = 'modal small';
  m.innerHTML = `<div class="card"><h3>${row ? 'Editar entrevistado' : 'Agregar entrevistado'}</h3>
    <label>Tipo de entrevistado</label><select id="ivtype">${Object.entries(TYPES).map(([k, n]) => `<option value="${k}" ${k === r.subject_type ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <label>Nombre completo del entrevistado</label><input id="ivname" autocomplete="off" value="${esc(r.subject_name || '')}">
    <div id="iv-alumno"><label>Grado</label><input id="ivgrade" value="${esc(r.grade || '')}" placeholder="Ej. 5.º primaria B">
      <label>Padre / madre / encargado</label><input id="ivguardian" value="${esc(r.guardian || '')}"></div>
    <div id="iv-padre"><label>Hijo/a (nombre completo)</label><input id="ivchild" value="${esc(r.child_name || '')}">
      <label>Correo electrónico</label><input id="ivemail" type="email" value="${esc(r.email || '')}"></div>
    <label>Edad</label><input id="ivage" type="number" min="1" max="120" inputmode="numeric" value="${r.age ?? ''}">
    <label>Entrevistador</label><input id="ivinterviewer" value="${esc(r.interviewer || '')}" placeholder="Quien realiza la entrevista">
    <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button>
      <button data-act="doaddiv" data-id="${row ? row.id : ''}">${row ? 'Guardar' : 'Agregar'}</button></div></div>`;
  document.body.appendChild(m); ivToggle(); $('#ivname').focus();
}
/* Muestra solo los campos del tipo elegido (lo llama events.js al cambiar el tipo) */
export function ivToggle() {
  const padre = $('#ivtype').value === 'padre';
  $('#iv-alumno').hidden = padre; $('#iv-padre').hidden = !padre;
}
function readForm() {
  const v = id => $(id).value.trim(), type = v('#ivtype'), padre = type === 'padre', age = +v('#ivage');
  if (!v('#ivname')) throw new Error('Escribe el nombre completo del entrevistado.');
  if (padre) {
    if (!v('#ivchild')) throw new Error('Escribe el nombre completo del hijo/a.');
    if (!/^\S+@\S+\.\S+$/.test(v('#ivemail'))) throw new Error('Escribe un correo electrónico válido.');
  } else {
    if (!v('#ivgrade')) throw new Error('Escribe el grado.');
    if (!v('#ivguardian')) throw new Error('Escribe el padre, madre o encargado.');
  }
  if (!(age >= 1 && age <= 120)) throw new Error('Escribe una edad válida.');
  if (!v('#ivinterviewer')) throw new Error('Escribe quién realiza la entrevista (entrevistador).');
  return {
    subject_type: type, subject_name: v('#ivname').slice(0, 150), interviewer: v('#ivinterviewer').slice(0, 150), age: Math.round(age),
    grade: padre ? null : v('#ivgrade').slice(0, 100), guardian: padre ? null : v('#ivguardian').slice(0, 150),
    child_name: padre ? v('#ivchild').slice(0, 150) : null, email: padre ? v('#ivemail').slice(0, 200) : null
  };
}

export const acts = {
  interviews: () => go('interviews'),
  addinterview: () => ivForm(null),
  editinterview: el => ivForm(state.iv.rows.find(r => r.id === el.dataset.id)),
  doaddiv: async el => {
    const data = readForm(), id = el.dataset.id;
    if (id) {
      const row = await q(sb.from('interviews').update(data).eq('id', id).select().single());
      state.iv.rows = state.iv.rows.map(r => r.id === id ? row : r);
    } else state.iv.rows.push(await q(sb.from('interviews').insert({ ...data, rubric_id: state.iv.rid }).select().single()));
    $('.modal')?.remove(); redraw('interviews');
  },
  delinterview: async el => {
    if (!await ask('¿Borrar esta entrevista?', 'Borrar')) return;
    await q(sb.from('interviews').delete().eq('id', el.dataset.id));
    state.iv.rows = state.iv.rows.filter(r => r.id !== el.dataset.id); redraw('interviews');
  }
};

/* Guarda una nota o las observaciones al salir de la casilla (lo llama events.js) */
export async function onInterviewChange(t) {
  const row = state.iv?.rows.find(r => r.id === t.dataset.iv);
  if (!row) return;
  const cr = state.iv.rubrics.find(r => r.id === state.iv.rid).criteria;
  const patch = {};
  if (t.dataset.ic !== undefined) {
    const c = cr.find(x => x.id === t.dataset.ic);
    if (t.value.trim() === '') delete row.scores[c.id];
    else { const v = Math.min(+c.max, Math.max(0, +t.value || 0)); row.scores[c.id] = v; t.value = v; } // no deja pasar del valor del criterio
    patch.scores = row.scores;
    const tot = $('#ivt-' + row.id); if (tot) tot.innerHTML = totalTxt(row, cr);
  } else { row.notes = t.value.slice(0, 2000); patch.notes = row.notes; }
  try { await q(sb.from('interviews').update(patch).eq('id', row.id)); }
  catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'err'); }
}
