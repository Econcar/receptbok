import test from 'node:test';
import assert from 'node:assert/strict';

import { groupByCategory, kategoriNamn, KATEGORIER, ärGiltig } from '../public/categories.js';

const vara = (name, kategori) => ({ name, kategori });
const kategoriFör = (rad) => rad.kategori;

test('ordningen är butikens, inte bokstavernas', () => {
  // Poängen med att kategorisera är att slippa pendla mellan avdelningarna.
  // Alfabetisk ordning hade gett Bröd, Dryck, Fisk … och ingen nytta alls.
  const ids = KATEGORIER.map((k) => k.id);

  assert.ok(ids.indexOf('grönt') < ids.indexOf('fryst'), 'grönsakerna före frysen');
  assert.ok(ids.indexOf('mejeri') < ids.indexOf('övrigt'));
  assert.equal(ids.at(-1), 'övrigt', 'övrigt sist');
});

test('grupperingen följer den ordningen', () => {
  const grupper = groupByCategory([
    vara('frysta ärtor', 'fryst'),
    vara('mjölk', 'mejeri'),
    vara('morot', 'grönt'),
  ], kategoriFör);

  assert.deepEqual(grupper.map((g) => g.id), ['grönt', 'mejeri', 'fryst']);
});

test('okategoriserat hamnar sist', () => {
  // De raderna har man ännu inte tagit ställning till, och de ska inte stå i
  // vägen för dem man har.
  const grupper = groupByCategory([
    vara('något nytt', null),
    vara('mjölk', 'mejeri'),
  ], kategoriFör);

  assert.deepEqual(grupper.map((g) => g.id), ['mejeri', null]);
  assert.equal(grupper.at(-1).namn, 'Okategoriserat');
});

test('en okänd kategori behandlas som ingen', () => {
  // Ett gammalt eller felstavat värde ska inte skapa en egen avdelning i
  // listan – då hade man fått två "mejeri" som ser likadana ut.
  const grupper = groupByCategory([vara('mjölk', 'mejjeri')], kategoriFör);

  assert.equal(grupper.length, 1);
  assert.equal(grupper[0].id, null);
});

test('ordningen inom en grupp rörs inte', () => {
  const grupper = groupByCategory([
    vara('ost', 'mejeri'),
    vara('mjölk', 'mejeri'),
    vara('ägg', 'mejeri'),
  ], kategoriFör);

  assert.deepEqual(grupper[0].items.map((v) => v.name), ['ost', 'mjölk', 'ägg']);
});

test('varje kategori har ett läsbart namn', () => {
  for (const kategori of KATEGORIER) {
    assert.equal(kategoriNamn(kategori.id), kategori.namn);
    assert.equal(ärGiltig(kategori.id), true);
  }

  assert.equal(ärGiltig('påhittad'), false);
  assert.equal(kategoriNamn(null), 'Okategoriserat');
});

test('tom lista ger inga grupper', () => {
  assert.deepEqual(groupByCategory([], kategoriFör), []);
  assert.deepEqual(groupByCategory(null, kategoriFör), []);
});
