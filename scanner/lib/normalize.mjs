// Normalisering av rå annonstext till strukturerade fält.
// Källorna skriver samma sak på tio sätt: "3 495 kr/mån", "3.495:-", "från 3495 kr".

import { effectiveMonthly } from './pricing.mjs';

const BRAND_ALIASES = new Map(Object.entries({
  vw: 'Volkswagen',
  volkswagen: 'Volkswagen',
  'v w': 'Volkswagen',
  mb: 'Mercedes-Benz',
  mercedes: 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz',
  benz: 'Mercedes-Benz',
  bmw: 'BMW',
  kia: 'Kia',
  hyundai: 'Hyundai',
  volvo: 'Volvo',
  polestar: 'Polestar',
  tesla: 'Tesla',
  skoda: 'Škoda',
  'škoda': 'Škoda',
  seat: 'SEAT',
  cupra: 'Cupra',
  audi: 'Audi',
  peugeot: 'Peugeot',
  renault: 'Renault',
  dacia: 'Dacia',
  toyota: 'Toyota',
  nissan: 'Nissan',
  mazda: 'Mazda',
  ford: 'Ford',
  opel: 'Opel',
  citroen: 'Citroën',
  'citroën': 'Citroën',
  mg: 'MG',
  byd: 'BYD',
  xpeng: 'XPeng',
  nio: 'NIO',
  mini: 'MINI',
  jeep: 'Jeep',
  subaru: 'Subaru',
  suzuki: 'Suzuki',
  honda: 'Honda',
  fiat: 'Fiat',
  smart: 'smart',
  lynkco: 'Lynk & Co',
  'lynk & co': 'Lynk & Co',
  'lynk and co': 'Lynk & Co',
}));

const FUEL_ALIASES = new Map(Object.entries({
  el: 'el',
  elbil: 'el',
  electric: 'el',
  eldrift: 'el',
  bensin: 'bensin',
  petrol: 'bensin',
  diesel: 'diesel',
  hybrid: 'hybrid',
  elhybrid: 'hybrid',
  'mild hybrid': 'hybrid',
  mildhybrid: 'hybrid',
  laddhybrid: 'laddhybrid',
  plugin: 'laddhybrid',
  'plug-in hybrid': 'laddhybrid',
  phev: 'laddhybrid',
  etanol: 'etanol',
  e85: 'etanol',
  gas: 'gas',
  fordonsgas: 'gas',
}));

/**
 * Plockar ut ett belopp i SEK ur fri text.
 * Hanterar mellanslag/hårt mellanslag/punkt som tusentalsavgränsare och
 * komma som decimaltecken. Returnerar null när inget vettigt tal finns.
 */
export function parseSek(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (!input) return null;

  const text = String(input).replace(/ /g, ' ');
  const match = text.match(/-?\d[\d\s.,]*/);
  if (!match) return null;

  let raw = match[0].trim();
  // Komma som decimaltecken (svenskt): 3495,50
  const decimal = raw.match(/,(\d{1,2})$/);
  if (decimal) raw = raw.slice(0, -decimal[0].length) + '.' + decimal[1];
  // Kvarvarande avgränsare (mellanslag, punkt, komma) är tusental.
  raw = raw.replace(/[\s,]/g, '');
  if (/\.\d{3}(\D|$)/.test(raw) || /\.\d{3}$/.test(raw)) raw = raw.replace(/\./g, '');

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** "36 mån", "36 månader", "3 år", "36m" → 36 */
export function parseTermMonths(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  if (!input) return null;

  const text = String(input).toLowerCase();
  const years = text.match(/(\d+)\s*(år|ar\b|years?)/);
  if (years) return Number(years[1]) * 12;

  const months = text.match(/(\d+)\s*(mån|man\b|månader|manader|mon|months?|m\b)/);
  if (months) return Number(months[1]);

  const bare = text.match(/\d+/);
  return bare ? Number(bare[0]) : null;
}

/** "1 500 mil/år", "15000 km", "1500 mil" → km/år (mil × 10) */
export function parseKmPerYear(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  if (!input) return null;

  const text = String(input).toLowerCase().replace(/ /g, ' ');
  const value = parseSek(text);
  if (value === null) return null;

  if (/\bmil\b/.test(text)) return Math.round(value * 10);
  return Math.round(value);
}

/** Kanoniskt märkesnamn, eller trimmad input när märket är okänt. */
export function normalizeBrand(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase().replace(/\s+/g, ' ');
  if (BRAND_ALIASES.has(key)) return BRAND_ALIASES.get(key);
  return titleCase(key);
}

export function normalizeFuel(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase().replace(/\s+/g, ' ');
  return FUEL_ALIASES.get(key) ?? key;
}

/**
 * Modellnamn utan brus: tar bort märket, drivmedelsord och årtal så att
 * "Volvo EX30 Extended Range 2025" och "EX30 extended range" hamnar i samma grupp.
 */
export function normalizeModel(input, brand) {
  if (!input) return null;
  let text = String(input).replace(/ /g, ' ').trim();

  if (brand) {
    const escaped = String(brand).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}\\s+`, 'i'), '');
  }
  text = text.replace(/\b(19|20)\d{2}\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Slår ihop rå adapterdata till en rad som matchar `listings`-schemat.
 * Adaptern ansvarar för att plocka ut fälten; den här funktionen städar dem.
 */
export function normalizeListing(raw, { source }) {
  if (!raw?.external_id || !raw?.url) return null;

  const brand = normalizeBrand(raw.brand);
  const listing = {
    source,
    external_id: String(raw.external_id),
    url: String(raw.url),
    brand,
    model: normalizeModel(raw.model, brand),
    trim: raw.trim ? String(raw.trim).trim() : null,
    fuel: normalizeFuel(raw.fuel),
    year: Number.isFinite(Number(raw.year)) ? Number(raw.year) : null,
    monthly_sek: parseSek(raw.monthly_sek),
    down_payment_sek: parseSek(raw.down_payment_sek),
    term_months: parseTermMonths(raw.term_months),
    km_per_year: parseKmPerYear(raw.km_per_year),
    residual_sek: parseSek(raw.residual_sek),
    segment: raw.segment === 'foretag' ? 'foretag' : 'privat',

    // Ingen källa har segment som fält – adaptern får flagga på fritext.
    segment_uncertain: raw.segment_uncertain === true,
    condition: raw.condition === 'used' || raw.condition === 'new' ? raw.condition : null,

    includes_insurance: toBool(raw.includes_insurance),
    includes_service: toBool(raw.includes_service),
    includes_winter_tires: toBool(raw.includes_winter_tires),
    includes_tire_storage: toBool(raw.includes_tire_storage),

    dealer: raw.dealer ? String(raw.dealer).trim() : null,
    city: raw.city ? String(raw.city).trim() : null,
    cash_price_sek: parseSek(raw.cash_price_sek),
    total_cost_sek: parseSek(raw.total_cost_sek),
    leasing_factor: Number.isFinite(Number(raw.leasing_factor)) && raw.leasing_factor !== null
      ? Number(raw.leasing_factor)
      : null,

    raw: raw.raw ?? null,
  };

  // Utan månadspris är annonsen värdelös för prisjämförelsen.
  if (listing.monthly_sek === null) return null;
  listing.effective_monthly_sek = effectiveMonthly(listing);
  return listing;
}

// null/undefined ska förbli null – "vet inte" är inte samma sak som "nej".
function toBool(value) {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

// Ordinitial versal. \b duger inte – det är en ASCII-gräns och skulle dela
// "nyttmärke" mitt i ordet, före både ä och r.
function titleCase(text) {
  return text.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
