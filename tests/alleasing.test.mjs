import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseFlightPayload,
  extractObject,
  extractProductLd,
  publicIdFromUrl,
  hasBusinessTerms,
  offerToRawListings,
  parseSitemapUrls,
  selectWindow,
  bestPerTerms,
  spreadOrder,
} from '../scanner/sources/alleasing.mjs';
import { normalizeListing } from '../scanner/lib/normalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const OFFER_URL = 'https://www.alleasing.se/erbjudande/polestar/2/99bd99326aba';
const VARIANT_URL = 'https://www.alleasing.se/erbjudande/cupra/formentor/b156d4af1a3f';

test('flight-payloaden sys ihop över flera script-chunkar', () => {
  const html = fixture('alleasing-offer.html');
  const flight = parseFlightPayload(html);
  assert.ok(flight.includes('"car":{'), 'car-objektet ska finnas i den hopsydda payloaden');
  // Delningen sker mitt i objektet – hittas det ändå är hopsyningen korrekt.
  assert.ok(!html.includes('"car":{'), 'i råa HTML:en är strängen escapad och delad');
});

test('extractObject balanserar klamrar inuti strängar', () => {
  const text = '{"car":{"trim":"Paket {A} \\"bäst\\"","nested":{"x":1}},"efter":2}';
  assert.deepEqual(extractObject(text, 'car'), { trim: 'Paket {A} "bäst"', nested: { x: 1 } });
});

test('extractObject ger null när nyckeln saknas', () => {
  assert.equal(extractObject('{"annat":{"x":1}}', 'car'), null);
});

test('erbjudande utan availablePrices ger exakt en rad', () => {
  const rows = offerToRawListings(fixture('alleasing-offer.html'), OFFER_URL);
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.external_id, '99bd99326aba');
  assert.equal(row.monthly_sek, 8495);
  assert.equal(row.term_months, 36);
  assert.equal(row.km_per_year, 15000);
  assert.equal(row.down_payment_sek, 0);
  assert.equal(row.condition, 'new');
  assert.equal(row.dealer, 'volvocarretail');
  assert.equal(row.includes_service, true);
  assert.equal(row.includes_insurance, false);
  assert.equal(row.includes_tire_storage, null);
});

test('external_id är URL-suffixet och därmed stabilt över körningar', () => {
  const rows = offerToRawListings(fixture('alleasing-offer.html'), OFFER_URL);
  assert.equal(rows[0].external_id, publicIdFromUrl(OFFER_URL));
});

test('körsträckan tas i kilometer, inte mil', () => {
  const rows = offerToRawListings(fixture('alleasing-offer.html'), OFFER_URL);
  // 15 000 km/år = 1 500 mil/år. En mil→km-konvertering skulle ge 150 000.
  assert.equal(rows[0].km_per_year, 15000);

  const listing = normalizeListing({ ...rows[0], segment: 'privat' }, { source: 'alleasing' });
  assert.equal(listing.km_per_year, 15000, 'normaliseringen får inte konvertera ett tal som redan är km');
});

test('företagsleasing i fritext flaggar raden i stället för att kasta den', () => {
  const rows = offerToRawListings(fixture('alleasing-offer.html'), OFFER_URL);
  assert.equal(rows[0].segment_uncertain, true, 'trim nämner "Företagsleasing … exkl moms"');

  const listing = normalizeListing({ ...rows[0], segment: 'privat' }, { source: 'alleasing' });
  assert.equal(listing.segment_uncertain, true);
  assert.equal(listing.monthly_sek, 8495, 'raden sparas – den kastas inte');
});

test('hasBusinessTerms känner igen skrivsätten men inte privatleasing', () => {
  assert.equal(hasBusinessTerms('Företagsleasing från 6795kr'), true);
  assert.equal(hasBusinessTerms('4 995 kr/mån exkl. moms'), true);
  assert.equal(hasBusinessTerms('4 995 kr/mån ex moms'), true);
  assert.equal(hasBusinessTerms('Privatleasing inkl moms'), false);
  assert.equal(hasBusinessTerms(null, undefined), false);
});

test('availablePrices expanderas till en rad per villkorskombination', () => {
  const rows = offerToRawListings(fixture('alleasing-offer-varianter.html'), VARIANT_URL);
  assert.equal(rows.length, 2);

  assert.deepEqual(
    rows.map((r) => [r.external_id, r.monthly_sek, r.term_months, r.km_per_year]),
    [
      ['b156d4af1a3f-36m-10000km', 2995, 36, 10000],
      ['b156d4af1a3f-36m-15000km', 3395, 36, 15000],
    ],
  );
  // Kontantinsatsen följer med varje kombination – annars blir effektiv
  // månadskostnad fel för den dyrare varianten.
  assert.ok(rows.every((r) => r.down_payment_sek === 10000));
  assert.ok(rows.every((r) => r.segment_uncertain === false));
});

test('insatsvarianter av samma bil blir en rad, inte fyra', () => {
  // Verklig data från /erbjudande/audi/a3/6da24129d14d: samma löptid och
  // körsträcka, fyra kontantinsatser. Effektiv månadskostnad är i praktiken
  // densamma – fyra rader skulle ge bilen fyrdubbel vikt i baslinjen.
  const combos = [
    { duration: 36, distance: 10000, price: 1895, deposit: 30000 },
    { duration: 36, distance: 10000, price: 2195, deposit: 20000 },
    { duration: 36, distance: 10000, price: 2495, deposit: 10000 },
    { duration: 36, distance: 10000, price: 2795, deposit: 0 },
  ];
  const kept = bestPerTerms(combos);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].price, 1895, 'billigast effektivt: 1895 + 30000/36 ≈ 2728');
});

test('olika löptid och körsträcka är däremot olika produkter', () => {
  const kept = bestPerTerms([
    { duration: 36, distance: 10000, price: 2995, deposit: 0 },
    { duration: 36, distance: 15000, price: 3395, deposit: 0 },
    { duration: 24, distance: 10000, price: 3195, deposit: 0 },
  ]);
  assert.equal(kept.length, 3);
});

test('hela sidan ger unika external_id efter kollapsen', () => {
  const rows = offerToRawListings(fixture('alleasing-offer-varianter.html'), VARIANT_URL);
  const ids = rows.map((r) => r.external_id);
  assert.equal(new Set(ids).size, ids.length, 'inga kollisioner – annars äter dubblettfiltret rader');
  assert.ok(rows.every((r) => Array.isArray(r.raw.availablePrices)), 'alla varianter bevaras i raw');
});

test('ld+json används när flight-payloaden saknas', () => {
  const html = fixture('alleasing-offer-endast-ldjson.html');
  assert.equal(parseFlightPayload(html), '', 'fixturen har medvetet ingen flight-payload');

  const rows = offerToRawListings(html, OFFER_URL);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].monthly_sek, 8495);
  assert.equal(rows[0].brand, 'Polestar');
  assert.equal(rows[0].term_months, null, 'ld+json bär inga villkor');
  assert.ok(extractProductLd(html));
});

test('raden bär med sig vilken väg den kom in', () => {
  const [flightRow] = offerToRawListings(fixture('alleasing-offer.html'), OFFER_URL);
  assert.equal(flightRow.raw.via, 'flight');

  const [fallbackRow] = offerToRawListings(fixture('alleasing-offer-endast-ldjson.html'), OFFER_URL);
  assert.equal(fallbackRow.raw.via, 'ld+json');

  // Det är den här skillnaden räknaren i fetchListings bygger på, och den som
  // gör en tyst degradering sökbar i databasen efteråt.
  assert.equal(flightRow.term_months, 36);
  assert.equal(fallbackRow.term_months, null);
});

test('varianter behåller via-märkningen genom expansionen', () => {
  const rows = offerToRawListings(fixture('alleasing-offer-varianter.html'), VARIANT_URL);
  assert.ok(rows.length > 1);
  assert.ok(rows.every((r) => r.raw.via === 'flight'));
});

test('en sida utan både flight och ld+json ger noll rader, inte skräp', () => {
  assert.deepEqual(offerToRawListings('<html><body>Hittades inte</body></html>', OFFER_URL), []);
});

test('sitemapindexet skiljer erbjudandefiler från filtersidor', () => {
  const urls = parseSitemapUrls(fixture('alleasing-sitemap-index.xml'));
  const offers = urls.filter((u) => /\/sitemap\/offers-\d+\.xml$/.test(u));
  assert.equal(urls.length, 5);
  assert.deepEqual(offers, [
    'https://www.alleasing.se/sitemap/offers-0.xml',
    'https://www.alleasing.se/sitemap/offers-1.xml',
  ]);
});

test('fönstret roterar genom hela listan över flera körningar', () => {
  const urls = Array.from({ length: 10 }, (_, i) => `u${i}`);

  assert.deepEqual(selectWindow(urls, { maxOffers: 4, runIndex: 0 }), ['u0', 'u1', 'u2', 'u3']);
  assert.deepEqual(selectWindow(urls, { maxOffers: 4, runIndex: 1 }), ['u4', 'u5', 'u6', 'u7']);
  // Sista fönstret i varvet fylls på från början så inget hoppas över.
  assert.deepEqual(selectWindow(urls, { maxOffers: 4, runIndex: 2 }), ['u8', 'u9', 'u0', 'u1']);

  const seen = new Set();
  for (let run = 0; run < 10; run += 1) {
    for (const u of selectWindow(urls, { maxOffers: 4, runIndex: run })) seen.add(u);
  }
  assert.equal(seen.size, urls.length, 'alla erbjudanden ska hinna besökas');
});

test('ordningen blandar märken men är stabil mellan körningar', () => {
  // Alfabetisk sitemap: alla MINI ligger i rad. Ett fönster ur den sorteringen
  // skulle innehålla en enda modell.
  const urls = [
    ...Array.from({ length: 20 }, (_, i) => `https://x.se/erbjudande/mini/aceman/${i}`),
    ...Array.from({ length: 20 }, (_, i) => `https://x.se/erbjudande/volvo/ex30/${i}`),
  ].sort();

  const order = spreadOrder(urls);
  assert.deepEqual([...order].sort(), [...urls].sort(), 'inget får försvinna eller tillkomma');
  assert.deepEqual(order, spreadOrder(urls), 'samma ordning varje körning – annars hoppar fönstren');

  const firstTen = order.slice(0, 10);
  const brands = new Set(firstTen.map((u) => u.split('/')[4]));
  assert.equal(brands.size, 2, 'första fönstret ska innehålla båda märkena');
});

test('fönstret klarar färre erbjudanden än fönsterstorleken', () => {
  assert.deepEqual(selectWindow(['a', 'b'], { maxOffers: 400, runIndex: 7 }), ['a', 'b']);
  assert.deepEqual(selectWindow([], { maxOffers: 400, runIndex: 0 }), []);
});
