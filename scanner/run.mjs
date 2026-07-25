#!/usr/bin/env node
// Skannermotorn. Körs av GitHub Actions (.github/workflows/scan.yml) och lokalt
// med `npm run scan`. Kör källorna en i taget, isolerat: en trasig källa får
// aldrig fälla hela jobbet.

import { selectSources } from './sources/index.mjs';
import { normalizeListing } from './lib/normalize.mjs';
import { dedupeBatch } from './lib/dedupe.mjs';
import { createClient } from './lib/supabase.mjs';

const log = (...args) => console.log(...args);

export async function runScan({ sourceFilter = process.env.SCAN_SOURCES, client, sources: override } = {}) {
  const sources = override ?? selectSources(sourceFilter);

  // Kolla källorna före klienten – utan adaptrar finns inget att skriva, och
  // då ska jobbet inte falla på saknade Supabase-variabler.
  if (!sources.length) {
    log('Inga aktiva källor registrerade – se scanner/sources/index.mjs och docs/datakallor.md.');
    return { sources: [], totalUpserted: 0, failures: 0 };
  }

  const db = client ?? createClient();

  log(`Startar skanning av ${sources.length} källa/källor${db.dryRun ? ' (DRY RUN)' : ''}.`);

  const results = [];
  for (const source of sources) {
    results.push(await runSource(source, db));
  }

  const totalUpserted = results.reduce((sum, r) => sum + r.rows_upserted, 0);
  const failures = results.filter((r) => r.status === 'error').length;
  const empty = results.filter((r) => r.status === 'empty').map((r) => r.source);

  log('---');
  for (const r of results) {
    log(`${r.status.padEnd(5)} ${r.source}: ${r.rows_found} hittade, ${r.rows_upserted} skrivna${r.error ? ` – ${r.error}` : ''}`);
  }
  if (empty.length) log(`VARNING: källor utan träffar (format kan ha ändrats): ${empty.join(', ')}`);

  // Exit-koden signalerar bara totalhaveri – enskilda trasiga källor är väntat
  // och syns i loggen och i scan_runs.
  if (failures === results.length) {
    log('Alla källor misslyckades.');
    process.exitCode = 1;
  }

  return { sources: results, totalUpserted, failures };
}

async function runSource(source, db) {
  log(`\n▶ ${source.label ?? source.id}`);
  const finish = await db.startRun(source.id);
  const result = { source: source.id, status: 'ok', rows_found: 0, rows_upserted: 0, error: null };

  try {
    const raw = await source.fetchListings({ log });
    result.rows_found = raw.length;

    const normalized = raw
      .map((item) => normalizeListing({ segment: source.segment, ...item }, { source: source.id }))
      .filter(Boolean);
    const rows = dedupeBatch(normalized);

    const dropped = raw.length - rows.length;
    if (dropped > 0) log(`  ${dropped} rader föll bort (dubbletter eller saknat månadspris)`);

    if (!rows.length) {
      result.status = 'empty';
    } else {
      result.rows_upserted = await db.upsertListings(rows);
    }
  } catch (err) {
    result.status = 'error';
    result.error = err?.message ?? String(err);
    log(`  FEL: ${result.error}`);
  }

  await finish(result);
  return result;
}

// Kör bara när filen startas direkt, inte när testerna importerar den.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('run.mjs')) {
  runScan().catch((err) => {
    console.error('Oväntat fel i skannern:', err);
    process.exitCode = 1;
  });
}
