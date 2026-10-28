/* Entrevistas (con alumnos o padres de familia): tabla de entrevistados × criterios de una rúbrica de entrevista. */
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
    <div class="card tablewrap">${rows.length ? `<table><thead><tr><th>Entrevistado</th><th>Totales</th>
      ${cr.map(c => `<th title="${esc(c.description || '')}">${esc(c.name)}<br><span class="mut">máx. ${esc(c.max)}</span></th>`).join('')}<th>Notas</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td style="white-space:nowrap"><b>${esc(r.subject_name)}</b><br><span class="tag">${TYPES[r.subject_type] || ''}</span></td>
        <td id="ivt-${r.id}" style="white-space:nowrap">${totalTxt(r, cr)}</td>
        ${cr.map(c => `<td><input style="width:72px" type="number" min="0" max="${esc(c.max)}" step="any" inputmode="decimal" data-iv="${r.id}" data-ic="${esc(c.id)}" value="${r.scores[c.id] ?? ''}"></td>`).join('')}
        <td><input style="min-width:170px" maxlength="2000" data-iv="${r.id}" data-ivnotes value="${esc(r.notes)}" placeholder="Observaciones"></td>
        <td><button class="sm danger" data-act="delinterview" data-id="${r.id}">✕</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty"><div class="ic">📭</div>Aún no hay entrevistados. Pulsa “Agregar entrevistado”.</div>'}</div>`;
  }
};

export const acts = {
  interviews: () => go('interviews'),
  addinterview: () => {
    const m = document.createElement('div'); m.className = 'modal small';
    m.innerHTML = `<div class="card"><h3>Agregar entrevistado</h3>
      <label>Nombre</label><input id="ivname" autocomplete="off">
      <label>Tipo</label><select id="ivtype">${Object.entries(TYPES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button><button data-act="doaddiv">Agregar</button></div></div>`;
    document.body.appendChild(m); $('#ivname').focus();
  },
  doaddiv: async () => {
    const name = $('#ivname').value.trim();
    if (!name) return toast('Escribe el nombre del entrevistado.', 'err');
    const row = await q(sb.from('interviews').insert({ rubric_id: state.iv.rid, subject_name: name.slice(0, 150), subject_type: $('#ivtype').value }).select().single());
    state.iv.rows.push(row);
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
