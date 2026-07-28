// Skalning av portioner i receptvyn.
//
// Mängderna räknas om, men inte tillagningstiden och inte kryddorna på något
// klokare sätt än rakt av – de följer inte portionsantalet, och att låtsas
// annat vore att bygga in ett fel som ser rätt ut. Därför står det utskrivet i
// gränssnittet i stället.
//
// Ingen tyst avrundning per enhet. 3 ägg gånger 1,5 blir 4½ ägg, inte 5. Att
// runda upp hade varit en gissning om vad kocken vill, och den gissningen hör
// hemma i köket och inte i koden.

/** Bråk man faktiskt mäter i, och tåligheten för att räknas dit. */
const BRÅK = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'],
  [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];
const TÅLIGHET = 0.02;

export function scaleFactor(receptets, önskade) {
  if (!receptets || !önskade) return 1;
  const faktor = önskade / receptets;
  return Number.isFinite(faktor) && faktor > 0 ? faktor : 1;
}

/** Tre decimaler räcker; ingen mäter noggrannare än så i ett kök. */
export function scaleQuantity(quantity, factor) {
  if (quantity === null || quantity === undefined) return null;
  const skalad = Number(quantity) * factor;
  return Number.isFinite(skalad) ? Math.round(skalad * 1000) / 1000 : null;
}

/**
 * "2,5" blir "2½", "0,75" blir "¾", "3,4" blir "3,4".
 *
 * Bråk där de finns, decimalkomma där de inte gör det – ett svenskt recept
 * skriver ½ dl, inte 0,5 dl.
 */
export function formatQuantity(n) {
  if (n === null || n === undefined) return '';

  const heltal = Math.floor(n);
  const rest = n - heltal;

  const träff = BRÅK.find(([värde]) => Math.abs(rest - värde) < TÅLIGHET);
  if (träff) return `${heltal || ''}${träff[1]}`;
  if (rest < TÅLIGHET) return String(heltal);

  // Två decimaler, utan efterföljande nollor: 3,40 blir 3,4.
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * Raden som den ska stå i receptvyn.
 *
 * Vid faktor 1 återges raw_text oförändrad. Originalet är alltid bättre än vår
 * hopsättning – det innehåller ordval och nyanser tolkningen kastat bort. Först
 * när mängden faktiskt ändrats är det värt att skriva om raden.
 */
export function scaleIngredient(rad, factor) {
  if (factor === 1 || rad?.quantity === null || rad?.quantity === undefined) {
    return rad?.raw_text ?? '';
  }

  const mängd = formatQuantity(scaleQuantity(rad.quantity, factor));
  const delar = [mängd, rad.unit, rad.name || rad.raw_text].filter(Boolean);
  const rest = rad.note ? `, ${rad.note}` : '';
  return `${delar.join(' ')}${rest}`;
}
