// Butiksavdelningar för inköpslistan.
//
// Ordningen är inte alfabetisk utan följer en vanlig butiksrunda: grönsakerna
// först, frysen sist. Poängen med att kategorisera är att slippa pendla mellan
// mejeri och torrvaror, och då måste ordningen vara butikens och inte
// bokstavernas.
//
// Listan är fast i koden, till skillnad från receptkategorierna som hushållet
// hittar på själv. En butik ser ungefär likadan ut för alla, och en fri lista
// hade bara gett tio stavningar av "grönsaker".

export const KATEGORIER = [
  { id: 'grönt', namn: 'Frukt & grönt' },
  { id: 'bröd', namn: 'Bröd' },
  { id: 'mejeri', namn: 'Mejeri & ägg' },
  { id: 'kött', namn: 'Kött & chark' },
  { id: 'fisk', namn: 'Fisk & skaldjur' },
  { id: 'torrvaror', namn: 'Torrvaror & pasta' },
  { id: 'konserv', namn: 'Konserver' },
  { id: 'kryddor', namn: 'Kryddor & smaksättning' },
  { id: 'dryck', namn: 'Dryck' },
  { id: 'fryst', namn: 'Fryst' },
  { id: 'övrigt', namn: 'Övrigt' },
];

const ORDNING = new Map(KATEGORIER.map((k, i) => [k.id, i]));
const NAMN = new Map(KATEGORIER.map((k) => [k.id, k.namn]));

export const kategoriNamn = (id) => NAMN.get(id) ?? 'Okategoriserat';

export function ärGiltig(id) {
  return NAMN.has(id);
}

/**
 * Delar upp listan i butiksavdelningar.
 *
 * Okategoriserat hamnar sist och inte först. Det är rader man ännu inte tagit
 * ställning till, och de ska inte stå i vägen för dem man tagit ställning till.
 *
 * @param {Array} items      raderna, i den ordning de ska stå inom sin grupp
 * @param {Function} kategoriFör  rad → kategori-id eller null
 */
export function groupByCategory(items, kategoriFör) {
  const grupper = new Map();

  for (const item of items ?? []) {
    const id = kategoriFör?.(item) ?? null;
    const nyckel = ärGiltig(id) ? id : null;
    if (!grupper.has(nyckel)) grupper.set(nyckel, []);
    grupper.get(nyckel).push(item);
  }

  return [...grupper.entries()]
    .map(([id, rader]) => ({ id, namn: kategoriNamn(id), items: rader }))
    .sort((a, b) => plats(a.id) - plats(b.id));
}

/** Okänd eller saknad kategori sorteras sist. */
const plats = (id) => (ORDNING.has(id) ? ORDNING.get(id) : Number.MAX_SAFE_INTEGER);
