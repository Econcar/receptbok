// Receptkategorier: middag, frukost, vegetariskt … Fritt formulerade per
// hushåll, till skillnad från butiksavdelningarna som är fasta i koden.
//
// Delad mellan inmatningssidan och listsidan, för att båda ska skapa och
// koppla dem på samma sätt. Gemenformat är ett villkor i databasen – annars
// blir "Vegetariskt" och "vegetariskt" två kategorier som ser likadana ut.

// Det fanns en fast förslagslista här: middag, frukost, vegetariskt och nio
// till. Den togs bort, för den skapade en andra sorts kategori som såg ut som
// de andra men inte gick att ta bort – den fanns inte i databasen förrän någon
// använde den. "Varför kan jag radera soppa men inte vegetariskt?" är en fråga
// gränssnittet inte kunde svara på.
//
// Nu finns bara en sort: rader hushållet självt skapat, och alla går att ta
// bort. Ett tomt hushåll skriver sin första kategori i fältet, vilket är en
// engångskostnad på tio sekunder.

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
 * Kategorierna som ska visas som valbara: hushållets egna, plus dem receptet
 * redan bär.
 *
 * Det senare är inte överflödigt. Ett recept kan hålla en kategori vars rad
 * hunnit tas bort någon annanstans – den ska synas som vald och gå att klicka
 * bort, inte tyst försvinna ur vyn medan den sitter kvar i databasen.
 */
export function valbara(hushålletsTags, valda = []) {
  const alla = new Set([
    ...hushålletsTags.map((tag) => normalizeTag(tag.name)),
    ...valda.map(normalizeTag),
  ]);
  return [...alla].filter(Boolean).sort((a, b) => a.localeCompare(b, 'sv'));
}
