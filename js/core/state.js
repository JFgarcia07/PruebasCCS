/* Estado compartido de la app (los módulos no pueden reasignar variables importadas, por eso va en un objeto). */

/* session: sesión del profesor · ed: examen en edición · rb: rúbrica en edición · rp: reporte en edición
   rf: formulario de reporte (docente) · run: examen en curso (estudiante) · stream: cámara · gen: navegación vigente */
export const state = {
  session: null, ed: null, rb: null, rp: null, rf: null, run: null, stream: null, gen: 0,
  cache: { exams: [], rubrics: [], reports: [] }
};
