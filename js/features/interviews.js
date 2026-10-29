/* Entrevistas del proceso de admisión (solo administración): al estudiante y a padres de familia, con las dos rúbricas fijas de 15 puntos.
   La administración llena la entrevista (datos del entrevistado, entrevistador y nivel de cada criterio) y el total se calcula solo. */
import { q } from '../core/api.js';
import { sb } from '../core/config.js';
import { INTERVIEW_LEVELS, INTERVIEW_RUBRICS, interviewScore } from '../core/interview-rubrics.js';
import { go, redraw, render } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { $, esc } from '../core/util.js';

const TABS = [['alumno', 'Al estudiante'], ['padre', 'A padres de familia']];
const GRADES = ['7th', '8th', '9th', '10th', '11th'];
const COLS = 'id,subject_type,subject_name,child_name,grade,age,father,mother,guardian,email,interviewer,held_on,scores,notes,created_at';
const today = () => new Date().toLocaleDateString('en-CA');   // AAAA-MM-DD en la hora local
const fmtDay = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es') : '';
const blank = type => ({ id: null, type, subject_name: '', child_name: '', grade: '', age: '', father: '', mother: '', guardian: '', email: '', held_on: today(),
  interviewer: state.profile?.name || state.profile?.email || '', scores: {}, notes: '' });
/* Padre, madre y/o encargado que se anotaron (puede haber 1, 2 o 3) */
const family = r => [r.father && 'Padre: ' + r.father, r.mother && 'Madre: ' + r.mother, r.guardian && 'Encargado: ' + r.guardian].filter(Boolean);
/* Datos propios de cada tipo de entrevistado, en una línea */
const details = r => (r.subject_type === 'padre'
  ? [r.child_name && 'Estudiante: ' + r.child_name, r.grade, r.age && r.age + ' años', r.email]
  : [r.grade, r.age && r.age + ' años', ...family(r)]).filter(Boolean).map(esc).join(' · ');

export const loaders = {
  async interviews() {
    const rows = await q(sb.from('interviews').select(COLS).order('created_at', { ascending: false }));
    state.iv = { rows, tab: state.iv?.tab || 'alumno' };
    return state.iv;
  }
};

export const views = {
  interviews: () => {
    const { rows, tab } = state.iv, R = INTERVIEW_RUBRICS[tab], list = rows.filter(r => r.subject_type === tab);
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Entrevistas</h2>
      <button data-act="ivnew">＋ Nueva entrevista ${tab === 'padre' ? 'a padres' : 'al estudiante'}</button></div>
    <div class="row" style="margin-bottom:.6rem">${TABS.map(([k, n]) => `<button class="sm ${k === tab ? '' : 'sec'}" data-act="ivtab" data-k="${k}">${n} (${rows.filter(r => r.subject_type === k).length})</button>`).join('')}</div>
    <p class="mut">${esc(R.title)} · Proceso de admisión · Valor total: ${R.total} puntos.</p>
    <div class="card tablewrap">${list.length ? `<table><thead><tr><th>Entrevistado</th><th>Entrevistador</th><th>Fecha</th><th>Total</th><th></th></tr></thead><tbody>
      ${list.map(r => { const s = interviewScore(r.subject_type, r.scores); return `<tr><td style="min-width:220px"><b>${esc(r.subject_name)}</b><br><span class="mut">${details(r)}</span></td>
        <td>${esc(r.interviewer)}</td><td>${fmtDay(r.held_on)}</td><td style="white-space:nowrap">${s.done ? `<b>${s.score}</b> / ${s.max}` : '<span class="tag warn">sin calificar</span>'}</td>
        <td class="row"><button class="sm" data-act="ivopen" data-id="${r.id}">Abrir</button>
        <button class="sm danger" data-act="delinterview" data-id="${r.id}">✕</button></td></tr>`; }).join('')}
      </tbody></table>` : '<div class="empty"><div class="ic">📭</div>Aún no hay entrevistas de este tipo. Pulsa “Nueva entrevista”.</div>'}</div>`;
  },

  /* La entrevista como el formato del colegio: datos arriba y, abajo, la rúbrica con el nivel de cada criterio */
  ivform: () => {
    const f = state.ivf, R = INTERVIEW_RUBRICS[f.type], padre = f.type === 'padre', s = interviewScore(f.type, f.scores);
    const fld = (label, key, extra = '') => `<div><label>${label}</label><input data-ivf="${key}" value="${esc(f[key])}" ${extra}></div>`;
    const grades = f.grade && !GRADES.includes(f.grade) ? [...GRADES, f.grade] : GRADES;   // un grado antiguo escrito a mano se conserva
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${esc(R.title)}</h2>
      <button class="ghost" data-act="ivback">Cancelar</button><button data-act="ivsave">Guardar</button></div>
    <div class="card"><p class="mut" style="margin:0 0 .4rem">Proceso de admisión · Valor total: ${R.total} puntos</p>
      <div class="grid">
      ${f.id ? '' : `<div><label>Tipo de entrevista</label><select id="ivtype">${TABS.map(([k, n]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}
      ${padre ? fld('Nombre del estudiante (hijo/a)', 'child_name') : fld('Nombre del estudiante entrevistado', 'subject_name')}
      <div><label>Grado al que aplica</label><select data-ivf="grade"><option value="">Selecciona…</option>${grades.map(g => `<option value="${esc(g)}" ${g === f.grade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
      ${fld('Edad', 'age', 'type="number" min="1" max="120" inputmode="numeric"')}
      ${padre ? fld('Correo electrónico', 'email', 'type="email"') : ''}
      ${fld('Fecha', 'held_on', 'type="date"')}
      ${fld('Entrevistador', 'interviewer')}</div>
      <h4 style="margin:1rem 0 .2rem">${padre ? 'Entrevistados' : 'Padre, madre o encargado'} <span class="mut" style="font-weight:400">(escribe al menos uno; puedes anotar hasta tres)</span></h4>
      <div class="grid">${fld('Padre', 'father')}${fld('Madre', 'mother')}${fld('Encargado', 'guardian')}</div></div>
    <p class="mut"><b>Instrucciones:</b> seleccione el nivel que mejor describa las respuestas y evidencias obtenidas durante la entrevista.</p>
    <div class="card tablewrap" style="padding:0"><table class="rub"><thead><tr><th>Criterio</th>${INTERVIEW_LEVELS.map(l => `<th>${l.v} ${l.v === 1 ? 'punto' : 'puntos'}<br>${esc(l.name)}</th>`).join('')}<th>Punteo</th></tr></thead><tbody>
      ${R.criteria.map(c => `<tr><th class="crit">${esc(c.name)}</th>${INTERVIEW_LEVELS.map(l => `<td><label class="rcell"><input type="radio" name="iv-${c.id}" data-ivk="${c.id}" value="${l.v}" ${f.scores[c.id] !== undefined && +f.scores[c.id] === l.v ? 'checked' : ''}><span>${esc(c.desc[l.v])}</span></label></td>`).join('')}
        <td style="text-align:center;white-space:nowrap"><b id="ivp-${c.id}">${f.scores[c.id] ?? '—'}</b> / ${c.max}</td></tr>`).join('')}
      </tbody></table></div>
    <div id="ivsum" class="card" style="background:var(--pri-soft)">${sumHTML(s)}</div>
    <div class="card"><label style="margin-top:0">Observaciones (opcional)</label><textarea data-ivf="notes" maxlength="2000">${esc(f.notes)}</textarea>
      <div class="row" style="margin-top:1rem"><button class="lg grow" data-act="ivsave">Guardar entrevista</button></div></div>`;
  }
};

const sumHTML = s => `<div class="row"><b>Puntaje total:</b> <span>${s.score} / ${s.max}</span><span class="grow"></span><span class="mut">${s.done} de ${s.n} criterios calificados</span></div>`;

/* Datos del formulario y niveles marcados (lo llama events.js) */
export function onIvInput(t) {
  const f = state.ivf;
  if (t.dataset.ivk) {
    f.scores[t.dataset.ivk] = +t.value;
    const p = $('#ivp-' + t.dataset.ivk); if (p) p.textContent = t.value;
    const el = $('#ivsum'); if (el) el.innerHTML = sumHTML(interviewScore(f.type, f.scores));
  } else if (t.dataset.ivf) f[t.dataset.ivf] = t.value;
}
/* Cambiar el tipo de una entrevista nueva: cambia la rúbrica y se vacían las notas (lo llama events.js) */
export function onIvType(t) { state.ivf.type = t.value; state.ivf.scores = {}; redraw('ivform'); }

export const acts = {
  interviews: () => go('interviews'),
  ivtab: el => { state.iv.tab = el.dataset.k; redraw('interviews'); },
  ivnew: () => { state.ivf = blank(state.iv.tab); go('ivform'); },
  ivopen: el => {
    const r = state.iv.rows.find(x => x.id === el.dataset.id);
    state.ivf = { ...blank(r.subject_type), ...r, type: r.subject_type, child_name: r.child_name || '', grade: r.grade || '', age: r.age ?? '', father: r.father || '', mother: r.mother || '',
      guardian: r.guardian || '', email: r.email || '', held_on: r.held_on || today(), scores: { ...r.scores }, notes: r.notes || '' };
    go('ivform');
  },
  ivback: () => { render('interviews'); window.scrollTo(0, 0); },
  ivsave: async () => {
    const f = state.ivf, padre = f.type === 'padre', v = k => String(f[k] ?? '').trim(), age = +v('age');
    if (padre) { if (!v('child_name')) return toast('Escribe el nombre del estudiante (hijo/a).', 'err'); }
    else if (!v('subject_name')) return toast('Escribe el nombre del estudiante entrevistado.', 'err');
    if (!v('grade')) return toast('Selecciona el grado al que aplica.', 'err');
    if (!(age >= 1 && age <= 120)) return toast('Escribe una edad válida.', 'err');
    if (!v('father') && !v('mother') && !v('guardian')) return toast(padre ? 'Escribe al menos un entrevistado (padre, madre o encargado).' : 'Escribe al menos el padre, la madre o el encargado.', 'err');
    if (padre && !/^\S+@\S+\.\S+$/.test(v('email'))) return toast('Escribe un correo electrónico válido.', 'err');
    if (!v('interviewer')) return toast('Escribe quién realiza la entrevista (entrevistador).', 'err');
    const s = interviewScore(f.type, f.scores);
    if (s.done < s.n) return toast(`Faltan criterios por calificar (${s.done} de ${s.n}).`, 'err');
    const names = [v('father'), v('mother'), v('guardian')].filter(Boolean);
    const data = { subject_type: f.type, subject_name: (padre ? names.join(' y ') : v('subject_name')).slice(0, 150), child_name: padre ? v('child_name').slice(0, 150) : null, grade: v('grade').slice(0, 100),
      age: Math.round(age), father: v('father').slice(0, 150) || null, mother: v('mother').slice(0, 150) || null, guardian: v('guardian').slice(0, 150) || null,
      email: padre ? v('email').slice(0, 200) : null, interviewer: v('interviewer').slice(0, 150), held_on: v('held_on') || today(), scores: f.scores, notes: v('notes').slice(0, 2000) };
    const row = await q(f.id ? sb.from('interviews').update(data).eq('id', f.id).select(COLS).single() : sb.from('interviews').insert(data).select(COLS).single());
    state.iv.rows = f.id ? state.iv.rows.map(r => r.id === f.id ? row : r) : [row, ...state.iv.rows];
    state.iv.tab = f.type; toast('Entrevista guardada', 'ok'); render('interviews'); window.scrollTo(0, 0);
  },
  delinterview: async el => {
    if (!await ask('¿Borrar esta entrevista?', 'Borrar')) return;
    await q(sb.from('interviews').delete().eq('id', el.dataset.id));
    state.iv.rows = state.iv.rows.filter(r => r.id !== el.dataset.id); redraw('interviews');
  }
};
