import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { extractAllJsonLd, findByType, hasType } from '../lib/ldjson.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

test('receptet hittas inuti ett @graph', () => {
  const recipe = findByType(fixture('recept-graph.html'), 'Recipe');

  assert.equal(recipe.name, 'Pannkakor');
  assert.equal(recipe.recipeYield, '4 portioner');
  assert.equal(recipe.recipeIngredient.length, 5);
  assert.equal(recipe.recipeIngredient[0], '3 dl vetemjöl');
  assert.equal(recipe.recipeInstructions.length, 3);
});

test('receptet hittas i en array, även när @type är flera värden', () => {
  const recipe = findByType(fixture('recept-array.html'), 'Recipe');

  assert.equal(recipe.name, 'Köttbullar');
  assert.deepEqual(recipe.recipeIngredient, ['500 g blandfärs', '1 gul lök', '1 dl ströbröd']);
});

test('ett trasigt block fäller inte de andra', () => {
  // Fixturen har ett block med ett efterföljande kommatecken – ogiltig JSON.
  const nodes = extractAllJsonLd(fixture('recept-array.html'));
  assert.ok(nodes.length >= 3, 'de giltiga blocken ska finnas kvar');
  assert.ok(nodes.every((n) => n.name !== 'Trasig'), 'det trasiga ska inte komma med');
});

test('alla typer på sidan går att lista', () => {
  const nodes = extractAllJsonLd(fixture('recept-graph.html'));
  assert.deepEqual(nodes.map((n) => n['@type']), ['WebSite', 'BreadcrumbList', 'Recipe']);
});

test('hasType är okänsligt för skiftläge och klarar array-typer', () => {
  assert.equal(hasType({ '@type': 'Recipe' }, 'recipe'), true);
  assert.equal(hasType({ '@type': ['NewsArticle', 'Recipe'] }, 'Recipe'), true);
  assert.equal(hasType({ '@type': 'Product' }, 'Recipe'), false);
  assert.equal(hasType({}, 'Recipe'), false);
  assert.equal(hasType(null, 'Recipe'), false);
});

test('en sida utan ld+json ger tom lista, inte fel', () => {
  assert.deepEqual(extractAllJsonLd('<html><body>Inget här</body></html>'), []);
  assert.equal(findByType('<html></html>', 'Recipe'), null);
  assert.deepEqual(extractAllJsonLd(null), []);
});
