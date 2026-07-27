// Översätter ett schema.org-recept till receptbokens form.
//
// Sajterna följer standarden ungefär, inte exakt. Samma fält kommer som sträng,
// array eller objekt beroende på vem som publicerat det, och den här filen
// finns för att anroparen ska slippa veta vilket. Allt som inte går att tolka
// blir null – aldrig en gissning, aldrig ett kastat fel. Ett halvtolkat recept
// är värre än inget, för användaren kan fylla i själv men inte upptäcka att
// mängden blivit fel.
//
// Håll filen fri från Node-API:er. Den körs av node --test och av
// Cloudflare Pages Functions, som kör på Workers.

import { extractAllJsonLd, hasType } from './ldjson.mjs';

/**
 * Plockar receptet ur en hämtad sida.
 * @returns {object|null} null när sidan inte publicerar något recept alls
 */
export function recipeFromHtml(html, { sourceUrl } = {}) {
  const nodes = extractAllJsonLd(html);
  const node = nodes.find((entry) => hasType(entry, 'Recipe'));
  if (!node) return null;

  const recipe = toRecipe(node, { sourceUrl });
  // Sajtens namn står sällan på receptet självt utan på en syskonnod – en
  // WebSite eller Organization i samma ld+json. Det är därifrån "ICA" eller
  // "Köket.se" kommer när receptet inte anger någon publisher.
  if (recipe && !recipe.source_name) recipe.source_name = siteName(nodes);
  return recipe;
}

function siteName(nodes) {
  for (const type of ['WebSite', 'Organization']) {
    const found = nodes.find((entry) => hasType(entry, type));
    const name = clean(first(found?.name));
    if (name) return name;
  }
  return null;
}

/** Ett schema.org-Recipe till våra kolumner. */
export function toRecipe(node, { sourceUrl } = {}) {
  const title = clean(first(node?.name));
  if (!title) return null; // Utan titel är det inget recept, oavsett vad @type säger.

  return {
    title,
    source_url: sourceUrl ?? clean(first(node.url)) ?? null,
    source_name: publisherName(node),
    image_url: imageUrl(node.image),
    servings: parseServings(node.recipeYield),
    total_time_min: parseDuration(node.totalTime) ?? parseDuration(node.cookTime),
    instructions: instructionSteps(node.recipeInstructions),
    ingredients: toArray(node.recipeIngredient).map(clean).filter(Boolean),
    // Originalet sparas alltid, oförändrat. Tolkningen här ovanför kan
    // förbättras i efterhand utan att något behöver importeras om, och när den
    // har fel finns facit kvar att jämföra med.
    source_ldjson: node,
  };
}

/**
 * "PT1H30M" → 90. ISO 8601-varaktighet, som är det enda formatet standarden
 * tillåter men långt ifrån det enda sajter skickar.
 */
export function parseDuration(value) {
  const text = first(value);
  if (typeof text === 'number' && Number.isFinite(text)) return Math.round(text);
  const match = /^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?)/i.exec(String(text ?? '').trim());
  if (!match) return null;

  const [, days, hours, minutes] = match.map((m) => (m === undefined ? 0 : Number(m)));
  const total = days * 1440 + hours * 60 + minutes;
  return total > 0 ? Math.round(total) : null;
}

/** "4 portioner" → 4. Även "4-6 portioner" → 4: hellre för lite än för mycket mat. */
export function parseServings(value) {
  const raw = first(value);
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const match = /\d+/.exec(String(raw ?? ''));
  if (!match) return null;
  const n = Number(match[0]);
  return n > 0 && n < 1000 ? n : null;
}

/**
 * Instruktionerna är fältet som varierar mest: en textklump, en lista strängar,
 * HowToStep-objekt, eller HowToSection med stegen inuti. Alla plattas till en
 * lista med steg i den ordning de ska utföras.
 */
export function instructionSteps(value) {
  const out = [];

  const walk = (item) => {
    if (item == null) return;
    if (Array.isArray(item)) {
      for (const entry of item) walk(entry);
      return;
    }
    if (typeof item === 'object') {
      // HowToSection samlar steg under itemListElement; själva rubriken
      // slängs, eftersom vi ännu inte har någon plats att visa den på.
      if (item.itemListElement) return walk(item.itemListElement);
      return walk(item.text ?? item.name);
    }

    // En ensam textklump blir ofta flera steg åtskilda av radbrytningar.
    for (const line of String(item).split(/\r?\n+/)) {
      const step = clean(line);
      if (step) out.push(step);
    }
  };

  walk(value);
  return out;
}

/** Bilden kommer som sträng, ImageObject eller en lista av båda. */
export function imageUrl(value) {
  const item = first(value);
  if (!item) return null;
  const url = typeof item === 'object' ? first(item.url ?? item.contentUrl) : item;
  const text = clean(url);
  return text && /^https?:\/\//i.test(text) ? text : null;
}

function publisherName(node) {
  for (const candidate of [node.publisher, node.author, node.sourceOrganization]) {
    const item = first(candidate);
    if (!item) continue;
    const name = clean(typeof item === 'object' ? first(item.name) : item);
    if (name) return name;
  }
  return null;
}

// Entiteter som faktiskt dyker upp i recept. Bråken är inte kuriosa – "½ dl"
// är vanligare än "0,5 dl" och måste överleva importen intakt. De typografiska
// citattecknen finns med för engelska sajter, som skriver don&rsquo;t; utan dem
// hamnar entiteten oöversatt mitt i en instruktion.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  auml: 'ä', ouml: 'ö', aring: 'å', Auml: 'Ä', Ouml: 'Ö', Aring: 'Å',
  eacute: 'é', Eacute: 'É', uuml: 'ü', Uuml: 'Ü', szlig: 'ß',
  aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø',
  ndash: '–', mdash: '—', hellip: '…', deg: '°',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾',
  frac13: '⅓', frac23: '⅔', frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
};

/**
 * Avkodar HTML-entiteter i ett svep. Ett svep och inte flera: annars blir
 * "&amp;auml;" – som betyder texten "&auml;" – felaktigt till "ä".
 */
export function decodeEntities(text) {
  return String(text).replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    // Exakt träff först: &Auml; och &auml; är olika tecken. Gemenerna som
    // fallback fångar skrivsätt som &AMP; och &NBSP;.
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Städar fritext: taggar bort, entiteter tillbaka till tecken, blanksteg
 * ihopdragna. Sajter lägger HTML i ld+json trots att de inte får.
 *
 * Taggarna tas bort före avkodningen, så att ett skrivet "&lt;b&gt;" överlever
 * som texten "<b>" i stället för att bli en tagg som städas bort.
 */
export function clean(value) {
  if (value == null) return null;
  const text = decodeEntities(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Första värdet, oavsett om fältet var en array eller ett ensamt värde. */
function first(value) {
  return Array.isArray(value) ? value[0] : value;
}
