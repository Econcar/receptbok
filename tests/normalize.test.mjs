import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBrand,
  normalizeFuel,
  normalizeListing,
  normalizeModel,
  parseKmPerYear,
  parseSek,
  parseTermMonths,
} from '../scanner/lib/normalize.mjs';

test('parseSek klarar svenska prisformat', () => {
  assert.equal(parseSek('3 495 kr/mån'), 3495);
  assert.equal(parseSek('3 495 kr'), 3495);
  assert.equal(parseSek('3.495:-'), 3495);
  assert.equal(parseSek('från 3495 kr'), 3495);
  assert.equal(parseSek('3 495,50 kr'), 3495.5);
  assert.equal(parseSek(3495), 3495);
  assert.equal(parseSek('0 kr'), 0);
});

test('parseSek returnerar null för text utan belopp', () => {
  assert.equal(parseSek('Pris på begäran'), null);
  assert.equal(parseSek(''), null);
  assert.equal(parseSek(null), null);
});

test('parseTermMonths normaliserar till månader', () => {
  assert.equal(parseTermMonths('36 mån'), 36);
  assert.equal(parseTermMonths('36 månader'), 36);
  assert.equal(parseTermMonths('3 år'), 36);
  assert.equal(parseTermMonths(24), 24);
  assert.equal(parseTermMonths('48'), 48);
  assert.equal(parseTermMonths(null), null);
});

test('parseKmPerYear räknar om mil till km', () => {
  assert.equal(parseKmPerYear('1 500 mil/år'), 15000);
  assert.equal(parseKmPerYear('15 000 km/år'), 15000);
  assert.equal(parseKmPerYear(15000), 15000);
  assert.equal(parseKmPerYear(null), null);
});

test('normalizeBrand slår ihop stavningsvarianter', () => {
  assert.equal(normalizeBrand('vw'), 'Volkswagen');
  assert.equal(normalizeBrand('Volkswagen'), 'Volkswagen');
  assert.equal(normalizeBrand('mercedes benz'), 'Mercedes-Benz');
  assert.equal(normalizeBrand('skoda'), 'Škoda');
  assert.equal(normalizeBrand('bmw'), 'BMW');
  assert.equal(normalizeBrand('Nyttmärke'), 'Nyttmärke');
  assert.equal(normalizeBrand(null), null);
});

test('normalizeFuel mappar till kanoniska drivmedel', () => {
  assert.equal(normalizeFuel('Elbil'), 'el');
  assert.equal(normalizeFuel('Plug-in hybrid'), 'laddhybrid');
  assert.equal(normalizeFuel('Mild hybrid'), 'hybrid');
  assert.equal(normalizeFuel('Bensin'), 'bensin');
});

test('normalizeModel tar bort märke och årtal', () => {
  assert.equal(normalizeModel('Volvo EX30 Extended Range 2025', 'Volvo'), 'EX30 Extended Range');
  assert.equal(normalizeModel('EX30  Extended Range'), 'EX30 Extended Range');
  assert.equal(normalizeModel(null), null);
});

test('normalizeListing bygger en rad som matchar schemat', () => {
  const row = normalizeListing({
    external_id: 'abc-1',
    url: 'https://exempel.se/annons/abc-1',
    brand: 'vw',
    model: 'Volkswagen ID.4 Pro 2025',
    trim: ' Pro ',
    fuel: 'Elbil',
    year: '2025',
    monthly_sek: '3 995 kr/mån',
    down_payment_sek: '36 000 kr',
    term_months: '36 mån',
    km_per_year: '1 500 mil/år',
  }, { source: 'exempel' });

  // Delmängd, inte hela objektet: nya kolumner i schemat ska inte fälla ett test
  // om textnormalisering. Att fälten finns täcks av testerna längre ner.
  assert.equal(row.source, 'exempel');
  assert.equal(row.external_id, 'abc-1');
  assert.equal(row.url, 'https://exempel.se/annons/abc-1');
  assert.equal(row.brand, 'Volkswagen');
  assert.equal(row.model, 'ID.4 Pro');
  assert.equal(row.trim, 'Pro');
  assert.equal(row.fuel, 'el');
  assert.equal(row.year, 2025);
  assert.equal(row.monthly_sek, 3995);
  assert.equal(row.down_payment_sek, 36000);
  assert.equal(row.term_months, 36);
  assert.equal(row.km_per_year, 15000, '1 500 mil/år → 15 000 km/år');
  assert.equal(row.residual_sek, null);
  assert.equal(row.segment, 'privat');
  assert.equal(row.effective_monthly_sek, 4995);
});

test('normalizeListing bär de nya fälten igenom orörda', () => {
  const row = normalizeListing({
    external_id: 'x', url: 'https://exempel.se/x', monthly_sek: 2995,
    condition: 'used', segment_uncertain: true,
    includes_insurance: true, includes_service: false, includes_tire_storage: null,
    dealer: 'blocket', city: 'Skövde', leasing_factor: 0.96, total_cost_sek: 158364,
  }, { source: 'exempel' });

  assert.equal(row.condition, 'used');
  assert.equal(row.segment_uncertain, true);
  assert.equal(row.includes_insurance, true);
  assert.equal(row.includes_service, false);
  assert.equal(row.includes_tire_storage, null, 'okänt är inte samma sak som nej');
  assert.equal(row.dealer, 'blocket');
  assert.equal(row.city, 'Skövde');
  assert.equal(row.leasing_factor, 0.96);
  assert.equal(row.total_cost_sek, 158364);
});

test('condition tar bara de värden schemat känner igen', () => {
  const make = (condition) => normalizeListing(
    { external_id: 'x', url: 'https://exempel.se/x', monthly_sek: 1, condition },
    { source: 's' },
  );
  assert.equal(make('new').condition, 'new');
  assert.equal(make('used').condition, 'used');
  assert.equal(make('demo').condition, null);
  assert.equal(make(undefined).condition, null);
});

test('normalizeListing kastar bort rader utan pris, id eller url', () => {
  assert.equal(normalizeListing({ external_id: 'a', url: 'https://x.se' }, { source: 's' }), null);
  assert.equal(normalizeListing({ url: 'https://x.se', monthly_sek: 3000 }, { source: 's' }), null);
  assert.equal(normalizeListing({ external_id: 'a', monthly_sek: 3000 }, { source: 's' }), null);
});

test('normalizeListing tillåter bara kända segment', () => {
  const foretag = normalizeListing(
    { external_id: 'a', url: 'https://x.se', monthly_sek: 3000, segment: 'foretag' },
    { source: 's' },
  );
  const skräp = normalizeListing(
    { external_id: 'b', url: 'https://x.se', monthly_sek: 3000, segment: 'nonsens' },
    { source: 's' },
  );
  assert.equal(foretag.segment, 'foretag');
  assert.equal(skräp.segment, 'privat');
});
