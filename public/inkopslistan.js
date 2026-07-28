// Inköpslistan: veckans plan plus det man lagt till för hand, sammanslaget och
// grupperat per butiksavdelning.
//
// Egen sida sedan v22. Den läses i butiken med en hand, medan veckoplanen görs
// vid köksbordet – två helt olika situationer som inte tjänade på att dela sida.
//
// Listan lagras inte utan räknas fram vid varje visning. Det som lagras är det
// som inte går att räkna fram: vad man lagt till själv, och vad som är avbockat.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, showVersion,
  startSession,
} from '/session.js';
import { buildShoppingList, formatItem, normalizeName } from '/shopping.js';
import { groupByCategory, KATEGORIER } from '/categories.js';

const DAGAR = 7;

const els = {
  gate: document.getElementById('gate'),
  wrap: document.getElementById('listwrap'),
  meta: document.getElementById('list-meta'),
  list: document.getElementById('list'),
  itemForm: document.getElementById('item-form'),
  newItem: document.getElementById('new-item'),
  clearChecked: document.getElementById('clear-checked'),
};

let client = null;
let household = null;
let recipes = [];
let plan = [];
let sparade = [];
let varor = [];
let senasteHämtning = 0;

registerServiceWorker();
showVersion();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!client || !household) return;
  if (Date.now() - senasteHämtning < 15_000) return;
  ladda().catch((err) => setStatus(describe(err), 'error'));
});

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
    setStatus('Du måste vara inloggad för att se inköpslistan.');
    return;
  }

  household = await loadHousehold(client);
  if (!household) {
    els.gate.hidden = false;
    setStatus('Du hör inte till något hushåll ännu. Skapa ett på startsidan.');
    return;
  }

  els.wrap.hidden = false;

  els.itemForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return läggTillEgen();
  }));

  els.clearChecked.addEventListener('click', guard(() => rensaAvbockade()));

  await ladda();
}

/** ISO-datum i lokal tid. toISOString() hade gett gårdagens datum på kvällen. */
function isoDatum(d) {
  const år = d.getFullYear();
  const månad = String(d.getMonth() + 1).padStart(2, '0');
  const dag = String(d.getDate()).padStart(2, '0');
  return `${år}-${månad}-${dag}`;
}

async function ladda() {
  setStatus('Hämtar listan …');

  const idag = new Date();
  const sista = new Date(idag);
  sista.setDate(idag.getDate() + DAGAR - 1);

  [recipes, plan, sparade, varor] = await Promise.all([
    client.rest('recipes?select=id,title,servings,'
      + 'recipe_ingredients(raw_text,quantity,unit,name,note)'
      + `&household_id=eq.${household.id}`),
    client.rest('meal_plan?select=id,date,servings,recipe_id'
      + `&household_id=eq.${household.id}`
      + `&date=gte.${isoDatum(idag)}&date=lte.${isoDatum(sista)}`),
    client.rest(`shopping_list_items?select=*&household_id=eq.${household.id}`),
    client.rest(`ingredients?select=name,category&household_id=eq.${household.id}`),
  ]);

  senasteHämtning = Date.now();
  render();
  setStatus('Ansluten.', 'ok');
}

const receptet = (id) => recipes.find((r) => r.id === id);

/**
 * Nyckeln som binder en uträknad rad till sin bock.
 *
 * Bocken är alltid en egen rad med source='plan', även för något man lagt till
 * själv. Ett enda bockningssätt för allt som visas – annars hade en rad som
 * består av både planerat och handtillagt haft två ställen att vara avbockad på.
 */
const bockNyckel = (name, unit) => `${normalizeName(name)}|${unit ?? ''}`;

const egnaRader = () => sparade.filter((rad) => rad.source === 'manual');

function render() {
  const uträknad = buildShoppingList(
    plan.map((rad) => ({ recipe: receptet(rad.recipe_id), servings: rad.servings })),
    egnaRader(),
  );

  const bockar = new Map(
    sparade.filter((rad) => rad.source === 'plan')
      .map((rad) => [bockNyckel(rad.name, rad.unit), rad]),
  );

  const kategoriFör = (post) => {
    const namn = normalizeName(post.name);
    return varor.find((vara) => vara.name === namn)?.category ?? null;
  };

  els.list.replaceChildren(...groupByCategory(uträknad, kategoriFör).flatMap((grupp) => {
    const rubrik = document.createElement('li');
    rubrik.className = 'avdelning';
    rubrik.textContent = grupp.namn;
    return [rubrik, ...grupp.items.map(
      (post) => listrad(post, bockar.get(bockNyckel(post.name, post.unit))),
    )];
  }));

  const kvar = uträknad.filter((post) => !bockar.get(bockNyckel(post.name, post.unit))?.checked);
  const ungefärliga = uträknad.filter((post) => post.approximate).length;

  const delar = [];
  if (uträknad.length) delar.push(`${kvar.length} av ${uträknad.length} kvar`);
  if (ungefärliga) delar.push(`${ungefärliga} ungefärliga – skalade portioner följer inte kryddmåtten`);

  els.meta.textContent = uträknad.length
    ? delar.join(' · ')
    : 'Listan fylls av veckoplanen och av det du lägger till själv.';
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

  label.append(kategoriväljare(post.name));
  li.append(label);

  const härkomst = [...post.recipes];
  if (post.manuellt) härkomst.push('tillagt själv');

  if (härkomst.length) {
    const källa = document.createElement('p');
    källa.className = 'source';
    källa.textContent = härkomst.join(', ');
    li.append(källa);
  }

  // Bara det man lagt till själv går att ta bort. Planens rader tas bort genom
  // att rätten plockas ur veckan – annars hade listan och planen kunnat säga
  // emot varandra.
  const egen = egnaRader().find((rad) => bockNyckel(rad.name, rad.unit) === bockNyckel(post.name, post.unit));
  if (egen) {
    const bort = document.createElement('button');
    bort.type = 'button';
    bort.className = 'linkbutton';
    bort.textContent = 'Ta bort';
    bort.addEventListener('click', guard(() => taBortEgen(egen)));
    li.append(bort);
  }

  return li;
}

function kategoriväljare(namn) {
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

  select.value = varor.find((v) => v.name === normalizeName(namn))?.category ?? '';
  select.addEventListener('change', guard(() => sättKategori(namn, select.value)));
  return select;
}

async function sättKategori(namn, category) {
  await client.rest('ingredients?on_conflict=household_id,name', {
    method: 'POST',
    body: { household_id: household.id, name: normalizeName(namn), category: category || null },
    headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
  });

  varor = await client.rest(`ingredients?select=name,category&household_id=eq.${household.id}`);
  render();
}

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
  render();
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

async function taBortEgen(rad) {
  await client.rest(`shopping_list_items?id=eq.${rad.id}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });
  await ladda();
}

/**
 * Tar bort bockarna och de handtillagda rader som bockats av.
 *
 * Planens rader står kvar – de kommer ur veckan och försvinner när rätten gör
 * det. Att rensa listan ska inte tyst ändra vad man planerat att laga.
 */
async function rensaAvbockade() {
  const bockade = sparade.filter((rad) => rad.source === 'plan' && rad.checked);
  if (!bockade.length) {
    setStatus('Inget är avbockat.', 'warn');
    return;
  }

  if (!confirm(`Rensa ${bockade.length} avbockade rader? Veckoplanen rörs inte.`)) return;

  setStatus('Rensar …');
  const nycklar = new Set(bockade.map((rad) => bockNyckel(rad.name, rad.unit)));

  await client.rest(
    `shopping_list_items?household_id=eq.${household.id}&source=eq.plan&checked=is.true`,
    { method: 'DELETE', headers: { prefer: 'return=minimal' } },
  );

  for (const egen of egnaRader()) {
    if (!nycklar.has(bockNyckel(egen.name, egen.unit))) continue;
    await client.rest(`shopping_list_items?id=eq.${egen.id}`, {
      method: 'DELETE', headers: { prefer: 'return=minimal' },
    });
  }

  await ladda();
  setStatus('Avbockat rensat.', 'ok');
}
