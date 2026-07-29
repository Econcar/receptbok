// Veckoplanen: vilka rätter som ska lagas vilka dagar.
//
// Inköpslistan ligger på /inkopslistan och räknas fram ur den här planen.
// Sidorna är åtskilda för att situationerna är det: planen görs vid
// köksbordet, listan läses i butiken med en hand.
//
// Sju dagar från i dag, inte måndag till söndag. "Vilken vecka menar du" är en
// fråga ingen vill ställa sig framför kylskåpet.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, showVersion,
  startSession,
} from '/session.js';
import { dagarna, isoDatum } from '/vecka.js';

const els = {
  gate: document.getElementById('gate'),
  planner: document.getElementById('planner'),
  planForm: document.getElementById('plan-form'),
  planRecipe: document.getElementById('plan-recipe'),
  planDay: document.getElementById('plan-day'),
  planServings: document.getElementById('plan-servings'),
  planHint: document.getElementById('plan-hint'),
  week: document.getElementById('week'),
};

let client = null;
let household = null;
let recipes = [];
let plan = [];
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


  await ladda();
}

// --- Datum ------------------------------------------------------------------

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

  [recipes, plan] = await Promise.all([
    client.rest('recipes?select=id,title,servings'
      + `&household_id=eq.${household.id}&order=title.asc`),
    client.rest('meal_plan?select=id,date,servings,recipe_id'
      + `&household_id=eq.${household.id}&date=gte.${från}&date=lte.${till}&order=date.asc`),
  ]);

  senasteHämtning = Date.now();
  fyllRecept();
  renderVeckan();

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


function numberOrNull(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
