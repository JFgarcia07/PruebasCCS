/* Escala de interpretación según el porcentaje obtenido. */

/* Escala de interpretación según el porcentaje obtenido */
export const LEVELS = [
  { min: 85, range: '85 % o más', name: 'Superior', cls: 'ok', text: 'El estudiante demuestra un desempeño destacado en las habilidades cognitivas evaluadas. Presenta facilidad para comprender información, analizar situaciones, establecer relaciones lógicas y resolver problemas acordes con las tareas propuestas.' },
  { min: 70, range: '70 % a 84 %', name: 'Alto', cls: 'ok', text: 'El estudiante evidencia un buen desarrollo de las habilidades cognitivas evaluadas. Generalmente comprende las instrucciones, identifica relaciones entre conceptos y resuelve ejercicios que requieren razonamiento y análisis con buen nivel de desempeño.' },
  { min: 50, range: '50 % a 69 %', name: 'Promedio', cls: '', text: 'El estudiante presenta un desempeño esperado dentro de la escala establecida. Demuestra habilidades funcionales para comprender información, seguir instrucciones y resolver situaciones propias de las actividades evaluadas, aunque puede necesitar apoyo en algunas tareas específicas.' },
  { min: 35, range: '35 % a 49 %', name: 'Bajo el promedio', cls: 'warn', text: 'El estudiante muestra un desempeño inferior al promedio establecido en las habilidades evaluadas. Puede presentar dificultades en tareas que requieren comprensión, razonamiento, identificación de patrones o resolución de problemas, por lo que conviene identificar sus necesidades de apoyo académico.' },
  { min: 0, range: 'Menos de 35 %', name: 'Bajo', cls: 'bad', text: 'El estudiante presenta un desempeño reducido en las tareas cognitivas evaluadas. Puede requerir acompañamiento pedagógico, estrategias de aprendizaje diferenciadas y una revisión de los factores que pudieron influir en sus resultados, para determinar qué apoyos necesita.' }
];
/* `levels` es la rúbrica del examen (de mayor a menor 'min'); null = escala predeterminada */
export const levelFor = (pct, levels) => { const L = levels || LEVELS; return L.find(l => pct >= l.min) || L[L.length - 1]; };
