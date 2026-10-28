/* Eventos de formularios (input/change) delegados a nivel de documento. */
import { go } from './core/router.js';
import { state } from './core/state.js';
import { onAudioFile, onAudioUrl } from './features/audio.js';
import { onImportFile } from './features/exams.js';
import { loadMine } from './features/reports.js';
import { markNav, saveAnswers } from './features/student.js';

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.rp) state.rp[t.dataset.rp] = t.value;
  else if (t.dataset.rf) state.rf[t.dataset.rf] = t.value;
  else if (t.dataset.lf) state.rb.levels[+t.dataset.l][t.dataset.lf] = t.value;
  else if (t.dataset.rb) state.rb[t.dataset.rb] = t.value;
  else if (t.dataset.e) state.ed[t.dataset.e] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(1, +t.value || 1) : t.value;
  else if (t.dataset.f) {
    const x = state.ed.questions[+t.dataset.q];
    if (t.dataset.f === 'answers') x.answers = t.value.split('|').map(s => s.trim()).filter(Boolean);
    else if (t.dataset.f === 'points') x.points = Math.max(0, +t.value || 0);
    else if (t.dataset.f === 'plays') x.plays = Math.max(0, Math.floor(+t.value || 0));
    else x[t.dataset.f] = t.value;
  } else if (t.dataset.o !== undefined) state.ed.questions[+t.dataset.q].options[+t.dataset.o] = t.value;
  else if (t.dataset.qid && state.run) {
    state.run.at.answers[t.dataset.qid] = t.type === 'radio' ? +t.value : t.value;
    state.run.dirty = true; markNav(); clearTimeout(state.run.saveT);
    state.run.saveT = setTimeout(saveAnswers, t.type === 'radio' ? 400 : 2500); // texto: espera a que deje de escribir
    try { localStorage.setItem('ans:' + state.run.at.id, JSON.stringify(state.run.at.answers)); } catch { }
  }
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.correct !== undefined) state.ed.questions[+t.dataset.q].correct = +t.dataset.correct;
  if (t.dataset.qid && state.run?.dirty) saveAnswers(); // al salir de un campo de texto se guarda ya
  if (t.id === 'resfilter') go('results', t.value);
  if (t.dataset.rf === 'course') loadMine();
  if (t.dataset.afile !== undefined && t.files[0]) return onAudioFile(t);
  if (t.dataset.aurl !== undefined) return onAudioUrl(t);
  if (t.id === 'impfile' && t.files[0]) return onImportFile(t);
});
