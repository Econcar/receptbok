// Listsidan och kökläget: hushållets recept med bild, sökbara, filtrerade på
// kategori, läsbara utan nät och med skärmen tänd medan man lagar.
//
// Inmatningen ligger på /nytt. Den här sidan ska gå att använda med en hand och
// skitiga fingrar.
//
// Allt som kommer utifrån renderas med textContent, aldrig innerHTML.
// Receptexten är hämtad från en främmande sajt och behandlas därefter.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, startSession,
} from '/session.js';
import { matchesQuery } from '/search.js';
import { loadRecipes as loadCached, saveRecipes, savedAgo } from '/store.js';
import { keepAwake, letSleep } from '/kitchen.js';

const els = {
  signIn: document.getElementById('signin'),
  signInButton: document.getElementById('signin-button'),
  setup: document.getElementById('household-setup'),
  setupForm: document.getElementById('household-form'),
  setupName: document.getElementById('household-name'),
  library: document.getElementById('library'),
  householdTitle: document.getElementById('household-title'),
  householdMeta: document.getElementById('household-meta'),
  search: document.getElementById('search'),
  filters: document.getElementById('filters'),
  results: document.getElementById('results'),
  meta: document.getElementById('meta'),
};

let household = null;
let recipes = [];
let activeTag = null;
let query = '';
let öppna = 0;

registerServiceWorker();
els.meta.textContent = 'Receptbok · fas 3';

if (!configured) {
  setStatus('Sajten är utrullad, men public/config.js är inte ifylld ännu.', 'warn');
} else {
  start().catch((err) => setStatus(describe(err), 'error'));
}

function showOnly(section) {
  for (const candidate of [els.signIn, els.setup, els.library]) {
    candidate.hidden = candidate !== section;
  }
}

async function start() {
  const { client, user, error } = await startSession();
  if (error) setStatus(`Inloggningen avbröts: ${error}`, 'error');

  if (!user) {
    els.signInButton.addEventListener('click', () => client.signIn());
    showOnly(els.signIn);
    if (!error) setStatus('Inte inloggad.');
    return;
  }

  els.setupForm.addEventListener('submit', guard(async (event) => {
    event.preventDefault();
    const name = els.setupName.value.trim();
    if (!name) return;
    setStatus('Skapar hushåll …');
    // created_by sätts av kolumnens default till auth.uid(), vilket policyn
    // kräver. return=minimal eftersom raden inte går att läsa tillbaka förrän
    // triggern hunnit göra oss till medlem.
    await client.insert('households', { name }, { returning: 'minimal' });
    await show(client);
  }));

  els.search.addEventListener('input', () => {
    query = els.search.value;
    renderRecipes();
  });

  await show(client);
}

async function show(client) {
  setStatus('Hämtar hushåll …');
  household = await loadHousehold(client);

  if (!household) {
    showOnly(els.setup);
    setStatus('Du hör inte till något hushåll ännu.');
    return;
  }

  showOnly(els.library);
  els.householdTitle.textContent = household.name;
  await fetchRecipes(client);
}

const SELECT = 'recipes?select=id,title,image_url,source_url,source_name,servings,'
  + 'total_time_min,instructions,recipe_ingredients(raw_text,position),'
  + 'recipe_tags(tags(id,name))';

async function fetchRecipes(client) {
  try {
    recipes = await client.rest(`${SELECT}&household_id=eq.${household.id}&order=title.asc`);
    saveRecipes(recipes, household.id);
    setStatus('Ansluten.', 'ok');
  } catch (err) {
    // Utan nät är den sparade kopian hela poängen med kökläget. Finns ingen
    // är felet däremot värt att visa – då är det inte offline som är problemet.
    const sparat = loadCached(household.id);
    if (!sparat) throw err;
    recipes = sparat.recipes;
    setStatus(`Ingen kontakt med servern. Visar kopian som sparades ${savedAgo(sparat.saved_at)}.`, 'warn');
  }

  renderMeta();
  renderFilters();
  renderRecipes();
}

const tagsOf = (recipe) => (recipe.recipe_tags ?? []).map((row) => row.tags).filter(Boolean);

function renderMeta() {
  const roleName = household.role === 'owner' ? 'ägare' : 'medlem';
  els.householdMeta.textContent = recipes.length === 0
    ? `Du är ${roleName}. Inga recept ännu.`
    : `Du är ${roleName}. ${recipes.length} recept.`;
}

function renderFilters() {
  // Bara kategorier som faktiskt används visas. En tom kategori är en knapp
  // som garanterat ger noll träffar.
  const used = new Map();
  for (const recipe of recipes) {
    for (const tag of tagsOf(recipe)) used.set(tag.id, tag.name);
  }

  els.filters.replaceChildren();
  if (!used.size) return;

  els.filters.append(chip('Alla', activeTag === null, () => {
    activeTag = null;
    renderFilters();
    renderRecipes();
  }));

  for (const [id, name] of [...used].sort((a, b) => a[1].localeCompare(b[1], 'sv'))) {
    els.filters.append(chip(name, activeTag === id, () => {
      activeTag = activeTag === id ? null : id;
      renderFilters();
      renderRecipes();
    }));
  }
}

function chip(label, active, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.textContent = label;
  if (active) button.dataset.active = 'true';
  button.addEventListener('click', onClick);
  return button;
}

function renderRecipes() {
  const visible = recipes.filter((recipe) => {
    const rättKategori = activeTag === null
      || tagsOf(recipe).some((tag) => tag.id === activeTag);
    return rättKategori && matchesQuery(recipe, query);
  });

  // Ett utfällt recept försvinner vid omritning, och därmed också dess låsbehov.
  öppna = 0;
  letSleep();

  if (!visible.length) {
    const tom = document.createElement('li');
    tom.className = 'empty';
    tom.textContent = recipes.length
      ? 'Inget recept matchar. Prova ett annat ord eller en annan kategori.'
      : 'Inga recept ännu. Lägg till det första.';
    els.results.replaceChildren(tom);
    return;
  }

  els.results.replaceChildren(...visible.map(recipeCard));
}

/** Byggt med DOM-anrop, inte innerHTML: texten kommer från främmande sajter. */
function recipeCard(recipe) {
  const li = document.createElement('li');
  li.className = 'card';

  if (recipe.image_url) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = recipe.image_url;
    img.alt = '';
    img.loading = 'lazy';
    // Bilden ligger hos källan och finns inte utan nät. Då ska kortet krympa,
    // inte visa en trasig ikon.
    img.addEventListener('error', () => img.remove());
    li.append(img);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const details = document.createElement('details');
  details.addEventListener('toggle', () => {
    öppna += details.open ? 1 : -1;
    if (öppna > 0) keepAwake();
    else letSleep();
  });

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

  const tags = tagsOf(recipe);
  if (tags.length) {
    const bar = document.createElement('p');
    bar.className = 'tagbar';
    for (const tag of tags) {
      const badge = document.createElement('span');
      badge.className = 'tag';
      badge.textContent = tag.name;
      bar.append(badge);
    }
    details.append(bar);
  }

  const ingredients = [...(recipe.recipe_ingredients ?? [])]
    .sort((a, b) => a.position - b.position);

  if (ingredients.length) {
    const list = document.createElement('ul');
    list.className = 'ingredients';
    for (const item of ingredients) {
      list.append(ingredientRow(item.raw_text));
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

  body.append(details);
  li.append(body);
  return li;
}

/**
 * Avbockningsbar, för att hålla reda på var man är när man mäter upp. En
 * riktig kryssruta och inte en klickbar rad: den går att träffa med tummen,
 * fungerar med tangentbord och läses upp rätt av skärmläsare.
 *
 * Bocken sparas inte. Nästa gång man lagar rätten börjar man om ändå.
 */
function ingredientRow(text) {
  const li = document.createElement('li');
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  label.append(box, document.createTextNode(text));
  li.append(label);
  return li;
}
