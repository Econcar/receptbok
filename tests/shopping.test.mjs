import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addToList, applyToList, buildShoppingList, collectMarkers, formatItem, groupKey,
  normalizeName, planGroups,
} from '../public/shopping.js';

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

/** Kortform för en rad i tabellen. */
const sparad = (id, name, quantity, unit, extra = {}) => ({
  id, name, quantity, unit, source: 'manual', checked: false, hidden: false, ...extra,
});

const bock = (id, name, unit) => sparad(id, name, null, unit, { source: 'plan', checked: true });

/** Raden addToList vill skriva för en vara. */
const vara = (name, quantity, unit) => ({ name, unit, quantity, source: 'manual' });

/** Det bortplock som ersätter en bock på något veckoplanen bidrar med. */
const bortplock = (name, unit) => ({
  name, unit, quantity: null, checked: false, hidden: true, source: 'plan',
});

/** Gruppnycklarna veckoplanen bidrar med, som anroparen räknar fram dem. */
const iPlanen = (...poster) => new Set(poster.map(([name, unit]) => groupKey(name, unit)));

test('en påfyllning summeras med det som redan står i listan', () => {
  const { remove, write } = addToList(
    [{ name: 'mjölk', quantity: 2, unit: 'dl' }],
    [sparad('a', 'mjölk', 3, 'dl')],
  );

  assert.deepEqual(remove, [], 'den gamla raden skrivs över, inte bort');
  assert.deepEqual(write, [vara('mjölk', 5, 'dl')]);
});

test('det som redan är handlat börjar om från noll', () => {
  // Buggen som fanns: bocken betyder att mjölken står i kylen. Att lägga i
  // receptet igen skulle be om två deciliter till, inte om fyra.
  const { remove, write, markers } = addToList(
    [{ name: 'mjölk', quantity: 2, unit: 'dl' }],
    [sparad('a', 'mjölk', 2, 'dl'), bock('b', 'mjölk', 'dl')],
  );

  assert.deepEqual(write, [vara('mjölk', 2, 'dl')]);
  assert.deepEqual(remove.sort(), ['a', 'b'], 'både den handlade raden och bocken');
  assert.deepEqual(markers, [], 'planen bidrar inte, så det finns inget att plocka bort');
});

test('handlat som kommer ur veckoplanen plockas bort i stället för att avbockas', () => {
  // Planens mängd går inte att radera – den räknas fram på nytt vid varje
  // visning. Att bara ta bort bocken gjorde varan ohandlad igen, och den nya
  // raden lades ovanpå: fyra deciliter att handla när man behövde två.
  const { remove, write, markers } = addToList(
    [{ name: 'mjölk', quantity: 2, unit: 'dl' }],
    [bock('b', 'mjölk', 'dl')],
    iPlanen(['mjölk', 'dl']),
  );

  assert.deepEqual(remove, ['b'], 'bocken gäller förra omgången');
  assert.deepEqual(write, [vara('mjölk', 2, 'dl')]);
  assert.deepEqual(markers, [bortplock('mjölk', 'dl')], 'planens del är fullgjord');
});

test('det handlade känns igen även när listan skrivit om enheten', () => {
  // Listan skriver summan så den går att läsa i butiken, så bocken för 500 ml
  // mjölk står som "0,5 l mjölk". En jämförelse på råa enheter hade missat det.
  const { remove, write } = addToList(
    [{ name: 'mjölk', quantity: 500, unit: 'ml' }],
    [sparad('a', 'mjölk', 0.5, 'l'), bock('b', 'mjölk', 'l')],
  );

  assert.deepEqual(write, [vara('mjölk', 500, 'ml')]);
  assert.deepEqual(remove.sort(), ['a', 'b'], 'den gamla halvlitern räknas inte med');
});

test('bortplocksmärket står kvar när varan läggs i igen', () => {
  // Plockar man bort en rad har man sagt att planens mängd inte ska räknas.
  // Tas märket bort kommer den tillbaka bakvägen, med den nya raden ovanpå.
  // Raden syns ändå: bortplock gäller bara planens bidrag, aldrig det egna.
  const { remove, write, markers } = addToList(
    [{ name: 'salt', quantity: 1, unit: 'krm' }],
    [sparad('b', 'salt', null, 'krm', { source: 'plan', hidden: true })],
    iPlanen(['salt', 'krm']),
  );

  assert.deepEqual(remove, []);
  assert.deepEqual(markers, [], 'märket finns redan och behöver inte skrivas om');
  assert.deepEqual(write, [vara('salt', 1, 'krm')]);
});

test('en vara utan enhet summeras inte i förväg', () => {
  // Tabellens unika villkor tar inte två okända enheter för samma värde, så
  // skrivningen krockar aldrig med den gamla raden utan blir en rad till.
  // Summerade vi här hade de tre äggen räknats två gånger.
  const { remove, write } = addToList(
    [{ name: 'ägg', quantity: 3, unit: null }],
    [sparad('a', 'ägg', 3, null)],
  );

  assert.deepEqual(remove, []);
  assert.deepEqual(write, [vara('ägg', 3, null)]);

  // Och listan lägger ihop de två raderna till sex ägg, som sig bör.
  const lista = buildShoppingList([], [sparad('a', 'ägg', 3, null), sparad('b', 'ägg', 3, null)]);
  assert.equal(rad(lista, 'ägg').quantity, 6);
});

test('skiftläge summeras inte i förväg heller', () => {
  // Databasen jämför namn tecken för tecken. "Mjölk" och "mjölk" blir två
  // rader där, och listan lägger ihop dem när den visas.
  const { write } = addToList(
    [{ name: 'mjölk', quantity: 2, unit: 'dl' }],
    [sparad('a', 'Mjölk', 2, 'dl')],
  );

  assert.deepEqual(write, [vara('mjölk', 2, 'dl')]);
});

test('samma vara två gånger i ett recept blir en rad', () => {
  // Smör till såsen och smör till stekningen. Två rader med samma nyckel i
  // samma skrivning får databasen att vägra hela anropet.
  const { write } = addToList([
    { name: 'smör', quantity: 1, unit: 'msk' },
    { name: 'smör', quantity: 2, unit: 'msk' },
  ], []);

  assert.deepEqual(write, [vara('smör', 3, 'msk')]);
});

test('rader utan mängd behåller sin brist genom påfyllningen', () => {
  const { write } = addToList(
    [{ name: 'salt', quantity: null, unit: null }],
    [sparad('a', 'salt', null, null)],
  );

  assert.deepEqual(write, [vara('salt', null, null)], 'inte 0');
});

test('andra varors rader och märken lämnas i fred', () => {
  const { remove, write, markers } = addToList(
    [{ name: 'mjölk', quantity: 2, unit: 'dl' }],
    [sparad('a', 'kaffe', null, null), bock('b', 'kaffe', null)],
    iPlanen(['kaffe', null]),
  );

  assert.deepEqual(remove, []);
  assert.deepEqual(markers, []);
  assert.deepEqual(write, [vara('mjölk', 2, 'dl')]);
});

test('namnlösa rader faller bort', () => {
  assert.deepEqual(addToList([{ name: '  ', quantity: 2, unit: 'dl' }], []).write, []);
  assert.deepEqual(addToList(null).write, []);
});

test('bocken hör till varan och inte till enheten summan skrevs i', () => {
  // Bockad som "2 dl mjölk", men veckan ändras och raden står som "1,2 l".
  // Letade man på enheten rakt av var bocken borta.
  const märken = collectMarkers([sparad('b', 'mjölk', 2, 'dl', { source: 'plan', checked: true })]);

  assert.equal(märken.get(groupKey('mjölk', 'l')).checked, true);
  assert.equal(märken.get(groupKey('Mjölk ', 'ml')).checked, true, 'och inte till skiftläget');
  assert.equal(märken.get(groupKey('mjölk', 'förp')), undefined, 'paket är inte ett mått');
});

test('två märken på samma vara slås ihop', () => {
  // Så länge det gick att skriva två rader för samma vara hann sådana par
  // uppstå. Ett märke som ibland syns och ibland inte är värre än ett som
  // står kvar en omgång för länge.
  const märken = collectMarkers([
    sparad('a', 'salt', null, null, { source: 'plan', checked: true }),
    sparad('b', 'salt', null, null, { source: 'plan', hidden: true }),
  ]);

  assert.equal(märken.size, 1);
  assert.deepEqual(märken.get(groupKey('salt', null)), { checked: true, hidden: true });
});

test('handtillagda rader är inga märken', () => {
  assert.equal(collectMarkers([sparad('a', 'kaffe', null, null)]).size, 0);
  assert.equal(collectMarkers(null).size, 0);
});

test('planens varor är gruppnycklar och inte namn', () => {
  // Samma nycklar som märkena och sammanslagningen använder, annars svarar de
  // två olika på frågan om planen bidrar med varan.
  const nycklar = planGroups([rätt('Pannkakor', null, [['mjölk', 15, 'dl'], ['salt', null, null]])]);

  assert.equal(nycklar.has(groupKey('mjölk', 'dl')), true, 'summan står som 1,5 l, varan är densamma');
  assert.equal(nycklar.has(groupKey('salt', null)), true);
  assert.equal(nycklar.has(groupKey('smör', 'g')), false);
  assert.equal(planGroups([]).size, 0);
});

/** Klient som bara skriver upp vad den blev ombedd att göra. */
function loggandeKlient() {
  const anrop = [];
  return {
    anrop,
    rest: async (path, { method = 'GET', body } = {}) => { anrop.push({ method, path, body }); },
  };
}

test('skrivningen raderar det gamla innan den skriver det nya', async () => {
  // Tvärtom hade raderingen tagit den rad skrivningen just uppdaterat.
  const client = loggandeKlient();

  await applyToList(client, 'h1', {
    remove: ['a', 'b'],
    write: [vara('mjölk', 2, 'dl')],
    markers: [bortplock('mjölk', 'dl')],
  });

  assert.deepEqual(client.anrop.map((a) => a.method), ['DELETE', 'POST'], 'ett svep var, i den ordningen');
  assert.match(client.anrop[0].path, /id=in\.\(a,b\)/);
  assert.deepEqual(
    client.anrop[1].body,
    [
      { household_id: 'h1', ...vara('mjölk', 2, 'dl') },
      { household_id: 'h1', ...bortplock('mjölk', 'dl') },
    ],
    'varan och märket i samma skrivning',
  );
});

test('inget att skriva ger inga anrop', async () => {
  const client = loggandeKlient();
  await applyToList(client, 'h1', { remove: [], write: [], markers: [] });
  assert.deepEqual(client.anrop, []);
});
