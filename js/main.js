/* Punto de entrada: junta las vistas/acciones de cada módulo, conecta los eventos y arranca. */
import { $ } from './core/util.js';
import { sb } from './core/config.js';
import { state } from './core/state.js';
import { loadProfile } from './core/profile.js';
import { toast, ask } from './core/ui.js';
import { registry, go, nav, route } from './core/router.js';
import * as auth from './features/auth.js';
import * as exams from './features/exams.js';
import * as rubrics from './features/rubrics.js';
import * as reports from './features/reports.js';
import * as results from './features/results.js';
import * as interviews from './features/interviews.js';
import * as coeval from './features/coeval.js';
import * as student from './features/student.js';
import './events.js';
import './features/audio.js';

for (const f of [auth, exams, rubrics, reports, results, interviews, coeval, student]) {
  Object.assign(registry.views, f.views);
  Object.assign(registry.loaders, f.loaders);
  Object.assign(registry.acts, f.acts);
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  el.disabled = true;
  try { await registry.acts[el.dataset.act]?.(el); }
  catch (err) { toast(err.message || String(err), 'err'); }
  finally { el.disabled = false; }
});
$('#brand').addEventListener('click', async e => {
  e.preventDefault();
  if (state.run && !await ask('Hay un examen en curso y el tiempo sigue corriendo. ¿Salir?', 'Salir')) return;
  go('home');
});

(async function init() {
  if (sb) {
    state.session = (await sb.auth.getSession()).data.session;
    await loadProfile();
    // fuera del callback: supabase-js no admite llamadas a su API dentro de onAuthStateChange
    sb.auth.onAuthStateChange((_e, s) => { state.session = s; setTimeout(() => loadProfile().then(nav), 0); });
  }
  route();
})();
