import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  clean,
  decodeEntities,
  imageUrl,
  instructionSteps,
  parseDuration,
  parseServings,
  recipeFromHtml,
  toRecipe,
} from '../lib/recipe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

test('ett välformat recept blir våra kolumner', () => {
  const recipe = recipeFromHtml(fixture('recept-graph.html'), {
    sourceUrl: 'https://exempel.se/pannkakor',
  });

  assert.equal(recipe.title, 'Pannkakor');
  assert.equal(recipe.source_url, 'https://exempel.se/pannkakor');
  assert.equal(recipe.source_name, 'Exempelsajten');
  assert.equal(recipe.image_url, 'https://exempel.se/pannkakor.jpg');
  assert.equal(recipe.servings, 4);
  assert.equal(recipe.total_time_min, 30);
  assert.equal(recipe.ingredients.length, 5);
  assert.equal(recipe.ingredients[0], '3 dl vetemjöl');
  assert.deepEqual(recipe.instructions, [
    'Vispa ihop mjöl och hälften av mjölken.',
    'Tillsätt resten av mjölken, ägg och salt.',
    'Stek i smör.',
  ]);
});

test('instruktioner som en enda textklump blir ändå ett steg', () => {
  const recipe = recipeFromHtml(fixture('recept-array.html'));

  assert.equal(recipe.title, 'Köttbullar');
  assert.deepEqual(recipe.instructions, ['Blanda, rulla, stek.']);
  assert.equal(recipe.servings, 6);
  assert.equal(recipe.total_time_min, null, 'saknad tid gissas inte fram');
  assert.equal(recipe.image_url, null);
});

test('den röriga varianten reds ut: sektioner, HTML och arrayer', () => {
  const recipe = recipeFromHtml(fixture('recept-rorigt.html'));

  assert.equal(recipe.title, 'Lasagne & sallad', 'entiteter avkodas');
  assert.equal(recipe.source_url, 'https://exempel.se/recept/lasagne', 'url från receptet');
  assert.equal(recipe.source_name, 'Exempelsajten');
  assert.equal(recipe.image_url, 'https://exempel.se/lasagne.jpg', 'första bilden, ur ImageObject');
  assert.equal(recipe.servings, 4, '4-6 portioner ger det lägre talet');
  assert.equal(recipe.total_time_min, 75);

  assert.deepEqual(recipe.ingredients, [
    '500 g köttfärs',
    '1 gul lök',
    '2 dl grädde',
  ]);

  assert.deepEqual(recipe.instructions, [
    'Bryn färsen.',
    'Tillsätt lök och låt puttra.',
    'Varva såsen med lasagneplattor.',
  ], 'stegen plattas ut ur sina sektioner, i ordning');
});

test('en sida utan recept ger null, inte ett tomt skal', () => {
  assert.equal(recipeFromHtml('<html><body>Ingen mat här</body></html>'), null);
  assert.equal(recipeFromHtml(''), null);
});

test('ett recept utan titel räknas inte som recept', () => {
  assert.equal(toRecipe({ '@type': 'Recipe', recipeIngredient: ['1 dl mjöl'] }), null);
  assert.equal(toRecipe({ '@type': 'Recipe', name: '   ' }), null);
});

test('ISO-varaktighet blir minuter', () => {
  assert.equal(parseDuration('PT30M'), 30);
  assert.equal(parseDuration('PT1H'), 60);
  assert.equal(parseDuration('PT1H30M'), 90);
  assert.equal(parseDuration('P1DT2H'), 1560);
  assert.equal(parseDuration(45), 45, 'somliga sajter skickar minuter som tal');
  assert.equal(parseDuration('PT0M'), null, 'noll minuter är ingen uppgift');
  assert.equal(parseDuration('en halvtimme'), null);
  assert.equal(parseDuration(null), null);
});

test('portioner läses ur fritext', () => {
  assert.equal(parseServings('4 portioner'), 4);
  assert.equal(parseServings('6'), 6);
  assert.equal(parseServings(8), 8);
  assert.equal(parseServings('4-6 portioner'), 4);
  assert.equal(parseServings('ca 4 pers'), 4);
  assert.equal(parseServings('lagom till helgen'), null);
  assert.equal(parseServings(undefined), null);
});

test('bildfältet klarar sträng, objekt och array', () => {
  assert.equal(imageUrl('https://exempel.se/a.jpg'), 'https://exempel.se/a.jpg');
  assert.equal(imageUrl({ url: 'https://exempel.se/b.jpg' }), 'https://exempel.se/b.jpg');
  assert.equal(imageUrl([{ contentUrl: 'https://exempel.se/c.jpg' }]), 'https://exempel.se/c.jpg');
  assert.equal(imageUrl('/relativ/sokvag.jpg'), null, 'relativa adresser går inte att spara');
  assert.equal(imageUrl(null), null);
});

test('instruktionssteg plattas ut oavsett form', () => {
  assert.deepEqual(instructionSteps('Ett steg.'), ['Ett steg.']);
  assert.deepEqual(instructionSteps(['Ett.', 'Två.']), ['Ett.', 'Två.']);
  assert.deepEqual(instructionSteps([{ text: 'Ett.' }, { name: 'Två.' }]), ['Ett.', 'Två.']);
  assert.deepEqual(instructionSteps('Rad ett.\n\nRad två.'), ['Rad ett.', 'Rad två.']);
  assert.deepEqual(instructionSteps(null), []);
  assert.deepEqual(instructionSteps([null, '', '   ']), []);
});

test('fritext städas utan att innehållet ändras', () => {
  assert.equal(clean('  två   blanksteg '), 'två blanksteg');
  assert.equal(clean('<b>fet</b> text'), 'fet text');
  assert.equal(clean('salt &amp; peppar'), 'salt & peppar');
  assert.equal(clean('&lt;b&gt;'), '<b>', 'skriven text överlever, till skillnad från taggar');
  assert.equal(clean(''), null);
  assert.equal(clean(null), null);
});

test('entiteter avkodas, inklusive de som betyder mat', () => {
  assert.equal(decodeEntities('gr&auml;dde'), 'grädde');
  assert.equal(decodeEntities('&Aring;h'), 'Åh');
  assert.equal(decodeEntities('&frac12; dl'), '½ dl', 'bråk är vanligare än decimaler');
  assert.equal(decodeEntities('&#189; dl'), '½ dl');
  assert.equal(decodeEntities('&#x00BD; dl'), '½ dl');
  assert.equal(decodeEntities('20 &deg;C'), '20 °C');
  assert.equal(decodeEntities('&amp;auml;'), '&auml;', 'ett svep, inte flera');
  assert.equal(decodeEntities('&okand;'), '&okand;', 'okända entiteter lämnas i fred');
});

test('engelska recept har sina egna tecken', () => {
  assert.equal(decodeEntities('don&rsquo;t overmix'), 'don’t overmix');
  assert.equal(decodeEntities('&frac13; cup'), '⅓ cup');
  assert.equal(decodeEntities('2 &times; 400g tins'), '2 × 400g tins');
  assert.equal(decodeEntities('&ldquo;soft peaks&rdquo;'), '“soft peaks”');
});
