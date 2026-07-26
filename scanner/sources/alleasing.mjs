// Adapter för alleasing.se – jämförelsesajt som aggregerar ~10 000 erbjudanden
// från 17 återförsäljare. Vald som första källa i docs/datakallor.md (volym).
//
// Hämtningsväg: sajten är Next.js **App Router**, inte Pages Router. Det finns
// alltså inget `__NEXT_DATA__` och ingen `/_next/data/<buildId>/….json` –
// kartläggningens hypotes stämde inte. I stället ligger ett komplett `car`-objekt
// i RSC-flight-payloaden (`self.__next_f.push([1,"…"])`). Det är bättre än en
// buildId-URL: inget versionsnummer som ändras vid varje deploy hos dem.
//
// Fallback: <script type="application/ld+json"> med @type Product ger pris,
// märke, modell och skick. Räcker inte för löptid/körsträcka, men räddar raden
// från att försvinna helt om flight-formatet ändras.

import { fetchText, isAllowedByRobots, sleep } from '../lib/http.mjs';
import { effectiveMonthly } from '../lib/pricing.mjs';

const ORIGIN = 'https://www.alleasing.se';
const SITEMAP_INDEX = `${ORIGIN}/sitemap.xml`;

// Källan uppdaterar 4 ggr/dygn och vi kör var 6:e timme. En full svep över
// ~10 000 sidor tar längre tid än workflow-timeouten på 30 minuter, så varje
// körning tar ett fönster och nästa fortsätter där den slutade.
const DEFAULT_MAX_OFFERS = 400;
const DEFAULT_DELAY_MS = 1500;
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

const BUSINESS_TERMS = /f[öo]retagsleasing|exkl\.?\s*moms|ex\.?\s*moms|exklusive\s+moms/i;

export default {
  id: 'alleasing',
  label: 'Alleasing.se',
  enabled: true,
  segment: 'privat',

  async fetchListings({
    log = console.log,
    maxOffers = Number(process.env.ALLEASING_MAX_OFFERS) || DEFAULT_MAX_OFFERS,
    delayMs = Number(process.env.ALLEASING_DELAY_MS) || DEFAULT_DELAY_MS,
    now = Date.now(),
  } = {}) {
    if (!(await isAllowedByRobots(`${ORIGIN}/erbjudande/`))) {
      throw new Error('robots.txt tillåter inte hämtning av /erbjudande/');
    }

    const urls = await collectOfferUrls({ log });
    if (!urls.length) throw new Error('sitemap gav inga erbjudande-URL:er – formatet kan ha ändrats');

    const window = selectWindow(urls, { maxOffers, runIndex: Math.floor(now / RUN_INTERVAL_MS) });
    log(`  ${urls.length} erbjudanden i sitemap, hämtar ${window.length} i den här körningen`);

    const out = [];
    let failures = 0;
    let fallbacks = 0;
    for (const [i, url] of window.entries()) {
      if (i > 0) await sleep(delayMs);
      try {
        const html = await fetchText(url);
        const rows = offerToRawListings(html, url);
        if (!rows.length) failures += 1;
        else if (rows[0].raw?.via === 'ld+json') fallbacks += 1;
        out.push(...rows);
      } catch (err) {
        failures += 1;
        // En enskild sida som fallerar är väntat (annonsen kan vara borttagen
        // mellan sitemap och hämtning). Först när nästan allt fallerar är det
        // ett formatbyte, och då ska källan larma i stället för att tyst ge 0.
        if (failures <= 5) log(`  hoppar över ${url}: ${err.message}`);
      }
    }

    if (failures > window.length * 0.5) {
      throw new Error(`${failures} av ${window.length} sidor gick inte att tolka – formatet har troligen ändrats`);
    }

    const parsed = window.length - failures;
    log(`  ${out.length} rader från ${parsed} sidor`);

    // Fallbacken räddar raden men tappar löptid och körsträcka. Utan den här
    // raden syns det bara som att kvoten rader/sidor närmar sig 1,0 – en
    // formatändring skulle alltså se ut som en lyckad körning.
    if (fallbacks > 0) {
      const andel = Math.round((fallbacks / parsed) * 100);
      log(`  VARNING: ${fallbacks} av ${parsed} sidor (${andel} %) lästes via ld+json-fallbacken`);
      log('           De raderna saknar löptid och körsträcka. Vid höga tal:'
        + ' kontrollera om flight-formatet ändrats (se scanner/sources/alleasing.mjs).');
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

/** Alla <loc>-värden i en sitemap eller ett sitemapindex. */
export function parseSitemapUrls(xml) {
  return [...String(xml ?? '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

async function collectOfferUrls({ log }) {
  const index = parseSitemapUrls(await fetchText(SITEMAP_INDEX));
  // Indexet innehåller ~587 filer, men bara offers-*.xml är erbjudanden.
  // Resten (0-0.xml, 1-0.xml, …) är filtersidor som /fwd och /awd.
  const offerMaps = index.filter((u) => /\/sitemap\/offers-\d+\.xml$/.test(u));
  if (!offerMaps.length) throw new Error('inga offers-*.xml i sitemapindexet');

  const urls = [];
  for (const map of offerMaps) {
    await sleep(500);
    const found = parseSitemapUrls(await fetchText(map)).filter((u) => u.includes('/erbjudande/'));
    urls.push(...found);
  }
  log?.(`  ${offerMaps.length} sitemapfiler`);
  return spreadOrder([...new Set(urls)]);
}

/**
 * Stabil men märkesblandad ordning.
 *
 * Sitemapen är alfabetisk, så ett sammanhängande fönster ur den innehåller
 * en enda modell – en körning skulle skanna 400 MINI Aceman och inte röra
 * resten på flera dygn. Sorterar vi i stället på en hash av URL:en blir
 * ordningen densamma varje körning (fönstren fortsätter där förra slutade)
 * men varje fönster blir ett tvärsnitt av hela beståndet.
 */
export function spreadOrder(urls) {
  return [...urls]
    .map((url) => [hash32(url), url])
    .sort((a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : 1))
    .map(([, url]) => url);
}

/**
 * FNV-1a plus murmur3:s slutmix. Vi behöver spridning, inte kryptografi – men
 * enbart FNV räcker inte här: våra URL:er delar lång prefix och skiljer sig
 * bara på slutet, och då hamnar de nära varandra även i talrymden. Utan
 * mixsteget grupperar sorteringen märkena igen, vilket är precis det vi
 * försöker undvika.
 */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Fönstret för den här körningen. Roterar genom hela listan så att alla
 * erbjudanden hinner besökas, utan att någon körning spränger timeouten.
 * Tillståndslöst med flit – vi har ingen plats att spara ett bokmärke i.
 */
export function selectWindow(urls, { maxOffers, runIndex }) {
  if (!urls.length || maxOffers <= 0) return [];
  if (urls.length <= maxOffers) return [...urls];
  const start = (Math.abs(runIndex) * maxOffers) % urls.length;
  const window = urls.slice(start, start + maxOffers);
  // Sista fönstret i varvet är kortare – fyll på från början.
  if (window.length < maxOffers) window.push(...urls.slice(0, maxOffers - window.length));
  return window;
}

// ---------------------------------------------------------------------------
// Sidparsning
// ---------------------------------------------------------------------------

/** Syr ihop RSC-flight-payloaden ur alla self.__next_f.push([1,"…"])-anrop. */
export function parseFlightPayload(html) {
  let flight = '';
  for (const m of String(html ?? '').matchAll(/self\.__next_f\.push\(\[1\s*,\s*("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      flight += JSON.parse(m[1]);
    } catch {
      // En chunk som inte går att tolka ska inte fälla resten.
    }
  }
  return flight;
}

/**
 * Plockar ut ett balanserat JSON-objekt som följer på "<key>":
 * Går inte att göra med regex – objekten är nästlade och innehåller
 * klamrar inuti strängar (fritext, JSON-escapade URL:er).
 */
export function extractObject(text, key) {
  const needle = `"${key}":{`;
  const at = String(text ?? '').indexOf(needle);
  if (at < 0) return null;

  const start = at + needle.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let p = start; p < text.length; p += 1) {
    const c = text[p];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, p + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Product-blocket ur ld+json. Används när flight-payloaden inte går att tolka. */
export function extractProductLd(html) {
  for (const m of String(html ?? '').matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.['@type'] === 'Product') return parsed;
    } catch {
      // Nästa block.
    }
  }
  return null;
}

/** Annonsens id = sista segmentet i URL:en. Samma värde som car.publicId. */
export function publicIdFromUrl(url) {
  const path = String(url ?? '').split('?')[0].replace(/\/$/, '');
  const last = path.split('/').pop();
  return last || null;
}

/** Nämner annonsen företagsleasing eller priser exkl. moms? */
export function hasBusinessTerms(...parts) {
  return BUSINESS_TERMS.test(parts.filter(Boolean).join(' '));
}

// ---------------------------------------------------------------------------
// Kartläggning till rådata
// ---------------------------------------------------------------------------

/** En sida → noll, en eller flera råa rader (ett erbjudande kan ha flera villkor). */
export function offerToRawListings(html, url) {
  const car = extractObject(parseFlightPayload(html), 'car');
  if (car) return carToRawListings(car, url);

  const product = extractProductLd(html);
  if (product) return productToRawListings(product, url);

  return [];
}

export function carToRawListings(car, url) {
  const publicId = car.publicId ?? publicIdFromUrl(url);
  if (!publicId) return [];

  const base = {
    url,
    brand: car.brand,
    model: car.model,
    trim: car.trim,
    fuel: car.fuelType,
    year: car.modelYear,
    condition: car.condition,
    dealer: car.source,
    city: car.city,
    cash_price_sek: car.cashPrice,
    total_cost_sek: car.totalCost,
    leasing_factor: car.leasingFactor,
    includes_insurance: car.includesInsurance,
    includes_service: car.includesService,
    includes_winter_tires: car.includesWinterTire,
    includes_tire_storage: car.includesTireStorage,
    segment_uncertain: hasBusinessTerms(car.trim, car.description, car.fullName),
    raw: {
      // Vilken väg raden kom in. Gör en tyst degradering sökbar i efterhand:
      // `select count(*) from listings where raw->>'via' = 'ld+json'`.
      via: 'flight',
      publicId,
      dealerUrl: car.url ?? null,
      dealerExternalId: car.externalId ?? null,
      registrationNumber: car.registrationNumber ?? null,
      availableLeasingDurations: car.availableLeasingDurations ?? null,
      availableDistancesInKm: car.availableDistancesInKm ?? null,
      leasingPriceChange: car.leasingPriceChange ?? null,
      leasingPriceChangeDaysAgo: car.leasingPriceChangeDaysAgo ?? null,
    },
  };

  // availablePrices är den auktoritativa listan över villkorskombinationer:
  // samma bil kan ha 36 mån/1000 mil och 36 mån/2000 mil till olika pris.
  // Finns den använder vi bara den – rubrikpriset är en av dess rader.
  const combos = (Array.isArray(car.availablePrices) ? car.availablePrices : [])
    .filter((combo) => combo && toNumber(combo.price) !== null);
  if (combos.length) {
    return bestPerTerms(combos).map((combo) => ({
      ...base,
      external_id: comboId(publicId, combo.duration, combo.distance),
      monthly_sek: combo.price,
      term_months: toNumber(combo.duration),
      km_per_year: toNumber(combo.distance),
      down_payment_sek: toNumber(combo.deposit) ?? toNumber(car.deposit) ?? 0,
      raw: { ...base.raw, availablePrices: combos },
    }));
  }

  if (toNumber(car.leasingPrice) === null) return [];
  return [{
    ...base,
    external_id: publicId,
    monthly_sek: car.leasingPrice,
    term_months: onlyValue(car.availableLeasingDurations),
    km_per_year: lowestValue(car.availableDistancesInKm),
    down_payment_sek: toNumber(car.deposit) ?? 0,
  }];
}

/** Mager fallback: ld+json har pris och modell, men inga villkor. */
export function productToRawListings(product, url) {
  const publicId = publicIdFromUrl(url);
  const price = toNumber(product?.offers?.price);
  if (!publicId || price === null) return [];

  const brand = product.brand?.name ?? null;
  return [{
    external_id: publicId,
    url,
    brand,
    model: product.name,
    fuel: null,
    year: null,
    monthly_sek: price,
    term_months: null,
    km_per_year: null,
    down_payment_sek: 0,
    condition: product.offers?.itemCondition === 'https://schema.org/UsedCondition' ? 'used' : 'new',
    segment_uncertain: hasBusinessTerms(product.description, product.name),
    raw: { publicId, via: 'ld+json' },
  }];
}

/**
 * En rad per löptid + körsträcka – inte per kontantinsats.
 *
 * Källan listar samma bil en gång per insatsnivå: 1895 kr med 30 000 kr insats,
 * 2795 kr med 0 kr, och två steg däremellan. Det är samma erbjudande betalat på
 * olika sätt, vilket effektiv månadskostnad är byggd för att jämna ut
 * (1895 + 30000/36 ≈ 2795 + 0). Sparade vi dem som fyra rader skulle bilen väga
 * fyra gånger tyngre i baslinjen än en bil utan insatsvarianter.
 *
 * Vi behåller den billigaste effektiva varianten och lägger hela listan i `raw`.
 * Löptid och körsträcka däremot är olika produkter och får bli egna rader.
 */
export function bestPerTerms(combos) {
  const best = new Map();
  for (const combo of combos) {
    const key = `${toNumber(combo.duration) ?? 'x'}|${toNumber(combo.distance) ?? 'x'}`;
    const current = best.get(key);
    if (!current || comboEffective(combo) < comboEffective(current)) best.set(key, combo);
  }
  return [...best.values()];
}

function comboEffective(combo) {
  return effectiveMonthly({
    monthly_sek: toNumber(combo.price),
    down_payment_sek: toNumber(combo.deposit) ?? 0,
    term_months: toNumber(combo.duration),
  }) ?? Infinity;
}

// Körsträckan kommer i **kilometer** (availableDistancesInKm: 10000, 15000).
// Kartläggningen skrev att alleasing anger mil – det stämmer inte, och en
// mil→km-konvertering här skulle ge 100 000 km/år.
function comboId(publicId, duration, distance) {
  const d = toNumber(duration);
  const k = toNumber(distance);
  return `${publicId}-${d ?? 'x'}m-${k ?? 'x'}km`;
}

/**
 * Bara när arrayen har exakt ett värde. Med flera löptider vet vi inte vilken
 * rubrikpriset gäller, och en gissad löptid slår direkt mot effektiv
 * månadskostnad när kontantinsatsen ska slås ut. Hellre null.
 */
function onlyValue(list) {
  return Array.isArray(list) && list.length === 1 ? toNumber(list[0]) : null;
}

/**
 * Lägsta värdet. Till skillnad från löptiden är den här gissningen försvarbar:
 * annonspriset avser den billigaste konfigurationen, alltså lägsta körsträckan.
 */
function lowestValue(list) {
  const nums = (Array.isArray(list) ? list : []).map(toNumber).filter((n) => n !== null);
  return nums.length ? Math.min(...nums) : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
