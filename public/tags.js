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
 * Vad som ska visas som valbara kategorier: hushållets egna först, sedan
 * förslagen som inte redan finns. Utan hushållets egna skulle en kategori man
 * hittat på försvinna ur förslagen nästa gång, och man fick skriva den igen.
 */
export function valbara(hushålletsTags, valda = []) {
  const alla = new Set([
    ...hushålletsTags.map((tag) => normalizeTag(tag.name)),
    ...valda.map(normalizeTag),
    ...FÖRSLAG,
  ]);
  return [...alla].filter(Boolean).sort((a, b) => a.localeCompare(b, 'sv'));
}
