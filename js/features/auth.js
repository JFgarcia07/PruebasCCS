/* Pantallas de inicio y acceso del profesor. */
import { sb } from '../core/config.js';
import { go } from '../core/router.js';
import { state } from '../core/state.js';
import { toast } from '../core/ui.js';
import { $ } from '../core/util.js';

export const views = {
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
        <button class="sec grow" data-act="signup">Crear cuenta</button></div></div>`
};

export const acts = {
  home: () => go('home'),
  join: () => go('join'),
  tlogin: () => go(state.session ? 'teacher' : 'auth'),
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
    state.session = null; state.ed = null; go('home');
  }
};
