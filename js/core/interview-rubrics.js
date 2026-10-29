/* Las dos rúbricas de entrevista del proceso de admisión (valor total: 15 puntos cada una; 5 criterios de 0 a 3).
   subject_type 'padre' = entrevista a padres de familia · 'alumno' = entrevista al estudiante. */
const D = (a, b, c, d) => ({ 3: a, 2: b, 1: c, 0: d });

export const INTERVIEW_LEVELS = [
  { v: 3, name: 'Desempeño sólido' }, { v: 2, name: 'Adecuado' }, { v: 1, name: 'En proceso' }, { v: 0, name: 'No demostrado / rechazo explícito' }
];

export const INTERVIEW_RUBRICS = {
  padre: {
    id: 'padre', name: 'Entrevista a padres de familia', title: 'Rúbrica de entrevista a padres de familia', total: 15,
    criteria: [
      { id: 'p1', name: '1. Formación cristiana y principios espirituales', max: 3, desc: D(
        'Demuestra compromiso con los principios cristianos, explica cómo los practica en el hogar y manifiesta disposición para apoyar la formación espiritual institucional.',
        'Acepta el enfoque cristiano y manifiesta disposición general para apoyarlo.',
        'Presenta dudas o necesita aclarar su disposición para acompañar este enfoque.',
        'Expresa rechazo a principios fundamentales del proyecto educativo cristiano previamente explicados.') },
      { id: 'p2', name: '2. Disciplina y formación en el hogar', max: 3, desc: D(
        'Describe normas claras, corrección respetuosa y disposición para colaborar con el colegio en la formación conductual.',
        'Reconoce la importancia de los límites y acepta colaborar con la disciplina institucional.',
        'Presenta dificultades para explicar cómo establece límites o cómo apoyaría las medidas disciplinarias.',
        'Rechaza responsabilidades familiares esenciales o manifiesta que no respetará normas previamente comunicadas.') },
      { id: 'p3', name: '3. Compromiso y colaboración con el colegio', max: 3, desc: D(
        'Comprende sus responsabilidades y demuestra disposición para cumplir el reglamento y trabajar con los docentes.',
        'Acepta las responsabilidades y manifiesta disposición general para colaborar.',
        'Reconoce parcialmente sus responsabilidades o expresa reservas que requieren aclaración.',
        'Rechaza responsabilidades esenciales o se niega a cumplir disposiciones fundamentales previamente explicadas.') },
      { id: 'p4', name: '4. Comunicación y expectativas familiares', max: 3, desc: D(
        'Expresa expectativas realistas, escucha orientaciones y propone resolver desacuerdos mediante diálogo respetuoso.',
        'Mantiene disposición favorable al diálogo y a la comunicación institucional.',
        'Presenta expectativas poco claras o necesita orientación para resolver desacuerdos.',
        'Manifiesta negativa explícita a utilizar canales respetuosos de comunicación.') },
      { id: 'p5', name: '5. Responsabilidad y seguimiento', max: 3, desc: D(
        'Propone acciones concretas para acompañar al estudiante y dar seguimiento a sus responsabilidades.',
        'Reconoce sus responsabilidades y manifiesta disposición para cumplirlas.',
        'Necesita definir cómo organizará el acompañamiento y el seguimiento.',
        'Manifiesta que no asumirá responsabilidades esenciales de acompañamiento familiar.') }
    ]
  },
  alumno: {
    id: 'alumno', name: 'Entrevista al estudiante', title: 'Rúbrica de entrevista al estudiante', total: 15,
    criteria: [
      { id: 'e1', name: '1. Valores y formación cristiana', max: 3, desc: D(
        'Comprende la importancia de los principios cristianos, identifica cómo aplicarlos en su vida y manifiesta disposición para participar en la formación espiritual del colegio.',
        'Reconoce los principios cristianos y muestra disposición para participar en las actividades espirituales.',
        'Presenta comprensión limitada o necesita orientación para explicar cómo aplicar estos principios.',
        'Manifiesta rechazo explícito a actividades o principios fundamentales del proyecto educativo cristiano previamente explicados.') },
      { id: 'e2', name: '2. Disciplina y respeto a la autoridad', max: 3, desc: D(
        'Reconoce la importancia de las normas, explica cómo respondería ante una corrección y demuestra disposición para asumir las consecuencias de sus acciones.',
        'Acepta las normas y reconoce la importancia de respetar a docentes y autoridades.',
        'Le cuesta reconocer su responsabilidad o explicar cómo actuaría ante una corrección.',
        'Manifiesta que se negará a cumplir normas fundamentales o a asumir responsabilidades por sus acciones.') },
      { id: 'e3', name: '3. Actitud y compromiso y responsabilidad', max: 3, desc: D(
        'Expresa motivación para estudiar, conoce sus responsabilidades y manifiesta disposición para cumplir el reglamento institucional.',
        'Muestra disposición para estudiar, respetar las normas y cumplir sus responsabilidades.',
        'Expresa dudas o presenta comprensión limitada de las responsabilidades escolares.',
        'Manifiesta rechazo explícito a cumplir normas fundamentales del colegio previamente explicadas.') },
      { id: 'e4', name: '4. Comunicación y manejo de conflictos', max: 3, desc: D(
        'Explica cómo resolvería desacuerdos mediante el diálogo, el respeto y la búsqueda de ayuda cuando sea necesario.',
        'Reconoce la importancia de dialogar y buscar apoyo para resolver conflictos.',
        'Necesita orientación para expresar desacuerdos o resolver situaciones conflictivas.',
        'Manifiesta que recurrirá deliberadamente a conductas irrespetuosas o agresivas para resolver conflictos.') },
      { id: 'e5', name: '5. Nivel de Inglés', max: 3, desc: D(
        'Demuestra un nivel de inglés acorde con el grado al que aplica, comprende las preguntas básicas correspondientes a su nivel.',
        'Demuestra conocimientos básicos de inglés, comprende algunas preguntas y logra responder con dificultad.',
        'Presenta conocimientos limitados de inglés y necesita apoyo frecuente para comprender o responder preguntas.',
        'No logra demostrar los conocimientos básicos esperados para el grado al que aplica, presenta dificultades.') }
    ]
  }
};

/* Puntos de una entrevista (suma de criterios, sin pasar del máximo de cada uno) y cuántos criterios tienen nota */
export function interviewScore(type, scores) {
  const r = INTERVIEW_RUBRICS[type]; if (!r) return { score: 0, max: 0, done: 0, n: 0 };
  let score = 0, done = 0;
  for (const c of r.criteria) {
    const v = scores?.[c.id];
    if (v !== undefined && v !== null && v !== '') { done++; score += Math.min(c.max, Math.max(0, +v || 0)); }
  }
  return { score: Math.round(score * 100) / 100, max: r.total, done, n: r.criteria.length };
}
