import { json, options } from './_shared.js';

export const onRequestOptions = options;

export function onRequestGet({ env }) {
  return json({
    ok: true,
    time: new Date().toISOString(),
    supabase_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
  }, { maxAge: 0 });
}
