/* Reporte automático de cada estudiante: junta todos sus exámenes, sus entrevistas y su coevaluación y los suma.
   Funciones puras (sin DOM ni red), para que la pantalla y el PDF muestren exactamente lo mismo. */
import { cvScore, DEFAULT_COEVAL } from './coeval-rubric.js';
import { levelFor } from './levels.js';
import { norm } from './util.js';

const r2 = n => Math.round(n * 100) / 100;
/* Un estudiante es su correo (o su nombre, en los intentos antiguos que no lo tienen), sin importar cuántos exámenes haya hecho */
export const studentKey = a => a.email ? a.email.trim().toLowerCase() : 'n:' + norm(a.student_name);

/* raw: { attempts, exams, interviews, rubrics (de entrevista), evals, overrides } → estudiantes ordenados por nombre */
export function buildStudents(raw) {
  const title = Object.fromEntries(raw.exams.map(e => [e.id, e.title]));
  const rub = Object.fromEntries(raw.rubrics.map(r => [r.id, r]));
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
    const r = rub[i.rubric_id]; if (!r || !r.criteria.length) continue;
    const given = r.criteria.filter(c => i.scores[c.id] !== undefined && i.scores[c.id] !== null);
    if (!given.length) continue;   // entrevista todavía sin notas
    const item = { rubric: r.name, who: i.subject_type === 'padre' ? 'Padre / madre' : 'Alumno', interviewer: i.interviewer || '', date: i.created_at,
      score: r2(r.criteria.reduce((a, c) => a + Math.min(+c.max, Math.max(0, +i.scores[c.id] || 0)), 0)), max: r2(r.criteria.reduce((a, c) => a + +c.max, 0)) };
    for (const s of byName.get(norm(i.subject_type === 'padre' ? i.child_name : i.subject_name)) || []) s.interviews.push(item);
  }
  for (const e of raw.evals) {
    const s = students.get(e.student_key); if (!s) continue;
    const c = cvScore(DEFAULT_COEVAL, e.scores);
    s.coeval = { parts: c.parts, score: c.total, max: c.outOf, comment: e.comment || '', date: e.updated_at };
  }
  for (const o of raw.overrides) { const s = students.get(o.student_key); if (s) s.override = o; }
  return [...students.values()].sort((x, y) => x.name.localeCompare(y.name, 'es'));
}

/* Total de un estudiante: suma de todo lo que tiene; la nota ajustada a mano reemplaza a la suma automática.
   `levels` = rangos de la rúbrica de reporte elegida (null = escala predeterminada). */
export function summarize(s, levels) {
  const part = list => ({ n: list.length, score: r2(list.reduce((a, x) => a + x.score, 0)), max: r2(list.reduce((a, x) => a + x.max, 0)) });
  const parts = { exams: part(s.exams), interviews: part(s.interviews), coeval: part(s.coeval ? [s.coeval] : []) };
  const items = [...s.exams, ...s.interviews, ...(s.coeval ? [s.coeval] : [])];
  const auto = r2(items.reduce((a, x) => a + x.score, 0)), max = r2(items.reduce((a, x) => a + x.max, 0));
  const adjusted = !!s.override, total = adjusted ? +s.override.manual_total : auto;
  const pct = max ? Math.round(total / max * 100) : 0;
  return { parts, auto, max, total, pct, adjusted, level: max ? levelFor(pct, levels) : null, empty: !items.length };
}
