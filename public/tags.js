// Receptkategorier: middag, frukost, vegetariskt … Fritt formulerade per
// hushåll, till skillnad från butiksavdelningarna som är fasta i koden.
//
// Delad mellan inmatningssidan och listsidan, för att båda ska skapa och
// koppla dem på samma sätt. Gemenformat är ett villkor i databasen – annars
// blir "Vegetariskt" och "vegetariskt" två kategorier som ser likadana ut.

/** Förslag för ett tomt hushåll. Bara en startpunkt; egna går alltid att skriva. */
export const FÖRSLAG = [
  'middag', 'frukost', 'lunch', 'vegetariskt', 'kött', 'fisk',
  'soppa', 'pasta', 'sallad', 'bak', 'efterrätt', 'snabbt',
];

export const normalizeTag = (namn) => String(namn ?? '').trim().toLowerCase();

/**
 * Skapar kategorierna som saknas och returnerar raderna för allihop.
 *
 * merge-duplicates gör att en kategori som redan finns i hushållet returneras
 * i stället för att unikhetsvillkoret fäller anropet.
 */
export async function upsertTags(client, householdId, namn) {
  const rena = [...new Set(namn.map(normalizeTag).filter(Boolean))];
  if (!rena.length) return [];

  return client.rest('tags?on_conflict=household_id,name', {
    method: 'POST',
    body: rena.map((name) => ({ household_id: householdId, name })),
    headers: { prefer: 'return=representation,resolution=merge-duplicates' },
  });
}

/**
 * Vilka kategorier som ska visas som valbara.
 *
 * `medFörslag` skiljer de två platserna åt, och skillnaden är inte kosmetisk.
 * Förslagen finns inte i databasen förrän någon använder dem, och går alltså
 * inte att ta bort. På inmatningssidan är det rimligt – där väljer man, och en
 * startlista hjälper ett tomt hushåll igång.
 *
 * I receptvyn är det däremot fel: där redigerar man, och allt som syns ska gå
 * att bli av med. Tolv oborttagbara förslag på varje recept är skräp man inte
 * kan städa. Behövs en ny kategori finns fältet bredvid.
 */
export function valbara(hushålletsTags, valda = [], { medFörslag = true } = {}) {
  const alla = new Set([
    ...hushålletsTags.map((tag) => normalizeTag(tag.name)),
    ...valda.map(normalizeTag),
    ...(medFörslag ? FÖRSLAG : []),
  ]);
  return [...alla].filter(Boolean).sort((a, b) => a.localeCompare(b, 'sv'));
}
