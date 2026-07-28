import test from 'node:test';
import assert from 'node:assert/strict';

import { FÖRSLAG, normalizeTag, upsertTags, valbara } from '../public/tags.js';

const tag = (name) => ({ id: `id-${name}`, name });

test('kategorinamn normaliseras till gemener', () => {
  // Gemenformat är ett villkor i databasen. Utan det blir "Vegetariskt" och
  // "vegetariskt" två kategorier som ser likadana ut i listan.
  assert.equal(normalizeTag('  Vegetariskt '), 'vegetariskt');
  assert.equal(normalizeTag('MIDDAG'), 'middag');
  assert.equal(normalizeTag(null), '');
});

test('hushållets egna kategorier finns bland de valbara', () => {
  // Utan det försvann en egen kategori ur förslagen nästa gång, och man fick
  // skriva den igen. I praktiken samma sak som att den inte gick att skapa.
  const lista = valbara([tag('gratäng'), tag('julmat')]);

  assert.ok(lista.includes('gratäng'));
  assert.ok(lista.includes('julmat'));
});

test('förslagen finns kvar för ett tomt hushåll', () => {
  const lista = valbara([]);
  for (const förslag of FÖRSLAG) assert.ok(lista.includes(förslag), förslag);
});

test('en kategori som både finns och föreslås visas en gång', () => {
  const lista = valbara([tag('middag')]);
  assert.equal(lista.filter((n) => n === 'middag').length, 1);
});

test('valda kategorier som saknas i listan tas med', () => {
  // Ett recept kan bära en kategori som hunnit tas bort ur hushållet. Den ska
  // synas som vald och gå att klicka bort, inte bara försvinna.
  const lista = valbara([], ['gammal kategori']);
  assert.ok(lista.includes('gammal kategori'));
});

test('listan sorteras på svenska', () => {
  const lista = valbara([tag('ägg'), tag('bak'), tag('öl')]);
  const index = (n) => lista.indexOf(n);

  assert.ok(index('bak') < index('ägg'), 'ä efter b');
  assert.ok(index('ägg') < index('öl'), 'ä före ö');
});

test('upsert normaliserar och tar bort dubbletter', async () => {
  let skickat;
  const client = {
    rest: async (path, init) => { skickat = { path, body: init.body, headers: init.headers }; return []; },
  };

  await upsertTags(client, 'hus-1', ['Middag', 'middag', '  MIDDAG  ', 'pasta']);

  assert.deepEqual(skickat.body.map((r) => r.name), ['middag', 'pasta']);
  assert.match(skickat.path, /on_conflict=household_id,name/);
  assert.match(skickat.headers.prefer, /merge-duplicates/);
});

test('inget att spara ger inget anrop', async () => {
  const client = { rest: async () => { throw new Error('skulle inte anropas'); } };

  assert.deepEqual(await upsertTags(client, 'hus-1', []), []);
  assert.deepEqual(await upsertTags(client, 'hus-1', ['  ', null]), []);
});
