// Fas 1–2: inloggning, hushåll, import från länk och manuell inmatning.
//
// Import och handinmatning delar formulär med flit. Importen fyller i det åt
// användaren, som får granska innan något sparas – tolkningen har fel ibland,
// och det ska synas innan raden ligger i databasen, inte efteråt.
//
// Allt som kommer utifrån renderas med textContent, aldrig innerHTML.
// Receptexten är hämtad från en främmande sajt och ska behandlas därefter.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js';
import { createClient, RestError } from '/supabase.js';

const els = {
  status: document.getElementById('status'),
  meta: document.getElementById('meta'),
  account: document.getElementById('account'),
  accountName: document.getElementById('account-name'),
  signOut: document.getElementById('signout'),
  signIn: document.getElementById('signin'),
  signInButton: document.getElementById('signin-button'),
  setup: document.getElementById('household-setup'),
  setupForm: document.getElementById('household-form'),
  setupName: document.getElementById('household-name'),
  household: document.getElementById('household'),
  householdTitle: document.getElementById('household-title'),
  householdMeta: document.getElementById('household-meta'),
  importForm: document.getElementById('import-form'),
  importUrl: document.getElementById('import-url'),
  importButton: document.getElementById('import-button'),
  manualToggle: document.getElementById('manual-toggle'),
  editor: document.getElementById('editor'),
  editorTitle: document.getElementById('editor-title'),
  editorCancel: document.getElementById('editor-cancel'),
  recipeForm: document.getElementById('recipe-form'),
  title: document.getElementById('recipe-title'),
  source: document.getElementById('recipe-source'),
  servings: document.getElementById('recipe-servings'),
  time: document.getElementById('recipe-time'),
  ingredients: document.getElementById('recipe-ingredients'),
  instructions: document.getElementById('recipe-instructions'),
  results: document.getElementById('results'),
};

/** Det som importen läste men formuläret inte visar. Följer med till databasen. */
let pending = { source_name: null, image_url: null, source_ldjson: null };
let household = null;

function setStatus(text, tone) {
  els.status.textContent = text;
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

/** Ett läge i taget – annars blinkar två paneler förbi under laddningen. */
function showOnly(section) {
  for (const candidate of [els.signIn, els.setup, els.household]) {
    candidate.hidden = candidate !== section;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Utan service worker fungerar sajten ändå, bara inte offline.
  });
}

els.meta.textContent = 'Receptbok · fas 2';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  setStatus('Sajten är utrullad, men public/config.js är inte ifylld ännu.', 'warn');
} else {
  start().catch((err) => setStatus(describe(err), 'error'));
}

async function start() {
  const client = createClient({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });

  // Efter återkomsten från Google ligger resultatet i adressens fragment.
  const { error } = client.consumeRedirect();
  if (error) setStatus(`Inloggningen avbröts: ${error}`, 'error');

  els.signInButton.addEventListener('click', () => client.signIn());
  els.signOut.addEventListener('click', async () => {
    await client.signOut();
    location.reload();
  });

  const session = await client.getSession();
  if (!session) {
    els.account.hidden = true;
    showOnly(els.signIn);
    if (!error) setStatus('Inte inloggad.');
    return;
  }

  const user = client.user;
  els.accountName.textContent = user?.email ?? 'Inloggad';
  els.account.hidden = false;

  wire(client, user);
  await loadHousehold(client, user);
}

function wire(client, user) {
  els.setupForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return createHousehold(client, user);
  }));

  els.importForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return importRecipe(client);
  }));

  els.manualToggle.addEventListener('click', () => {
    fillForm({ title: '', ingredients: [], instructions: [] });
    els.editorTitle.textContent = 'Nytt recept';
    els.editor.hidden = false;
    els.title.focus();
  });

  els.editorCancel.addEventListener('click', closeEditor);

  els.recipeForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return saveRecipe(client);
  }));
}

/** Fångar fel från en händelsehanterare och skriver dem i statusraden. */
function guard(handler) {
  return (event) => {
    try {
      const result = handler(event);
      if (result?.catch) result.catch((err) => setStatus(describe(err), 'error'));
    } catch (err) {
      setStatus(describe(err), 'error');
    }
  };
}

async function loadHousehold(client, user) {
  setStatus('Hämtar hushåll …');

  // Ett anrop räcker: RLS ser till att bara egna medlemskap kommer tillbaka,
  // och hushållsraden följer med inbäddad via främmande nyckeln.
  const memberships = await client.rest(
    'household_members?select=role,households(id,name)',
  );

  if (!memberships.length) {
    showOnly(els.setup);
    setStatus('Du hör inte till något hushåll ännu.');
    return;
  }

  const { households: row, role } = memberships[0];
  household = { ...row, role };

  showOnly(els.household);
  els.householdTitle.textContent = household.name;
  await loadRecipes(client);
}

async function loadRecipes(client) {
  const recipes = await client.rest(
    `recipes?select=id,title,source_url,source_name,servings,total_time_min,instructions,`
    + `recipe_ingredients(raw_text,position)`
    + `&household_id=eq.${household.id}&order=title.asc`,
  );

  const roleName = household.role === 'owner' ? 'ägare' : 'medlem';
  els.householdMeta.textContent = recipes.length === 0
    ? `Du är ${roleName}. Inga recept ännu – importera det första.`
    : `Du är ${roleName}. ${recipes.length} ${recipes.length === 1 ? 'recept' : 'recept'}.`;

  els.results.replaceChildren(...recipes.map(recipeCard));
  setStatus('Ansluten.', 'ok');
}

/** Byggt med DOM-anrop, inte innerHTML: texten kommer från främmande sajter. */
function recipeCard(recipe) {
  const li = document.createElement('li');
  li.className = 'card';

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = recipe.title;
  details.append(summary);

  const facts = [
    recipe.servings ? `${recipe.servings} portioner` : null,
    recipe.total_time_min ? `${recipe.total_time_min} min` : null,
    recipe.source_name,
  ].filter(Boolean);

  if (facts.length) {
    const meta = document.createElement('p');
    meta.className = 'source';
    meta.textContent = facts.join(' · ');
    details.append(meta);
  }

  const ingredients = [...(recipe.recipe_ingredients ?? [])]
    .sort((a, b) => a.position - b.position);

  if (ingredients.length) {
    const list = document.createElement('ul');
    list.className = 'ingredients';
    for (const item of ingredients) {
      const row = document.createElement('li');
      row.textContent = item.raw_text;
      list.append(row);
    }
    details.append(list);
  }

  if (recipe.instructions?.length) {
    const steps = document.createElement('ol');
    steps.className = 'steps';
    for (const step of recipe.instructions) {
      const row = document.createElement('li');
      row.textContent = step;
      steps.append(row);
    }
    details.append(steps);
  }

  if (recipe.source_url) {
    const link = document.createElement('a');
    link.href = recipe.source_url;
    link.textContent = 'Öppna originalet';
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    details.append(link);
  }

  li.append(details);
  return li;
}

async function importRecipe(client) {
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

    // Okända /api-sökvägar serveras som startsidan med status 200. Ett JSON-svar
    // som inte är JSON betyder därför att funktionen inte hittades.
    const body = await res.json().catch(() => null);
    if (!body) throw new Error('Importfunktionen svarade inte med JSON.');
    if (!res.ok) throw new Error(body.error ?? `Importen misslyckades (${res.status}).`);

    fillForm(body.recipe);
    els.editorTitle.textContent = 'Granska innan du sparar';
    els.editor.hidden = false;
    setStatus('Receptet är hämtat. Kontrollera det och spara.', 'ok');
    els.title.focus();
  } finally {
    els.importButton.disabled = false;
  }
}

function fillForm(recipe) {
  els.title.value = recipe.title ?? '';
  els.source.value = recipe.source_url ?? '';
  els.servings.value = recipe.servings ?? '';
  els.time.value = recipe.total_time_min ?? '';
  els.ingredients.value = (recipe.ingredients ?? []).join('\n');
  els.instructions.value = (recipe.instructions ?? []).join('\n');

  pending = {
    source_name: recipe.source_name ?? null,
    image_url: recipe.image_url ?? null,
    source_ldjson: recipe.source_ldjson ?? null,
  };
}

function closeEditor() {
  els.editor.hidden = true;
  els.recipeForm.reset();
  els.importUrl.value = '';
  pending = { source_name: null, image_url: null, source_ldjson: null };
}

async function saveRecipe(client) {
  const title = els.title.value.trim();
  if (!title) return;

  const lines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ingredients = lines(els.ingredients.value);

  setStatus('Sparar …');

  // household_id måste anges; created_by sätts av databasens default. Raden går
  // att läsa tillbaka direkt, till skillnad från hushållet – vi är redan medlem.
  const [saved] = await client.insert('recipes', {
    household_id: household.id,
    title,
    source_url: els.source.value.trim() || null,
    source_name: pending.source_name,
    image_url: pending.image_url,
    servings: numberOrNull(els.servings.value),
    total_time_min: numberOrNull(els.time.value),
    instructions: lines(els.instructions.value),
    source_ldjson: pending.source_ldjson,
  });

  if (ingredients.length) {
    // raw_text sparas som den skrevs. Mängd och enhet tolkas i fas 4, ur den
    // här texten – originalet är facit och skrivs aldrig över.
    await client.insert(
      'recipe_ingredients',
      ingredients.map((raw_text, index) => ({
        recipe_id: saved.id,
        position: index + 1,
        raw_text,
      })),
      { returning: 'minimal' },
    );
  }

  closeEditor();
  await loadRecipes(client);
}

function numberOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function createHousehold(client, user) {
  const name = els.setupName.value.trim();
  if (!name) return;

  setStatus('Skapar hushåll …');
  // Bara namnet skickas. created_by sätts av kolumnens default till auth.uid(),
  // vilket är precis vad policyn kräver – klienten ska inte kunna ha fel om det.
  //
  // return=minimal av samma skäl: raden går inte att läsa tillbaka i samma
  // ögonblick som den skapas, eftersom triggern hinner göra oss till medlem
  // först efteråt. Vi hämtar hushållet i nästa anrop i stället.
  await client.insert('households', { name }, { returning: 'minimal' });
  await loadHousehold(client, user);
}

function describe(err) {
  if (err instanceof RestError && err.status === 401) {
    return 'Supabase avvisade nyckeln (401). Kontrollera anon-nyckeln i config.js.';
  }
  if (err instanceof RestError) {
    return `Supabase svarade ${err.status}: ${err.message}`;
  }
  return err.message;
}
