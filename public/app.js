// Listsidan och kökläget: hushållets recept med bild, sökbara, filtrerade på
// kategori, läsbara utan nät och med skärmen tänd medan man lagar.
//
// Inmatningen ligger på /nytt. Den här sidan ska gå att använda med en hand och
// skitiga fingrar.
//
// Allt som kommer utifrån renderas med textContent, aldrig innerHTML.
// Receptexten är hämtad från en främmande sajt och behandlas därefter.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, showVersion,
  startSession,
} from '/session.js';
import { matchesQuery } from '/search.js';
import { parseIngredient } from '/ingredients.js';
import { scaleFactor, scaleIngredient } from '/scale.js';
import { normalizeTag, upsertTags, valbara } from '/tags.js';
import {
  loadHousehold as cachedHousehold, loadRecipes as cachedRecipes,
  saveHousehold, saveRecipes, savedAgo,
} from '/store.js';
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
  reparse: document.getElementById('reparse'),
  invite: document.getElementById('invite'),
  inviteCreate: document.getElementById('invite-create'),
  inviteResult: document.getElementById('invite-result'),
  inviteLink: document.getElementById('invite-link'),
  inviteCopy: document.getElementById('invite-copy'),
  search: document.getElementById('search'),
  filters: document.getElementById('filters'),
  manageTags: document.getElementById('manage-tags'),
  tagAdmin: document.getElementById('tag-admin'),
  results: document.getElementById('results'),
};

let client = null;
let household = null;
let recipes = [];
let hushålletsTags = [];
let activeTag = null;
let query = '';
let öppna = 0;
let senasteHämtning = 0;

registerServiceWorker();
showVersion();

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

/** En inbjudningslänk är /?invite=<token>. */
const inbjudan = new URL(location.href).searchParams.get('invite');

async function start() {
  const { client: skapad, user, error } = await startSession();
  client = skapad;
  if (error) setStatus(`Inloggningen avbröts: ${error}`, 'error');

  if (!user) {
    // Med en inbjudan i adressen måste hela adressen tillbaka efter
    // inloggningen, annars tappas token på vägen och länken är förbrukad i
    // användarens ögon utan att någonsin ha lösts in.
    els.signInButton.addEventListener('click', () => client.signIn(
      inbjudan ? location.href : location.origin,
    ));
    showOnly(els.signIn);
    if (inbjudan) setStatus('Du har blivit inbjuden till ett hushåll. Logga in för att gå med.');
    else if (!error) setStatus('Inte inloggad.'); // Felet står redan där.
    return;
  }

  if (inbjudan) await lösIn(client);

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

  els.reparse.addEventListener('click', guard(() => reparse(client)));

  els.manageTags.addEventListener('click', () => {
    els.tagAdmin.hidden = !els.tagAdmin.hidden;
    els.manageTags.textContent = els.tagAdmin.hidden ? 'Hantera kategorier' : 'Dölj';
    if (!els.tagAdmin.hidden) renderTagAdmin();
  });
  els.inviteCreate.addEventListener('click', guard(() => skapaInbjudan(client)));

  els.inviteCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.inviteLink.value);
      els.inviteCopy.textContent = 'Kopierad';
    } catch {
      // Utan urklippsrättighet får man markera själv – fältet är läsbart.
      els.inviteLink.select();
    }
  });

  await show(client);
}

async function show(client) {
  setStatus('Hämtar hushåll …');

  // Hushållet hämtas före recepten och avgör om biblioteket ritas alls. Utan
  // en sparad kopia här spelar den sparade receptkopian ingen roll – då faller
  // laddningen redan på det här anropet, och kökläget är oanvändbart utan nät.
  try {
    household = await loadHousehold(client);
    if (household) saveHousehold(household);
  } catch (err) {
    household = cachedHousehold();
    if (!household) throw err;
  }

  if (!household) {
    showOnly(els.setup);
    setStatus('Du hör inte till något hushåll ännu.');
    return;
  }

  showOnly(els.library);
  els.householdTitle.textContent = household.name;
  // Bara ägare kan bjuda in – policyn säger det, och knappen ska säga samma sak.
  els.invite.hidden = household.role !== 'owner';
  await fetchRecipes(client);
}

const SELECT = 'recipes?select=id,title,image_url,source_url,source_name,servings,'
  + 'total_time_min,instructions,'
  + 'recipe_ingredients(id,recipe_id,raw_text,position,quantity,unit,name,note),'
  + 'recipe_tags(tags(id,name))';

async function fetchRecipes(client) {
  try {
    [recipes, hushålletsTags] = await Promise.all([
      client.rest(`${SELECT}&household_id=eq.${household.id}&order=title.asc`),
      client.rest(`tags?select=id,name&household_id=eq.${household.id}&order=name.asc`),
    ]);
    saveRecipes(recipes, household.id);
    senasteHämtning = Date.now();
    setStatus('Ansluten.', 'ok');
  } catch (err) {
    // Utan nät är den sparade kopian hela poängen med kökläget. Finns ingen
    // är felet däremot värt att visa – då är det inte offline som är problemet.
    const sparat = cachedRecipes(household.id);
    if (!sparat) throw err;
    recipes = sparat.recipes;
    setStatus(`Ingen kontakt med servern. Visar kopian som sparades ${savedAgo(sparat.saved_at)}.`, 'warn');
  }

  renderMeta();
  renderFilters();
  renderRecipes();
}

/**
 * Löser in inbjudan och städar bort den ur adressen.
 *
 * Inlösen går via en security definer-funktion i databasen: den som löser in
 * är per definition inte medlem ännu och kan varken läsa inbjudningsraden
 * eller skriva sig in i hushållet på egen hand.
 */
async function lösIn(client) {
  setStatus('Löser in inbjudan …');
  try {
    await client.rest('rpc/redeem_household_invite', {
      method: 'POST',
      body: { invite_token: inbjudan },
    });
    setStatus('Du är med i hushållet.', 'ok');
  } catch (err) {
    setStatus(describe(err), 'error');
  } finally {
    // Bort ur adressen oavsett utfall. En förbrukad länk ska inte lösas in
    // igen vid varje omladdning, och ett misslyckande inte upprepas i tysthet.
    history.replaceState(null, '', location.pathname);
  }
}

async function skapaInbjudan(client) {
  setStatus('Skapar länk …');
  els.inviteCreate.disabled = true;

  try {
    // Token sätts av databasens default, inte av klienten.
    const [ny] = await client.insert('household_invites', { household_id: household.id });
    els.inviteLink.value = `${location.origin}/?invite=${ny.token}`;
    els.inviteResult.hidden = false;
    els.inviteCopy.textContent = 'Kopiera';
    setStatus('Länken gäller i sju dagar och kan lösas in en gång.', 'ok');
  } finally {
    els.inviteCreate.disabled = false;
  }
}

/**
 * Hämtar om när fliken blir synlig igen, så att det någon annan i hushållet
 * lagt till syns utan omladdning.
 *
 * Tre spärrar, och den mellersta är den viktiga: står receptet utfällt läser
 * någon det just nu, förmodligen mitt i en deg. En omritning hade fällt ihop
 * det – och att växla till en timer och tillbaka är precis vad man gör i ett
 * kök. Färsk data är inte värd det priset.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!client || !household || öppna > 0) return;
  if (Date.now() - senasteHämtning < 15_000) return; // Fliksurfande ska inte spamma.

  fetchRecipes(client).catch((err) => setStatus(describe(err), 'error'));
});

const tagsOf = (recipe) => (recipe.recipe_tags ?? []).map((row) => row.tags).filter(Boolean);

/**
 * Kör tolkningen över alla sparade ingrediensrader.
 *
 * Går att göra om hur många gånger som helst: raw_text rörs aldrig, bara
 * mängd, enhet och not skrivs. Blir reglerna bättre trycker man bara igen.
 */
async function reparse(client) {
  const rader = allaIngredienser();
  setStatus(`Tolkar ${rader.length} ingrediensrader …`);
  els.reparse.disabled = true;

  try {
    const uppdaterade = rader.map((rad) => {
      const tolkad = parseIngredient(rad.raw_text);
      return {
        id: rad.id,
        recipe_id: rad.recipe_id,
        position: rad.position,
        raw_text: rad.raw_text,
        quantity: tolkad.quantity,
        unit: tolkad.unit,
        name: tolkad.name || null,
        note: tolkad.note,
      };
    });

    // Upsert på primärnyckeln: ett anrop i stället för ett per rad.
    await client.rest('recipe_ingredients?on_conflict=id', {
      method: 'POST',
      body: uppdaterade,
      headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
    });

    const medMängd = uppdaterade.filter((rad) => rad.quantity !== null).length;
    await fetchRecipes(client);
    setStatus(`Tolkade ${medMängd} av ${uppdaterade.length} rader. Resten saknar mängd i originalet.`, 'ok');
  } finally {
    els.reparse.disabled = false;
  }
}

const allaIngredienser = () => recipes.flatMap((recipe) => recipe.recipe_ingredients ?? []);

function renderMeta() {
  const roleName = household.role === 'owner' ? 'ägare' : 'medlem';
  els.householdMeta.textContent = recipes.length === 0
    ? `Du är ${roleName}. Inga recept ännu.`
    : `Du är ${roleName}. ${recipes.length} recept.`;

  // Otolkade rader är inte nödvändigtvis fel – "smör till formen" har ingen
  // mängd och ska inte ha någon. Knappen visas därför bara när det finns
  // rader som tolkningen skulle sätta en mängd på om den kördes.
  // Också rader som saknar vara: namnkolumnen kom med inköpslistan och är tom
  // på allt som sparades dessförinnan.
  const otolkade = allaIngredienser().filter((rad) => {
    const tolkad = parseIngredient(rad.raw_text);
    return (rad.quantity === null && tolkad.quantity !== null)
      || (!rad.name && tolkad.name);
  });

  els.reparse.hidden = otolkade.length === 0;
  els.reparse.textContent = `Tolka ${otolkade.length} ingrediensrader`;
}

function renderFilters() {
  // Bara kategorier som faktiskt används visas. En tom kategori är en knapp
  // som garanterat ger noll träffar.
  const used = new Map();
  for (const recipe of recipes) {
    for (const tag of tagsOf(recipe)) used.set(tag.id, tag.name);
  }

  // Knappen visas så fort hushållet har någon kategori alls, även om inget
  // recept använder den – en oanvänd feltavning är just det man vill bli av med.
  els.manageTags.hidden = hushålletsTags.length === 0;
  if (els.manageTags.hidden) els.tagAdmin.hidden = true;
  if (!els.tagAdmin.hidden) renderTagAdmin();

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

/**
 * Att ta bort en kategori helt ur hushållet.
 *
 * Skilt från att klicka bort den på ett recept – det gör man ofta, det här gör
 * man när man stavat fel eller ångrat en indelning. Därför en egen vy och inte
 * ett kryss på varje chip: en felklickad borttagning hade tagit bort
 * kategorin från alla recept den satt på.
 */
function renderTagAdmin() {
  const antal = new Map();
  for (const recipe of recipes) {
    for (const tag of tagsOf(recipe)) antal.set(tag.id, (antal.get(tag.id) ?? 0) + 1);
  }

  if (!hushålletsTags.length) {
    const tom = document.createElement('li');
    tom.className = 'empty';
    tom.textContent = 'Inga kategorier ännu.';
    els.tagAdmin.replaceChildren(tom);
    return;
  }

  els.tagAdmin.replaceChildren(...hushålletsTags.map((tag) => {
    const n = antal.get(tag.id) ?? 0;

    const li = document.createElement('li');

    const namn = document.createElement('span');
    namn.className = 'tag';
    namn.textContent = tag.name;

    const räkning = document.createElement('span');
    räkning.className = 'source';
    räkning.textContent = n === 0
      ? 'används inte'
      : `${n} ${n === 1 ? 'recept' : 'recept'}`;

    const bort = document.createElement('button');
    bort.type = 'button';
    bort.className = 'linkbutton';
    bort.textContent = 'Ta bort';
    bort.addEventListener('click', guard(() => taBortTag(tag, n)));

    li.append(namn, räkning, bort);
    return li;
  }));
}

async function taBortTag(tag, antal) {
  // Alltid en fråga, även för en oanvänd kategori. Borttagningen går inte att
  // ångra, och "Ta bort" sitter bredvid fyra andra rader – en felträff ska
  // inte kosta något.
  //
  // Texten säger vad som faktiskt händer: en använd kategori försvinner från
  // varje recept den satt på, vilket främmande nyckelns cascade sköter. Det är
  // inte uppenbart att en borttagning här ändrar recept man inte tittar på.
  const följd = antal > 0
    ? `Den försvinner från ${antal} recept. Recepten själva rörs inte.`
    : 'Den används inte av något recept.';

  if (!confirm(`Ta bort kategorin "${tag.name}"?\n\n${följd}`)) return;

  setStatus(`Tar bort kategorin ${tag.name} …`);
  await client.rest(`tags?id=eq.${tag.id}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });

  if (activeTag === tag.id) activeTag = null;
  await fetchRecipes(client);
  renderTagAdmin();
  setStatus(`Kategorin ${tag.name} är borttagen.`, 'ok');
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

  details.append(kategoriRad(recipe));

  const ingredients = [...(recipe.recipe_ingredients ?? [])]
    .sort((a, b) => a.position - b.position);

  if (ingredients.length) {
    const list = document.createElement('ul');
    list.className = 'ingredients';

    // Ritas om vid varje portionsändring. Bockarna nollställs på köpet, och
    // det är rätt: ändrar man antalet portioner mäter man upp på nytt.
    const rita = (faktor) => {
      list.replaceChildren(...ingredients.map(
        (item) => ingredientRow(scaleIngredient(item, faktor)),
      ));
    };

    // Väljaren kräver två saker: ett portionsantal att utgå från, och minst en
    // tolkad mängd att räkna om. Saknas det senare – receptet är sparat innan
    // tolkningen fanns – hade knapparna inte gjort någonting alls när man
    // tryckte på dem.
    const gårAttSkala = recipe.servings
      && ingredients.some((item) => item.quantity !== null && item.quantity !== undefined);

    if (gårAttSkala) details.append(portionsväljare(recipe, rita));
    rita(1);
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
 * Kategorierna, klickbara direkt i receptvyn.
 *
 * Att kunna sätta dem i efterhand är hela poängen: recept importeras ofta i en
 * hast och kategoriseras när man har lust. Att behöva mata in receptet på nytt
 * för att lägga till "middag" hade betytt att ingen gjorde det.
 */
function kategoriRad(recipe) {
  const bar = document.createElement('div');
  bar.className = 'chips tagbar';

  const rita = () => {
    const valda = new Set(tagsOf(recipe).map((tag) => normalizeTag(tag.name)));

    bar.replaceChildren(...valbara(hushålletsTags, [...valda]).map((name) => {
      const knapp = chip(name, valda.has(name), guard(() => växlaTag(recipe, name, rita)));
      knapp.classList.add('chip-liten');
      return knapp;
    }), nyKategoriFält(recipe, rita));
  };

  rita();
  return bar;
}

/** Fält för en kategori som inte finns ännu. */
function nyKategoriFält(recipe, rita) {
  const form = document.createElement('form');
  form.className = 'nytagg';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 40;
  input.autocomplete = 'off';
  input.placeholder = '+ egen';
  input.setAttribute('aria-label', `Ny kategori för ${recipe.title}`);

  form.append(input);
  form.addEventListener('submit', guard(async (event) => {
    event.preventDefault();
    const name = normalizeTag(input.value);
    if (!name) return;
    input.value = '';
    await växlaTag(recipe, name, rita, true);
  }));

  return form;
}

/**
 * Lägger till eller tar bort en kategori på receptet.
 *
 * Ritar bara om kategoriraden och filtren, inte hela listan. En omritning hade
 * fällt ihop receptet man just satt och läser – samma skäl som att omhämtningen
 * vid flikbyte avstår när något är utfällt.
 */
async function växlaTag(recipe, name, rita, baraLäggTill = false) {
  const nuvarande = tagsOf(recipe);
  const träff = nuvarande.find((tag) => normalizeTag(tag.name) === name);

  if (träff && !baraLäggTill) {
    await client.rest(
      `recipe_tags?recipe_id=eq.${recipe.id}&tag_id=eq.${träff.id}`,
      { method: 'DELETE', headers: { prefer: 'return=minimal' } },
    );
    recipe.recipe_tags = (recipe.recipe_tags ?? [])
      .filter((rad) => rad.tags?.id !== träff.id);
  } else if (!träff) {
    const [tag] = await upsertTags(client, household.id, [name]);
    if (!tag) return;

    await client.rest('recipe_tags?on_conflict=recipe_id,tag_id', {
      method: 'POST',
      body: { recipe_id: recipe.id, tag_id: tag.id },
      headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
    });

    recipe.recipe_tags = [...(recipe.recipe_tags ?? []), { tags: tag }];
    if (!hushålletsTags.some((t) => t.id === tag.id)) hushålletsTags.push(tag);
  }

  saveRecipes(recipes, household.id);
  rita();
  renderFilters();
}

/**
 * Färre eller fler portioner. Ändrar bara ingrediensmängderna – tillagningstid
 * och ugnstemperatur står kvar, för de följer inte portionsantalet. Det står
 * utskrivet i stället för att tigas ihjäl.
 */
function portionsväljare(recipe, rita) {
  const rad = document.createElement('p');
  rad.className = 'portions';

  let antal = recipe.servings;

  const visa = document.createElement('span');
  visa.className = 'portions-antal';

  const knapp = (tecken, steg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stepper';
    b.textContent = tecken;
    b.setAttribute('aria-label', steg < 0 ? 'Färre portioner' : 'Fler portioner');
    b.addEventListener('click', () => {
      antal = Math.min(99, Math.max(1, antal + steg));
      uppdatera();
    });
    return b;
  };

  function uppdatera() {
    visa.textContent = `${antal} portioner`;
    rad.dataset.skalad = antal === recipe.servings ? 'false' : 'true';
    rita(scaleFactor(recipe.servings, antal));
  }

  const etikett = document.createElement('span');
  etikett.className = 'source';
  etikett.textContent = 'Mängderna skalas – tiden och ugnsvärmen gör det inte.';

  rad.append(knapp('−', -1), visa, knapp('+', 1), etikett);
  uppdatera();
  return rad;
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
