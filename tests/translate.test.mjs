import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRequest, MODEL, parseResponse, translateRecipe, TranslateError } from '../lib/translate.mjs';
import { looksSwedish } from '../public/lang.js';

const RECEPT = {
  title: 'Classic pancakes',
  ingredients: ['1 cup plain flour', '2 tbsp butter'],
  instructions: ['Sift the flour.', 'Fold in the egg whites.'],
};

/** Svar i den form strukturerad utdata ger: JSON i ett textblock. */
const svar = (payload, extra = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  ...extra,
});

test('anropet ställs till rätt modell och ber om strukturerad utdata', () => {
  const body = buildRequest(RECEPT);

  assert.equal(body.model, MODEL);
  assert.equal(body.model, 'claude-opus-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  assert.equal(body.fallbacks, 'default', 'avvisad begäran körs om på annan modell');
});

test('bara det som ska översättas skickas med', () => {
  const body = buildRequest({ ...RECEPT, servings: 4, total_time_min: 30, source_url: 'https://x' });
  const skickat = JSON.parse(body.messages[0].content);

  assert.deepEqual(Object.keys(skickat).sort(), ['ingredients', 'instructions', 'title']);
  assert.equal(skickat.servings, undefined, 'tal behöver ingen översättning');
});

test('systemprompten säger vad måtten ska bli', () => {
  const { system } = buildRequest(RECEPT);

  assert.match(system, /1 cup = 2,4 dl/);
  assert.match(system, /1 stick butter = 113 g/);
  assert.match(system, /350°F = 175°C/);
  assert.match(system, /vänd ner/, 'fackspråk, inte ordagrann översättning');
});

test('ett saknat fält blir tom lista i stället för undefined', () => {
  const skickat = JSON.parse(buildRequest({ title: 'Bara titel' }).messages[0].content);

  assert.deepEqual(skickat.ingredients, []);
  assert.deepEqual(skickat.instructions, []);
});

test('svaret läses ut ur textblocket', () => {
  const resultat = parseResponse(svar({
    title: 'Pannkakor',
    ingredients: ['2½ dl vetemjöl', '2 msk smör'],
    instructions: ['Sikta mjölet.', 'Vänd ner äggvitorna.'],
    already_swedish: false,
  }));

  assert.equal(resultat.title, 'Pannkakor');
  assert.equal(resultat.ingredients[0], '2½ dl vetemjöl');
  assert.equal(resultat.already_swedish, false);
});

test('en avvisad begäran kastar innan content läses', () => {
  // content är tom vid avvisning – att indexera den rakt av hade kraschat
  // med ett fel som inte säger något om vad som hände.
  assert.throws(
    () => parseResponse({ stop_reason: 'refusal', content: [] }),
    (err) => err instanceof TranslateError && err.status === 422,
  );
});

test('ett obegripligt svar ger ett begripligt fel', () => {
  assert.throws(
    () => parseResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'inte json' }] }),
    (err) => err.status === 502 && /giltig JSON/.test(err.message),
  );

  assert.throws(
    () => parseResponse({ stop_reason: 'end_turn', content: [] }),
    (err) => err.status === 502 && /utan text/.test(err.message),
  );

  assert.throws(
    () => parseResponse(svar({ ingredients: [] })),
    (err) => err.status === 502 && /titel/.test(err.message),
  );
});

test('nyckeln skickas som x-api-key, aldrig i webbläsaren', async () => {
  let sett;
  const doFetch = async (url, init) => {
    sett = { url, headers: init.headers };
    return new Response(JSON.stringify(svar({
      title: 'Pannkakor', ingredients: ['2½ dl vetemjöl'], instructions: [], already_swedish: false,
    })), { status: 200 });
  };

  await translateRecipe(RECEPT, { apiKey: 'sk-test', fetch: doFetch });

  assert.equal(sett.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sett.headers['x-api-key'], 'sk-test');
  assert.equal(sett.headers['anthropic-version'], '2023-06-01');
});

test('saknad nyckel upptäcks före anropet', async () => {
  await assert.rejects(
    () => translateRecipe(RECEPT, { apiKey: '', fetch: () => { throw new Error('skulle inte anropas'); } }),
    (err) => err instanceof TranslateError && err.status === 500,
  );
});

test('ett fel från API:t blir ett fel med statuskod', async () => {
  const doFetch = async () => new Response('rate limited', { status: 429 });

  await assert.rejects(
    () => translateRecipe(RECEPT, { apiKey: 'sk-test', fetch: doFetch }),
    (err) => err.status === 429,
  );
});

test('språkgissningen skiljer svenska recept från engelska', () => {
  assert.equal(looksSwedish('3 dl vetemjöl, 2 msk smör'), true);
  assert.equal(looksSwedish('Vispa ihop mjöl och mjölk till en slät smet.'), true);
  assert.equal(looksSwedish('1 cup plain flour, 2 tbsp butter'), false);
  assert.equal(looksSwedish('Sift the flour and whisk with the milk until smooth.'), false);
  assert.equal(looksSwedish(''), true, 'inget att översätta');
  assert.equal(looksSwedish(null), true);
});
