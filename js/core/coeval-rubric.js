/* Rúbrica por defecto de la coevaluación docente (cada docente califica a un estudiante de 1 a 4 por criterio).
   Cada coevaluación guarda una copia de esta rúbrica, así que un cambio futuro aquí no altera las ya enviadas. */
const L = (a, b, c, d) => ({ 4: a, 3: b, 2: c, 1: d });

export const DEFAULT_COEVAL = {
  levels: [{ v: 4, name: 'Sobresaliente' }, { v: 3, name: 'Satisfactorio' }, { v: 2, name: 'En desarrollo' }, { v: 1, name: 'Insuficiente' }],
  sections: [
    {
      id: 'A', name: 'Comportamiento', points: 10, criteria: [
        { id: 'respeto', name: 'Respeto', desc: L('Trata siempre con cortesía a docentes y compañeros; escucha con atención y es modelo para los demás.', 'Generalmente es respetuoso; ocasionalmente necesita un recordatorio.', 'Muestra respeto de forma inconsistente; requiere llamadas de atención frecuentes.', 'Falta al respeto de manera reiterada a docentes o compañeros.') },
        { id: 'normas', name: 'Normas', desc: L('Cumple todas las indicaciones y reglas sin necesidad de supervisión.', 'Cumple las normas con pocas excepciones.', 'Cumple las normas solo con supervisión constante.', 'Incumple las normas de manera frecuente o deliberada.') },
        { id: 'autocontrol', name: 'Autocontrol', desc: L('Mantiene la calma y regula sus emociones y su conducta en toda situación.', 'Controla su conducta, con pocos episodios de impulsividad.', 'Se altera o distrae con facilidad; le cuesta autorregularse.', 'No logra controlar sus reacciones; interrumpe o afecta la clase.') },
        { id: 'responsabilidad', name: 'Responsabilidad', desc: L('Cumple con sus tareas y materiales y asume las consecuencias de sus actos.', 'Cumple con la mayoría de sus compromisos.', 'Cumple de forma irregular; necesita recordatorios.', 'No cumple con sus compromisos ni asume responsabilidad.') },
        { id: 'convivencia', name: 'Convivencia', desc: L('Colabora, incluye a otros y contribuye a un buen ambiente de grupo.', 'Se relaciona bien y colabora cuando se le pide.', 'Interactúa con dificultad; participa poco en el trabajo en equipo.', 'Genera conflictos o se aísla del grupo.') },
        { id: 'valores', name: 'Valores', desc: L('Demuestra honestidad, empatía y solidaridad de forma constante.', 'Demuestra valores en la mayoría de las situaciones.', 'Demuestra valores de manera ocasional.', 'Muestra conductas contrarias a los valores esperados.') }
      ]
    },
    {
      id: 'B', name: 'Académico', points: 10, criteria: [
        { id: 'comprension', name: 'Comprensión', desc: L('Entiende ideas explícitas e implícitas y las explica con sus propias palabras.', 'Comprende las ideas principales con pocas dudas.', 'Comprende de forma parcial; necesita apoyo para captar ideas.', 'No logra comprender el contenido, aun con apoyo.') },
        { id: 'lectura', name: 'Lectura', desc: L('Lee con fluidez, buena entonación y puntuación adecuada.', 'Lee con fluidez aceptable y pocos errores.', 'Lee con pausas, errores o poca entonación.', 'Lee con dificultad notable; silabea o no logra completar la lectura.') },
        { id: 'expresion', name: 'Expresión oral', desc: L('Se expresa con claridad, seguridad y vocabulario apropiado.', 'Se expresa de forma clara con algunas vacilaciones.', 'Se expresa con dificultad; ideas poco organizadas o respuestas muy breves.', 'No logra expresar sus ideas oralmente.') },
        { id: 'escritura', name: 'Escritura', desc: L('Escribe con ideas coherentes, buena ortografía y redacción ordenada.', 'Escribe con coherencia y pocos errores ortográficos o de redacción.', 'Escribe con errores frecuentes o ideas poco organizadas.', 'Escritura confusa, con errores graves o incompleta.') },
        { id: 'razonamiento', name: 'Razonamiento', desc: L('Analiza, relaciona y argumenta con lógica y de forma autónoma.', 'Razona correctamente en la mayoría de los casos.', 'Razona de manera básica; necesita guía para llegar a conclusiones.', 'No logra razonar ni resolver las situaciones planteadas.') },
        { id: 'habitos', name: 'Hábitos', desc: L('Es organizado, atento, constante y autónomo en su trabajo.', 'Mantiene buenos hábitos con pocas distracciones.', 'Sus hábitos de trabajo son irregulares; se distrae con frecuencia.', 'Carece de hábitos de estudio: desorden, desatención o no trabaja.') }
      ]
    }
  ]
};

export const cvKey = (s, c) => `${s.id}.${c.id}`;
export const cvTotalCriteria = r => r.sections.reduce((n, s) => n + s.criteria.length, 0);

/* Puntos por sección: suma de niveles ÷ máximo posible × puntos de la sección (10). */
export function cvScore(rubric, scores) {
  const top = Math.max(...rubric.levels.map(l => l.v));
  const parts = rubric.sections.map(s => {
    const vals = s.criteria.map(c => +scores?.[cvKey(s, c)] || 0), raw = vals.reduce((a, b) => a + b, 0), max = s.criteria.length * top;
    return { id: s.id, name: s.name, raw, max, outOf: s.points, done: vals.filter(Boolean).length, n: s.criteria.length, points: max ? Math.round(raw / max * s.points * 100) / 100 : 0 };
  });
  return { parts, total: Math.round(parts.reduce((a, p) => a + p.points, 0) * 100) / 100, outOf: parts.reduce((a, p) => a + p.outOf, 0) };
}
