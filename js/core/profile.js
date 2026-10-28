/* Perfil del usuario con sesión (rol: admin | teacher). El rol lo asigna la administración en la base de datos. */
import { sb } from './config.js';
import { state } from './state.js';

export async function loadProfile() {
  state.profile = null;
  if (!sb || !state.session) return;
  try {
    const { data } = await sb.from('profiles').select('role,name,email').eq('id', state.session.user.id).maybeSingle();
    state.profile = data || { role: 'teacher', name: '', email: state.session.user.email };
  } catch { state.profile = { role: 'teacher', name: '', email: state.session.user.email }; }
}
