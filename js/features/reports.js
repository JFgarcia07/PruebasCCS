/* Reportes de estudiante: creación, formulario para docentes, resultados y PDF. */
import { q, rpc } from '../core/api.js';
import { sb } from '../core/config.js';
import { levelFor } from '../core/levels.js';
import { go, redraw, render } from '../core/router.js';
import { state } from '../core/state.js';
import { ask, toast } from '../core/ui.js';
import { esc, fdate, norm } from '../core/util.js';

export const loaders = {
  async repedit() { state.cache.rubrics = await q(sb.from('rubrics').select('id,name,kind,levels').eq('kind', 'report').order('name')); },
  async reports() {
    const [reports, ents] = await Promise.all([
      q(sb.from('reports').select('*').order('created_at', { ascending: false })),
      q(sb.from('report_entries').select('report_id'))]);
    state.cache.reports = reports;
    const counts = {}; ents.forEach(e => counts[e.report_id] = (counts[e.report_id] || 0) + 1);
    return { reports, counts };
  },
  async repview(id) {
    const [report, entries] = await Promise.all([
      q(sb.from('reports').select('*').eq('id', id).single()),
      q(sb.from('report_entries').select('*').eq('report_id', id).order('course'))]);
    return { report, entries };
  },
  async repform({ code }) {
    const info = await rpc('report_info', { p_code: code });
    let teacher = ''; try { teacher = localStorage.getItem('rep:teacher') || ''; } catch { }
    state.rf = { code, info, course: '', teacher, score: '', comment: '', token: null };
    return state.rf;
  }
};

export const views = {
  reports: ({ reports, counts }) => `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Reportes de estudiantes</h2>
      <button data-act="newreport">＋ Nuevo reporte</button></div>
    <p class="mut">Crea el reporte de un estudiante y comparte el enlace con sus docentes: cada uno elige su curso y deja la nota de la unidad y un comentario. Aquí ves todo lo recopilado y descargas el PDF.</p>
    ${reports.length ? reports.map(r => `<div class="card ex-card"><div class="grow"><h3 style="margin-bottom:.2rem">${esc(r.title)}</h3>
        <div class="tags"><span class="tag">👤 ${esc(r.student_name)}</span>${r.grade_level ? `<span class="tag">${esc(r.grade_level)}</span>` : ''}${r.period ? `<span class="tag">${esc(r.period)}</span>` : ''}
        <span class="tag">Código <span class="code">${esc(r.code)}</span></span>
        <span class="tag ok">${counts[r.id] || 0}${r.courses.length ? ' / ' + r.courses.length : ''} cursos registrados</span>${r.levels ? '<span class="tag warn">🏅 con rúbrica</span>' : ''}</div></div>
        <div class="row"><button class="sm sec" data-act="copyreplink" data-code="${esc(r.code)}">🔗 Copiar enlace</button>
        <button class="sm" data-act="repview" data-id="${r.id}">Resultados</button>
        <button class="sm sec" data-act="editreport" data-id="${r.id}">Editar</button>
        <button class="sm danger" data-act="delreport" data-id="${r.id}">Borrar</button></div></div>`).join('')
      : '<div class="card empty"><div class="ic">📝</div><p>Aún no tienes reportes.</p><button data-act="newreport">Crear el primero</button></div>'}`,
  repedit: () => {
    const r = state.rp;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${r._new ? 'Nuevo reporte' : 'Editar reporte'}</h2>
      <button class="ghost" data-act="reports">Cancelar</button><button data-act="savereport">Guardar reporte</button></div>
    <div class="card"><div class="grid">
      <div><label>Título del reporte</label><input data-rp="title" value="${esc(r.title)}" placeholder="Ej. Informe de la unidad 3"></div>
      <div><label>Nombre del estudiante</label><input data-rp="student_name" value="${esc(r.student_name)}"></div>
      <div><label>Grado / sección (opcional)</label><input data-rp="grade_level" value="${esc(r.grade_level)}" placeholder="Ej. 5.º primaria B"></div>
      <div><label>Período (opcional)</label><input data-rp="period" value="${esc(r.period)}" placeholder="Ej. Unidad 3 · 2026"></div>
      <div><label>Código del enlace</label><input data-rp="code" value="${esc(r.code)}"></div>
      <div><label>Nota máxima de la unidad</label><input data-rp="max_score" type="number" min="1" step="any" value="${esc(r.max_score)}" ${r._new ? '' : 'disabled title="No se puede cambiar una vez creado"'}></div></div>
      <label>Cursos (opcional, uno por línea)</label>
      <textarea data-rp="coursesTxt" placeholder="Matemática&#10;Comunicación y Lenguaje&#10;Ciencias Naturales">${esc(r.coursesTxt)}</textarea>
      <span class="mut">Si los escribes, cada docente elegirá su curso de esta lista (y verás cuáles faltan). Si lo dejas vacío, cada docente escribe el nombre de su curso.</span>
      <label>Rúbrica (opcional, se aplica al porcentaje de cada nota)</label>
      <select data-rp="rubric_id"><option value="">Sin rúbrica</option>
        ${state.cache.rubrics.map(x => `<option value="${x.id}" ${x.id === r.rubric_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <span class="mut">Crea o edita rúbricas en la sección “Rúbricas” del menú.</span></div>`;
  },
  repview: ({ report: r, entries }) => {
    const pct = e => Math.round(e.score / r.max_score * 100);
    const avg = entries.length ? entries.reduce((s, e) => s + +e.score, 0) / entries.length : null;
    const missing = r.courses.filter(c => !entries.some(e => norm(e.course) === norm(c)));
    const lv = avg === null ? null : repLevel(r, avg);
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${esc(r.title)}</h2>
      <button class="ghost" data-act="reports">← Reportes</button>
      <button class="sec" data-act="copyreplink" data-code="${esc(r.code)}">🔗 Copiar enlace</button>
      <button data-act="reppdf" data-id="${r.id}" ${entries.length ? '' : 'disabled'}>⬇ Descargar PDF</button></div>
    <div class="card"><div class="tags" style="margin:0">
      <span class="tag">👤 ${esc(r.student_name)}</span>${r.grade_level ? `<span class="tag">${esc(r.grade_level)}</span>` : ''}${r.period ? `<span class="tag">${esc(r.period)}</span>` : ''}
      <span class="tag">Nota máxima ${esc(r.max_score)}</span><span class="tag">Código <span class="code">${esc(r.code)}</span></span></div></div>
    <div class="stats"><div class="stat"><b>${entries.length}${r.courses.length ? ' / ' + r.courses.length : ''}</b><span>Cursos registrados</span></div>
      <div class="stat"><b>${avg === null ? '—' : Math.round(avg * 100) / 100}</b><span>Promedio (de ${esc(r.max_score)})</span></div>
      <div class="stat"><b>${lv ? esc(lv.name) : '—'}</b><span>${r.levels ? 'Nivel del promedio' : 'Sin rúbrica'}</span></div></div>
    ${missing.length ? `<div class="card"><b>Pendientes (${missing.length}):</b> <span class="mut">${missing.map(esc).join(' · ')}</span></div>` : ''}
    <div class="card tablewrap">${entries.length ? `<table><thead><tr><th>Curso</th><th>Docente</th><th>Nota</th>${r.levels ? '<th>Nivel</th>' : ''}<th>Comentario</th><th>Fecha</th><th></th></tr></thead><tbody>
    ${entries.map(e => `<tr><td><b>${esc(e.course)}</b></td><td>${esc(e.teacher_name)}</td>
      <td><b>${esc(e.score)}</b>/${esc(r.max_score)} <span class="mut">(${pct(e)} %)</span></td>
      ${r.levels ? (l => `<td><span class="tag ${esc(l.cls)}">${esc(l.name)}</span></td>`)(repLevel(r, e.score)) : ''}
      <td style="white-space:pre-wrap;min-width:220px">${e.comment ? esc(e.comment) : '<span class="mut">—</span>'}</td>
      <td>${fdate(e.updated_at)}</td>
      <td><button class="sm danger" data-act="delentry" data-id="${e.id}" data-rid="${r.id}">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty"><div class="ic">📭</div>Aún ningún docente ha registrado su nota. Comparte el enlace.</div>'}</div>`;
  },
  repform: () => {
    const f = state.rf, i = f.info;
    const mine = !!f.token;
    return `
    <div class="card center" style="max-width:560px"><img class="logo-sm" src="logo.webp" alt="Calvary Christian School">
      <h2>${esc(i.title)}</h2>
      <div class="tags"><span class="tag">👤 ${esc(i.student_name)}</span>${i.grade_level ? `<span class="tag">${esc(i.grade_level)}</span>` : ''}${i.period ? `<span class="tag">${esc(i.period)}</span>` : ''}</div>
      <label>Tu nombre</label><input data-rf="teacher" value="${esc(f.teacher)}" autocomplete="name">
      <label>Curso que impartes</label>
      ${i.courses.length ? `<select data-rf="course"><option value="">Selecciona…</option>
        ${i.courses.map(c => `<option value="${esc(c)}" ${norm(c) === norm(f.course) ? 'selected' : ''}>${esc(c)}${i.filled.some(x => norm(x) === norm(c)) ? ' (ya registrado)' : ''}</option>`).join('')}</select>`
      : `<input data-rf="course" value="${esc(f.course)}" placeholder="Ej. Matemática">`}
      ${mine ? '<p class="mut">Ya registraste este curso: puedes corregir tu nota o comentario.</p>' : ''}
      <label>Nota de la unidad (0 a ${esc(i.max_score)})</label>
      <input data-rf="score" type="number" min="0" max="${esc(i.max_score)}" step="any" inputmode="decimal" value="${esc(f.score)}">
      <label>Comentario sobre el estudiante</label>
      <textarea data-rf="comment" maxlength="2000" placeholder="Desempeño, actitud, áreas a reforzar…">${esc(f.comment)}</textarea>
      <div class="row" style="margin-top:1.1rem"><button class="lg grow" data-act="repsend">${mine ? 'Guardar cambios' : 'Enviar'}</button></div></div>`;
  },
  repdone: ({ course }) => `
    <div class="card center" style="text-align:center;max-width:520px"><img class="logo-sm" src="logo.webp" alt="Calvary Christian School">
      <h2>¡Gracias!</h2><p>Tu nota y comentario de <b>${esc(course)}</b> quedaron registrados.</p>
      <button class="sec" data-act="repagain">Corregir mi registro</button></div>`
};

export const acts = {
  reports: () => go('reports'),
  newreport: () => {
    state.rp = { _new: true, title: '', student_name: '', grade_level: '', period: '', code: Math.random().toString(36).slice(2, 8).toUpperCase(), max_score: 100, coursesTxt: '', rubric_id: '' };
    go('repedit');
  },
  editreport: el => {
    const r = JSON.parse(JSON.stringify(state.cache.reports.find(x => x.id === el.dataset.id)));
    state.rp = { ...r, coursesTxt: r.courses.join('\n'), rubric_id: r.rubric_id || '' };
    go('repedit');
  },
  savereport: async () => {
    const title = state.rp.title.trim(), student = state.rp.student_name.trim(), code = state.rp.code.trim().toUpperCase();
    if (!title) return toast('Pon un título al reporte.', 'err');
    if (!student) return toast('Escribe el nombre del estudiante.', 'err');
    if (!/^[A-Z0-9_-]+$/.test(code)) return toast('El código solo puede llevar letras, números, - y _.', 'err');
    const max = +state.rp.max_score;
    if (!(max > 0)) return toast('La nota máxima debe ser mayor que 0.', 'err');
    const courses = [...new Map(state.rp.coursesTxt.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => [norm(s), s])).values()];
    const row = { title, student_name: student, grade_level: state.rp.grade_level.trim(), period: state.rp.period.trim(), code, courses,
      rubric_id: state.rp.rubric_id || null, levels: state.cache.rubrics.find(x => x.id === state.rp.rubric_id)?.levels || null };
    try {
      await q(state.rp._new ? sb.from('reports').insert({ ...row, max_score: max }) : sb.from('reports').update(row).eq('id', state.rp.id));
    } catch (e) { throw new Error(e.code === '23505' ? 'Ya existe otro reporte con ese código.' : e.message); }
    toast('Reporte guardado', 'ok'); go('reports');
  },
  delreport: async el => {
    if (!await ask('¿Borrar el reporte y todas las notas registradas?', 'Borrar')) return;
    await q(sb.from('reports').delete().eq('id', el.dataset.id)); go('reports');
  },
  copyreplink: async el => {
    const url = location.origin + location.pathname + '#/reporte/' + el.dataset.code;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); } catch { prompt('Copia el enlace:', url); }
  },
  repview: el => go('repview', el.dataset.id),
  delentry: async el => {
    if (!await ask('¿Borrar este registro?', 'Borrar')) return;
    await q(sb.from('report_entries').delete().eq('id', el.dataset.id)); go('repview', el.dataset.rid);
  },
  reppdf: async el => reportPDF(await loaders.repview(el.dataset.id)),
  repsend: async () => {
    const f = state.rf, i = f.info, score = f.score === '' ? NaN : +f.score;
    if (!f.teacher.trim()) return toast('Escribe tu nombre.', 'err');
    if (!f.course.trim()) return toast('Indica el curso.', 'err');
    if (!(score >= 0 && score <= i.max_score)) return toast(`La nota debe estar entre 0 y ${i.max_score}.`, 'err');
    const r = await rpc('report_submit', { p_code: f.code, p_course: f.course, p_teacher: f.teacher, p_score: score, p_comment: f.comment, p_token: f.token });
    try { localStorage.setItem(repKey(f.code, r.course), r.token); localStorage.setItem('rep:teacher', f.teacher.trim()); } catch { }
    f.token = r.token; f.course = r.course;
    if (!i.filled.some(x => norm(x) === norm(r.course))) i.filled.push(r.course);
    render('repdone', { course: r.course });
  },
  repagain: () => render('repform')
};

export const repLevel = (r, score) => r.levels ? levelFor(Math.round(score / r.max_score * 100), r.levels) : null;
export const repKey = (code, course) => `rep:${code}:${norm(course)}`;
/* Si este navegador ya registró el curso elegido, recupera ese registro para poder corregirlo */
export async function loadMine() {
  const course = state.rf.course; state.rf.token = null;
  let tk = null; try { tk = course && localStorage.getItem(repKey(state.rf.code, course)); } catch { }
  if (tk) {
    try {
      const m = await rpc('report_my_entry', { p_code: state.rf.code, p_course: course, p_token: tk });
      if (m && state.rf.course === course) { state.rf.token = tk; state.rf.teacher = m.teacher; state.rf.score = String(m.score); state.rf.comment = m.comment; }
    } catch { }
  }
  redraw('repform');
}

export const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
export const loadScript = src => new Promise((res, rej) => {
  if (loadScript[src]) return res();
  const s = document.createElement('script'); s.src = src;
  s.onload = () => { loadScript[src] = true; res(); };
  s.onerror = () => rej(new Error('No se pudo cargar el generador de PDF. Revisa tu conexión.'));
  document.head.appendChild(s);
});
export const logoPng = () => new Promise(res => {
  const im = new Image();
  im.onload = () => { // se reduce: en el PDF ocupa ~54 pt
    const k = Math.min(1, 220 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/png'));
  };
  im.onerror = () => res(null);
  im.src = 'logo.webp';
});

export async function reportPDF({ report: r, entries }) {
  await loadScript(JSPDF);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, CW = W - 2 * M;
  const NAVY = [27, 42, 78], GOLD = [201, 169, 107], GRAY = [102, 112, 137], INK = [22, 33, 63];
  let y = M;
  const need = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const txt = (s, x, size, style, color, opt) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); doc.text(String(s), x, y, opt); };

  const wrap = (s, w) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); return doc.splitTextToSize(s, w); };
  const logo = await logoPng();
  if (logo) doc.addImage(logo, 'PNG', M, y - 6, 54, 54);
  txt('Calvary Christian School', M + 66, 18, 'bold', NAVY); y += 18;
  txt('Reporte de seguimiento del estudiante', M + 66, 11, 'normal', GRAY); y += 36;
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.5); doc.line(M, y, W - M, y); y += 26;

  txt(r.title, M, 15, 'bold', INK); y += 22;
  const info = [['Estudiante', r.student_name], r.grade_level && ['Grado / sección', r.grade_level], r.period && ['Período', r.period], ['Fecha de emisión', new Date().toLocaleDateString('es')]].filter(Boolean);
  for (const [k, v] of info) { txt(k + ':', M, 10.5, 'bold', GRAY); txt(v, M + 100, 10.5, 'normal', INK); y += 16; }
  y += 8;

  if (entries.length) {
    const avg = entries.reduce((s, e) => s + +e.score, 0) / entries.length, lv = repLevel(r, avg);
    const avgTxt = `${Math.round(avg * 100) / 100} / ${r.max_score}  (${Math.round(avg / r.max_score * 100)} %)`;
    const lines = lv ? wrap(lv.text, CW - 24) : [];
    const h = 46 + (lv ? 18 + lines.length * 13 : 0);
    need(h);
    doc.setFillColor(238, 241, 248); doc.roundedRect(M, y, CW, h, 6, 6, 'F');
    y += 20; txt('Resumen', M + 12, 11, 'bold', NAVY);
    txt(`Cursos registrados: ${entries.length}${r.courses.length ? ' de ' + r.courses.length : ''}`, W - M - 12, 10, 'normal', GRAY, { align: 'right' }); y += 18;
    txt('Promedio: ' + avgTxt + (lv ? '   ·   Nivel: ' + lv.name : ''), M + 12, 11, 'bold', INK);
    if (lv) { y += 18; doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK); doc.text(lines, M + 12, y); y += (lines.length - 1) * 13; }
    y += 30;
  }

  txt('Detalle por curso', M, 13, 'bold', NAVY); y += 10;
  for (const e of entries) {
    const lines = e.comment ? wrap(e.comment, CW) : [];
    need(54 + Math.min(lines.length, 6) * 13);
    y += 14; doc.setDrawColor(232, 229, 220); doc.setLineWidth(.7); doc.line(M, y - 6, W - M, y - 6); y += 8;
    const lv = repLevel(r, e.score);
    txt(e.course, M, 12, 'bold', INK);
    txt(`${e.score} / ${r.max_score}  (${Math.round(e.score / r.max_score * 100)} %)${lv ? '  ·  ' + lv.name : ''}`, W - M, 11, 'bold', NAVY, { align: 'right' }); y += 15;
    txt(`Docente: ${e.teacher_name}`, M, 9.5, 'normal', GRAY); y += 15;
    if (lines.length) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...INK);
      for (const ln of lines) { need(14); doc.text(ln, M, y); y += 13; }
    } else { txt('Sin comentario.', M, 10, 'italic', GRAY); y += 13; }
  }

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
    doc.text('Calvary Christian School · Documento confidencial', M, H - 24);
    doc.text(`Página ${p} de ${n}`, W - M, H - 24, { align: 'right' });
  }
  const slug = r.student_name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  doc.save(`reporte-${slug || 'estudiante'}.pdf`);
}
