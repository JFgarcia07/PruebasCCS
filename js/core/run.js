/* Cierre limpio del examen en curso (cámara, temporizadores y eventos). */
import { state } from './state.js';

export function stopStream() { state.stream?.getTracks().forEach(t => t.stop()); state.stream = null; }

export function cleanupRun() {
  if (!state.run) return;
  state.run.timers.forEach(clearInterval); clearTimeout(state.run.saveT); clearTimeout(state.run.retryT);
  state.run.handlers.forEach(([t, ev, fn]) => t.removeEventListener(ev, fn));
  state.run = null; stopStream();
}
