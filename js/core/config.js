/* Cliente de Supabase (la URL y la anon key salen de config.js, que es público por diseño). */

export const cfg = window.APP_CONFIG || {};
export const sb = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
