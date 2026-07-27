// Delade hjälpare för Pages Functions. Filer med understreck routas inte av Cloudflare.

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

export function json(body, { status = 200, maxAge = 60 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      ...CORS,
    },
  });
}

export function fail(message, status = 500) {
  return json({ error: message }, { status, maxAge: 0 });
}

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Anropar Supabase REST (PostgREST) med anon-nyckeln från Pages-miljön.
 * @param {Record<string, string|undefined>} env
 * @param {string} path t.ex. "listings?select=*&limit=100"
 */
export async function supabaseRest(env, path) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY saknas i Pages-miljön');

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Supabase svarade ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Klämmer ett tal till ett intervall, med fallback för skräpinput. */
export function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
