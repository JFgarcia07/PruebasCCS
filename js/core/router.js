/* Navegación: cambia de pantalla cargando datos y pintando la vista. Las vistas viven en features/*. */
import { sb } from './config.js';
import { cleanupRun } from './run.js';
import { state } from './state.js';
import { toast } from './ui.js';
import { $ } from './util.js';

export const app = $('#app');
/* Registros que llena main.js con las vistas, cargadores y acciones de cada módulo (features/*). */
export const registry = { views: {}, loaders: {}, acts: {} };

export async function go(view, p) {
  cleanupRun();
  const my = ++state.gen;
  try {
    if (!sb && view !== 'home') view = 'setup';
    if (['teacher', 'results', 'editor', 'rubrics', 'rubedit', 'reports', 'repedit', 'repview'].includes(view) && !state.session) view = 'auth';
    let data = p;
    if (registry.loaders[view]) { app.innerHTML = '<div class="loading">Cargando…</div>'; data = await registry.loaders[view](p); }
    if (my !== state.gen) return;
    render(view, data);
    window.scrollTo(0, 0);
  } catch (e) { toast(e.message || String(e), 'err'); if (my === state.gen) render('home'); }
}
export function redraw(view) { const y = scrollY; render(view); scrollTo(0, y); }
export function nav() {
  $('#topnav').innerHTML = state.session
    ? '<a href="#" data-act="teacher">Mis exámenes</a><a href="#" data-act="reports">Reportes</a><a href="#" data-act="rubrics">Rúbricas</a><a href="#" data-act="results">Resultados</a><a href="#" data-act="logout">Cerrar sesión</a>'
    : '<a href="#" data-act="join">Presentar examen</a><a href="#" data-act="tlogin">Profesores</a>';
}
export function render(view, p) { nav(); app.innerHTML = registry.views[view](p); }
export function route() {
  const m = location.hash.match(/^#\/examen\/(.+)$/), rm = location.hash.match(/^#\/reporte\/(.+)$/);
  if (m) go('join', { code: decodeURIComponent(m[1]).toUpperCase() });
  else if (rm) go('repform', { code: decodeURIComponent(rm[1]).toUpperCase() });
  else if (!state.run) go('home');
}
