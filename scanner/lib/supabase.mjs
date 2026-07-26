// Supabase-skrivning via PostgREST. Service-nyckeln går förbi RLS och får
// bara finnas i GitHub Actions-secrets – aldrig i frontend eller i repot.

import { fetchWithRetry } from './http.mjs';

// Kolumner som Postgres räknar ut själv – att skicka dem ger 400.
const GENERATED_COLUMNS = ['effective_monthly_sek', 'baseline_eligible', 'id', 'updated_at'];

export function createClient({ url, serviceKey, dryRun = false } = {}) {
  const base = (url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const key = serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const isDryRun = dryRun || process.env.DRY_RUN === '1';

  if (!isDryRun && (!base || !key)) {
    throw new Error('SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta (eller DRY_RUN=1)');
  }

  async function request(path, { method = 'GET', body, prefer } = {}) {
    const headers = {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (prefer) headers.prefer = prefer;

    const res = await fetchWithRetry(`${base}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    dryRun: isDryRun,

    /** Upsert på (source, external_id). Uppdaterar last_seen på befintliga rader. */
    async upsertListings(listings) {
      const rows = (listings ?? []).map(stripGenerated).map((row) => ({
        ...row,
        last_seen: new Date().toISOString(),
      }));
      if (!rows.length) return 0;
      if (isDryRun) {
        console.log(`[dry-run] skulle upserta ${rows.length} rader`);
        return rows.length;
      }

      // Chunkas för att hålla payloaden liten nog för PostgREST.
      let written = 0;
      for (const chunk of chunks(rows, 500)) {
        await request('listings?on_conflict=source,external_id', {
          method: 'POST',
          body: chunk,
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
        written += chunk.length;
      }
      return written;
    },

    /** Startar en rad i scan_runs och returnerar en avslutare. */
    async startRun(source) {
      if (isDryRun) {
        return async (result) => console.log(`[dry-run] ${source}:`, result);
      }
      const [run] = await request('scan_runs', {
        method: 'POST',
        body: [{ source, status: 'running' }],
        prefer: 'return=representation',
      });
      return async ({ status, rows_found = 0, rows_upserted = 0, error = null }) => {
        await request(`scan_runs?id=eq.${run.id}`, {
          method: 'PATCH',
          body: { status, rows_found, rows_upserted, error, finished_at: new Date().toISOString() },
          prefer: 'return=minimal',
        });
      };
    },
  };
}

export function stripGenerated(row) {
  const copy = { ...row };
  for (const column of GENERATED_COLUMNS) delete copy[column];
  return copy;
}

function* chunks(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
