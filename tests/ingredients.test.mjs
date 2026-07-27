import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIngredient, parseIngredients } from '../public/ingredients.js';

/** Kortform: bara det vi bryr oss om, så att raderna går att läsa. */
const tolka = (raw) => {
  const { quantity, unit, name, note } = parseIngredient(raw);
  return { quantity, unit, name, note };
};

test('det vanliga fallet', () => {
  assert.deepEqual(tolka('2 dl vispgrädde'),
    { quantity: 2, unit: 'dl', name: 'vispgrädde', note: null });

  assert.deepEqual(tolka('500 g blandfärs'),
    { quantity: 500, unit: 'g', name: 'blandfärs', note: null });

  assert.deepEqual(tolka('1 msk smör'),
    { quantity: 1, unit: 'msk', name: 'smör', note: null });
});

test('bråk skrivs på fyra sätt och betyder samma sak', () => {
  assert.equal(tolka('½ tsk salt').quantity, 0.5);
  assert.equal(tolka('1/2 tsk salt').quantity, 0.5);
  assert.equal(tolka('0,5 tsk salt').quantity, 0.5);
  assert.equal(tolka('0.5 tsk salt').quantity, 0.5);
});

test('decimalkomma är inte en notseparator', () => {
  // "0,5 dl" är en halv deciliter, inte noll deciliter med noten "5 dl".
  assert.deepEqual(tolka('1,5 dl grädde'),
    { quantity: 1.5, unit: 'dl', name: 'grädde', note: null });

  // Men ett komma följt av text delar som vanligt, även efter ett decimaltal.
  assert.deepEqual(tolka('1,5 dl grädde, vispad'),
    { quantity: 1.5, unit: 'dl', name: 'grädde', note: 'vispad' });
});

test('heltal plus bråk', () => {
  assert.equal(tolka('2½ dl mjölk').quantity, 2.5);
  assert.equal(tolka('2 1/2 dl mjölk').quantity, 2.5);
  assert.equal(tolka('1¼ dl socker').quantity, 1.25);
});

test('intervall tar det lägre talet', () => {
  // Man kan alltid hälla i mer. Det motsatta felet står man med i grytan.
  assert.equal(tolka('2-3 dl mjölk').quantity, 2);
  assert.equal(tolka('2–3 dl mjölk').quantity, 2, 'tankstreck');
  assert.equal(tolka('1½-2 dl grädde').quantity, 1.5);
});

test('ungefärligheten slängs, den säger inget om mängden', () => {
  assert.deepEqual(tolka('ca 2 dl grädde'),
    { quantity: 2, unit: 'dl', name: 'grädde', note: null });
  assert.equal(tolka('cirka 4 msk olja').quantity, 4);
  assert.equal(tolka('drygt 1 dl socker').quantity, 1);
});

test('ett tal utan enhet betyder antal', () => {
  // "3 ägg" är tre stycken ägg. Utan enhet blir raden osammanslagbar i fas 5.
  assert.deepEqual(tolka('3 ägg'),
    { quantity: 3, unit: 'st', name: 'ägg', note: null });
  assert.deepEqual(tolka('1 gul lök'),
    { quantity: 1, unit: 'st', name: 'gul lök', note: null });
});

test('tillredningen hamnar i noten, inte i varan', () => {
  assert.deepEqual(tolka('1 gul lök, finhackad'),
    { quantity: 1, unit: 'st', name: 'gul lök', note: 'finhackad' });

  assert.deepEqual(tolka('2 msk smör, smält'),
    { quantity: 2, unit: 'msk', name: 'smör', note: 'smält' });

  assert.deepEqual(tolka('100 g parmesan (gärna färskriven)'),
    { quantity: 100, unit: 'g', name: 'parmesan', note: 'gärna färskriven' });
});

test('en mängd som inte är en mängd blir ingen mängd', () => {
  // "salt efter smak" är inte "1 salt". Hellre ingen uppgift än en påhittad.
  assert.deepEqual(tolka('salt och peppar efter smak'),
    { quantity: null, unit: null, name: 'salt och peppar', note: 'efter smak' });

  assert.deepEqual(tolka('olja till stekning'),
    { quantity: null, unit: null, name: 'olja', note: 'till stekning' });

  assert.deepEqual(tolka('smör till formen'),
    { quantity: null, unit: null, name: 'smör', note: 'till formen' });
});

test('skrivsätt för samma enhet blir samma enhet', () => {
  // Annars går raderna inte att slå ihop i fas 5.
  assert.equal(tolka('2 matskedar olja').unit, 'msk');
  assert.equal(tolka('2 msk olja').unit, 'msk');
  assert.equal(tolka('1 Tsk salt').unit, 'tsk');
  assert.equal(tolka('3 deciliter mjöl').unit, 'dl');
  assert.equal(tolka('1 paket fetaost').unit, 'förp');
  assert.equal(tolka('1 förp fetaost').unit, 'förp');
});

test('styckeenheter för varor man inte väger', () => {
  assert.deepEqual(tolka('2 klyftor vitlök'),
    { quantity: 2, unit: 'klyfta', name: 'vitlök', note: null });
  assert.deepEqual(tolka('1 burk krossade tomater'),
    { quantity: 1, unit: 'burk', name: 'krossade tomater', note: null });
  assert.deepEqual(tolka('1 knippe persilja'),
    { quantity: 1, unit: 'knippe', name: 'persilja', note: null });
});

test('engelska mått känns igen men räknas inte om', () => {
  // En cup förblir en cup. Fas 5 slår bara ihop rader med identisk enhet, så
  // en felaktig omräkning här hade blivit en felaktig inköpslista.
  assert.deepEqual(tolka('1 cup plain flour'),
    { quantity: 1, unit: 'cup', name: 'plain flour', note: null });
  assert.equal(tolka('2 tbsp butter').unit, 'tbsp');
  assert.equal(tolka('1 lb ground beef').unit, 'lb');
});

test('en rad kan inte äta upp sig själv', () => {
  // "Till servering" är en rubrik mitt i ingredienslistan. Tidigare matchade
  // den efter-smak-regeln och hela raden hamnade i noten, med tom vara kvar.
  // Hittat i ett riktigt recept från Köket.se.
  assert.deepEqual(tolka('Till servering'),
    { quantity: null, unit: null, name: 'Till servering', note: null });

  assert.deepEqual(tolka('efter smak'),
    { quantity: null, unit: null, name: 'efter smak', note: null });
});

test('en enhet utan vara är varan', () => {
  // "1 nypa" utan fortsättning – då är "nypa" inte en enhet utan allt vi har.
  assert.deepEqual(tolka('1 nypa'),
    { quantity: null, unit: null, name: 'nypa', note: null });
});

test('skräp och tomt kraschar inte', () => {
  assert.deepEqual(tolka(''), { quantity: null, unit: null, name: '', note: null });
  assert.deepEqual(tolka(null), { quantity: null, unit: null, name: '', note: null });
  assert.deepEqual(tolka('   '), { quantity: null, unit: null, name: '', note: null });
});

test('originalet följer alltid med', () => {
  // raw_text är facit och skrivs aldrig över. Tolkningen läggs bredvid.
  const rad = parseIngredient('  ca 2½ dl vispgrädde, lättvispad  ');
  assert.equal(rad.raw, 'ca 2½ dl vispgrädde, lättvispad');
  assert.equal(rad.quantity, 2.5);
  assert.equal(rad.name, 'vispgrädde');
});

test('en hel lista tolkas i ordning', () => {
  const rader = parseIngredients(['3 dl vetemjöl', '½ tsk salt', 'olja till stekning']);

  assert.equal(rader.length, 3);
  assert.equal(rader[0].name, 'vetemjöl');
  assert.equal(rader[1].quantity, 0.5);
  assert.equal(rader[2].quantity, null);
});

test('listan tar både strängar och sparade rader', () => {
  const rader = parseIngredients([{ raw_text: '2 dl grädde' }, '1 msk smör']);

  assert.equal(rader[0].unit, 'dl');
  assert.equal(rader[1].unit, 'msk');
});

test('en tredjedel avrundas till något man kan mäta upp', () => {
  assert.equal(tolka('⅓ dl socker').quantity, 0.333);
});
