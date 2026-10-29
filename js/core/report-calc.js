/* Reporte automático de cada estudiante: junta todos sus exámenes, sus entrevistas y su coevaluación y los suma.
   Funciones puras (sin DOM ni red), para que la pantalla y el PDF muestren exactamente lo mismo. */
import { cvScore } from './coeval-rubric.js';
import { INTERVIEW_RUBRICS, interviewScore } from './interview-rubrics.js';
import { levelFor } from './levels.js';
import { norm } from './util.js';

/* Las dos entrevistas del reporte (15 puntos cada una) y lo que se puede hacer con cada una si se excluye */
export const INTERVIEW_TYPES = ['padre', 'alumno'];
export const INTERVIEW_MODES = { zero: 'en cero', full: 'con puntaje completo', skip: 'no se toma en cuenta' };
const r2 = n => Math.round(n * 100) / 100;
/* Un estudiante es su correo (o su nombre, en los intentos antiguos que no lo tienen), sin importar cuántos exámenes haya hecho */
export const studentKey = a => a.email ? a.email.trim().toLowerCase() : 'n:' + norm(a.student_name);

/* raw: { attempts, exams, interviews, evals, overrides } → estudiantes ordenados por nombre */
export function buildStudents(raw) {
  const title = Object.fromEntries(raw.exams.map(e => [e.id, e.title]));
  const students = new Map(), byName = new Map();
  for (const a of raw.attempts) {   // vienen del más reciente al más antiguo: el nombre que se conserva es el último escrito
    const k = studentKey(a); let s = students.get(k);
    if (!s) {
      s = { key: k, name: a.student_name, email: a.email || '', exams: [], interviews: [], coeval: null, override: null };
      students.set(k, s);
      const nk = norm(a.student_name); if (!byName.has(nk)) byName.set(nk, []); byName.get(nk).push(s);
    }
    if (a.ended_at && a.max_score) s.exams.push({ title: title[a.exam_id] || 'Examen', date: a.ended_at, score: +a.score, max: +a.max_score, edited: !!a.score_edited_at });
  }
  // Entrevistas: al alumno entrevistado por su nombre; al padre/madre, por el nombre de su hijo/a
  for (const i of raw.interviews) {
    const r = INTERVIEW_RUBRICS[i.subject_type]; if (!r) continue;
    const sc = interviewScore(i.subject_type, i.scores);
    if (!sc.done) continue;   // entrevista todavía sin notas
    const item = { type: i.subject_type, rubric: r.name, who: i.subject_type === 'padre' ? 'Padre / madre' : 'Alumno', interviewer: i.interviewer || '', date: i.held_on || i.created_at, score: sc.score, max: sc.max };
    for (const s of byName.get(norm(i.subject_type === 'padre' ? i.child_name : i.subject_name)) || []) s.interviews.push(item);
  }
  for (const e of raw.evals) {
    const s = students.get(e.student_key); if (!s) continue;
    const c = cvScore(e.scores);
    s.coeval = { parts: c.parts, score: c.total, max: c.outOf, comment: e.comment || '', date: e.updated_at };
  }
  for (const o of raw.overrides) { const s = students.get(o.student_key); if (s) s.override = o; }
  return [...students.values()].sort((x, y) => x.name.localeCompare(y.name, 'es'));
}

/* Total de un estudiante: suma de todo lo que tiene; la nota ajustada a mano reemplaza a la suma automática.
   `levels` = rangos de la rúbrica de reporte elegida (null = escala predeterminada). */
/* Entrevistas del reporte. Cada tipo (a padres / al estudiante) puede usarse tal cual o excluirse: en cero, con puntaje completo,
   o sin tomarla en cuenta (no suma ni al puntaje ni al máximo). Una excluida «en cero» o «completa» sí cuenta sus 15 puntos de máximo. */
function interviewPart(s) {
  const modes = s.override?.interview_modes || {}, rows = [];
  for (const t of INTERVIEW_TYPES) {
    const r = INTERVIEW_RUBRICS[t], mode = modes[t];
    if (mode) rows.push({ type: t, rubric: r.name, mode, score: mode === 'full' ? r.total : 0, max: mode === 'skip' ? 0 : r.total });
    else rows.push(...s.interviews.filter(x => x.type === t));
  }
  return { n: rows.filter(x => !x.mode).length, rows, modes, excluded: rows.some(x => x.mode), score: r2(rows.reduce((a, x) => a + x.score, 0)), max: r2(rows.reduce((a, x) => a + x.max, 0)) };
}

/* Total de un estudiante: suma de todo lo que tiene; la nota ajustada a mano reemplaza a la suma automática.
   `levels` = rangos de la rúbrica de reporte elegida (null = escala predeterminada). */
export function summarize(s, levels) {
  const part = list => ({ n: list.length, score: r2(list.reduce((a, x) => a + x.score, 0)), max: r2(list.reduce((a, x) => a + x.max, 0)) });
  const iv = interviewPart(s);
  const parts = { exams: part(s.exams), interviews: iv, coeval: part(s.coeval ? [s.coeval] : []) };
  const items = [...s.exams, ...iv.rows.filter(x => x.mode !== 'skip'), ...(s.coeval ? [s.coeval] : [])];
  const rawScore = r2(items.reduce((a, x) => a + x.score, 0)), rawMax = r2(items.reduce((a, x) => a + x.max, 0));
  // Si alguna entrevista «no se toma en cuenta», el máximo baja de 100: el total se calcula con lo que sí cuenta y se lleva a 100
  const scaled = iv.rows.some(x => x.mode === 'skip') && rawMax > 0 && rawMax !== 100;
  const auto = scaled ? r2(rawScore / rawMax * 100) : rawScore, max = scaled ? 100 : rawMax;
  const adjusted = s.override?.manual_total != null, total = adjusted ? +s.override.manual_total : auto;
  const pct = max ? Math.round(total / max * 100) : 0;
  return { parts, auto, max, total, pct, adjusted, scaled: scaled ? { score: rawScore, max: rawMax } : null, level: max ? levelFor(pct, levels) : null, empty: !items.length };
}
