/* Coevaluación docente: dos áreas que la administración llena a mano como porcentaje (0 a 100).
   El sistema lo convierte a puntos: porcentaje ÷ 10 sobre 10 en cada área, y el total va sobre 20. */
export const COEVAL_AREAS = [
  { id: 'A', name: 'Comportamiento', points: 10 },
  { id: 'B', name: 'Académico', points: 10 }
];

const r2 = n => Math.round(n * 100) / 100;
const pctOf = v => v === undefined || v === null || v === '' || !Number.isFinite(+v) ? null : Math.min(100, Math.max(0, +v));

/* scores: { A: porcentaje, B: porcentaje } → puntos por área y total */
export function cvScore(scores) {
  const parts = COEVAL_AREAS.map(a => {
    const pct = pctOf(scores?.[a.id]);
    return { id: a.id, name: a.name, pct: pct ?? 0, done: pct !== null, outOf: a.points, points: pct === null ? 0 : r2(pct * a.points / 100) };
  });
  return { parts, total: r2(parts.reduce((s, p) => s + p.points, 0)), outOf: parts.reduce((s, p) => s + p.outOf, 0) };
}
