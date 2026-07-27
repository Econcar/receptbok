// Översätter ett recept till svenska och räknar om måtten.
//
// Det här är inte ordbyte. "Fold in the egg whites" är "vänd ner äggvitorna",
// inte "vik in dem", och en cup är 2,4 dl medan en pinne smör är 113 gram –
// omräkningen kräver att man vet vad varan är. Därför en språkmodell och inte
// en tabell.
//
// Nätverksanropet ligger här men fetch skickas in, så att prompten, schemat och
// svarstolkningen går att enhetstesta utan att röra API:t. Håll filen fri från
// Node-API:er: den körs av node --test och av Cloudflare Pages Functions.

export const MODEL = 'claude-opus-5';

const SYSTEM = `Du översätter matrecept till svenska åt ett hushåll som lagar efter dem.

Översätt titel, ingredienser och tillagningssteg. Behåll stegens ordning och
antal – slå inte ihop och dela inte upp dem.

Använd svensk mattermlogi, inte ordagrann översättning. "Fold in" är "vänd ner",
"dredge" är "panera", "sauté" är "fräs", "simmer" är "sjud", "whisk" är "vispa".

Räkna om måtten till svenska:
- 1 cup = 2,4 dl. 1 tablespoon = 1 msk. 1 teaspoon = 1 tsk.
- 1 stick butter = 113 g. 1 oz = 28 g. 1 lb = 450 g. 1 fl oz = 3 cl.
- Fahrenheit till Celsius, avrundat till närmaste tiotal: 350°F = 175°C.
- Avrunda till mått man kan mäta upp i ett kök. Hellre "2½ dl" än "2,37 dl".
- Volym för torra varor räknas om till volym, inte vikt: "1 cup flour" blir
  "2½ dl vetemjöl", inte gram. Undantaget är smör, som anges i gram.
- Är måttet redan svenskt eller metriskt, lämna det som det är.

Namn på varor som saknar svensk motsvarighet behålls med en kort förklaring:
"graham crackers (digestivekex)".

Är receptet redan på svenska: returnera det oförändrat och sätt already_swedish
till true. Ändra ingenting bara för att det går att formulera snyggare.`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    instructions: { type: 'array', items: { type: 'string' } },
    already_swedish: { type: 'boolean' },
  },
  required: ['title', 'ingredients', 'instructions', 'already_swedish'],
  additionalProperties: false,
};

export class TranslateError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TranslateError';
    this.status = status;
  }
}

/** Bara det som ska översättas skickas – portioner och tid är tal. */
export function buildRequest(recipe) {
  return {
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    // Fabriksinställd fallback: avvisar säkerhetsklassificeringen begäran
    // körs den om på en annan modell i stället för att ge upp.
    fallbacks: 'default',
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: JSON.stringify({
        title: recipe.title ?? '',
        ingredients: recipe.ingredients ?? [],
        instructions: recipe.instructions ?? [],
      }),
    }],
  };
}

/**
 * Läser ut det översatta receptet.
 *
 * stop_reason kontrolleras före content: vid en avvisad begäran är content tom
 * eller halv, och att indexera den rakt av kraschar i stället för att förklara.
 */
export function parseResponse(body) {
  if (body?.stop_reason === 'refusal') {
    throw new TranslateError('Översättningen avvisades av modellen.', 422);
  }

  const text = (body?.content ?? []).find((block) => block.type === 'text')?.text;
  if (!text) throw new TranslateError('Modellen svarade utan text.', 502);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TranslateError('Modellens svar var inte giltig JSON.', 502);
  }

  if (!parsed.title || !Array.isArray(parsed.ingredients)) {
    throw new TranslateError('Modellens svar saknade titel eller ingredienser.', 502);
  }
  return parsed;
}

/**
 * @param {object} recipe   { title, ingredients[], instructions[] }
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {Function} [opts.fetch] injicerbar för test
 */
export async function translateRecipe(recipe, { apiKey, fetch: doFetch = fetch } = {}) {
  if (!apiKey) throw new TranslateError('ANTHROPIC_API_KEY saknas i Pages-miljön.', 500);

  const res = await doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildRequest(recipe)),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new TranslateError(
      `Anthropic svarade ${res.status}: ${detail.slice(0, 200)}`,
      res.status === 429 ? 429 : 502,
    );
  }

  return parseResponse(await res.json());
}
