// Ingredienstolkning: "2 dl vispgrädde" → { quantity: 2, unit: 'dl', name: 'vispgrädde' }
//
// Rena funktioner, inga beroenden, tungt testade. raw_text skrivs aldrig över –
// den här tolkningen läggs bredvid och kan köras om hur många gånger som helst
// när reglerna blir bättre. Det var hela poängen med den kolumnen.
//
// Går något inte att tolka blir det null, aldrig en gissning. En felaktig
// mängd är värre än ingen mängd: den syns inte, och den följer med hela vägen
// till inköpslistan.
//
// Ligger i public/ och inte lib/ eftersom tolkningen sker i webbläsaren när
// receptet sparas. Filen rör inga globaler och går att köra under node --test.

const BRÅK = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/**
 * Enheter och deras skrivsätt. Nyckeln är den form vi lagrar, så att
 * "matsked", "msk" och "Msk" blir samma sak och därmed går att slå ihop i
 * fas 5:s inköpslista.
 *
 * De engelska finns med för recept som matats in för hand utan att översättas.
 * De räknas inte om här – en cup förblir en cup, och fas 5 slår bara ihop
 * rader med identisk enhet.
 */
const ENHETER = {
  dl: ['dl', 'deciliter'],
  l: ['l', 'liter'],
  cl: ['cl', 'centiliter'],
  ml: ['ml', 'milliliter'],
  msk: ['msk', 'matsked', 'matskedar'],
  tsk: ['tsk', 'tesked', 'teskedar'],
  krm: ['krm', 'kryddmått'],
  g: ['g', 'gram'],
  hg: ['hg', 'hekto', 'hektogram'],
  kg: ['kg', 'kilo', 'kilogram'],
  st: ['st', 'stycken', 'styck'],
  klyfta: ['klyfta', 'klyftor'],
  förp: ['förp', 'förpackning', 'förpackningar', 'paket', 'pkt'],
  påse: ['påse', 'påsar'],
  burk: ['burk', 'burkar'],
  knippe: ['knippe', 'knippen'],
  näve: ['näve', 'nävar'],
  nypa: ['nypa', 'nypor'],
  skiva: ['skiva', 'skivor'],
  cup: ['cup', 'cups'],
  tbsp: ['tbsp', 'tablespoon', 'tablespoons'],
  tsp: ['tsp', 'teaspoon', 'teaspoons'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
};

const ENHET_UPPSLAG = new Map();
for (const [normal, former] of Object.entries(ENHETER)) {
  for (const form of former) ENHET_UPPSLAG.set(form, normal);
}

// "ca 2 dl" – ungefärligheten säger inget om mängden och slängs.
const UNGEFÄR = /^(ca|cirka|ungefär|drygt|knappt|runt|omkring)\b\.?\s*/i;

// Fraser som beskriver hur mycket utan att vara en mängd. De hör till noten.
const EFTER_SMAK = /\b(efter smak|efter behov|till servering|till garnering|att garnera|till stekning|till pensling|till formen)\b/i;

/**
 * @param {string} raw
 * @returns {{raw: string, quantity: number|null, unit: string|null, name: string, note: string|null}}
 */
export function parseIngredient(raw) {
  const original = String(raw ?? '').trim();
  if (!original) return { raw: original, quantity: null, unit: null, name: '', note: null };

  let { text, note } = splitNote(original);
  text = text.replace(UNGEFÄR, '');

  const mängd = takeQuantity(text);
  const enhet = takeUnit(mängd.rest);

  let name = enhet.rest.trim().replace(/^(av|med)\s+/i, '').trim();
  let quantity = mängd.quantity;
  let unit = enhet.unit;

  // "3 ägg" är tre stycken ägg. Ett tal utan enhet i ett recept betyder antal,
  // och att lämna enheten tom hade gjort raden osammanslagbar i fas 5.
  if (quantity !== null && unit === null && name) unit = 'st';

  // "salt" utan mängd är inte "1 salt". Hellre ingen uppgift än en påhittad.
  if (!name && enhet.unit) {
    name = enhet.unit;
    unit = null;
    quantity = null;
  }

  return { raw: original, quantity, unit, name, note };
}

/** Tolkar en hel lista och behåller ordningen. */
export const parseIngredients = (rader) =>
  (rader ?? []).map((rad) => parseIngredient(typeof rad === 'string' ? rad : rad?.raw_text));

/**
 * Noten är allt efter första kommatecknet, plus parenteser och
 * "efter smak"-fraser. Det är där tillredningen står – "finhackad", "smält",
 * "gärna ekologisk" – och den hör inte till varan man köper.
 */
function splitNote(text) {
  const delar = [];
  let kvar = text;

  kvar = kvar.replace(/\(([^)]*)\)/g, (_, inne) => {
    delar.push(inne.trim());
    return ' ';
  });

  // Kommatecken mellan siffror är decimaltecken, inte notseparator: "0,5 dl"
  // är en halv deciliter, inte noll deciliter med noten "5 dl".
  const komma = kvar.search(/,(?!\d)/);
  if (komma !== -1) {
    delar.push(kvar.slice(komma + 1).trim());
    kvar = kvar.slice(0, komma);
  }

  // Frasen flyttas till noten bara om något blir kvar. "Till servering" är en
  // rubrik mitt i ingredienslistan, inte en ingrediens med en anteckning – och
  // en rad ska aldrig kunna äta upp sig själv och försvinna.
  const smak = EFTER_SMAK.exec(kvar);
  if (smak && kvar.replace(EFTER_SMAK, ' ').trim()) {
    delar.push(smak[0].trim());
    kvar = kvar.replace(EFTER_SMAK, ' ');
  }

  const note = delar.map((d) => d.trim()).filter(Boolean).join(', ');
  return { text: kvar.replace(/\s+/g, ' ').trim(), note: note || null };
}

const TAL = '\\d+(?:[.,]\\d+)?';
const BRÅKTECKEN = Object.keys(BRÅK).join('');

// "2", "2,5", "1/2", "2 1/2", "½", "2½", "2-3", "2–3 dl"
const MÄNGD = new RegExp(
  `^\\s*(${TAL}\\s*\\/\\s*${TAL}|${TAL}\\s*[${BRÅKTECKEN}]|${TAL}\\s+${TAL}\\s*\\/\\s*${TAL}|[${BRÅKTECKEN}]|${TAL})`
  + `(?:\\s*[-–—]\\s*(${TAL}\\s*\\/\\s*${TAL}|[${BRÅKTECKEN}]|${TAL}))?`,
);

function takeQuantity(text) {
  const träff = MÄNGD.exec(text);
  if (!träff) return { quantity: null, rest: text };

  const quantity = toNumber(träff[1]);
  if (quantity === null) return { quantity: null, rest: text };

  // Intervall tar det lägre talet. Man kan alltid hälla i mer; det motsatta
  // felet står man med i grytan.
  return { quantity, rest: text.slice(träff[0].length) };
}

function toNumber(text) {
  const rent = String(text).trim();

  // "2 1/2" och "2½" – heltal plus bråk.
  const blandat = new RegExp(`^(${TAL})\\s*(?:(${TAL})\\s*\\/\\s*(${TAL})|([${BRÅKTECKEN}]))$`).exec(rent);
  if (blandat) {
    const heltal = Number(blandat[1].replace(',', '.'));
    const del = blandat[4] ? BRÅK[blandat[4]] : Number(blandat[2]) / Number(blandat[3]);
    return round(heltal + del);
  }

  const bråk = new RegExp(`^(${TAL})\\s*\\/\\s*(${TAL})$`).exec(rent);
  if (bråk) {
    const nämnare = Number(bråk[2].replace(',', '.'));
    if (!nämnare) return null;
    return round(Number(bråk[1].replace(',', '.')) / nämnare);
  }

  if (BRÅK[rent] !== undefined) return round(BRÅK[rent]);

  const tal = Number(rent.replace(',', '.'));
  return Number.isFinite(tal) ? round(tal) : null;
}

/** Tre decimaler räcker: 1/3 blir 0,333 och ingen mäter noggrannare. */
const round = (n) => Math.round(n * 1000) / 1000;

function takeUnit(text) {
  const träff = /^\s*([\p{L}]+)\.?\b/u.exec(text);
  if (!träff) return { unit: null, rest: text };

  const normal = ENHET_UPPSLAG.get(träff[1].toLowerCase());
  if (!normal) return { unit: null, rest: text };

  return { unit: normal, rest: text.slice(träff[0].length) };
}
