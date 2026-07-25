import test from 'node:test';
import assert from 'node:assert/strict';

import { completeness, dedupeBatch, groupDuplicateOffers, offerKey, sourceKey } from '../scanner/lib/dedupe.mjs';

const base = {
  source: 'exempel',
  external_id: '1',
  url: 'https://exempel.se/1',
  brand: 'Volvo',
  model: 'EX30',
  term_months: 36,
  km_per_year: 15000,
  monthly_sek: 3995,
};

test('sourceKey är unik per källa och annons-id', () => {
  assert.equal(sourceKey(base), 'exempel|1');
  assert.notEqual(sourceKey(base), sourceKey({ ...base, source: 'annan' }));
});

test('dedupeBatch behåller en rad per external_id', () => {
  const rows = dedupeBatch([base, { ...base }, { ...base, external_id: '2' }]);
  assert.equal(rows.length, 2);
});

test('dedupeBatch låter den mest kompletta raden vinna', () => {
  const tunn = { ...base, trim: null, fuel: null };
  const komplett = { ...base, trim: 'Ultra', fuel: 'el', year: 2025 };
  assert.equal(dedupeBatch([tunn, komplett])[0].trim, 'Ultra');
  assert.equal(dedupeBatch([komplett, tunn])[0].trim, 'Ultra');
});

test('dedupeBatch hoppar över tomma värden', () => {
  assert.deepEqual(dedupeBatch([null, undefined]), []);
  assert.deepEqual(dedupeBatch(null), []);
});

test('offerKey ser samma erbjudande hos två källor som ett', () => {
  const a = { ...base, source: 'a', external_id: 'x', url: 'https://a.se/x' };
  const b = { ...base, source: 'b', external_id: 'y', url: 'https://b.se/y' };
  assert.equal(offerKey(a), offerKey(b));
});

test('offerKey skiljer på olika villkor', () => {
  assert.notEqual(offerKey(base), offerKey({ ...base, term_months: 48 }));
  assert.notEqual(offerKey(base), offerKey({ ...base, down_payment_sek: 20000 }));
  assert.notEqual(offerKey(base), offerKey({ ...base, segment: 'foretag' }));
});

test('groupDuplicateOffers samlar identiska erbjudanden', () => {
  const groups = groupDuplicateOffers([
    { ...base, source: 'a' },
    { ...base, source: 'b' },
    { ...base, source: 'c', monthly_sek: 4200 },
  ]);
  assert.equal(groups.size, 2);
  assert.equal(groups.get(offerKey(base)).length, 2);
});

test('completeness räknar ifyllda fält', () => {
  assert.equal(completeness({}), 0);
  assert.ok(completeness({ ...base, trim: 'Ultra' }) > completeness(base));
});
