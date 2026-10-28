/* Rúbricas: mensajes que ve el estudiante según su porcentaje. */
import { q } from '../core/api.js';
import { sb } from '../core/config.js';
import { LEVELS } from '../core/levels.js';
import { go, redraw } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { esc } from '../core/util.js';

export const loaders = {
  async rubrics() {
    state.cache.rubrics = await q(sb.from('rubrics').select('*').order('created_at', { ascending: false }));
    return { rubrics: state.cache.rubrics };
  }
};

export const views = {
  rubrics: ({ rubrics }) => `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Rúbricas</h2>
      <button data-act="newrubric">＋ Nueva rúbrica</button></div>
    <p class="mut">Una rúbrica define el nombre y el mensaje que ve el estudiante según su porcentaje. Se asigna a cada examen al editarlo.</p>
    ${rubrics.length ? rubrics.map(r => `<div class="card ex-card"><div class="grow"><h3 style="margin-bottom:.2rem">${esc(r.name)}</h3>
        <div class="tags">${r.levels.map(l => `<span class="tag ${esc(l.cls)}">${esc(l.name)} · desde ${l.min} %</span>`).join('')}</div></div>
        <div class="row"><button class="sm" data-act="editrubric" data-id="${r.id}">Editar</button>
        <button class="sm danger" data-act="delrubric" data-id="${r.id}">Borrar</button></div></div>`).join('')
      : '<div class="card empty"><div class="ic">🏅</div><p>Aún no tienes rúbricas. Mientras tanto, los exámenes usan la escala predeterminada.</p><button data-act="newrubric">Crear la primera</button></div>'}`,
  rubedit: () => `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${state.rb._new ? 'Nueva rúbrica' : 'Editar rúbrica'}</h2>
      <button class="ghost" data-act="rubrics">Cancelar</button><button data-act="saverubric">Guardar rúbrica</button></div>
    <div class="card"><label>Nombre de la rúbrica</label><input data-rb="name" value="${esc(state.rb.name)}" placeholder="Ej. Escala de aptitud cognitiva"></div>
    ${state.rb.levels.map((l, i) => `<div class="card qcard"><div class="row"><span class="qnum">${i + 1}</span><span class="grow"></span>
      <span class="mut">Desde (%)</span><input style="width:90px" type="number" min="0" max="100" data-l="${i}" data-lf="min" value="${esc(l.min)}">
      <button class="sm danger" data-act="dellevel" data-l="${i}">Quitar</button></div>
      <div class="grid"><div><label>Nombre del nivel</label><input data-l="${i}" data-lf="name" value="${esc(l.name)}" placeholder="Ej. Superior"></div>
        <div><label>Color</label><select data-l="${i}" data-lf="cls">${[['ok', 'Verde'], ['', 'Neutro'], ['warn', 'Amarillo'], ['bad', 'Rojo']].map(([v, n]) => `<option value="${v}" ${l.cls === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <label>Mensaje para el estudiante</label><textarea data-l="${i}" data-lf="text">${esc(l.text)}</textarea></div>`).join('')}
    <div class="row"><button class="sec" data-act="addlevel">＋ Nivel</button></div>
    <p class="mut">Cada nivel aplica desde su porcentaje hasta el siguiente nivel más alto. Debe haber un nivel que empiece en 0 %.</p>`
};

export const acts = {
  rubrics: () => go('rubrics'),
  newrubric: () => { state.rb = { _new: true, name: '', levels: LEVELS.map(({ min, name, cls, text }) => ({ min, name, cls, text })) }; go('rubedit'); },
  editrubric: el => { state.rb = JSON.parse(JSON.stringify(state.cache.rubrics.find(r => r.id === el.dataset.id))); go('rubedit'); },
  delrubric: async el => {
    if (!await ask('¿Borrar la rúbrica? Los exámenes que ya la usan conservan sus mensajes actuales.', 'Borrar')) return;
    await q(sb.from('rubrics').delete().eq('id', el.dataset.id)); go('rubrics');
  },
  addlevel: () => { state.rb.levels.push({ min: 0, name: '', cls: '', text: '' }); redraw('rubedit'); },
  dellevel: el => { if (state.rb.levels.length <= 1) return; state.rb.levels.splice(+el.dataset.l, 1); redraw('rubedit'); },
  saverubric: async () => {
    const name = state.rb.name.trim();
    if (!name) return toast('Pon un nombre a la rúbrica.', 'err');
    for (const [i, l] of state.rb.levels.entries()) {
      if (String(l.min).trim() === '' || !(+l.min >= 0 && +l.min <= 100)) return toast(`El nivel ${i + 1} necesita un porcentaje entre 0 y 100.`, 'err');
      if (!l.name.trim()) return toast(`El nivel ${i + 1} necesita un nombre.`, 'err');
    }
    const levels = state.rb.levels.map(l => ({ min: +l.min, name: l.name.trim(), cls: l.cls || '', text: l.text.trim() })).sort((a, b) => b.min - a.min);
    if (new Set(levels.map(l => l.min)).size !== levels.length) return toast('Dos niveles empiezan en el mismo porcentaje.', 'err');
    if (levels[levels.length - 1].min !== 0) return toast('Debe haber un nivel que empiece en 0 % para cubrir todas las notas.', 'err');
    if (state.rb._new) await q(sb.from('rubrics').insert({ name, levels }));
    else {
      await q(sb.from('rubrics').update({ name, levels }).eq('id', state.rb.id));
      await q(sb.from('exams').update({ levels }).eq('rubric_id', state.rb.id)); // los exámenes que la usan se actualizan
    }
    toast('Rúbrica guardada', 'ok'); go('rubrics');
  }
};
