// Slår ihop veckans recept till en inköpslista.
//
// Svårare än tolkningen, och av ett skäl som är värt att skriva ut: 2 dl och
// 1 dl går att addera, men 2 dl grädde och 1 paket grädde gör det inte. Ett
// paket är inte ett mått. Regeln är därför att bara addera när enheterna är
// identiska eller går att räkna om exakt – resten blir egna rader.
//
// Hellre två rader grädde än en felaktig summa. En summa som ser rimlig ut men
// är fel upptäcker man i butiken, och då är det för sent.

/**
 * Enheter som mäter samma sak och går att räkna om exakt. Nyckeln är basenhet
 * per familj: milliliter respektive gram.
 *
 * Svenska mått är definierade i milliliter – krm är 1, tsk 5, msk 15 – så
 * omräkningen är exakt och inte en uppskattning.
 */
const VOLYM = { ml: 1, krm: 1, tsk: 5, msk: 15, cl: 10, dl: 100, l: 1000 };
const VIKT = { g: 1, hg: 100, kg: 1000 };

// Vad summan skrivs i. Största enheten där talet blir minst 1, så att 2500 ml
// blir 2,5 l och inte 2500 ml.
const VOLYMSTEGE = [['l', 1000], ['dl', 100], ['msk', 15], ['tsk', 5], ['ml', 1]];
const VIKTSTEGE = [['kg', 1000], ['g', 1]];

function familj(unit) {
  if (unit && VOLYM[unit] !== undefined) return { bas: VOLYM[unit], stege: VOLYMSTEGE, namn: 'volym' };
  if (unit && VIKT[unit] !== undefined) return { bas: VIKT[unit], stege: VIKTSTEGE, namn: 'vikt' };
  // st, förp, burk, klyfta, cup, lb … går bara ihop med exakt sig själva.
  return null;
}

/**
 * Nyckeln avgör vad som får slås ihop. Samma nyckel, samma rad.
 *
 * Exporterad för att anroparen ska kunna peka ut en rad utan att gissa hur
 * grupperingen fungerar – "2 dl grädde" och "2 msk grädde" hamnar i samma
 * grupp, och en nyckel byggd på råa enheter hade missat det.
 */
export function groupKey(name, unit) {
  const vara = normalizeName(name);
  const grupp = familj(unit)?.namn ?? `=${unit ?? ''}`;
  return `${vara}|${grupp}`;
}

/** "Vispgrädde" och "vispgrädde " är samma vara. Mer än så gissar vi inte. */
export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {Array<{recipe: object, servings: number|null}>} poster veckans rätter
 * @param {Array<{name, quantity, unit}>} egna rader man lagt till för hand
 * @param {Set<string>} dolda gruppnycklar vars planbidrag ska hoppas över
 * @returns {Array<{name, quantity, unit, approximate, manuellt, recipes: string[]}>}
 */
export function buildShoppingList(poster, egna = [], dolda = new Set()) {
  const grupper = new Map();

  // Handtillagda rader går genom samma sammanslagning som planens. Att stå med
  // två mjölkrader för att den ena kom från en knapp och den andra från en
  // veckoplan är precis den sortens fel som får en att sluta lita på listan.
  for (const rad of egna ?? []) {
    if (!normalizeName(rad?.name)) continue;
    const grupp = hämtaGrupp(grupper, rad.name, rad.unit);
    grupp.manuellt = true;
    if (rad.quantity !== null && rad.quantity !== undefined) {
      const f = familj(rad.unit);
      grupp.summa = (grupp.summa ?? 0) + rad.quantity * (f ? f.bas : 1);
    }
  }

  for (const post of poster ?? []) {
    const recipe = post?.recipe;
    if (!recipe) continue;

    // Skalning är inte linjär – kryddor och tillagningstid följer inte antalet
    // portioner. Mängderna skalas ändå, men raden flaggas som ungefärlig så
    // att det syns i listan i stället för att tigas ihjäl.
    const faktor = skalfaktor(recipe.servings, post.servings);

    for (const rad of recipe.recipe_ingredients ?? []) {
      const name = rad.name ?? rad.raw_text;
      if (!normalizeName(name)) continue;

      // Bortplockat gäller bara det planen bidrar med. En handtillagd rad med
      // samma nyckel står kvar – det är så en ändrad rad ersätter den uträknade
      // i stället för att adderas till den.
      if (dolda.has(groupKey(name, rad.unit))) continue;

      const grupp = hämtaGrupp(grupper, name, rad.unit);
      grupp.recipes.add(recipe.title);

      if (rad.quantity !== null && rad.quantity !== undefined) {
        const f = familj(rad.unit);
        const bidrag = rad.quantity * faktor * (f ? f.bas : 1);
        grupp.summa = (grupp.summa ?? 0) + bidrag;
        if (faktor !== 1) grupp.approximate = true;
      }
    }
  }

  return [...grupper.values()]
    .map(skrivUt)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

/** Samma nyckel oavsett varifrån raden kom – det är hela poängen. */
function hämtaGrupp(grupper, name, unit) {
  const k = groupKey(name, unit);
  if (!grupper.has(k)) {
    grupper.set(k, {
      name: String(name).trim(),
      unit: unit ?? null,
      summa: null,
      approximate: false,
      manuellt: false,
      recipes: new Set(),
    });
  }
  return grupper.get(k);
}

function skalfaktor(receptets, planerade) {
  if (!receptets || !planerade) return 1; // Saknas uppgift skalar vi inte.
  const faktor = planerade / receptets;
  return Number.isFinite(faktor) && faktor > 0 ? faktor : 1;
}

function skrivUt(grupp) {
  const gemensamt = {
    name: grupp.name,
    approximate: grupp.approximate,
    manuellt: grupp.manuellt,
    recipes: [...grupp.recipes],
  };

  // Rader utan mängd behåller sin brist. "Salt" står kvar som "salt".
  if (grupp.summa === null) return { ...gemensamt, quantity: null, unit: grupp.unit };

  const f = familj(grupp.unit);
  if (!f) return { ...gemensamt, quantity: round(grupp.summa), unit: grupp.unit };

  const [unit, storlek] = f.stege.find(([, s]) => grupp.summa >= s) ?? f.stege.at(-1);
  return { ...gemensamt, quantity: round(grupp.summa / storlek), unit };
}

/** Två decimaler räcker. Ingen mäter upp 1,333 dl. */
const round = (n) => Math.round(n * 100) / 100;

/** "2 dl grädde", "salt" – raden som den ska stå i listan. */
export function formatItem(item) {
  const mängd = item.quantity === null
    ? ''
    : `${String(item.quantity).replace('.', ',')}${item.unit ? ` ${item.unit}` : ''} `;
  return `${mängd}${item.name}`.trim();
}

/**
 * Gruppnycklarna veckoplanen bidrar med just nu.
 *
 * Skiljer det som går att radera från det som bara går att plocka bort. En
 * mängd som räknas fram ur planen kommer tillbaka nästa gång listan visas, hur
 * många rader man än raderar – det enda sättet att säga att den är handlad är
 * att plocka bort den.
 *
 * Samma sammanslagning som listan själv gör. Räknade de två olika hade de
 * svarat olika på samma fråga.
 *
 * @param {Array<{recipe: object, servings: number|null}>} poster veckans rätter
 * @returns {Set<string>}
 */
export function planGroups(poster) {
  return new Set(buildShoppingList(poster).map((post) => groupKey(post.name, post.unit)));
}

/**
 * Skriver det addToList räknat fram.
 *
 * Ordningen är inte fri: det gamla måste bort före det nya. Tvärtom hade
 * raderingen tagit den rad skrivningen just uppdaterat, och varan försvunnit ur
 * listan i stället för att stå där med sin nya mängd. Därför bor den här och
 * inte hos varje knapp som lägger något i listan.
 *
 * Varje rad skrivs med samma fält, även de som bara gäller märken. PostgREST
 * skriver flera rader som en enda insert och vägrar med "All object keys must
 * match" om objekten inte ser likadana ut – och en vara och ett bortplock i
 * samma skrivning gjorde inte det.
 */
export async function applyToList(client, householdId, { remove, write, markers }) {
  if (remove.length) {
    await client.rest(`shopping_list_items?id=in.(${remove.join(',')})`, {
      method: 'DELETE',
      headers: { prefer: 'return=minimal' },
    });
  }

  const rader = [...write, ...markers];
  if (!rader.length) return;

  await client.rest('shopping_list_items?on_conflict=household_id,name,unit,source', {
    method: 'POST',
    body: rader.map((rad) => ({
      household_id: householdId,
      name: rad.name,
      unit: rad.unit,
      quantity: rad.quantity,
      checked: rad.checked ?? false,
      hidden: rad.hidden ?? false,
      source: rad.source,
    })),
    headers: { prefer: 'return=minimal,resolution=merge-duplicates' },
  });
}

/**
 * Bock- och bortplocksmärkena, slagna ihop per vara.
 *
 * Nyckeln är gruppnyckeln och inte enheten rakt av. Listan skriver summan i den
 * enhet som blir läsligast, så raden man bockade av som "2 dl mjölk" kan stå
 * som "1,2 l mjölk" när veckan ser annorlunda ut – och bocken hör till varan,
 * inte till hur mängden råkade skrivas den dagen.
 *
 * Flera märken på samma vara slås ihop i stället för att det sist lästa får
 * gälla. Så länge det gick att skriva två rader för samma vara hann sådana par
 * uppstå, och de ligger kvar i tabellen. Ett märke som ibland syns och ibland
 * inte är värre än ett som står kvar en omgång för länge.
 *
 * @param {Array<{name, unit, source, checked, hidden}>} sparade tabellens rader
 * @returns {Map<string, {checked: boolean, hidden: boolean}>}
 */
export function collectMarkers(sparade) {
  const märken = new Map();

  for (const rad of sparade ?? []) {
    if (rad?.source !== 'plan') continue;

    const nyckel = groupKey(rad.name, rad.unit);
    const förra = märken.get(nyckel);
    märken.set(nyckel, {
      checked: Boolean(rad.checked) || Boolean(förra?.checked),
      hidden: Boolean(rad.hidden) || Boolean(förra?.hidden),
    });
  }

  return märken;
}

/**
 * Vad som ska skrivas när man lägger varor i listan för hand.
 *
 * Svårare än ett insert, av tre skäl. Det handtillagda ligger som en rad per
 * vara och enhet, så en påfyllning måste summeras ihop med det som redan står
 * där. Det som är avbockat är redan handlat och hemburet, och då börjar en ny
 * omgång om från noll i stället för att lägga sig ovanpå. Och summeringen får
 * bara ske där skrivningen faktiskt träffar den gamla raden – räknar man ihop
 * mängder som sedan hamnar på två olika rader har man dubblat dem.
 *
 * Det handlade går inte alltid att radera. Kommer mängden ur veckoplanen räknas
 * den fram på nytt vid varje visning, och en bock som bara tas bort betyder att
 * varan blir ohandlad igen. Därför byts den mot ett bortplock: planens bidrag
 * är fullgjort, och det som ska handlas är det man just lade i. Det kräver att
 * anroparen säger vilka varor planen faktiskt bidrar med – att gissa på det
 * hade tyst räknat bort en vara som en annan rätt i veckan också behöver.
 *
 * @param {Array<{name, quantity, unit}>} nya raderna man vill lägga i
 * @param {Array<{id, name, unit, quantity, source, checked, hidden}>} sparade tabellens rader
 * @param {Set<string>} planensVaror gruppnycklar veckoplanen bidrar med just nu
 * @returns {{remove: string[], write: Array<object>, markers: Array<object>}}
 */
export function addToList(nya, sparade = [], planensVaror = new Set()) {
  const rader = slåIhopValda(nya);
  const berörda = new Set(rader.map((rad) => groupKey(rad.name, rad.unit)));

  // Avbockat betyder handlat. Att summera ovanpå det hade skickat en tillbaka
  // till butiken efter samma två deciliter mjölk en gång till.
  const handlat = new Set(
    (sparade ?? [])
      .filter((rad) => rad.source === 'plan' && rad.checked)
      .map((rad) => groupKey(rad.name, rad.unit))
      .filter((nyckel) => berörda.has(nyckel)),
  );

  const remove = [];
  const gamla = new Map();

  for (const rad of sparade ?? []) {
    const nyckel = groupKey(rad.name, rad.unit);
    if (!berörda.has(nyckel)) continue;

    // Bortplocket står kvar. Det säger att planens mängd inte ska räknas, och
    // det gäller fortfarande – annars kom det man plockat bort tillbaka
    // bakvägen, med den nya raden ovanpå. Att raden ändå syns beror på att
    // bortplock bara gäller planens bidrag, aldrig det man lagt till själv.
    if (rad.source === 'plan') {
      if (handlat.has(nyckel)) remove.push(rad.id);
    } else if (handlat.has(nyckel)) remove.push(rad.id);
    else if (skrivnyckel(rad)) gamla.set(skrivnyckel(rad), rad);
  }

  const write = rader.map((rad) => ({
    name: rad.name,
    unit: rad.unit,
    quantity: summera(gamla.get(skrivnyckel(rad))?.quantity, rad.quantity),
    source: 'manual',
  }));

  const markers = rader
    .filter((rad) => {
      const nyckel = groupKey(rad.name, rad.unit);
      return handlat.has(nyckel) && planensVaror.has(nyckel);
    })
    .map((rad) => ({
      name: rad.name,
      unit: rad.unit,
      quantity: null,
      checked: false,
      hidden: true,
      source: 'plan',
    }));

  return { remove, write, markers };
}

/**
 * Nyckeln som skrivningen krockar på: namn och enhet, precis som tabellens
 * unika villkor.
 *
 * Namnet jämförs tecken för tecken – databasen bryr sig om skiftläget även om
 * listan inte gör det – och en rad utan enhet får ingen nyckel alls. Postgres
 * räknar två okända enheter som olika värden, så en sådan rad krockar aldrig
 * med något: den blir en rad till i tabellen, och listan summerar ihop dem ändå.
 */
const skrivnyckel = (rad) => (rad.unit === null || rad.unit === undefined
  ? null
  : `${rad.name}|${rad.unit}`);

/**
 * Slår ihop dubbletter inom det man just valt.
 *
 * Ett recept tar mycket väl smör två gånger, en gång till såsen och en gång
 * till stekningen. Två rader med samma nyckel i samma skrivning får Postgres
 * att vägra hela anropet, och då hade ingenting alls hamnat i listan.
 */
function slåIhopValda(nya) {
  const summor = new Map();

  for (const rad of nya ?? []) {
    const name = String(rad?.name ?? '').trim();
    if (!name) continue;

    const unit = rad.unit ?? null;
    const nyckel = `${name}|${unit ?? ''}`;
    const gammal = summor.get(nyckel);
    if (gammal) gammal.quantity = summera(gammal.quantity, rad.quantity);
    else summor.set(nyckel, { name, unit, quantity: rad.quantity ?? null });
  }

  return [...summor.values()];
}

/** null plus null är null. "Salt" utan mängd blir inte 0 av att läggas i igen. */
function summera(a, b) {
  const tomt = (v) => v === null || v === undefined;
  if (tomt(a) && tomt(b)) return null;
  // Tre decimaler, samma noggrannhet som portionsskalningen. Utan avrundningen
  // blir 0,1 + 0,2 något med sexton decimaler, och det står i listan.
  return Math.round((Number(a ?? 0) + Number(b ?? 0)) * 1000) / 1000;
}
