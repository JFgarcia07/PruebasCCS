'use strict';
/* Exámenes en línea — frontend estático + Supabase (Auth, Postgres/RLS, RPC). */
const cfg = window.APP_CONFIG || {};
const sb = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = s / 3600 | 0; return (h ? h + ':' : '') + String(s % 3600 / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fdate = t => new Date(t).toLocaleString('es');
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Escala de interpretación según el porcentaje obtenido */
const LEVELS = [
  { min: 85, range: '85 % o más', name: 'Superior', cls: 'ok', text: 'El estudiante demuestra un desempeño destacado en las habilidades cognitivas evaluadas. Presenta facilidad para comprender información, analizar situaciones, establecer relaciones lógicas y resolver problemas acordes con las tareas propuestas.' },
  { min: 70, range: '70 % a 84 %', name: 'Alto', cls: 'ok', text: 'El estudiante evidencia un buen desarrollo de las habilidades cognitivas evaluadas. Generalmente comprende las instrucciones, identifica relaciones entre conceptos y resuelve ejercicios que requieren razonamiento y análisis con buen nivel de desempeño.' },
  { min: 50, range: '50 % a 69 %', name: 'Promedio', cls: '', text: 'El estudiante presenta un desempeño esperado dentro de la escala establecida. Demuestra habilidades funcionales para comprender información, seguir instrucciones y resolver situaciones propias de las actividades evaluadas, aunque puede necesitar apoyo en algunas tareas específicas.' },
  { min: 35, range: '35 % a 49 %', name: 'Bajo el promedio', cls: 'warn', text: 'El estudiante muestra un desempeño inferior al promedio establecido en las habilidades evaluadas. Puede presentar dificultades en tareas que requieren comprensión, razonamiento, identificación de patrones o resolución de problemas, por lo que conviene identificar sus necesidades de apoyo académico.' },
  { min: 0, range: 'Menos de 35 %', name: 'Bajo', cls: 'bad', text: 'El estudiante presenta un desempeño reducido en las tareas cognitivas evaluadas. Puede requerir acompañamiento pedagógico, estrategias de aprendizaje diferenciadas y una revisión de los factores que pudieron influir en sus resultados, para determinar qué apoyos necesita.' }
];
const levelFor = pct => LEVELS.find(l => pct >= l.min);

const app = $('#app');
let session = null, ed = null, run = null, stream = null, gen = 0, cache = { exams: [] };

/* ---------- UI helpers ---------- */
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4500);
}
function ask(msg, ok = 'Aceptar') {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal small';
    m.innerHTML = `<div class="card"><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end">
      <button class="ghost" data-r="0">Cancelar</button><button data-r="1">${esc(ok)}</button></div></div>`;
    m.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { m.remove(); res(b.dataset.r === '1'); } });
    document.body.appendChild(m);
  });
}
function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

/* ---------- Navegación ---------- */
const loaders = {
  async teacher() {
    const [exams, att] = await Promise.all([
      q(sb.from('exams').select('*').order('created_at', { ascending: false })),
      q(sb.from('attempts').select('exam_id'))]);
    cache.exams = exams;
    const counts = {}; att.forEach(a => counts[a.exam_id] = (counts[a.exam_id] || 0) + 1);
    return { exams, counts };
  },
  async results(examId) {
    const [exams, attempts] = await Promise.all([
      q(sb.from('exams').select('*').order('created_at', { ascending: false })),
      q(sb.from('attempts').select('id,exam_id,student_name,started_at,ended_at,score,max_score,flags').order('started_at', { ascending: false }))]);
    cache.exams = exams;
    return { exams, attempts: attempts.filter(a => !examId || a.exam_id === examId), examId };
  }
};

async function go(view, p) {
  cleanupRun();
  const my = ++gen;
  try {
    if (!sb && view !== 'home') view = 'setup';
    if (['teacher', 'results', 'editor'].includes(view) && !session) view = 'auth';
    let data = p;
    if (loaders[view]) { app.innerHTML = '<div class="loading">Cargando…</div>'; data = await loaders[view](p); }
    if (my !== gen) return;
    render(view, data);
    window.scrollTo(0, 0);
  } catch (e) { toast(e.message || String(e), 'err'); if (my === gen) render('home'); }
}
function redraw(view) { const y = scrollY; render(view); scrollTo(0, y); }
function nav() {
  $('#topnav').innerHTML = session
    ? '<a href="#" data-act="teacher">Mis exámenes</a><a href="#" data-act="results">Resultados</a><a href="#" data-act="logout">Cerrar sesión</a>'
    : '<a href="#" data-act="join">Presentar examen</a><a href="#" data-act="tlogin">Profesores</a>';
}
function render(view, p) { nav(); app.innerHTML = views[view](p); }

const views = {
  setup: () => `<div class="card center" style="max-width:640px"><h2>⚙️ Falta conectar Supabase</h2>
    <ol class="steps"><li>Crea un proyecto gratis en <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
    <li>En <b>SQL Editor</b> pega y ejecuta <code>supabase/schema.sql</code>.</li>
    <li>En <b>Project Settings → API</b> copia la <i>Project URL</i> y la <i>anon key</i> en <code>config.js</code>.</li>
    <li>Recarga esta página.</li></ol><p class="mut">Detalles en <code>README.md</code>.</p></div>`,

  home: () => `
    <section class="hero"><img src="logo.webp" alt="Calvary Christian School"><div><h1>Calvary Christian School</h1><p>Plataforma de exámenes y pruebas de aptitud. Academics · Discipleship · Excellence.</p></div></section>
    <div class="grid">
      <div class="card role"><span class="ic">🎓</span><h3>Soy estudiante</h3>
        <p class="mut">Ingresa el código que te dio tu profesor y comienza tu examen.</p>
        <button class="lg" data-act="join">Presentar examen</button></div>
      <div class="card role"><span class="ic">👩‍🏫</span><h3>Soy profesor</h3>
        <p class="mut">Crea exámenes, sube tus preguntas con sus respuestas y revisa resultados.</p>
        <button class="lg sec" data-act="tlogin">Entrar al panel</button></div>
    </div>`,

  auth: () => `
    <div class="card center"><h2>Panel del profesor</h2>
      <label>Correo</label><input id="email" type="email" autocomplete="email">
      <label>Contraseña</label><input id="pass" type="password" autocomplete="current-password" minlength="6">
      <div class="row" style="margin-top:1.1rem"><button class="grow" data-act="login">Entrar</button>
        <button class="sec grow" data-act="signup">Crear cuenta</button></div></div>`,

  teacher: ({ exams, counts }) => `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Mis exámenes</h2>
      <button data-act="newexam">＋ Nuevo examen</button>
      <button class="sec" data-act="importexam">Importar JSON</button>
      <input type="file" id="impfile" accept=".json" hidden></div>
    ${exams.length ? exams.map(e => `<div class="card ex-card"><div class="grow"><h3 style="margin-bottom:.2rem">${esc(e.title)}</h3>
        <div class="tags"><span class="tag">Código <span class="code">${esc(e.code)}</span></span>
        <span class="tag">⏱ ${e.minutes} min</span><span class="tag">${e.questions.length} preguntas</span>
        ${e.camera ? '<span class="tag warn">📷 cámara</span>' : ''}<span class="tag ok">${counts[e.id] || 0} intentos</span></div></div>
        <div class="row"><button class="sm sec" data-act="copylink" data-code="${esc(e.code)}">🔗 Copiar enlace</button>
        <button class="sm" data-act="edit" data-id="${e.id}">Editar</button>
        <button class="sm sec" data-act="results" data-id="${e.id}">Resultados</button>
        <button class="sm ghost" data-act="exportexam" data-id="${e.id}">Exportar</button>
        <button class="sm danger" data-act="delexam" data-id="${e.id}">Borrar</button></div></div>`).join('')
      : '<div class="card empty"><div class="ic">📋</div><p>Aún no tienes exámenes.</p><button data-act="newexam">Crear el primero</button></div>'}`,

  editor: () => {
    const e = ed;
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">${e._new ? 'Nuevo examen' : 'Editar examen'}</h2>
      <button class="ghost" data-act="teacher">Cancelar</button><button data-act="saveexam">Guardar examen</button></div>
    <div class="card"><div class="grid">
      <div><label>Título</label><input data-e="title" value="${esc(e.title)}" placeholder="Ej. Parcial de Matemática"></div>
      <div><label>Código de acceso</label><input data-e="code" value="${esc(e.code)}"></div>
      <div><label>Duración (minutos)</label><input data-e="minutes" type="number" min="1" value="${e.minutes}"></div></div>
      <label class="chk"><input type="checkbox" data-e="camera" ${e.camera ? 'checked' : ''}> Exigir cámara (fotos periódicas y registro de salidas de la pestaña)</label>
      <label class="chk"><input type="checkbox" data-e="shuffle" ${e.shuffle ? 'checked' : ''}> Mezclar el orden de las preguntas</label>
      <label class="chk"><input type="checkbox" data-e="show_score" ${e.show_score ? 'checked' : ''}> Mostrar la nota al estudiante al terminar</label></div>
    ${e.questions.map(qHTML).join('')}
    <div class="row"><button class="sec" data-act="addq" data-t="mc">＋ Opción múltiple / V-F</button>
      <button class="sec" data-act="addq" data-t="text">＋ Respuesta corta</button>
      <button class="ghost" data-act="bulk">Pegar preguntas en texto</button></div>
    <div id="bulkbox" class="card" hidden style="margin-top:1rem">
      <p class="mut">Formato: <code>? Pregunta</code>, luego una opción por línea (<code>*</code> al inicio marca la correcta).
      Respuesta corta: <code>= respuesta1 | respuesta2</code>. Separa preguntas con una línea en blanco.</p>
      <textarea id="bulktxt" placeholder="? ¿Capital de Guatemala?&#10;*a) Ciudad de Guatemala&#10;b) Antigua&#10;&#10;? 2 + 2 =&#10;= 4 | cuatro"></textarea>
      <p><button data-act="dobulk">Agregar preguntas</button></p></div>`;
  },

  results: ({ exams, attempts, examId }) => {
    const done = attempts.filter(a => a.ended_at && a.max_score);
    const avg = done.length ? Math.round(done.reduce((s, a) => s + a.score / a.max_score, 0) / done.length * 100) : null;
    const alerts = attempts.reduce((s, a) => s + a.flags.length, 0);
    return `
    <div class="row" style="margin-bottom:1rem"><h2 class="grow" style="margin:0">Resultados</h2>
      <select id="resfilter" style="width:auto"><option value="">Todos los exámenes</option>
      ${exams.map(e => `<option value="${e.id}" ${e.id === examId ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select>
      <button class="sec" data-act="csv" data-id="${examId || ''}">⬇ CSV</button></div>
    <div class="stats"><div class="stat"><b>${attempts.length}</b><span>Intentos</span></div>
      <div class="stat"><b>${avg === null ? '—' : avg + '%'}</b><span>Promedio</span></div>
      <div class="stat"><b>${alerts}</b><span>Alertas de conducta</span></div></div>
    <div class="card tablewrap">${attempts.length ? `<table><thead><tr><th>Estudiante</th><th>Examen</th><th>Nota</th><th>Nivel</th><th>Fecha</th><th>Alertas</th><th></th></tr></thead><tbody>
    ${attempts.map(a => {
      const ex = exams.find(e => e.id === a.exam_id);
      return `<tr><td><b>${esc(a.student_name)}</b></td><td>${esc(ex ? ex.title : '')}</td>
      <td>${a.ended_at ? `<b>${a.score}</b>/${a.max_score}` : '<span class="tag warn">en curso</span>'}</td>
      <td>${a.ended_at && a.max_score ? (l => `<span class="tag ${l.cls}">${l.name}</span>`)(levelFor(Math.round(a.score / a.max_score * 100))) : '<span class="mut">—</span>'}</td><td>${fdate(a.started_at)}</td>
      <td>${a.flags.length ? `<span class="tag bad">${a.flags.length}</span>` : '<span class="mut">—</span>'}</td>
      <td class="row"><button class="sm sec" data-act="detail" data-id="${a.id}">Ver</button>
      <button class="sm danger" data-act="delatt" data-id="${a.id}">✕</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="empty"><div class="ic">📭</div>Sin intentos todavía.</div>'}</div>`;
  },

  join: p => `
    <div class="card center"><h2>Presentar examen</h2>
      <label>Código del examen</label><input id="jcode" autocomplete="off" value="${esc(p?.code || '')}" style="text-transform:uppercase">
      <label>Tu nombre completo</label><input id="jname" autocomplete="name">
      <div id="camwrap" hidden><p class="mut camhint">📷 Este examen requiere cámara. Verifica que te veas bien.</p>
        <video id="cam" autoplay muted playsinline></video></div>
      <p id="jmsg" class="mut"></p>
      <div class="row"><button class="lg grow" data-act="start" id="startbtn">Continuar</button><button class="ghost" data-act="home">Volver</button></div>
    </div>`,

  exam: () => {
    const { info, at } = run;
    const qs = at.order.map(id => info.questions.find(x => x.id === id));
    return `<div class="examhead"><div class="row"><h2 class="grow">${esc(info.title)}</h2>
      <span class="savestate" id="savestate"></span><span id="timer">--:--</span></div>
      <div class="bar"><i id="prog"></i></div></div>
    <div class="examwrap"><div>
      ${qs.map((x, i) => `<div class="card qcard" id="q${i}"><div class="row"><span class="qnum">${i + 1}</span><span class="mut">${x.points} ${x.points == 1 ? 'punto' : 'puntos'}</span></div>
        <p style="white-space:pre-wrap;margin:.6rem 0">${esc(x.text)}</p>
        ${audioPlayHTML(x)}
        ${x.type === 'mc' ? x.options.map((o, oi) => `<label class="ans"><input type="radio" name="${x.id}" data-qid="${x.id}" value="${oi}" ${at.answers[x.id] === oi ? 'checked' : ''}>${esc(o)}</label>`).join('')
        : `<input data-qid="${x.id}" placeholder="Escribe tu respuesta" value="${esc(at.answers[x.id] ?? '')}" autocomplete="off">`}
      </div>`).join('')}
      <button class="lg" data-act="finish">Enviar examen</button></div>
      <aside class="side"><div class="card">
        ${info.camera ? '<video id="cam" autoplay muted playsinline></video>' : ''}
        <div class="nav">${qs.map((x, i) => `<a href="#q${i}" id="n${i}">${i + 1}</a>`).join('')}</div></div></aside></div>`;
  },

  done: p => {
    const pct = p.show && p.max ? Math.round(p.score / p.max * 100) : 0, lv = levelFor(pct);
    return `
    <div class="card center" style="text-align:center;max-width:560px"><img class="logo-sm" src="logo.webp" alt="Calvary Christian School"><h2>Examen enviado</h2>
      ${p.show ? `<div class="big">${p.score} / ${p.max}</div><p class="mut">${pct}%</p>
        <p><span class="tag lvl ${lv.cls}">Nivel: ${lv.name}</span></p>
        <p class="lvltext">${lv.text}</p>` : '<p class="mut">Tu profesor te dará los resultados.</p>'}
      ${p.auto ? '<p class="mut">Se envió automáticamente al terminar el tiempo.</p>' : ''}
      <button data-act="home" style="margin-top:1rem">Volver al inicio</button></div>`;
  }
};

/* ---------- Acciones ---------- */
const acts = {
  home: () => go('home'),
  join: () => go('join'),
  tlogin: () => go(session ? 'teacher' : 'auth'),
  teacher: () => go('teacher'),
  login: async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#pass').value });
    if (error) throw error;
    go('teacher');
  },
  signup: async () => {
    const { data, error } = await sb.auth.signUp({ email: $('#email').value.trim(), password: $('#pass').value });
    if (error) throw error;
    if (data.session) go('teacher'); else toast('Cuenta creada. Revisa tu correo para confirmarla y luego entra.', 'ok');
  },
  logout: async () => {
    // 'local' borra la sesión de este navegador aunque no haya conexión con el servidor
    await sb.auth.signOut({ scope: 'local' }).catch(() => { });
    session = null; ed = null; go('home');
  },
  newexam: () => {
    ed = { _new: true, title: '', code: Math.random().toString(36).slice(2, 7).toUpperCase(), minutes: 30, camera: true, shuffle: false, show_score: true, questions: [] };
    go('editor');
  },
  edit: el => { ed = JSON.parse(JSON.stringify(cache.exams.find(e => e.id === el.dataset.id))); go('editor'); },
  delexam: async el => {
    if (!await ask('¿Borrar el examen y todos sus resultados?', 'Borrar')) return;
    await q(sb.from('exams').delete().eq('id', el.dataset.id)); go('teacher');
  },
  copylink: async el => {
    const url = location.origin + location.pathname + '#/examen/' + el.dataset.code;
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); } catch { prompt('Copia el enlace:', url); }
  },
  exportexam: el => {
    const { id, owner, created_at, ...x } = cache.exams.find(e => e.id === el.dataset.id);
    download('examen.json', JSON.stringify(x, null, 1), 'application/json');
  },
  importexam: () => $('#impfile').click(),
  addq: el => {
    ed.questions.push(el.dataset.t === 'mc'
      ? { id: uid(), type: 'mc', text: '', options: ['', ''], correct: 0, points: 1 }
      : { id: uid(), type: 'text', text: '', answers: [], points: 1 });
    redraw('editor');
  },
  delq: el => { ed.questions.splice(+el.dataset.q, 1); redraw('editor'); },
  addopt: el => { ed.questions[+el.dataset.q].options.push(''); redraw('editor'); },
  delaudio: el => { const x = ed.questions[+el.dataset.q]; delete x.audio; delete x.plays; redraw('editor'); },
  delopt: el => {
    const x = ed.questions[+el.dataset.q], o = +el.dataset.o;
    if (x.options.length <= 2) return;
    x.options.splice(o, 1); if (x.correct >= x.options.length) x.correct = 0; else if (x.correct > o) x.correct--;
    redraw('editor');
  },
  bulk: () => { $('#bulkbox').hidden = false; $('#bulktxt').focus(); },
  dobulk: () => { const n = parseText($('#bulktxt').value); if (!n.length) return toast('No se reconocieron preguntas.', 'err'); ed.questions.push(...n); redraw('editor'); },
  saveexam: async () => {
    if (!ed.title.trim()) return toast('Pon un título.', 'err');
    ed.code = ed.code.trim().toUpperCase();
    if (!ed.code) return toast('Pon un código de acceso.', 'err');
    if (!ed.questions.length) return toast('Agrega al menos una pregunta.', 'err');
    for (const [i, x] of ed.questions.entries()) {
      if (!x.text.trim()) return toast(`La pregunta ${i + 1} está vacía.`, 'err');
      if (x.type === 'mc' && x.options.some(o => !o.trim())) return toast(`La pregunta ${i + 1} tiene opciones vacías.`, 'err');
      if (x.type === 'text' && !x.answers.length) return toast(`La pregunta ${i + 1} necesita una respuesta aceptada.`, 'err');
      if (x.audio && !/^(data:audio\/|https:\/\/)/i.test(x.audio)) return toast(`El audio de la pregunta ${i + 1} debe ser un archivo o un enlace https://.`, 'err');
      if (!x.audio) { delete x.audio; delete x.plays; }
    }
    const row = { title: ed.title.trim(), code: ed.code, minutes: ed.minutes, camera: ed.camera, shuffle: ed.shuffle, show_score: ed.show_score, questions: ed.questions };
    try {
      await q(ed._new ? sb.from('exams').insert(row) : sb.from('exams').update(row).eq('id', ed.id));
    } catch (e) { throw new Error(e.code === '23505' ? 'Ya existe otro examen con ese código.' : e.message); }
    toast('Examen guardado', 'ok'); go('teacher');
  },
  results: el => go('results', el?.dataset.id || ''),
  detail: el => showDetail(el.dataset.id),
  closemodal: () => $('.modal')?.remove(),
  delatt: async el => {
    if (!await ask('¿Borrar este intento?', 'Borrar')) return;
    await q(sb.from('attempts').delete().eq('id', el.dataset.id)); go('results', $('#resfilter')?.value || '');
  },
  csv: async el => {
    const { exams, attempts } = await loaders.results(el.dataset.id || '');
    const rows = [['Estudiante', 'Examen', 'Nota', 'Máximo', 'Inicio', 'Fin', 'Alertas']];
    attempts.forEach(a => rows.push([a.student_name, exams.find(e => e.id === a.exam_id)?.title, a.score ?? '', a.max_score ?? '', fdate(a.started_at), a.ended_at ? fdate(a.ended_at) : '', a.flags.length]));
    download('resultados.csv', '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  },
  start: startFlow,
  finish: async () => { if (await ask('¿Enviar el examen? No podrás cambiar tus respuestas.', 'Enviar')) finishExam(false); }
};

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  el.disabled = true;
  try { await acts[el.dataset.act]?.(el); }
  catch (err) { toast(err.message || String(err), 'err'); }
  finally { el.disabled = false; }
});
$('#brand').addEventListener('click', async e => {
  e.preventDefault();
  if (run && !await ask('Hay un examen en curso y el tiempo sigue corriendo. ¿Salir?', 'Salir')) return;
  go('home');
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.e) ed[t.dataset.e] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(1, +t.value || 1) : t.value;
  else if (t.dataset.f) {
    const x = ed.questions[+t.dataset.q];
    if (t.dataset.f === 'answers') x.answers = t.value.split('|').map(s => s.trim()).filter(Boolean);
    else if (t.dataset.f === 'points') x.points = Math.max(0, +t.value || 0);
    else if (t.dataset.f === 'plays') x.plays = Math.max(0, Math.floor(+t.value || 0));
    else x[t.dataset.f] = t.value;
  } else if (t.dataset.o !== undefined) ed.questions[+t.dataset.q].options[+t.dataset.o] = t.value;
  else if (t.dataset.qid && run) {
    run.at.answers[t.dataset.qid] = t.type === 'radio' ? +t.value : t.value;
    run.dirty = true; markNav(); clearTimeout(run.saveT); run.saveT = setTimeout(saveAnswers, 700);
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.correct !== undefined) ed.questions[+t.dataset.q].correct = +t.dataset.correct;
  if (t.id === 'resfilter') go('results', t.value);
  if (t.dataset.afile !== undefined && t.files[0]) {
    const f = t.files[0], x = ed.questions[+t.dataset.afile];
    if (!f.type.startsWith('audio/')) { t.value = ''; return toast('Elige un archivo de audio.', 'err'); }
    if (f.size > AUDIO_MAX) { t.value = ''; return toast('El audio pesa más de 1.5 MB. Comprímelo o usa un enlace.', 'err'); }
    x.audio = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    redraw('editor');
  }
  if (t.dataset.aurl !== undefined) {
    const v = t.value.trim(), x = ed.questions[+t.dataset.q];
    if (!v) return;
    if (!/^https:\/\//i.test(v)) return toast('El enlace debe empezar con https://', 'err');
    x.audio = v; redraw('editor');
  }
  if (t.id === 'impfile' && t.files[0]) {
    try {
      const x = JSON.parse(await t.files[0].text());
      for (const ex of Array.isArray(x) ? x : [x]) {
        if (!ex.questions || !ex.title) throw new Error('Archivo JSON no válido.');
        const row = { title: ex.title, code: String(ex.code || uid()).toUpperCase(), minutes: ex.minutes || 30, camera: !!ex.camera, shuffle: !!ex.shuffle, show_score: ex.show_score !== false, questions: ex.questions };
        for (let i = 0; ; i++) {
          const { error } = await sb.from('exams').insert(i ? { ...row, code: row.code + i } : row);
          if (!error) break; if (error.code !== '23505' || i > 20) throw error;
        }
      }
      toast('Importado', 'ok'); go('teacher');
    } catch (err) { toast(err.message || 'Archivo JSON no válido.', 'err'); }
  }
});

function qHTML(x, i) {
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

/* ---------- Pistas de audio ---------- */
const AUDIO_MAX = 1.5 * 1024 * 1024;
function audioEditHTML(x, i) {
  if (x.audio) return `<div class="audbox"><label>Pista de audio</label>
    <audio controls preload="metadata" src="${esc(x.audio)}"></audio>
    <div class="row"><span class="mut">Reproducciones permitidas (0 = sin límite)</span>
      <input style="width:80px" type="number" min="0" data-q="${i}" data-f="plays" value="${x.plays || 0}">
      <span class="grow"></span><button class="sm danger" data-act="delaudio" data-q="${i}">Quitar audio</button></div></div>`;
  return `<div class="audbox"><label>Pista de audio (opcional)</label>
    <div class="row"><input type="file" accept="audio/*" data-afile="${i}" style="flex:1">
      <input type="text" data-q="${i}" data-aurl placeholder="…o pega un enlace https:// a un .mp3" style="flex:1"></div>
    <span class="mut">Archivo de hasta 1.5 MB (MP3 recomendado) o enlace directo.</span></div>`;
}
function audioPlayHTML(x) {
  if (!x.audio) return '';
  const left = x.plays ? x.plays - (run.plays[x.id] || 0) : null;
  return `<div class="audbox" id="aud-${x.id}">${left === 0 ? '<span class="mut">🔇 Ya usaste todas las reproducciones de este audio.</span>'
    : `<audio controls controlsList="nodownload noplaybackrate" preload="auto" data-aqid="${x.id}" src="${esc(x.audio)}"></audio>`}
    ${left === null ? '' : `<span class="mut" data-aleft="${x.id}">Reproducciones restantes: ${left}</span>`}</div>`;
}
/* Los eventos de media no burbujean: se capturan a nivel de documento.
   Una reproducción se cuenta al iniciarla (no al terminar); pausar y seguir no cuenta.
   Con límite, se bloquea adelantar/retroceder para que no se pueda rebobinar. */
const audioInfo = e => {
  const qid = e.target.dataset?.aqid;
  return qid && run ? { el: e.target, qid, x: run.info.questions.find(z => z.id === qid) } : null;
};
document.addEventListener('play', e => {
  const a = audioInfo(e); if (!a || a.el._counted) return;
  a.el._counted = true;
  run.plays[a.qid] = (run.plays[a.qid] || 0) + 1;
  try { localStorage.setItem('plays:' + run.at.id, JSON.stringify(run.plays)); } catch { }
  if (!a.x.plays) return;
  $(`[data-aleft="${a.qid}"]`).textContent = 'Reproducciones restantes: ' + Math.max(0, a.x.plays - run.plays[a.qid]);
}, true);
document.addEventListener('timeupdate', e => { const a = audioInfo(e); if (a && !a.el.seeking) a.el._t = a.el.currentTime; }, true);
document.addEventListener('seeking', e => {
  const a = audioInfo(e);
  if (a && a.x.plays && a.el._t !== undefined && Math.abs(a.el.currentTime - a.el._t) > .7) a.el.currentTime = a.el._t;
}, true);
document.addEventListener('ended', e => {
  const a = audioInfo(e); if (!a) return;
  a.el._counted = false; a.el._t = 0;
  if (a.x.plays && a.x.plays - run.plays[a.qid] <= 0) $('#aud-' + a.qid).innerHTML = '<span class="mut">🔇 Ya usaste todas las reproducciones de este audio.</span>';
}, true);

function parseText(t) {
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

async function showDetail(id) {
  const [a, shots] = await Promise.all([
    q(sb.from('attempts').select('*').eq('id', id).single()),
    q(sb.from('shots').select('taken_at,img').eq('attempt_id', id).order('taken_at'))]);
  const ex = cache.exams.find(e => e.id === a.exam_id);
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="card"><div class="row"><h3 class="grow">${esc(a.student_name)} — ${esc(ex?.title || '')}</h3><button class="sm sec" data-act="closemodal">Cerrar</button></div>
    <p>Nota: <b>${a.score ?? '—'}/${a.max_score ?? '—'}</b>${a.ended_at && a.max_score ? (p => ` (${p} %) · Nivel: <b>${levelFor(p).name}</b>`)(Math.round(a.score / a.max_score * 100)) : ''} · Inicio: ${fdate(a.started_at)}${a.ended_at ? ' · Duración: ' + fmt(new Date(a.ended_at) - new Date(a.started_at)) : ''}</p>
    <h4>Alertas (${a.flags.length})</h4>${a.flags.length ? '<ul>' + a.flags.map(f => `<li>${new Date(f.t).toLocaleTimeString('es')} — ${esc(f.msg)}</li>`).join('') + '</ul>' : '<p class="mut">Sin alertas.</p>'}
    <h4>Fotos de la cámara (${shots.length})</h4><div class="shots">${shots.map(s => `<img src="${s.img}" title="${new Date(s.taken_at).toLocaleTimeString('es')}">`).join('') || '<span class="mut">Sin fotos.</span>'}</div>
    <h4 style="margin-top:1rem">Respuestas</h4>${ex ? ex.questions.map((x, i) => {
    const r = a.answers[x.id];
    const ok = x.type === 'mc' ? r === x.correct : r !== undefined && x.answers.some(z => norm(z) === norm(r));
    const given = r === undefined || r === '' ? '<i>sin respuesta</i>' : esc(x.type === 'mc' ? x.options[r] : r);
    const key = x.type === 'mc' ? x.options[x.correct] : x.answers.join(' | ');
    return `<div class="ansline"><b>${i + 1}.</b> ${esc(x.text)}<br><span class="${ok ? 'right' : 'wrong'}">${ok ? '✔' : '✘'} ${given}</span>${ok ? '' : ` <span class="mut">(correcta: ${esc(key)})</span>`}</div>`;
  }).join('') : '<p class="mut">El examen ya no existe.</p>'}</div>`;
  document.body.appendChild(m);
}

/* ---------- Flujo del estudiante ---------- */
function stopStream() { stream?.getTracks().forEach(t => t.stop()); stream = null; }
const tokKey = (code, name) => `att:${code}:${norm(name)}`;
const setMsg = (t, bad) => { const m = $('#jmsg'); m.textContent = t; m.className = bad ? 'wrong' : 'mut'; };

async function startFlow() {
  const code = $('#jcode').value.trim().toUpperCase(), name = $('#jname').value.trim();
  if (!code) return setMsg('Escribe el código del examen.', true);
  if (!name) return setMsg('Escribe tu nombre.', true);
  setMsg('');
  let info;
  try { info = await rpc('student_exam_info', { p_code: code }); } catch (e) { return setMsg(e.message, true); }
  if (info.camera && !stream) {
    $('#camwrap').hidden = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      $('#cam').srcObject = stream;
      $('#startbtn').textContent = 'Comenzar examen';
      return setMsg('Cámara lista. Verifica que se te vea y pulsa “Comenzar examen”.');
    } catch (err) {
      return setMsg('No se pudo acceder a la cámara (' + err.name + '). Este examen la exige: permite el acceso en el navegador y reintenta.', true);
    }
  }
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(tokKey(code, name)) || '{}'); } catch { }
  let r;
  try { r = await rpc('student_start', { p_code: code, p_name: name, p_token: saved.token || null }); }
  catch (e) { return setMsg(e.message, true); }
  if (r.expired) { stopStream(); return setMsg('Tu tiempo para este examen ya terminó.', true); }
  try { localStorage.setItem(tokKey(code, name), JSON.stringify({ token: r.token })); } catch { }
  runExam(r);
}

function runExam(r) {
  const offset = new Date(r.now).getTime() - Date.now();
  const end = new Date(r.started_at).getTime() + r.minutes * 60000;
  const at = { id: r.attempt_id, token: r.token, order: r.order, answers: r.answers || {} };
  let plays = {}; try { plays = JSON.parse(localStorage.getItem('plays:' + r.attempt_id) || '{}'); } catch { }
  run = { info: r, at, timers: [], handlers: [], dirty: false, last: {}, end, offset, plays };
  render('exam');
  window.scrollTo(0, 0);
  if (stream && r.camera) {
    const v = $('#cam'); v.srcObject = stream;
    const shoot = () => {
      if (!v.videoWidth) return;
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      c.getContext('2d').drawImage(v, 0, 0, 240, 180);
      rpc('student_shot', { p_attempt: at.id, p_token: at.token, p_img: c.toDataURL('image/jpeg', .5) }).catch(() => { });
    };
    setTimeout(shoot, 1500);
    run.timers.push(setInterval(shoot, 30000));
    stream.getVideoTracks()[0].addEventListener('ended', () => flag('La cámara se desconectó o se apagó'));
  } else stopStream();
  const on = (t, ev, fn) => { t.addEventListener(ev, fn); run.handlers.push([t, ev, fn]); };
  on(document, 'visibilitychange', () => document.hidden && flag('Cambió de pestaña o minimizó la ventana'));
  on(window, 'blur', () => !document.hidden && flag('La ventana perdió el foco'));
  on(document, 'copy', () => flag('Intentó copiar texto'));
  on(document, 'paste', () => flag('Intentó pegar texto'));
  on(window, 'beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
  const tm = $('#timer');
  const tick = () => {
    const left = run.end - (Date.now() + run.offset);
    tm.textContent = '⏱ ' + fmt(left); tm.classList.toggle('low', left < 300000);
    if (left <= 0 && !run.finishing) finishExam(true);
  };
  tick(); run.timers.push(setInterval(tick, 500));
  run.timers.push(setInterval(() => run.dirty && saveAnswers(), 10000));
  markNav();
}
async function saveAnswers() {
  if (!run || run.finishing) return;
  const st = $('#savestate'); run.dirty = false;
  try { await rpc('student_save', { p_attempt: run.at.id, p_token: run.at.token, p_answers: run.at.answers }); if (st) st.textContent = '✓ Guardado'; }
  catch (e) { run && (run.dirty = true); if (st) st.textContent = '⚠ Sin conexión, reintentando…'; }
}
function flag(msg) {
  if (!run || run.finishing) return;
  const now = Date.now(); if (now - (run.last[msg] || 0) < 2000) return; run.last[msg] = now;
  rpc('student_flag', { p_attempt: run.at.id, p_token: run.at.token, p_msg: msg }).catch(() => { });
}
function markNav() {
  if (!run) return;
  let n = 0;
  run.at.order.forEach((id, i) => { const a = run.at.answers[id], d = a !== undefined && a !== ''; if (d) n++; $('#n' + i)?.classList.toggle('done', d); });
  const p = $('#prog'); if (p) p.style.width = (n / run.at.order.length * 100) + '%';
}
function cleanupRun() {
  if (!run) return;
  run.timers.forEach(clearInterval); clearTimeout(run.saveT);
  run.handlers.forEach(([t, ev, fn]) => t.removeEventListener(ev, fn));
  run = null; stopStream();
}
async function finishExam(auto) {
  if (!run || run.finishing) return;
  run.finishing = true; clearTimeout(run.saveT);
  const { at } = run;
  app.insertAdjacentHTML('afterbegin', '<div class="loading" id="sending">Enviando examen…</div>');
  for (; ;) {
    try {
      const r = await rpc('student_submit', { p_attempt: at.id, p_token: at.token, p_answers: at.answers });
      cleanupRun();
      render('done', { show: r.show, score: r.score, max: r.max, auto });
      return;
    } catch (e) {
      if (!run) return;
      toast('No se pudo enviar (' + e.message + '). Reintentando…', 'err');
      await wait(3000);
    }
  }
}
window.addEventListener('pagehide', stopStream);

/* ---------- Arranque ---------- */
function route() {
  const m = location.hash.match(/^#\/examen\/(.+)$/);
  if (m) go('join', { code: decodeURIComponent(m[1]).toUpperCase() }); else if (!run) go('home');
}
(async function init() {
  if (sb) {
    session = (await sb.auth.getSession()).data.session;
    sb.auth.onAuthStateChange((_e, s) => { session = s; nav(); });
  }
  route();
})();
