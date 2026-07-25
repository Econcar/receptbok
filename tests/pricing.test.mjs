import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBaselines, dealScore, effectiveMonthly, median, percentile } from '../scanner/lib/pricing.mjs';

test('effectiveMonthly slår ut kontantinsatsen över löptiden', () => {
  assert.equal(effectiveMonthly({ monthly_sek: 3000, down_payment_sek: 36000, term_months: 36 }), 4000);
});

test('effectiveMonthly utan kontantinsats är månadspriset', () => {
  assert.equal(effectiveMonthly({ monthly_sek: 3495, term_months: 36 }), 3495);
});

test('effectiveMonthly klarar löptid 0 utan att dividera med noll', () => {
  assert.equal(effectiveMonthly({ monthly_sek: 2500, down_payment_sek: 10000, term_months: 0 }), 2500);
});

test('effectiveMonthly returnerar null utan månadspris', () => {
  assert.equal(effectiveMonthly({ down_payment_sek: 10000, term_months: 36 }), null);
  assert.equal(effectiveMonthly(null), null);
});

test('effectiveMonthly accepterar sifferliknande strängar', () => {
  assert.equal(effectiveMonthly({ monthly_sek: '3000', down_payment_sek: '12000', term_months: '24' }), 3500);
});

test('dealScore mäter hur långt under baslinjen erbjudandet ligger', () => {
  assert.equal(dealScore(3600, 4000), 10);
  assert.equal(dealScore(4400, 4000), -10);
  assert.equal(dealScore(4000, 4000), 0);
});

test('dealScore är null när jämförelsen saknar mening', () => {
  assert.equal(dealScore(3600, 0), null);
  assert.equal(dealScore(null, 4000), null);
  assert.equal(dealScore(3600, null), null);
});

test('median hanterar jämnt och udda antal', () => {
  assert.equal(median([3000, 4000, 5000]), 4000);
  assert.equal(median([3000, 4000, 5000, 6000]), 4500);
  assert.equal(median([]), null);
  assert.equal(median([3000, null, 'skräp', 5000]), 4000);
});

test('percentile interpolerar', () => {
  assert.equal(percentile([1000, 2000, 3000, 4000], 0.25), 1750);
  assert.equal(percentile([1000], 0.9), 1000);
  assert.equal(percentile([], 0.5), null);
});

test('buildBaselines kräver minst tre annonser per modell', () => {
  const listings = [
    { brand: 'Volvo', model: 'EX30', monthly_sek: 3000, term_months: 36 },
    { brand: 'Volvo', model: 'EX30', monthly_sek: 4000, term_months: 36 },
    { brand: 'Volvo', model: 'EX30', monthly_sek: 5000, term_months: 36 },
    { brand: 'Kia', model: 'EV6', monthly_sek: 4500, term_months: 36 },
  ];
  const baselines = buildBaselines(listings);

  assert.equal(baselines.size, 1);
  assert.equal(baselines.get('volvo|ex30|privat').median_effective_sek, 4000);
  assert.equal(baselines.get('volvo|ex30|privat').sample_size, 3);
  assert.equal(baselines.has('kia|ev6|privat'), false);
});

test('buildBaselines jämför på effektiv månadskostnad, inte annonspris', () => {
  const listings = [
    { brand: 'Kia', model: 'EV6', monthly_sek: 2000, down_payment_sek: 72000, term_months: 36 }, // 4000
    { brand: 'Kia', model: 'EV6', monthly_sek: 4000, term_months: 36 },
    { brand: 'Kia', model: 'EV6', monthly_sek: 4000, term_months: 36 },
  ];
  assert.equal(buildBaselines(listings).get('kia|ev6|privat').median_effective_sek, 4000);
});
