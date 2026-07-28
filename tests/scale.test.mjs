import test from 'node:test';
import assert from 'node:assert/strict';

import { formatQuantity, scaleFactor, scaleIngredient, scaleQuantity } from '../public/scale.js';

test('faktorn räknas ur receptets och det önskade antalet', () => {
  assert.equal(scaleFactor(4, 8), 2);
  assert.equal(scaleFactor(4, 2), 0.5);
  assert.equal(scaleFactor(4, 6), 1.5);
});

test('utan uppgift skalas ingenting', () => {
  assert.equal(scaleFactor(null, 8), 1);
  assert.equal(scaleFactor(4, null), 1);
  assert.equal(scaleFactor(0, 8), 1, 'noll portioner är ingen uppgift');
});

test('mängden skalas, tomma mängder förblir tomma', () => {
  assert.equal(scaleQuantity(2.5, 2), 5);
  assert.equal(scaleQuantity(6, 0.5), 3);
  assert.equal(scaleQuantity(null, 2), null, 'salt efter smak skalas inte');
});

test('bråk skrivs som bråk, inte som decimaler', () => {
  // Ett svenskt recept skriver ½ dl, inte 0,5 dl.
  assert.equal(formatQuantity(0.5), '½');
  assert.equal(formatQuantity(2.5), '2½');
  assert.equal(formatQuantity(0.75), '¾');
  assert.equal(formatQuantity(3.75), '3¾');
  assert.equal(formatQuantity(1 / 3), '⅓');
  assert.equal(formatQuantity(2 + 2 / 3), '2⅔');
});

test('heltal skrivs som heltal', () => {
  assert.equal(formatQuantity(3), '3');
  assert.equal(formatQuantity(12), '12');
});

test('det som inte är ett bråk får decimalkomma', () => {
  assert.equal(formatQuantity(3.4), '3,4');
  assert.equal(formatQuantity(1.1), '1,1');
});

test('vid faktor 1 återges originalet oförändrat', () => {
  // raw_text innehåller ordval och nyanser tolkningen kastat bort. Den är
  // alltid bättre än vår hopsättning när mängden inte ändrats.
  const rad = { raw_text: 'ca 2 dl vispgrädde, lättvispad', quantity: 2, unit: 'dl', name: 'vispgrädde', note: 'lättvispad' };
  assert.equal(scaleIngredient(rad, 1), 'ca 2 dl vispgrädde, lättvispad');
});

test('en skalad rad sätts ihop av de tolkade delarna', () => {
  const rad = { raw_text: '2 dl vispgrädde, lättvispad', quantity: 2, unit: 'dl', name: 'vispgrädde', note: 'lättvispad' };
  assert.equal(scaleIngredient(rad, 1.5), '3 dl vispgrädde, lättvispad');
  assert.equal(scaleIngredient(rad, 0.25), '½ dl vispgrädde, lättvispad');
});

test('en rad utan mängd står kvar som den är, oavsett faktor', () => {
  const rad = { raw_text: 'salt och peppar efter smak', quantity: null, unit: null, name: 'salt och peppar' };
  assert.equal(scaleIngredient(rad, 3), 'salt och peppar efter smak');
});

test('ägg avrundas inte i smyg', () => {
  // 3 ägg gånger 1,5 är 4½ ägg. Att runda upp till 5 hade varit en gissning
  // om vad kocken vill, och den gissningen hör hemma i köket.
  const rad = { raw_text: '3 ägg', quantity: 3, unit: 'st', name: 'ägg' };
  assert.equal(scaleIngredient(rad, 1.5), '4½ st ägg');
});

test('saknas tolkad vara används originaltexten', () => {
  const rad = { raw_text: '2 dl grädde', quantity: 2, unit: 'dl', name: null };
  assert.equal(scaleIngredient(rad, 2), '4 dl 2 dl grädde');
});

test('tom rad kraschar inte', () => {
  assert.equal(scaleIngredient(null, 2), '');
  assert.equal(scaleIngredient({}, 2), '');
});
