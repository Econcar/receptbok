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
import {
  addToList, applyToList, buildShoppingList, collectMarkers, formatItem, groupKey,
  normalizeName, planGroups,
} from '/shopping.js';
import { parseIngredient } from '/ingredients.js';
import { groupByCategory, KATEGORIER } from '/categories.js';
import { veckansFönster } from '/vecka.js';

const els = {
  gate: document.getElementById('gate'),
  wrap: document.getElementById('listwrap'),
  meta: document.getElementById('list-meta'),
  list: document.getElementById('list'),
  itemForm: document.getElementById('item-form'),
  newItem: document.getElementById('new-item'),
  doneSection: document.getElementById('done-section'),
  done: document.getElementById('done'),
  clearChecked: document.getElementById('clear-checked'),
  hiddenNote: document.getElementById('hidden-note'),
  hiddenCount: document.getElementById('hidden-count'),
  restoreHidden: document.getElementById('restore-hidden'),
  clearAll: document.getElementById('clear-all'),
};

/** Nyckeln på den rad som just ändras, eller null. */
let redigerar = null;

let client = null;
let household = null;
let recipes = [];
let plan = [];
let sparade = [];
let varor = [];
let senasteHämtning = 0;

/** Det render() senast satte på skärmen. Rensaknapparna räknar på det. */
let visade = [];
let inhandlade = [];

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

  els.clearChecked.addEventListener('click', guard(() => rensaInhandlat()));
  els.restoreHidden.addEventListener('click', guard(() => återställDolda()));
  els.clearAll.addEventListener('click', guard(() => rensaAllt()));

  await ladda();
}

async function ladda() {
  setStatus('Hämtar listan …');

  const { från, till } = veckansFönster();

  [recipes, plan, sparade, varor] = await Promise.all([
    client.rest('recipes?select=id,title,servings,'
      + 'recipe_ingredients(raw_text,quantity,unit,name,note)'
      + `&household_id=eq.${household.id}`),
    client.rest('meal_plan?select=id,date,servings,recipe_id'
      + `&household_id=eq.${household.id}`
      + `&date=gte.${från}&date=lte.${till}`),
    client.rest(`shopping_list_items?select=*&household_id=eq.${household.id}`),
    client.rest(`ingredients?select=name,category&household_id=eq.${household.id}`),
  ]);

  senasteHämtning = Date.now();
  render();
  setStatus('Ansluten.', 'ok');
}

const receptet = (id) => recipes.find((r) => r.id === id);

const egnaRader = () => sparade.filter((rad) => rad.source === 'manual');

/** Veckans rätter som sammanslagningen vill ha dem. */
const planposter = () => plan.map((rad) => ({
  recipe: receptet(rad.recipe_id),
  servings: rad.servings,
}));

function render() {
  // Bocken är alltid en egen rad med source='plan', även för något man lagt
  // till själv. Ett enda bockningssätt för allt som visas – annars hade en rad
  // som består av både planerat och handtillagt haft två ställen att vara
  // avbockad på.
  const märken = collectMarkers(sparade);

  // Bortplockat gäller planens bidrag. En handtillagd rad med samma nyckel står
  // kvar – det är så en ändrad rad ersätter den uträknade i stället för att
  // adderas till den.
  const dolda = new Set(
    [...märken].filter(([, märke]) => märke.hidden).map(([nyckel]) => nyckel),
  );

  const synliga = buildShoppingList(planposter(), egnaRader(), dolda);

  const märke = (post) => märken.get(groupKey(post.name, post.unit));
  const kvarDolda = [...dolda].filter(
    (k) => !synliga.some((post) => groupKey(post.name, post.unit) === k),
  ).length;

  const attHandla = synliga.filter((post) => !märke(post)?.checked);
  const inhandlat = synliga.filter((post) => märke(post)?.checked);

  // Rensaknapparna talar om hur mycket de tar. De ska räkna det som står på
  // skärmen och inte raderna i tabellen: ett märke kan höra till en vara som
  // inte längre visas, och "Rensa 5 varor" över en lista med tre är inget man
  // kan svara ja på.
  visade = synliga;
  inhandlade = inhandlat;

  const kategoriFör = (post) => {
    const namn = normalizeName(post.name);
    return varor.find((vara) => vara.name === namn)?.category ?? null;
  };

  els.list.replaceChildren(...groupByCategory(attHandla, kategoriFör).flatMap((grupp) => {
    const rubrik = document.createElement('li');
    rubrik.className = 'avdelning';
    rubrik.textContent = grupp.namn;
    return [rubrik, ...grupp.items.map((post) => listrad(post, märke(post)))];
  }));

  // Inhandlat grupperas inte per avdelning. Där är man färdig, och avdelningen
  // säger bara något om var i butiken man skulle ha gått.
  els.doneSection.hidden = inhandlat.length === 0;
  els.done.replaceChildren(...inhandlat.map((post) => listrad(post, märke(post))));

  els.hiddenNote.hidden = kvarDolda === 0;
  els.hiddenCount.textContent = kvarDolda === 1
    ? '1 vara är bortplockad. '
    : `${kvarDolda} varor är bortplockade. `;

  const delar = [];
  if (synliga.length) delar.push(`${attHandla.length} av ${synliga.length} kvar`);
  const ungefärliga = attHandla.filter((post) => post.approximate).length;
  if (ungefärliga) delar.push(`${ungefärliga} ungefärliga – skalade portioner följer inte kryddmåtten`);

  els.meta.textContent = synliga.length
    ? delar.join(' · ')
    : 'Listan fylls av veckoplanen och av det du lägger till själv.';
}

function listrad(post, märke) {
  const nyckel = groupKey(post.name, post.unit);
  if (nyckel === redigerar) return ändraRad(post);

  const li = document.createElement('li');
  const rad = document.createElement('div');
  rad.className = 'varurad';

  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = Boolean(märke?.checked);
  box.addEventListener('change', guard(() => bocka(post, box.checked)));

  const text = document.createElement('span');
  text.className = 'varunamn';
  text.textContent = formatItem(post);
  label.append(box, text);

  // Härkomst, avdelning och ca-flagga hör till handlandet. Ligger varan redan
  // i kundvagnen är de bara brus.
  if (!märke?.checked && post.approximate) {
    const flagga = document.createElement('span');
    flagga.className = 'tag';
    flagga.textContent = 'ca';
    flagga.title = 'Mängden är skalad efter portioner och är ungefärlig';
    label.append(flagga);
  }

  rad.append(label);
  if (!märke?.checked) rad.append(kategoriväljare(post.name));

  const ändra = document.createElement('button');
  ändra.type = 'button';
  ändra.className = 'linkbutton';
  ändra.textContent = 'Ändra';
  ändra.addEventListener('click', () => {
    redigerar = nyckel;
    render();
    els.wrap.querySelector('.varurad input[type="text"]')?.select();
  });

  const bort = document.createElement('button');
  bort.type = 'button';
  bort.className = 'linkbutton';
  bort.textContent = 'Ta bort';
  bort.addEventListener('click', guard(() => taBort(post)));

  rad.append(ändra, bort);
  li.append(rad);

  if (!märke?.checked) {
    const härkomst = [...post.recipes];
    if (post.manuellt) härkomst.push('tillagt själv');
    if (härkomst.length) {
      const källa = document.createElement('p');
      källa.className = 'source';
      källa.textContent = härkomst.join(', ');
      li.append(källa);
    }
  }

  return li;
}

/**
 * Ändring av en rad, som fritext.
 *
 * Texten tolkas med samma parser som receptens ingredienser – "2,5 dl mjölk"
 * blir mängd, enhet och vara. Ett eget fält per del hade varit tre rutor att
 * fylla i för något man skriver på en sekund.
 */
function ändraRad(post) {
  const li = document.createElement('li');
  const form = document.createElement('form');
  form.className = 'varurad';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = formatItem(post);
  input.maxLength = 80;
  input.required = true;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `Ändra ${post.name}`);

  const spara = document.createElement('button');
  spara.type = 'submit';
  spara.className = 'linkbutton';
  spara.textContent = 'Spara';

  const avbryt = document.createElement('button');
  avbryt.type = 'button';
  avbryt.className = 'linkbutton';
  avbryt.textContent = 'Avbryt';
  avbryt.addEventListener('click', () => {
    redigerar = null;
    render();
  });

  form.append(input, spara, avbryt);
  form.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return sparaÄndring(post, input.value);
  }));

  li.append(form);
  return li;
}

/**
 * Sparar en ändrad rad.
 *
 * Den uträknade raden plockas bort och ersätts av en handtillagd med det man
 * skrev. Att i stället ändra receptet vore fel: mängden i inköpslistan gäller
 * den här handlingen, inte hur rätten ska lagas nästa gång.
 */
async function sparaÄndring(post, text) {
  const tolkad = parseIngredient(text);
  if (!tolkad.name) {
    setStatus('Skriv minst ett varunamn.', 'warn');
    return;
  }

  await taBortRader(post);
  await sättMärke(post, { hidden: true, checked: false });

  await client.rest('shopping_list_items?on_conflict=household_id,name,unit,source', {
    method: 'POST',
    body: {
      household_id: household.id,
      name: tolkad.name,
      unit: tolkad.unit,
      quantity: tolkad.quantity,
      source: 'manual',
    },
    headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
  });

  redigerar = null;
  await ladda();
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

/**
 * Skriver bock- och bortplocksmärket för en rad.
 *
 * Båda bor på samma rad med source='plan', och det ska finnas exakt en sådan
 * rad per vara. Därför går de gamla bort innan den nya skrivs, i stället för
 * att skrivas över: tabellens unika villkor räknar två okända enheter som
 * olika värden, så en vara utan enhet krockade aldrig med sig själv och fick
 * ett märke till för varje klick. Samma svep städar bort märken som står kvar
 * i en enhet listan slutat skriva summan i.
 *
 * Är varken bocken eller bortplocket satt skrivs ingen ny rad alls, så
 * tabellen inte fylls av tomma märken.
 */
async function sättMärke(post, ändring) {
  const nyckel = groupKey(post.name, post.unit);
  const gamla = sparade.filter(
    (rad) => rad.source === 'plan' && groupKey(rad.name, rad.unit) === nyckel,
  );

  const nuvarande = collectMarkers(gamla).get(nyckel);
  const checked = ändring.checked ?? nuvarande?.checked ?? false;
  const hidden = ändring.hidden ?? nuvarande?.hidden ?? false;

  if (gamla.length) {
    await client.rest(`shopping_list_items?id=in.(${gamla.map((rad) => rad.id).join(',')})`, {
      method: 'DELETE',
      headers: { prefer: 'return=minimal' },
    });
  }

  if (checked || hidden) {
    await client.rest('shopping_list_items?on_conflict=household_id,name,unit,source', {
      method: 'POST',
      body: {
        household_id: household.id,
        name: post.name,
        unit: post.unit,
        quantity: post.quantity,
        checked,
        hidden,
        source: 'plan',
      },
      headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
    });
  }

  sparade = await client.rest(`shopping_list_items?select=*&household_id=eq.${household.id}`);
}

/** Kryssa i flyttar varan till Redan inhandlat, kryssa ur flyttar den tillbaka. */
async function bocka(post, checked) {
  await sättMärke(post, { checked });
  render();
}

/**
 * Tar bort raden ur båda listorna.
 *
 * Två saker samtidigt, för en rad kan bestå av båda sorterna: det handtillagda
 * bidraget raderas, och raden märks som bortplockad så att planens del slutar
 * visas. Att i stället plocka rätten ur veckan hade ändrat vad man tänkt laga
 * bara för att man redan har mjöl hemma.
 */
async function taBort(post) {
  await taBortRader(post);
  await sättMärke(post, { hidden: true, checked: false });
  render();
}

/** Raderar de handtillagda bidragen till en rad. Planens del märks separat. */
async function taBortRader(post) {
  const nyckel = groupKey(post.name, post.unit);

  for (const egen of egnaRader()) {
    if (groupKey(egen.name, egen.unit) !== nyckel) continue;
    await client.rest(`shopping_list_items?id=eq.${egen.id}`, {
      method: 'DELETE', headers: { prefer: 'return=minimal' },
    });
  }

  sparade = await client.rest(`shopping_list_items?select=*&household_id=eq.${household.id}`);
}

/**
 * Lägger till en vara man skriver in själv.
 *
 * Går samma väg som knappen i receptvyn. Skrev den sin rad rakt in i tabellen
 * hamnade en vara man just skrivit in direkt under "Redan inhandlat", om samma
 * vara råkade vara avbockad sedan förra rundan – och mängden lades ihop med
 * den man redan burit hem.
 */
async function läggTillEgen() {
  // Tolkas som en ingrediensrad, så att "2 dl grädde" blir mängd, enhet och
  // vara och kan slås ihop med planens grädde. Skriver man bara "kaffe" blir
  // det en rad utan mängd, precis som förut.
  const tolkad = parseIngredient(els.newItem.value);
  if (!tolkad.name) return;

  await applyToList(
    client,
    household.id,
    addToList([tolkad], sparade, planGroups(planposter())),
  );

  els.newItem.value = '';
  await ladda();
}

/**
 * Rensar det som är inhandlat.
 *
 * De handtillagda raderna raderas – de är handlade och hemburna, och kan
 * försvinna. Kommer mängden ur veckoplanen går den inte att radera: den räknas
 * fram på nytt vid varje visning, och en bock som bara togs bort lade tillbaka
 * allt man nyss handlat bland det som ska handlas. Bocken byts därför mot ett
 * bortplock, precis som när man lägger i en handlad vara på nytt.
 *
 * Veckoplanen rörs inte. Att rensa listan ska inte tyst ändra vad man tänkt
 * laga, och ångrar man sig står varorna kvar under "Ta tillbaka".
 */
async function rensaInhandlat() {
  if (!inhandlade.length) {
    setStatus('Inget är inhandlat än.', 'warn');
    return;
  }

  const antal = inhandlade.length === 1 ? '1 inhandlad vara' : `${inhandlade.length} inhandlade varor`;
  if (!confirm(`Rensa ${antal}? Veckoplanen rörs inte, och det du handlat ber inte om sig igen.`)) return;

  setStatus('Rensar …');
  const bockade = sparade.filter((rad) => rad.source === 'plan' && rad.checked);
  const nycklar = new Set(bockade.map((rad) => groupKey(rad.name, rad.unit)));
  const planens = planGroups(planposter());

  for (const egen of egnaRader()) {
    if (!nycklar.has(groupKey(egen.name, egen.unit))) continue;
    await client.rest(`shopping_list_items?id=eq.${egen.id}`, {
      method: 'DELETE', headers: { prefer: 'return=minimal' },
    });
  }

  const kvar = bockade.filter((rad) => planens.has(groupKey(rad.name, rad.unit)));
  const bort = bockade.filter((rad) => !planens.has(groupKey(rad.name, rad.unit)));

  if (bort.length) {
    await client.rest(`shopping_list_items?id=in.(${bort.map((rad) => rad.id).join(',')})`, {
      method: 'DELETE', headers: { prefer: 'return=minimal' },
    });
  }

  if (kvar.length) {
    await client.rest(`shopping_list_items?id=in.(${kvar.map((rad) => rad.id).join(',')})`, {
      method: 'PATCH',
      body: { checked: false, hidden: true },
      headers: { prefer: 'return=minimal' },
    });
  }

  await ladda();
  setStatus('Inhandlat rensat.', 'ok');
}

/** Tar tillbaka allt bortplockat. Inget ska försvinna för gott av ett klick. */
async function återställDolda() {
  await client.rest(
    `shopping_list_items?household_id=eq.${household.id}&source=eq.plan&hidden=is.true`,
    {
      method: 'PATCH',
      body: { hidden: false },
      headers: { prefer: 'return=minimal' },
    },
  );

  await ladda();
  setStatus('Bortplockade varor är tillbaka.', 'ok');
}

/**
 * Rensar hela listan: alla handtillagda rader, alla bockar och alla
 * bortplock. Veckoplanen rörs inte – står rätterna kvar fylls listan på nytt
 * nästa gång sidan öppnas, vilket är meningen.
 */
async function rensaAllt() {
  if (!sparade.length) {
    // Knappen når bara det som ligger i tabellen. Står listan full av varor
    // som räknas fram ur veckoplanen finns det ingenting här att radera – och
    // att då säga "listan är redan tom" till någon som ser tolv rader är att
    // ljuga om varför ingenting händer.
    setStatus(visade.length
      ? 'Det finns inget att rensa – allt i listan kommer ur veckoplanen. '
        + 'Plocka bort rader en och en, eller ta bort rätter ur veckan.'
      : 'Listan är redan tom.', 'warn');
    return;
  }

  const svar = confirm([
    'Rensa hela inköpslistan?',
    '',
    'Allt du lagt till själv försvinner, liksom bockar och bortplock. '
    + 'Veckoplanen rörs inte, så listan fylls på nytt av de rätter som står kvar.',
  ].join('\n'));
  if (!svar) return;

  setStatus('Rensar …');
  await client.rest(`shopping_list_items?household_id=eq.${household.id}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });

  await ladda();
  setStatus('Inköpslistan är rensad.', 'ok');
}
