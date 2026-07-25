// Dubblettfilter. Samma bil dyker upp flera gånger – dels inom en källa
// (annonsen listas om), dels mellan källor (samma återförsäljare, två sajter).

/** Nyckel inom en källa: källans egna id är auktoritativt. */
export function sourceKey(listing) {
  return `${listing.source}|${listing.external_id}`;
}

/**
 * Nyckel på erbjudandenivå: samma bil + samma villkor + samma pris är
 * samma erbjudande, oavsett var det annonseras.
 */
export function offerKey(listing) {
  return [
    listing.brand,
    listing.model,
    listing.trim,
    listing.term_months,
    listing.km_per_year,
    listing.monthly_sek,
    listing.down_payment_sek ?? 0,
    listing.segment ?? 'privat',
  ]
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');
}

/**
 * Tar bort dubbletter i en batch från en och samma källa.
 * Vid krock vinner den mest kompletta raden – ett halvparsat duplikat ska
 * aldrig skriva över en rad med fler ifyllda fält.
 */
export function dedupeBatch(listings) {
  const byKey = new Map();
  for (const listing of listings ?? []) {
    if (!listing) continue;
    const key = sourceKey(listing);
    const existing = byKey.get(key);
    if (!existing || completeness(listing) > completeness(existing)) byKey.set(key, listing);
  }
  return [...byKey.values()];
}

/**
 * Grupperar identiska erbjudanden över källor. Returnerar en Map
 * offerKey → annonser, så att frontend kan visa "finns hos 3 säljare".
 */
export function groupDuplicateOffers(listings) {
  const groups = new Map();
  for (const listing of listings ?? []) {
    const key = offerKey(listing);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(listing);
  }
  return groups;
}

const SCORED_FIELDS = [
  'brand', 'model', 'trim', 'fuel', 'year',
  'monthly_sek', 'down_payment_sek', 'term_months', 'km_per_year', 'residual_sek',
];

/** Antal ifyllda fält – proxy för hur användbar raden är. */
export function completeness(listing) {
  return SCORED_FIELDS.reduce(
    (sum, field) => sum + (listing?.[field] === null || listing?.[field] === undefined || listing?.[field] === '' ? 0 : 1),
    0,
  );
}
