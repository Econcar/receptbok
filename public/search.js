// Sökning i den egna samlingen. Ingen indexering och ingen server – hushållets
// recept är några hundra på sin höjd och ligger redan i minnet.
//
// Söker i både titel och ingredienser, för att den vanligaste frågan i ett kök
// inte är "vad heter receptet" utan "vad kan jag göra på det jag har hemma".

// Platshållare ur Unicodes privata område: tecken som aldrig står i ett recept.
const SKYDDA = { 'å': '', 'ä': '', 'ö': '' };
const ÅTERSTÄLL = { '': 'å', '': 'ä', '': 'ö' };

/**
 * Gör text jämförbar: gemener, och accenter bortplockade så att "puré" hittas
 * med "pure".
 *
 * Å, ä och ö undantas. De är egna bokstäver på svenska, inte a och o med
 * prickar – den som söker "kål" menar inte "kal". De byts därför mot
 * platshållare innan accenterna skalas av, och tillbaka efteråt.
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[åäö]/g, (tecken) => SKYDDA[tecken])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-]/g, (tecken) => ÅTERSTÄLL[tecken]);
}

/**
 * Alla ord i frågan måste finnas någonstans i receptet, men inte i följd:
 * "kyckling curry" hittar "Curry med kyckling".
 */
export function matchesQuery(recipe, query) {
  const ord = normalize(query).split(/\s+/).filter(Boolean);
  if (!ord.length) return true;

  const heltäcket = normalize([
    recipe?.title,
    ...(recipe?.recipe_ingredients ?? []).map((rad) => rad.raw_text),
    ...(recipe?.recipe_tags ?? []).map((rad) => rad.tags?.name),
  ].filter(Boolean).join(' '));

  return ord.every((del) => heltäcket.includes(del));
}
