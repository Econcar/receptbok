// Listsidan: hushållets recept med bild, filtrerade på kategori.
//
// Inmatningen ligger på /nytt. Den här sidan ska gå att läsa i köket och inget
// annat.
//
// Allt som kommer utifrån renderas med textContent, aldrig innerHTML.
// Receptexten är hämtad från en främmande sajt och behandlas därefter.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, startSession,
} from '/session.js';

const els = {
  signIn: document.getElementById('signin'),
  signInButton: document.getElementById('signin-button'),
  setup: document.getElementById('household-setup'),
  setupForm: document.getElementById('household-form'),
  setupName: document.getElementById('household-name'),
  library: document.getElementById('library'),
  householdTitle: document.getElementById('household-title'),
  householdMeta: document.getElementById('household-meta'),
  filters: document.getElementById('filters'),
  results: document.getElementById('results'),
  meta: document.getElementById('meta'),
};

let household = null;
let recipes = [];
let activeTag = null;

registerServiceWorker();
els.meta.textContent = 'Receptbok · fas 2';

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
  await loadRecipes(client);
}

async function loadRecipes(client) {
  recipes = await client.rest(
    'recipes?select=id,title,image_url,source_url,source_name,servings,total_time_min,'
    + 'instructions,recipe_ingredients(raw_text,position),recipe_tags(tags(id,name))'
    + `&household_id=eq.${household.id}&order=title.asc`,
  );

  const roleName = household.role === 'owner' ? 'ägare' : 'medlem';
  els.householdMeta.textContent = recipes.length === 0
    ? `Du är ${roleName}. Inga recept ännu.`
    : `Du är ${roleName}. ${recipes.length} recept.`;

  renderFilters();
  renderRecipes();
  setStatus('Ansluten.', 'ok');
}

const tagsOf = (recipe) => (recipe.recipe_tags ?? []).map((row) => row.tags).filter(Boolean);

function renderFilters() {
  // Bara kategorier som faktiskt används visas. En tom kategori är en knapp
  // som garanterat ger noll träffar.
  const used = new Map();
  for (const recipe of recipes) {
    for (const tag of tagsOf(recipe)) used.set(tag.id, tag.name);
  }

  els.filters.replaceChildren();
  if (!used.size) return;

  const alla = chip('Alla', activeTag === null, () => {
    activeTag = null;
    renderFilters();
    renderRecipes();
  });
  els.filters.append(alla);

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
  const visible = activeTag === null
    ? recipes
    : recipes.filter((recipe) => tagsOf(recipe).some((tag) => tag.id === activeTag));

  if (!visible.length) {
    const tom = document.createElement('li');
    tom.className = 'empty';
    tom.textContent = recipes.length
      ? 'Inga recept i den kategorin.'
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
    // Bilden ligger hos källan och kan försvinna när de gör om sajten.
    // Då ska kortet krympa, inte visa en trasig ikon.
    img.addEventListener('error', () => img.remove());
    li.append(img);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

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

  body.append(details);
  li.append(body);
  return li;
}
