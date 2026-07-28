// Inmatningssidan: importera från länk, översätt, eller skriv in för hand.
//
// Import, översättning och handinmatning delar samma formulär med flit.
// Maskinen fyller i det, användaren granskar, sedan sparas det. Tolkningen och
// översättningen har fel ibland, och det ska synas före databasen – inte efter.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, showVersion,
  startSession,
} from '/session.js';
import { looksSwedish } from '/lang.js';
import { parseIngredients } from '/ingredients.js';
import { normalizeTag, valbara } from '/tags.js';

const els = {
  gate: document.getElementById('gate'),
  editorWrap: document.getElementById('editor-wrap'),
  importForm: document.getElementById('import-form'),
  importUrl: document.getElementById('import-url'),
  importButton: document.getElementById('import-button'),
  recipeForm: document.getElementById('recipe-form'),
  title: document.getElementById('recipe-title'),
  source: document.getElementById('recipe-source'),
  servings: document.getElementById('recipe-servings'),
  time: document.getElementById('recipe-time'),
  image: document.getElementById('recipe-image'),
  ingredients: document.getElementById('recipe-ingredients'),
  instructions: document.getElementById('recipe-instructions'),
  chips: document.getElementById('tag-chips'),
  tagHint: document.getElementById('tag-hint'),
  translate: document.getElementById('translate-button'),
  reset: document.getElementById('reset-button'),
};

let household = null;
let client = null;
/** Det importen läste men formuläret inte visar. Följer med till databasen. */
let pending = { source_name: null, source_ldjson: null };
let chosen = new Set();
/** Hushållets kategorier. Nya skapas under Inställningar, inte här. */
let hushålletsTags = [];

registerServiceWorker();
showVersion();

if (!configured) {
  setStatus('Sajten är utrullad, men public/config.js är inte ifylld ännu.', 'warn');
} else {
  start().catch((err) => setStatus(describe(err), 'error'));
}

async function start() {
  const session = await startSession();
  client = session.client;

  // Utan inloggning eller hushåll finns ingenting att spara till. Listsidan
  // sköter båda flödena, så skicka dit i stället för att bygga om dem här.
  if (!session.user) {
    els.gate.hidden = false;
    setStatus('Du måste vara inloggad för att lägga till recept.');
    return;
  }

  household = await loadHousehold(client);
  if (!household) {
    els.gate.hidden = false;
    setStatus('Du hör inte till något hushåll ännu. Skapa ett på startsidan.');
    return;
  }

  els.editorWrap.hidden = false;
  hushålletsTags = await client.rest(
    `tags?select=id,name&household_id=eq.${household.id}&order=name.asc`,
  );
  renderChips();
  setStatus(`Lägger till i ${household.name}.`);

  els.importForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return importRecipe();
  }));


  els.translate.addEventListener('click', guard(() => translate()));
  els.reset.addEventListener('click', clearForm);
  els.recipeForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return saveRecipe();
  }));
}

// --- Kategorier -------------------------------------------------------------

function renderChips() {
  els.tagHint.textContent = hushålletsTags.length
    ? ''
    : 'Inga kategorier ännu. Skapa dem under Inställningar.';

  els.chips.replaceChildren(...valbara(hushålletsTags, [...chosen]).map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = name;
    if (chosen.has(name)) button.dataset.active = 'true';
    button.addEventListener('click', () => {
      if (chosen.has(name)) chosen.delete(name);
      else chosen.add(name);
      renderChips();
    });
    return button;
  }));
}


// --- Import och översättning ------------------------------------------------

async function importRecipe() {
  const url = els.importUrl.value.trim();
  if (!url) return;

  const session = await client.getSession();
  if (!session) throw new Error('Sessionen har gått ut. Logga in igen.');

  setStatus('Hämtar receptet …');
  els.importButton.disabled = true;

  try {
    const res = await fetch(`/api/import?url=${encodeURIComponent(url)}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    });

    // Okända /api-sökvägar serveras som startsidan med status 200. Ett svar som
    // inte är JSON betyder därför att funktionen inte hittades.
    const body = await res.json().catch(() => null);
    if (!body) throw new Error('Importfunktionen svarade inte med JSON.');
    if (!res.ok) throw new Error(body.error ?? `Importen misslyckades (${res.status}).`);

    fillForm(body.recipe);
    setStatus('Receptet är hämtat. Kontrollera det och spara.', 'ok');

    // Är det inte svenskt översätts det direkt – det var poängen med att be om
    // en länk i stället för att skriva av receptet för hand.
    if (!looksSwedish(sampleText())) await translate();
    els.title.focus();
  } finally {
    els.importButton.disabled = false;
  }
}

/** Det språkgissningen tittar på: titel, ingredienser och steg. */
const sampleText = () => [
  els.title.value, els.ingredients.value, els.instructions.value,
].join('\n');

async function translate() {
  const session = await client.getSession();
  if (!session) throw new Error('Sessionen har gått ut. Logga in igen.');

  const payload = {
    title: els.title.value.trim(),
    ingredients: lines(els.ingredients.value),
    instructions: lines(els.instructions.value),
  };
  if (!payload.title && !payload.ingredients.length) return;

  setStatus('Översätter och räknar om måtten …');
  els.translate.disabled = true;

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => null);
    if (!body) throw new Error('Översättningsfunktionen svarade inte med JSON.');
    if (!res.ok) throw new Error(body.error ?? `Översättningen misslyckades (${res.status}).`);

    const { recipe } = body;
    if (recipe.already_swedish) {
      setStatus('Receptet var redan på svenska – inget ändrat.', 'ok');
      return;
    }

    els.title.value = recipe.title;
    els.ingredients.value = recipe.ingredients.join('\n');
    els.instructions.value = recipe.instructions.join('\n');
    setStatus('Översatt. Kontrollera måtten innan du sparar.', 'ok');
  } finally {
    els.translate.disabled = false;
  }
}

// --- Formuläret -------------------------------------------------------------

const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function fillForm(recipe) {
  els.title.value = recipe.title ?? '';
  els.source.value = recipe.source_url ?? '';
  els.servings.value = recipe.servings ?? '';
  els.time.value = recipe.total_time_min ?? '';
  els.image.value = recipe.image_url ?? '';
  els.ingredients.value = (recipe.ingredients ?? []).join('\n');
  els.instructions.value = (recipe.instructions ?? []).join('\n');

  pending = {
    source_name: recipe.source_name ?? null,
    source_ldjson: recipe.source_ldjson ?? null,
  };
}

function clearForm() {
  els.recipeForm.reset();
  els.importUrl.value = '';
  pending = { source_name: null, source_ldjson: null };
  chosen = new Set();
  renderChips();
  setStatus(`Lägger till i ${household.name}.`);
}

async function saveRecipe() {
  const title = els.title.value.trim();
  if (!title) return;

  setStatus('Sparar …');

  const [saved] = await client.insert('recipes', {
    household_id: household.id,
    title,
    source_url: els.source.value.trim() || null,
    source_name: pending.source_name,
    image_url: els.image.value.trim() || null,
    servings: numberOrNull(els.servings.value),
    total_time_min: numberOrNull(els.time.value),
    instructions: lines(els.instructions.value),
    source_ldjson: pending.source_ldjson,
  });

  const ingredients = lines(els.ingredients.value);
  if (ingredients.length) {
    // raw_text sparas som den står, tolkningen läggs bredvid. Originalet är
    // facit och skrivs aldrig över – tolkningen kan därför köras om när
    // reglerna blir bättre, utan att något importeras om.
    await client.insert(
      'recipe_ingredients',
      parseIngredients(ingredients).map((rad, index) => ({
        recipe_id: saved.id,
        position: index + 1,
        raw_text: rad.raw,
        quantity: rad.quantity,
        unit: rad.unit,
        name: rad.name || null,
        note: rad.note,
      })),
      { returning: 'minimal' },
    );
  }

  if (chosen.size) await saveTags(saved.id);

  clearForm();
  setStatus('Sparat. Receptet finns nu på startsidan.', 'ok');
}

async function saveTags(recipeId) {
  // Kategorierna finns redan – chipsen kommer ur hushållets egna. Här kopplas
  // de bara till receptet.
  const valda = hushålletsTags.filter((tag) => chosen.has(normalizeTag(tag.name)));
  if (!valda.length) return;

  await client.insert(
    'recipe_tags',
    valda.map((tag) => ({ recipe_id: recipeId, tag_id: tag.id })),
    { returning: 'minimal' },
  );
}

function numberOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
