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

  assert.deepEqual(row, {
    source: 'exempel',
    external_id: 'abc-1',
    url: 'https://exempel.se/annons/abc-1',
    brand: 'Volkswagen',
    model: 'ID.4 Pro',
    trim: 'Pro',
    fuel: 'el',
    year: 2025,
    monthly_sek: 3995,
    down_payment_sek: 36000,
    term_months: 36,
    km_per_year: 15000,
    residual_sek: null,
    segment: 'privat',
    effective_monthly_sek: 4995,
  });
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
