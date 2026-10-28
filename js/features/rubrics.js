/* Rúbricas de tres tipos: examen y reporte (niveles según el porcentaje) y entrevista (criterios con valor). */
import { q } from '../core/api.js';
import { sb } from '../core/config.js';
import { LEVELS } from '../core/levels.js';
import { go, redraw } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { esc, uid } from '../core/util.js';
import { isAdmin } from '../core/state.js';

const KINDS = [['exam', 'Examen'], ['report', 'Reporte'], ['interview', 'Entrevista']];
const HELP = {
  exam: 'Define el nombre y el mensaje que ve el estudiante según su porcentaje. Se asigna a cada examen al editarlo.',
  report: 'Define el nivel y el mensaje que se aplica al porcentaje de la nota de un reporte de estudiante. Se asigna al crear o editar el reporte.',
  interview: 'Lista de criterios con su valor máximo. Se usa en Entrevistas (con alumnos o padres de familia): llenas una tabla con la nota de cada criterio.'
};
const kindOf = r => r.kind || 'exam';
/* Tipos que puede crear quien tiene la sesión: el maestro solo las de examen; la administración todas */
const tabKinds = () => isAdmin() ? KINDS : KINDS.filter(k => k[0] === 'exam');
const curTab = () => tabKinds().some(k => k[0] === state.rubTab) ? state.rubTab : 'exam';
const newCrit = () => ({ id: uid(), name: '', description: '', max: 10 });
const defaultLevels = () => LEVELS.map(({ min, name, cls, text }) => ({ min, name, cls, text }));
export const critTotal = cr => Math.round(cr.reduce((s, c) => s + (+c.max || 0), 0) * 100) / 100;

export const loaders = {
  async rubrics() {
    state.cache.rubrics = await q(sb.from('rubrics').select('*').order('created_at', { ascending: false }));
    return { rubrics: state.cache.rubrics };
  }
};

export const views = {
  rubrics: () => {
    const tab = curTab(), all = state.cache.rubrics.filter(r => tabKinds().some(k => k[0] === kindOf(r))), list = all.filter(r => kindOf(r) === tab);
    const label = KINDS.find(k => k[0] === tab)[1].toLowerCase();
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Rúbricas</h2>
      <button data-act="newrubric">＋ Nueva rúbrica de ${label}</button></div>
    ${tabKinds().length > 1 ? `<div class="row" style="margin-bottom:.6rem">${tabKinds().map(([k, n]) =>
      `<button class="sm ${k === tab ? '' : 'sec'}" data-act="rubtab" data-k="${k}">${n} (${all.filter(r => kindOf(r) === k).length})</button>`).join('')}</div>` : ''}
    <p class="mut">${HELP[tab]}</p>
    ${list.length ? list.map(r => `<div class="card ex-card"><div class="grow"><h3 style="margin-bottom:.2rem">${esc(r.name)}</h3>
        <div class="tags">${tab === 'interview'
          ? `<span class="tag ok">${r.criteria.length} criterios · ${critTotal(r.criteria)} pts</span>${r.criteria.map(c => `<span class="tag">${esc(c.name)} · ${esc(c.max)}</span>`).join('')}`
          : r.levels.map(l => `<span class="tag ${esc(l.cls)}">${esc(l.name)} · desde ${l.min} %</span>`).join('')}</div></div>
        <div class="row"><button class="sm" data-act="editrubric" data-id="${r.id}">Editar</button>
        <button class="sm danger" data-act="delrubric" data-id="${r.id}">Borrar</button></div></div>`).join('')
      : `<div class="card empty"><div class="ic">🏅</div><p>Aún no tienes rúbricas de ${label}.</p><button data-act="newrubric">Crear la primera</button></div>`}`;
  },
  rubedit: () => {
    const rb = state.rb, kind = rb.kind || 'exam';
    const kinds = rb._new ? tabKinds() : kind === 'interview' ? KINDS.filter(k => k[0] === 'interview') : KINDS.filter(k => k[0] !== 'interview');
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${rb._new ? 'Nueva rúbrica' : 'Editar rúbrica'}</h2>
      <button class="ghost" data-act="rubrics">Cancelar</button><button data-act="saverubric">Guardar rúbrica</button></div>
    <div class="card"><div class="grid">
      <div><label>Nombre de la rúbrica</label><input data-rb="name" value="${esc(rb.name)}" placeholder="${kind === 'interview' ? 'Ej. Entrevista con padres de familia' : 'Ej. Escala de aptitud cognitiva'}"></div>
      <div><label>Tipo</label><select data-rb="kind">${kinds.map(([k, n]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <span class="mut">${HELP[kind]}</span></div>
    ${kind === 'interview' ? `
    ${rb.criteria.map((c, i) => `<div class="card qcard"><div class="row"><span class="qnum">${i + 1}</span><span class="grow"></span>
      <span class="mut">Valor (pts)</span><input style="width:90px" type="number" min="0" step="any" data-c="${i}" data-cf="max" value="${esc(c.max)}">
      <button class="sm danger" data-act="delcrit" data-c="${i}">Quitar</button></div>
      <label>Criterio</label><input data-c="${i}" data-cf="name" value="${esc(c.name)}" placeholder="Ej. Comunicación">
      <label>Descripción (opcional)</label><textarea data-c="${i}" data-cf="description">${esc(c.description)}</textarea></div>`).join('')}
    <div class="row"><button class="sec" data-act="addcrit">＋ Criterio</button><span class="mut">Total de la rúbrica: <b id="crittotal">${critTotal(rb.criteria)}</b> pts</span></div>`
    : `${rb.levels.map((l, i) => `<div class="card qcard"><div class="row"><span class="qnum">${i + 1}</span><span class="grow"></span>
      <span class="mut">Desde (%)</span><input style="width:90px" type="number" min="0" max="100" data-l="${i}" data-lf="min" value="${esc(l.min)}">
      <button class="sm danger" data-act="dellevel" data-l="${i}">Quitar</button></div>
      <div class="grid"><div><label>Nombre del nivel</label><input data-l="${i}" data-lf="name" value="${esc(l.name)}" placeholder="Ej. Superior"></div>
        <div><label>Color</label><select data-l="${i}" data-lf="cls">${[['ok', 'Verde'], ['', 'Neutro'], ['warn', 'Amarillo'], ['bad', 'Rojo']].map(([v, n]) => `<option value="${v}" ${l.cls === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <label>Mensaje para el estudiante</label><textarea data-l="${i}" data-lf="text">${esc(l.text)}</textarea></div>`).join('')}
    <div class="row"><button class="sec" data-act="addlevel">＋ Nivel</button></div>
    <p class="mut">Cada nivel aplica desde su porcentaje hasta el siguiente nivel más alto. Debe haber un nivel que empiece en 0 %.</p>`}`;
  }
};

/* Al cambiar el tipo en el editor se prepara lo que ese tipo necesita y se vuelve a pintar (lo llama events.js) */
export function onRubricKind() {
  const rb = state.rb;
  if (rb.kind === 'interview') { if (!rb.criteria.length) rb.criteria.push(newCrit()); }
  else if (!rb.levels.length) rb.levels = defaultLevels();
  redraw('rubedit');
}

export const acts = {
  rubrics: () => go('rubrics'),
  rubtab: el => { state.rubTab = el.dataset.k; redraw('rubrics'); },
  newrubric: () => {
    const kind = curTab();
    state.rb = { _new: true, kind, name: '', levels: kind === 'interview' ? [] : defaultLevels(), criteria: kind === 'interview' ? [newCrit()] : [] };
    go('rubedit');
  },
  editrubric: el => { state.rb = JSON.parse(JSON.stringify(state.cache.rubrics.find(r => r.id === el.dataset.id))); state.rb.kind = kindOf(state.rb); go('rubedit'); },
  delrubric: async el => {
    const r = state.cache.rubrics.find(x => x.id === el.dataset.id);
    const msg = r && kindOf(r) === 'interview' ? '¿Borrar la rúbrica? Se borrarán también todas sus entrevistas.' : '¿Borrar la rúbrica? Lo que ya la usa conserva sus mensajes actuales.';
    if (!await ask(msg, 'Borrar')) return;
    await q(sb.from('rubrics').delete().eq('id', el.dataset.id)); go('rubrics');
  },
  addlevel: () => { state.rb.levels.push({ min: 0, name: '', cls: '', text: '' }); redraw('rubedit'); },
  dellevel: el => { if (state.rb.levels.length <= 1) return; state.rb.levels.splice(+el.dataset.l, 1); redraw('rubedit'); },
  addcrit: () => { state.rb.criteria.push(newCrit()); redraw('rubedit'); },
  delcrit: el => { if (state.rb.criteria.length <= 1) return; state.rb.criteria.splice(+el.dataset.c, 1); redraw('rubedit'); },
  saverubric: async () => {
    const rb = state.rb, kind = rb.kind || 'exam', name = rb.name.trim();
    if (!name) return toast('Pon un nombre a la rúbrica.', 'err');
    let levels = [], criteria = [];
    if (kind === 'interview') {
      for (const [i, c] of rb.criteria.entries()) {
        if (!c.name.trim()) return toast(`El criterio ${i + 1} necesita un nombre.`, 'err');
        if (String(c.max).trim() === '' || !(+c.max > 0)) return toast(`El criterio ${i + 1} necesita un valor mayor que 0.`, 'err');
      }
      criteria = rb.criteria.map(c => ({ id: c.id || uid(), name: c.name.trim(), description: (c.description || '').trim(), max: +c.max }));
    } else {
      for (const [i, l] of rb.levels.entries()) {
        if (String(l.min).trim() === '' || !(+l.min >= 0 && +l.min <= 100)) return toast(`El nivel ${i + 1} necesita un porcentaje entre 0 y 100.`, 'err');
        if (!l.name.trim()) return toast(`El nivel ${i + 1} necesita un nombre.`, 'err');
      }
      levels = rb.levels.map(l => ({ min: +l.min, name: l.name.trim(), cls: l.cls || '', text: l.text.trim() })).sort((a, b) => b.min - a.min);
      if (new Set(levels.map(l => l.min)).size !== levels.length) return toast('Dos niveles empiezan en el mismo porcentaje.', 'err');
      if (levels[levels.length - 1].min !== 0) return toast('Debe haber un nivel que empiece en 0 % para cubrir todas las notas.', 'err');
    }
    const row = { name, kind, levels, criteria };
    if (rb._new) await q(sb.from('rubrics').insert(row));
    else {
      await q(sb.from('rubrics').update(row).eq('id', rb.id));
      // lo que ya usa la rúbrica se actualiza con sus niveles nuevos
      if (kind === 'exam') await q(sb.from('exams').update({ levels }).eq('rubric_id', rb.id));
      if (kind === 'report') await q(sb.from('reports').update({ levels }).eq('rubric_id', rb.id));
    }
    state.rubTab = kind;
    toast('Rúbrica guardada', 'ok'); go('rubrics');
  }
};
