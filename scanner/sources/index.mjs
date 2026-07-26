// Register över datakällor. En adapter per källa, alla med samma kontrakt:
//
//   export default {
//     id: 'kortnamn',            // används i listings.source och scan_runs.source
//     label: 'Visningsnamn',
//     enabled: true,
//     segment: 'privat' | 'foretag',
//     async fetchListings(ctx) { return [ /* råa objekt, se lib/normalize.mjs */ ]; }
//   }
//
// fetchListings får kasta – run.mjs fångar per källa så en trasig källa aldrig
// fäller hela jobbet (se avsnitt 7 i docs/projektstart.md).
//
// Fas 1 är klar (docs/datakallor.md). Beslutade första adaptrar:
//   'alleasing' – volym (~10 000 erbjudanden, enumereras via sitemap/offers-*.xml)
//   'carplus'   – förstahandsdata från leasinggivaren, används som facit mot alleasing
// Carplus är inte byggd ännu.

import alleasing from './alleasing.mjs';

const sources = [alleasing];

export default sources;

export function selectSources(filter) {
  const active = sources.filter((source) => source.enabled !== false);
  if (!filter) return active;
  const wanted = new Set(String(filter).split(',').map((s) => s.trim()).filter(Boolean));
  return active.filter((source) => wanted.has(source.id));
}
