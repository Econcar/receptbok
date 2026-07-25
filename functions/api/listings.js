import { clampInt, fail, json, options, supabaseRest } from './_shared.js';

// Vitlista – sorteringskolumnen sätts in i PostgREST-frågan och får inte komma rakt från klient.
const SORTABLE = new Set(['effective_monthly_sek', 'monthly_sek', 'last_seen', 'deal_score']);

export const onRequestOptions = options;

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const limit = clampInt(params.get('limit'), { min: 1, max: 500, fallback: 100 });
  const sort = SORTABLE.has(params.get('sort')) ? params.get('sort') : 'effective_monthly_sek';
  const dir = sort === 'last_seen' ? 'desc' : 'asc';

  const query = new URLSearchParams({
    select: '*',
    order: `${sort}.${dir}.nullslast`,
    limit: String(limit),
  });

  const term = clampInt(params.get('term'), { min: 1, max: 120, fallback: 0 });
  if (term) query.append('term_months', `eq.${term}`);

  const maxMonthly = clampInt(params.get('maxMonthly'), { min: 1, max: 100000, fallback: 0 });
  if (maxMonthly) query.append('monthly_sek', `lte.${maxMonthly}`);

  const brand = (params.get('brand') || '').trim();
  if (brand) query.append('brand', `ilike.${brand}`);

  try {
    const listings = await supabaseRest(env, `listings_view?${query}`);
    return json({ generated_at: new Date().toISOString(), count: listings.length, listings });
  } catch (err) {
    return fail(err.message, 502);
  }
}
