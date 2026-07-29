// Veckan som planeras och handlas till: de sju dagarna från och med i dag.
//
// Samma fönster på tre ställen – veckoplanen, inköpslistan och knappen om
// inköp i receptvyn. Låg det i tre kopior räckte det att någon räknade dagar
// på ett annat sätt för att listan skulle handla till en annan vecka än den
// man planerat, och det syns inte förrän man står i butiken.

/** Så många dagar framåt planen och listan gäller. */
export const DAGAR = 7;

/** ISO-datum i lokal tid. toISOString() hade gett gårdagens datum på kvällen. */
export function isoDatum(d) {
  const år = d.getFullYear();
  const månad = String(d.getMonth() + 1).padStart(2, '0');
  const dag = String(d.getDate()).padStart(2, '0');
  return `${år}-${månad}-${dag}`;
}

/** Dagarna i tur och ordning, i dag först. */
export function dagarna(idag = new Date()) {
  return Array.from({ length: DAGAR }, (_, i) => {
    const d = new Date(idag);
    d.setDate(idag.getDate() + i);
    return d;
  });
}

/** Fönstret som frågan till meal_plan avgränsas med, båda ändarna inräknade. */
export function veckansFönster(idag = new Date()) {
  const dagar = dagarna(idag);
  return { från: isoDatum(dagar[0]), till: isoDatum(dagar.at(-1)) };
}
