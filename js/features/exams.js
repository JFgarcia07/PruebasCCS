/* Exámenes del profesor: listado, editor, importación, exportación y envío a otro profesor. */
import { EXAM_COLS, fullExam, q, rpc } from '../core/api.js';
import { sb } from '../core/config.js';
import { go, redraw } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, download, toast } from '../core/ui.js';
import { $, esc, uid } from '../core/util.js';
import { audioEditHTML } from './audio.js';

export const loaders = {
  async teacher() {
    const [exams, att] = await Promise.all([
      q(sb.from('exams').select(EXAM_COLS).eq('owner', state.session.user.id).order('created_at', { ascending: false })),
      q(sb.rpc('my_exam_counts'))]);
    state.cache.exams = exams;
    rpc('purge_old_shots', { p_days: 60 }).catch(() => { }); // libera espacio: fotos de cámara de hace más de 60 días
    const counts = {}; att.forEach(a => counts[a.exam_id] = Number(a.n));
    return { exams, counts };
  },
  async editor() { state.cache.rubrics = await q(sb.from('rubrics').select('id,name,kind,levels').eq('kind', 'exam').order('name')); }
};

export const views = {
  teacher: ({ exams, counts }) => `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Mis exámenes</h2>
      <button data-act="newexam">＋ Nuevo examen</button>
      <button class="sec" data-act="importexam">Importar JSON</button>
      ${exams.length ? '<button class="sec" data-act="sendexams">📤 Enviar exámenes</button>' : ''}
      <input type="file" id="impfile" accept=".json" hidden></div>
    ${exams.length ? exams.map(e => `<div class="card ex-card"><div class="grow"><h3 style="margin-bottom:.2rem">${esc(e.title)}</h3>
        <div class="tags"><span class="tag">Código <span class="code">${esc(e.code)}</span></span>
        <span class="tag">⏱ ${e.minutes} min</span><span class="tag">${e.n_questions} preguntas</span><span class="tag ok" title="Lo que vale el examen: suma de los puntos de sus preguntas">${e.total_points} pts</span>
        ${e.camera ? '<span class="tag warn">📷 cámara</span>' : ''}<span class="tag ok">${counts[e.id] || 0} intentos</span></div></div>
        <div class="row"><button class="sm sec" data-act="copylink" data-code="${esc(e.code)}">🔗 Copiar enlace</button>
        <button class="sm" data-act="edit" data-id="${e.id}">Editar</button>
        <button class="sm sec" data-act="results" data-id="${e.id}">Resultados</button>
        <button class="sm ghost" data-act="exportexam" data-id="${e.id}">Exportar</button>
        <button class="sm danger" data-act="delexam" data-id="${e.id}">Borrar</button></div></div>`).join('')
      : '<div class="card empty"><div class="ic">📋</div><p>Aún no tienes exámenes.</p><button data-act="newexam">Crear el primero</button></div>'}`,
  editor: () => {
    const e = state.ed;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${e._new ? 'Nuevo examen' : 'Editar examen'}</h2><span class="tag ok" id="extotal" title="Suma de los puntos de todas las preguntas">Valor del examen: ${examTotal(e.questions)} pts</span>
      <button class="ghost" data-act="teacher">Cancelar</button><button data-act="saveexam">Guardar examen</button></div>
    <div class="card"><div class="grid">
      <div><label>Título</label><input data-e="title" value="${esc(e.title)}" placeholder="Ej. Parcial de Matemática"></div>
      <div><label>Código de acceso</label><input data-e="code" value="${esc(e.code)}"></div>
      <div><label>Duración (minutos)</label><input data-e="minutes" type="number" min="1" value="${e.minutes}"></div></div>
      <label class="chk"><input type="checkbox" data-e="camera" ${e.camera ? 'checked' : ''}> Exigir cámara (fotos periódicas y registro de salidas de la pestaña)</label>
      <label class="chk"><input type="checkbox" data-e="shuffle" ${e.shuffle ? 'checked' : ''}> Mezclar el orden de las preguntas</label>
      <label class="chk"><input type="checkbox" data-e="show_score" ${e.show_score ? 'checked' : ''}> Mostrar la nota al estudiante al terminar</label>
      <label>Rúbrica de resultados (mensaje que verá el estudiante según su nota)</label>
      <select data-e="rubric_id"><option value="">Escala predeterminada</option>
        ${state.cache.rubrics.map(r => `<option value="${r.id}" ${r.id === e.rubric_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <span class="mut">Crea o edita rúbricas en la sección “Rúbricas” del menú.</span></div>
    ${e.questions.map(qHTML).join('')}
    <div class="row"><button class="sec" data-act="addq" data-t="mc">＋ Opción múltiple / V-F</button>
      <button class="sec" data-act="addq" data-t="text">＋ Respuesta corta</button>
      <button class="ghost" data-act="bulk">Pegar preguntas en texto</button></div>
    <div id="bulkbox" class="card" hidden style="margin-top:1rem">
      <p class="mut">Formato: <code>? Pregunta</code>, luego una opción por línea (<code>*</code> al inicio marca la correcta).
      Respuesta corta: <code>= respuesta1 | respuesta2</code>. Separa preguntas con una línea en blanco.</p>
      <textarea id="bulktxt" placeholder="? ¿Capital de Guatemala?&#10;*a) Ciudad de Guatemala&#10;b) Antigua&#10;&#10;? 2 + 2 =&#10;= 4 | cuatro"></textarea>
      <p><button data-act="dobulk">Agregar preguntas</button></p></div>`;
  }
};

export const acts = {
  teacher: () => go('teacher'),
  newexam: () => {
    state.ed = { _new: true, title: '', code: Math.random().toString(36).slice(2, 7).toUpperCase(), minutes: 30, camera: true, shuffle: false, show_score: true, questions: [] };
    go('editor');
  },
  edit: async el => { state.ed = await fullExam(el.dataset.id); go('editor'); },
  sendexams: () => {
    const m = document.createElement('div'); m.className = 'modal small';
    m.innerHTML = `<div class="card"><h3>Enviar exámenes a otro profesor</h3>
      <p class="mut">Los exámenes elegidos (con sus intentos y resultados) se pasarán a la cuenta de ese correo y desaparecerán de la tuya. Debe tener una cuenta creada.</p>
      <label>Correo del profesor</label><input id="sendto" type="email" autocomplete="off" placeholder="profesor@colegio.edu">
      <label>Exámenes a enviar</label>
      ${state.cache.exams.map(e => `<label class="chk"><input type="checkbox" class="sendchk" value="${e.id}" checked> ${esc(e.title)} <span class="mut">(${esc(e.code)})</span></label>`).join('')}
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="ghost" data-act="closemodal">Cancelar</button><button data-act="dosend">Enviar</button></div></div>`;
    document.body.appendChild(m); $('#sendto').focus();
  },
  dosend: async () => {
    const email = $('#sendto').value.trim(), ids = [...document.querySelectorAll('.sendchk:checked')].map(c => c.value);
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe un correo válido.', 'err');
    if (!ids.length) return toast('Elige al menos un examen.', 'err');
    if (!await ask(`¿Enviar ${ids.length} examen(es) a ${email}? Dejarán de estar en tu cuenta.`, 'Enviar')) return;
    const r = await rpc('transfer_exams', { p_ids: ids, p_email: email });
    $('.modal')?.remove(); toast(`${r.sent} examen(es) enviados a ${email}`, 'ok'); go('teacher');
  },
  delexam: async el => {
    if (!await ask('¿Borrar el examen y todos sus resultados?', 'Borrar')) return;
    await q(sb.from('exams').delete().eq('id', el.dataset.id)); go('teacher');
  },
  copylink: async el => {
    const url = location.origin + location.pathname + '#/examen/' + el.dataset.code;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); } catch { prompt('Copia el enlace:', url); }
  },
  exportexam: async el => {
    const { id, owner, created_at, rubric_id, n_questions, total_points, ...x } = await fullExam(el.dataset.id);
    download('examen.json', JSON.stringify(x, null, 1), 'application/json');
  },
  importexam: () => $('#impfile').click(),
  addq: el => {
    state.ed.questions.push(el.dataset.t === 'mc'
      ? { id: uid(), type: 'mc', text: '', options: ['', ''], correct: 0, points: 1 }
      : { id: uid(), type: 'text', text: '', answers: [], points: 1 });
    redraw('editor');
  },
  delq: el => { state.ed.questions.splice(+el.dataset.q, 1); redraw('editor'); },
  addopt: el => { state.ed.questions[+el.dataset.q].options.push(''); redraw('editor'); },
  delaudio: el => { const x = state.ed.questions[+el.dataset.q]; delete x.audio; delete x.plays; redraw('editor'); },
  delopt: el => {
    const x = state.ed.questions[+el.dataset.q], o = +el.dataset.o;
    if (x.options.length <= 2) return;
    x.options.splice(o, 1); if (x.correct >= x.options.length) x.correct = 0; else if (x.correct > o) x.correct--;
    redraw('editor');
  },
  bulk: () => { $('#bulkbox').hidden = false; $('#bulktxt').focus(); },
  dobulk: () => { const n = parseText($('#bulktxt').value); if (!n.length) return toast('No se reconocieron preguntas.', 'err'); state.ed.questions.push(...n); redraw('editor'); },
  saveexam: async () => {
    if (!state.ed.title.trim()) return toast('Pon un título.', 'err');
    state.ed.code = state.ed.code.trim().toUpperCase();
    if (!state.ed.code) return toast('Pon un código de acceso.', 'err');
    if (!state.ed.questions.length) return toast('Agrega al menos una pregunta.', 'err');
    for (const [i, x] of state.ed.questions.entries()) {
      if (!x.text.trim()) return toast(`La pregunta ${i + 1} está vacía.`, 'err');
      if (x.type === 'mc' && x.options.some(o => !o.trim())) return toast(`La pregunta ${i + 1} tiene opciones vacías.`, 'err');
      if (x.type === 'text' && !x.answers.length) return toast(`La pregunta ${i + 1} necesita una respuesta aceptada.`, 'err');
      if (x.audio && !/^(data:audio\/|https:\/\/)/i.test(x.audio)) return toast(`El audio de la pregunta ${i + 1} debe ser un archivo o un enlace https://.`, 'err');
      if (!x.audio) { delete x.audio; delete x.plays; }
    }
    const row = { title: state.ed.title.trim(), code: state.ed.code, minutes: state.ed.minutes, camera: state.ed.camera, shuffle: state.ed.shuffle, show_score: state.ed.show_score, questions: state.ed.questions,
      rubric_id: state.ed.rubric_id || null, levels: state.cache.rubrics.find(r => r.id === state.ed.rubric_id)?.levels || null };
    try {
      await q(state.ed._new ? sb.from('exams').insert(row) : sb.from('exams').update(row).eq('id', state.ed.id));
    } catch (e) { throw new Error(e.code === '23505' ? 'Ya existe otro examen con ese código.' : e.message); }
    toast('Examen guardado', 'ok'); go('teacher');
  }
};

/* Lo que vale el examen: suma de los puntos de sus preguntas */
export const examTotal = qs => Math.round(qs.reduce((a, x) => a + (+x.points || 0), 0) * 100) / 100;
export function refreshExamTotal() { const t = document.getElementById('extotal'); if (t) t.textContent = `Valor del examen: ${examTotal(state.ed.questions)} pts`; }
export function qHTML(x, i) {
  return `<div class="card qcard"><div class="row"><span class="qnum">${i + 1}</span><span class="tag">${x.type === 'mc' ? 'Opción múltiple' : 'Respuesta corta'}</span><span class="grow"></span>
    <span class="mut">Puntos</span><input style="width:80px" type="number" min="0" step="0.5" data-q="${i}" data-f="points" value="${x.points}">
    <button class="sm danger" data-act="delq" data-q="${i}">Quitar</button></div>
    <label>Enunciado</label><textarea data-q="${i}" data-f="text">${esc(x.text)}</textarea>
    ${audioEditHTML(x, i)}
    ${x.type === 'mc' ? `<label>Opciones (marca la correcta)</label>
      ${x.options.map((o, oi) => `<div class="opt"><input type="radio" name="c${i}" data-q="${i}" data-correct="${oi}" ${x.correct === oi ? 'checked' : ''}>
        <input type="text" data-q="${i}" data-o="${oi}" value="${esc(o)}" placeholder="Opción ${oi + 1}">
        <button class="sm ghost" data-act="delopt" data-q="${i}" data-o="${oi}">✕</button></div>`).join('')}
      <button class="sm sec" data-act="addopt" data-q="${i}">＋ Opción</button>`
      : `<label>Respuestas aceptadas (separa con |)</label><input data-q="${i}" data-f="answers" value="${esc(x.answers.join(' | '))}">
      <span class="mut">No distingue mayúsculas ni acentos.</span>`}</div>`;
}

export function parseText(t) {
  const qs = []; let cur = null;
  for (const raw of t.split(/\r?\n/)) {
    const l = raw.trim(); if (!l) continue;
    if (l.startsWith('?')) { cur = { id: uid(), type: 'mc', text: l.slice(1).trim(), options: [], correct: 0, points: 1 }; qs.push(cur); }
    else if (!cur) continue;
    else if (l.startsWith('=')) { cur.type = 'text'; cur.answers = l.slice(1).split('|').map(s => s.trim()).filter(Boolean); delete cur.options; delete cur.correct; }
    else if (cur.type === 'mc') {
      const m = l.match(/^(\*?)\s*(?:[A-Za-z][).]\s*|-\s*)?(.+)$/);
      if (m[1]) cur.correct = cur.options.length;
      cur.options.push(m[2].trim());
    }
  }
  return qs.filter(x => x.type === 'text' ? x.answers.length : x.options.length >= 2);
}

/* Importa uno o varios exámenes desde un archivo .json (lo llama events.js) */
export async function onImportFile(t) {
    try {
      const x = JSON.parse(await t.files[0].text());
      for (const ex of Array.isArray(x) ? x : [x]) {
        if (!ex.questions || !ex.title) throw new Error('Archivo JSON no válido.');
        const row = { title: ex.title, code: String(ex.code || uid()).toUpperCase(), minutes: ex.minutes || 30, camera: !!ex.camera, shuffle: !!ex.shuffle, show_score: ex.show_score !== false, questions: ex.questions, ...(ex.levels ? { levels: ex.levels } : {}) };
        for (let i = 0; ; i++) {
          const { error } = await sb.from('exams').insert(i ? { ...row, code: row.code + i } : row);
          if (!error) break; if (error.code !== '23505' || i > 20) throw error;
        }
      }
      toast('Importado', 'ok'); go('teacher');
    } catch (err) { toast(err.message || 'Archivo JSON no válido.', 'err'); }
}
