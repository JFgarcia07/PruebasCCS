/* Acceso a Supabase: consultas, RPC con reintentos y lectura del examen completo. */
import { sb } from './config.js';
import { wait } from './util.js';

export async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
/* Las llamadas repetibles del estudiante (guardar, alertas, fotos) se reintentan ante cortes de red o
   saturación del servidor, con espera aleatoria para que no vuelvan a golpear todas a la vez. */
const TRANSIENT = /failed to fetch|network|timeout|timed out|load failed|\b50[0234]\b|bad gateway|unavailable|too many|overload/i;
export async function rpc(fn, args, tries = /^student_(save|flag|shot)$/.test(fn) ? 3 : 1) {
  for (let i = 1; ; i++) {
    let res; try { res = await sb.rpc(fn, args); } catch (e) { res = { error: { message: String(e?.message || e) } }; }
    if (!res.error) return res.data;
    if (i >= tries || !TRANSIENT.test(res.error.message)) throw new Error(res.error.message);
    await wait(700 * i + Math.random() * 700);
  }
}

export const EXAM_COLS = 'id,owner,title,code,minutes,camera,shuffle,show_score,rubric_id,levels,created_at,n_questions'; // sin 'questions': con audios incrustados pesa MB
export const fullExam = id => q(sb.from('exams').select('*').eq('id', id).single());
