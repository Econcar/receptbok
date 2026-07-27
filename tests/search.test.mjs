import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesQuery, normalize } from '../public/search.js';
import {
  clearRecipes, loadHousehold, loadRecipes, saveHousehold, saveRecipes, savedAgo, VERSION,
} from '../public/store.js';

const RECEPT = {
  title: 'Curry med kyckling',
  recipe_ingredients: [
    { raw_text: '500 g kycklingfilé', position: 1 },
    { raw_text: '2 dl kokosmjölk', position: 2 },
  ],
  recipe_tags: [{ tags: { id: 't1', name: 'middag' } }],
};

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

test('accenter skalas av men å, ä och ö behålls', () => {
  assert.equal(normalize('Puré'), 'pure');
  assert.equal(normalize('CRÈME'), 'creme');
  assert.equal(normalize('Kål'), 'kål');
  assert.equal(normalize('Ägg'), 'ägg');
  assert.equal(normalize('Rödbetor'), 'rödbetor');
});

test('kål och kal är inte samma sak', () => {
  // Å, ä och ö är egna bokstäver på svenska. Skalades de av som accenter hade
  // en sökning på "kal" träffat kålrecepten.
  assert.notEqual(normalize('kål'), normalize('kal'));
  assert.notEqual(normalize('mörk'), normalize('mork'));
});

test('sökningen träffar titel, ingrediens och kategori', () => {
  assert.equal(matchesQuery(RECEPT, 'curry'), true);
  assert.equal(matchesQuery(RECEPT, 'kokosmjölk'), true, 'ingrediens');
  assert.equal(matchesQuery(RECEPT, 'middag'), true, 'kategori');
  assert.equal(matchesQuery(RECEPT, 'lasagne'), false);
});

test('orden behöver inte stå i följd', () => {
  assert.equal(matchesQuery(RECEPT, 'kyckling curry'), true);
  assert.equal(matchesQuery(RECEPT, 'curry kokosmjölk'), true, 'titel plus ingrediens');
  assert.equal(matchesQuery(RECEPT, 'kyckling lasagne'), false, 'alla ord måste finnas');
});

test('tom fråga visar allt', () => {
  assert.equal(matchesQuery(RECEPT, ''), true);
  assert.equal(matchesQuery(RECEPT, '   '), true);
  assert.equal(matchesQuery(RECEPT, null), true);
});

test('ett recept utan ingredienser eller kategorier kraschar inte', () => {
  assert.equal(matchesQuery({ title: 'Kokt ägg' }, 'ägg'), true);
  assert.equal(matchesQuery({}, 'ägg'), false);
});

test('recepten sparas och läses tillbaka för rätt hushåll', () => {
  const storage = fakeStorage();
  assert.equal(saveRecipes([RECEPT], 'hus-1', storage), true);

  const sparat = loadRecipes('hus-1', storage);
  assert.equal(sparat.recipes.length, 1);
  assert.equal(sparat.recipes[0].title, 'Curry med kyckling');
  assert.ok(sparat.saved_at > 0);
});

test('ett annat hushålls kopia används inte', () => {
  const storage = fakeStorage();
  saveRecipes([RECEPT], 'hus-1', storage);

  assert.equal(loadRecipes('hus-2', storage), null);
});

test('trasigt eller tomt lagringsvärde ger null, inte ett undantag', () => {
  const storage = fakeStorage();
  assert.equal(loadRecipes('hus-1', storage), null, 'inget sparat');

  storage.setItem('receptbok.recept', 'inte json');
  assert.equal(loadRecipes('hus-1', storage), null);

  storage.setItem('receptbok.recept', JSON.stringify({ version: 0, recipes: [] }));
  assert.equal(loadRecipes('hus-1', storage), null, 'gammal version kastas');
});

test('en lagring som vägrar skriva fäller inte laddningen', () => {
  const trasig = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };

  assert.equal(saveRecipes([RECEPT], 'hus-1', trasig), false);
  assert.doesNotThrow(() => clearRecipes(trasig));
});

test('hushållet sparas separat – utan det ritas biblioteket aldrig offline', () => {
  const storage = fakeStorage();
  const hushåll = { id: 'hus-1', name: 'Familjen', role: 'owner' };

  assert.equal(saveHousehold(hushåll, storage), true);
  assert.deepEqual(loadHousehold(storage), hushåll);
});

test('ett halvt sparat hushåll används inte', () => {
  const storage = fakeStorage();
  assert.equal(loadHousehold(storage), null, 'inget sparat');

  storage.setItem('receptbok.hushall', 'inte json');
  assert.equal(loadHousehold(storage), null);

  // Utan id går inga recept att slå upp, och då är kopian värdelös. VERSION
  // importeras i stället för att skrivas som en siffra, annars hade provet
  // passerat på versionsfelet i stället för på det som testas.
  storage.setItem('receptbok.hushall', JSON.stringify({ version: VERSION, household: { name: 'X' } }));
  assert.equal(loadHousehold(storage), null);
});

test('åldern skrivs ut i klartext', () => {
  const nu = Date.parse('2026-07-27T12:00:00Z');
  const sedan = (ms) => savedAgo(nu - ms, nu);

  assert.equal(sedan(30_000), 'nyss');
  assert.equal(sedan(20 * 60_000), 'för 20 minuter sedan');
  assert.equal(sedan(60 * 60_000), 'för 1 timme sedan');
  assert.equal(sedan(5 * 60 * 60_000), 'för 5 timmar sedan');
  assert.equal(sedan(26 * 60 * 60_000), 'för 1 dag sedan');
  assert.equal(sedan(3 * 24 * 60 * 60_000), 'för 3 dagar sedan');
});
