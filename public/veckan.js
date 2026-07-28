// Veckoplanen och inköpslistan som följer av den.
//
// Listan lagras inte – den räknas fram ur planen varje gång sidan visas. Det
// som lagras är bara det som inte går att räkna fram: vad som är avbockat och
// vad man lagt till för hand. En sparad lista hade genast kunnat säga emot
// planen, och då vet man inte vilken som gäller.
//
// Sju dagar från i dag, inte måndag till söndag. "Vilken vecka menar du" är en
// fråga ingen vill ställa sig framför kylskåpet.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, showVersion,
  startSession,
} from '/session.js';
import { buildShoppingList, formatItem, normalizeName } from '/shopping.js';
import { groupByCategory, KATEGORIER } from '/categories.js';

const DAGAR = 7;

const els = {
  gate: document.getElementById('gate'),
  planner: document.getElementById('planner'),
  planForm: document.getElementById('plan-form'),
  planRecipe: document.getElementById('plan-recipe'),
  planDay: document.getElementById('plan-day'),
  planServings: document.getElementById('plan-servings'),
  planHint: document.getElementById('plan-hint'),
  week: document.getElementById('week'),
  listMeta: document.getElementById('list-meta'),
  list: document.getElementById('list'),
  itemForm: document.getElementById('item-form'),
  newItem: document.getElementById('new-item'),
};

let client = null;
let household = null;
let recipes = [];
let plan = [];
let sparade = [];
let varor = [];
let senasteHämtning = 0;

/**
 * Hämtar om när fliken blir synlig igen. Den gemensamma inköpslistan är
 * poängen: står två personer i olika gångar och bockar av ska man inte behöva
 * ladda om för att se att den andra redan tagit mjölken.
 *
 * Här finns inget utfällt läge att förstöra, till skillnad från receptlistan.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!client || !household) return;
  if (Date.now() - senasteHämtning < 15_000) return;

  ladda().catch((err) => setStatus(describe(err), 'error'));
});

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

  if (!session.user) {
    els.gate.hidden = false;
    setStatus('Du måste vara inloggad för att planera veckan.');
    return;
  }

  household = await loadHousehold(client);
  if (!household) {
    els.gate.hidden = false;
    setStatus('Du hör inte till något hushåll ännu. Skapa ett på startsidan.');
    return;
  }

  els.planner.hidden = false;
  fyllDagar();

  els.planForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return planeraIn();
  }));

  els.itemForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return läggTillEgen();
  }));

  await ladda();
}

// --- Datum ------------------------------------------------------------------

/** ISO-datum i lokal tid. toISOString() hade gett gårdagens datum på kvällen. */
function isoDatum(d) {
  const år = d.getFullYear();
  const månad = String(d.getMonth() + 1).padStart(2, '0');
  const dag = String(d.getDate()).padStart(2, '0');
  return `${år}-${månad}-${dag}`;
}

function dagarna() {
  const idag = new Date();
  return Array.from({ length: DAGAR }, (_, i) => {
    const d = new Date(idag);
    d.setDate(idag.getDate() + i);
    return d;
  });
}

const namnPåDag = (d, index) => {
  if (index === 0) return 'I dag';
  if (index === 1) return 'I morgon';
  return d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
};

function fyllDagar() {
  els.planDay.replaceChildren(...dagarna().map((d, i) => {
    const option = document.createElement('option');
    option.value = isoDatum(d);
    option.textContent = namnPåDag(d, i);
    return option;
  }));
}

// --- Hämtning ---------------------------------------------------------------

async function ladda() {
  setStatus('Hämtar veckan …');

  const dagar = dagarna();
  const från = isoDatum(dagar[0]);
  const till = isoDatum(dagar.at(-1));

  [recipes, plan, sparade, varor] = await Promise.all([
    client.rest('recipes?select=id,title,servings,'
      + 'recipe_ingredients(raw_text,quantity,unit,name,note)'
      + `&household_id=eq.${household.id}&order=title.asc`),
    client.rest('meal_plan?select=id,date,servings,recipe_id'
      + `&household_id=eq.${household.id}&date=gte.${från}&date=lte.${till}&order=date.asc`),
    client.rest(`shopping_list_items?select=*&household_id=eq.${household.id}`),
    client.rest(`ingredients?select=name,category&household_id=eq.${household.id}`),
  ]);

  senasteHämtning = Date.now();
  fyllRecept();
  renderVeckan();
  renderLista();

  setStatus(recipes.length ? 'Ansluten.' : 'Inga recept att planera in ännu.', recipes.length ? 'ok' : 'warn');
}

function fyllRecept() {
  els.planRecipe.replaceChildren(...recipes.map((recipe) => {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = recipe.title;
    return option;
  }));

  els.planForm.hidden = recipes.length === 0;
  els.planHint.textContent = recipes.length
    ? 'Lämnas portioner tomt används receptets eget antal.'
    : 'Lägg till minst ett recept först.';
}

// --- Veckan -----------------------------------------------------------------

const receptet = (id) => recipes.find((r) => r.id === id);

function renderVeckan() {
  els.week.replaceChildren(...dagarna().map((d, index) => {
    const datum = isoDatum(d);
    const rätter = plan.filter((rad) => rad.date === datum);

    const li = document.createElement('li');
    li.className = 'day';
    if (rätter.length) li.dataset.planned = 'true';

    const rubrik = document.createElement('h3');
    rubrik.textContent = namnPåDag(d, index);
    li.append(rubrik);

    if (!rätter.length) {
      const tom = document.createElement('p');
      tom.className = 'muted';
      tom.textContent = '—';
      li.append(tom);
      return li;
    }

    const lista = document.createElement('ul');
    for (const rad of rätter) {
      const recipe = receptet(rad.recipe_id);
      const rätt = document.createElement('li');

      const namn = document.createElement('span');
      namn.textContent = recipe?.title ?? 'Okänt recept';
      rätt.append(namn);

      const portioner = rad.servings ?? recipe?.servings;
      if (portioner) {
        const p = document.createElement('span');
        p.className = 'source';
        p.textContent = ` ${portioner} port`;
        rätt.append(p);
      }

      const bort = document.createElement('button');
      bort.type = 'button';
      bort.className = 'linkbutton';
      bort.textContent = 'Ta bort';
      bort.addEventListener('click', guard(() => taBort(rad.id)));
      rätt.append(bort);

      lista.append(rätt);
    }
    li.append(lista);
    return li;
  }));
}

async function planeraIn() {
  const recipe_id = els.planRecipe.value;
  if (!recipe_id) return;

  setStatus('Lägger till …');
  await client.insert('meal_plan', {
    household_id: household.id,
    recipe_id,
    date: els.planDay.value,
    servings: numberOrNull(els.planServings.value),
  }, { returning: 'minimal' });

  els.planServings.value = '';
  await ladda();
}

async function taBort(id) {
  setStatus('Tar bort …');
  await client.rest(`meal_plan?id=eq.${id}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });
  await ladda();
}

// --- Inköpslistan -----------------------------------------------------------

/** Nyckeln som binder en uträknad rad till sin sparade bock. */
const bockNyckel = (name, unit) => `${normalizeName(name)}|${unit ?? ''}`;

/**
 * Kategorin sitter på varans namn, inte på raden. Sätter man mjölk till mejeri
 * gäller det överallt mjölk dyker upp, i det här receptet och nästa.
 */
const kategoriFör = (rad) => {
  const namn = normalizeName(rad.egen ? rad.egen.name : rad.post.name);
  return varor.find((vara) => vara.name === namn)?.category ?? null;
};

async function sättKategori(namn, category) {
  await client.rest('ingredients?on_conflict=household_id,name', {
    method: 'POST',
    body: { household_id: household.id, name: normalizeName(namn), category: category || null },
    headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
  });

  varor = await client.rest(`ingredients?select=name,category&household_id=eq.${household.id}`);
  renderLista();
}

/** Väljaren som säger vilken avdelning varan står i. */
function kategoriväljare(namn, nuvarande) {
  const select = document.createElement('select');
  select.className = 'avdelningsval';
  select.setAttribute('aria-label', `Avdelning för ${namn}`);

  const tom = document.createElement('option');
  tom.value = '';
  tom.textContent = '– avdelning –';
  select.append(tom);

  for (const kategori of KATEGORIER) {
    const option = document.createElement('option');
    option.value = kategori.id;
    option.textContent = kategori.namn;
    select.append(option);
  }

  select.value = nuvarande ?? '';
  select.addEventListener('change', guard(() => sättKategori(namn, select.value)));
  return select;
}

function renderLista() {
  const uträknad = buildShoppingList(plan.map((rad) => ({
    recipe: receptet(rad.recipe_id),
    servings: rad.servings,
  })));

  const bockar = new Map(
    sparade.filter((rad) => rad.source === 'plan')
      .map((rad) => [bockNyckel(rad.name, rad.unit), rad]),
  );

  const egna = sparade.filter((rad) => rad.source === 'manual');

  const rader = [
    ...uträknad.map((post) => ({ post, bock: bockar.get(bockNyckel(post.name, post.unit)) })),
    ...egna.map((rad) => ({ egen: rad })),
  ];

  // Grupperat per butiksavdelning, i butikens ordning och inte bokstavernas.
  // Okategoriserat hamnar sist – de raderna har man ännu inte tagit ställning
  // till, och de ska inte stå i vägen för dem man har.
  els.list.replaceChildren(...groupByCategory(rader, kategoriFör).flatMap((grupp) => {
    const rubrik = document.createElement('li');
    rubrik.className = 'avdelning';
    rubrik.textContent = grupp.namn;

    return [rubrik, ...grupp.items.map(
      (rad) => (rad.egen ? egenRad(rad.egen) : listrad(rad.post, rad.bock)),
    )];
  }));

  const ungefärliga = uträknad.filter((post) => post.approximate).length;
  const delar = [`${uträknad.length + egna.length} varor`];
  if (ungefärliga) {
    delar.push(`${ungefärliga} ungefärliga – skalade portioner följer inte kryddmåtten`);
  }
  els.listMeta.textContent = uträknad.length || egna.length
    ? delar.join(' · ')
    : 'Listan fylls av det du planerar in ovan.';
}

function listrad(post, bock) {
  const li = document.createElement('li');
  const label = document.createElement('label');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = Boolean(bock?.checked);
  box.addEventListener('change', guard(() => bocka(post, box.checked)));

  const text = document.createElement('span');
  text.textContent = formatItem(post);
  label.append(box, text);

  if (post.approximate) {
    const flagga = document.createElement('span');
    flagga.className = 'tag';
    flagga.textContent = 'ca';
    flagga.title = 'Mängden är skalad efter portioner och är ungefärlig';
    label.append(flagga);
  }

  label.append(kategoriväljare(post.name, kategoriFör({ post })));
  li.append(label);

  if (post.recipes?.length) {
    const källa = document.createElement('p');
    källa.className = 'source';
    källa.textContent = post.recipes.join(', ');
    li.append(källa);
  }

  return li;
}

function egenRad(rad) {
  const li = document.createElement('li');
  const label = document.createElement('label');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = rad.checked;
  box.addEventListener('change', guard(async () => {
    await client.rest(`shopping_list_items?id=eq.${rad.id}`, {
      method: 'PATCH',
      body: { checked: box.checked },
      headers: { prefer: 'return=minimal' },
    });
    rad.checked = box.checked;
  }));

  const text = document.createElement('span');
  text.textContent = rad.name;
  label.append(box, text, kategoriväljare(rad.name, kategoriFör({ egen: rad })));
  li.append(label);

  const bort = document.createElement('button');
  bort.type = 'button';
  bort.className = 'linkbutton';
  bort.textContent = 'Ta bort';
  bort.addEventListener('click', guard(async () => {
    await client.rest(`shopping_list_items?id=eq.${rad.id}`, {
      method: 'DELETE',
      headers: { prefer: 'return=minimal' },
    });
    await ladda();
  }));
  li.append(bort);

  return li;
}

/**
 * En bock på en uträknad rad sparas som en egen rad med source='plan'.
 * Avbockningen tas bort igen – ändras planen försvinner bocken med varan,
 * vilket är rätt: har man inte varan i listan har man inte köpt den heller.
 */
async function bocka(post, checked) {
  if (!checked) {
    await client.rest(
      `shopping_list_items?household_id=eq.${household.id}&source=eq.plan`
      + `&name=eq.${encodeURIComponent(post.name)}`
      + (post.unit ? `&unit=eq.${encodeURIComponent(post.unit)}` : '&unit=is.null'),
      { method: 'DELETE', headers: { prefer: 'return=minimal' } },
    );
  } else {
    await client.rest('shopping_list_items?on_conflict=household_id,name,unit,source', {
      method: 'POST',
      body: {
        household_id: household.id,
        name: post.name,
        unit: post.unit,
        quantity: post.quantity,
        checked: true,
        source: 'plan',
      },
      headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
    });
  }

  sparade = await client.rest(`shopping_list_items?select=*&household_id=eq.${household.id}`);
}

async function läggTillEgen() {
  const name = els.newItem.value.trim();
  if (!name) return;

  await client.rest('shopping_list_items?on_conflict=household_id,name,unit,source', {
    method: 'POST',
    body: { household_id: household.id, name, source: 'manual' },
    headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
  });

  els.newItem.value = '';
  await ladda();
}

function numberOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
