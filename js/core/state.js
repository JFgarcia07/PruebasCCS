/* Estado compartido de la app (los módulos no pueden reasignar variables importadas, por eso va en un objeto). */

/* session: sesión del profesor · ed: examen en edición · rb: rúbrica en edición · rp: reporte en edición
   rf: formulario de reporte (docente) · run: examen en curso (estudiante) · stream: cámara · gen: navegación vigente */
export const state = {
  session: null, profile: null, cv: null, cf: null, ed: null, rb: null, rp: null, rf: null, run: null, stream: null, gen: 0,
  rubTab: 'exam',   // pestaña activa en Rúbricas: exam | report | interview
  iv: null,         // entrevistas: { rubrics, rid, rows }
  cache: { exams: [], rubrics: [], reports: [] }
};

/* Rol del usuario con sesión: la administración ve todos los exámenes, crea entrevistas y corrige notas. */
export const isAdmin = () => state.profile?.role === 'admin';
