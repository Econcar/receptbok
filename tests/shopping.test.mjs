import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShoppingList, formatItem, normalizeName } from '../public/shopping.js';

/** Kortform för ett recept i veckoplanen. */
const rätt = (title, servings, ingredienser, planerade = null) => ({
  recipe: {
    title,
    servings,
    recipe_ingredients: ingredienser.map(([name, quantity, unit]) => ({ name, quantity, unit })),
  },
  servings: planerade,
});

const rad = (lista, namn) => lista.find((post) => post.name === namn);

test('samma vara och samma enhet adderas', () => {
  const lista = buildShoppingList([
    rätt('Pannkakor', 4, [['mjölk', 6, 'dl']]),
    rätt('Våfflor', 4, [['mjölk', 3, 'dl']]),
  ]);

  assert.equal(lista.length, 1);
  assert.deepEqual(rad(lista, 'mjölk').quantity, 9);
  assert.equal(rad(lista, 'mjölk').unit, 'dl');
});

test('mått som går att räkna om exakt slås ihop', () => {
  // Svenska mått är definierade i milliliter: msk är 15, tsk 5, krm 1.
  // Omräkningen är exakt, inte en uppskattning.
  const lista = buildShoppingList([
    rätt('A', null, [['grädde', 2, 'dl']]),
    rätt('B', null, [['grädde', 2, 'msk']]),
  ]);

  assert.equal(lista.length, 1);
  assert.equal(rad(lista, 'grädde').quantity, 2.3, '200 ml + 30 ml');
  assert.equal(rad(lista, 'grädde').unit, 'dl');
});

test('paket är inte ett mått och slås inte ihop med deciliter', () => {
  // Startdokumentets exempel. Hellre två rader grädde än en felaktig summa.
  const lista = buildShoppingList([
    rätt('A', null, [['grädde', 2, 'dl']]),
    rätt('B', null, [['grädde', 1, 'förp']]),
  ]);

  assert.equal(lista.length, 2);
  assert.equal(lista.filter((post) => post.name === 'grädde').length, 2);
});

test('vikt och volym blandas aldrig', () => {
  const lista = buildShoppingList([
    rätt('A', null, [['smör', 100, 'g']]),
    rätt('B', null, [['smör', 1, 'dl']]),
  ]);

  assert.equal(lista.length, 2);
});

test('summan skrivs i den enhet man handlar i', () => {
  const stor = buildShoppingList([rätt('A', null, [['mjölk', 15, 'dl']])]);
  assert.deepEqual([rad(stor, 'mjölk').quantity, rad(stor, 'mjölk').unit], [1.5, 'l']);

  const tung = buildShoppingList([rätt('A', null, [['potatis', 1500, 'g']])]);
  assert.deepEqual([rad(tung, 'potatis').quantity, rad(tung, 'potatis').unit], [1.5, 'kg']);

  const liten = buildShoppingList([rätt('A', null, [['salt', 2, 'krm']])]);
  assert.deepEqual([rad(liten, 'salt').quantity, rad(liten, 'salt').unit], [2, 'ml']);
});

test('portioner skalar mängderna och flaggar raden', () => {
  // Skalning är inte linjär – kryddor och tid följer inte portionsantalet.
  // Mängden skalas ändå, men det ska synas att den är ungefärlig.
  const lista = buildShoppingList([rätt('Pannkakor', 4, [['mjölk', 6, 'dl']], 8)]);

  // 6 dl för 4 portioner blir 12 dl för 8 – och skrivs som 1,2 l, för det är
  // så mjölk står på hyllan.
  assert.equal(rad(lista, 'mjölk').quantity, 1.2);
  assert.equal(rad(lista, 'mjölk').unit, 'l');
  assert.equal(rad(lista, 'mjölk').approximate, true);
});

test('utan portionsuppgift skalas ingenting', () => {
  const utan = buildShoppingList([rätt('A', null, [['mjölk', 6, 'dl']], 8)]);
  assert.equal(rad(utan, 'mjölk').quantity, 6);
  assert.equal(rad(utan, 'mjölk').approximate, false, 'ingen gissning, ingen flagga');

  const samma = buildShoppingList([rätt('A', 4, [['mjölk', 6, 'dl']], 4)]);
  assert.equal(samma[0].approximate, false, 'oskalad rad är inte ungefärlig');
});

test('rader utan mängd behåller sin brist', () => {
  const lista = buildShoppingList([
    rätt('A', null, [['salt', null, null]]),
    rätt('B', null, [['salt', null, null]]),
  ]);

  assert.equal(lista.length, 1);
  assert.equal(rad(lista, 'salt').quantity, null, 'ingen mängd blir inte 0');
});

test('en rad utan mängd smittar inte av sig på en med', () => {
  const lista = buildShoppingList([
    rätt('A', null, [['smör', 100, 'g']]),
    rätt('B', null, [['smör', null, null]]),
  ]);

  // Olika enhet – "g" och ingen enhet – alltså två rader. Att slå ihop dem
  // hade sagt "100 g smör" när receptet också vill ha smör till stekning.
  assert.equal(lista.length, 2);
});

test('listan säger vilka rätter varan kommer från', () => {
  const lista = buildShoppingList([
    rätt('Pannkakor', null, [['mjölk', 6, 'dl']]),
    rätt('Våfflor', null, [['mjölk', 3, 'dl']]),
  ]);

  assert.deepEqual(rad(lista, 'mjölk').recipes.sort(), ['Pannkakor', 'Våfflor']);
});

test('skiftläge och blanksteg gör inte två varor av en', () => {
  const lista = buildShoppingList([
    rätt('A', null, [['Vetemjöl', 3, 'dl']]),
    rätt('B', null, [['vetemjöl ', 2, 'dl']]),
  ]);

  assert.equal(lista.length, 1);
  assert.equal(lista[0].quantity, 5);
});

test('olika namn på samma vara blir olika rader', () => {
  // Vispgrädde och matlagningsgrädde är två rader. Att gissa att de är samma
  // vara vore fel oftare än rätt; den kanoniska listan får komma senare.
  const lista = buildShoppingList([
    rätt('A', null, [['vispgrädde', 2, 'dl']]),
    rätt('B', null, [['matlagningsgrädde', 2, 'dl']]),
  ]);

  assert.equal(lista.length, 2);
});

test('listan sorteras på svenska', () => {
  const lista = buildShoppingList([
    rätt('A', null, [['ägg', 3, 'st'], ['banan', 1, 'st'], ['citron', 1, 'st']]),
  ]);

  assert.deepEqual(lista.map((post) => post.name), ['banan', 'citron', 'ägg']);
});

test('tom plan ger tom lista', () => {
  assert.deepEqual(buildShoppingList([]), []);
  assert.deepEqual(buildShoppingList(null), []);
  assert.deepEqual(buildShoppingList([{ recipe: null }]), []);
});

test('handtillagt slås ihop med planens', () => {
  // Att stå med två mjölkrader för att den ena kom från en knapp och den andra
  // från veckoplanen är precis den sortens fel som får en att sluta lita på
  // listan.
  const lista = buildShoppingList(
    [rätt('Pannkakor', null, [['mjölk', 6, 'dl']])],
    [{ name: 'mjölk', quantity: 3, unit: 'dl' }],
  );

  assert.equal(lista.length, 1);
  assert.equal(rad(lista, 'mjölk').quantity, 9);
  assert.equal(rad(lista, 'mjölk').manuellt, true);
  assert.deepEqual(rad(lista, 'mjölk').recipes, ['Pannkakor']);
});

test('handtillagt räknas om precis som planens mått', () => {
  const lista = buildShoppingList(
    [rätt('A', null, [['grädde', 2, 'dl']])],
    [{ name: 'grädde', quantity: 2, unit: 'msk' }],
  );

  assert.equal(lista.length, 1);
  assert.equal(rad(lista, 'grädde').quantity, 2.3, '200 ml + 30 ml');
});

test('handtillagt utan motsvarighet i planen blir en egen rad', () => {
  const lista = buildShoppingList([], [{ name: 'kaffe', quantity: null, unit: null }]);

  assert.equal(lista.length, 1);
  assert.equal(rad(lista, 'kaffe').manuellt, true);
  assert.deepEqual(rad(lista, 'kaffe').recipes, [], 'ingen rätt att hänvisa till');
});

test('en rad ur enbart planen är inte manuell', () => {
  const lista = buildShoppingList([rätt('A', null, [['mjölk', 6, 'dl']])]);
  assert.equal(rad(lista, 'mjölk').manuellt, false);
});

test('raden skrivs som man läser den i butiken', () => {
  assert.equal(formatItem({ name: 'grädde', quantity: 2.5, unit: 'dl' }), '2,5 dl grädde');
  assert.equal(formatItem({ name: 'ägg', quantity: 3, unit: 'st' }), '3 st ägg');
  assert.equal(formatItem({ name: 'salt', quantity: null, unit: null }), 'salt');
});

test('namnnormaliseringen gissar inte', () => {
  assert.equal(normalizeName('  Vispgrädde '), 'vispgrädde');
  assert.equal(normalizeName('gul  lök'), 'gul lök');
  assert.equal(normalizeName(null), '');
});
