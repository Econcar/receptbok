// Grov språkgissning: räcker för att avgöra om ett importerat recept behöver
// översättas automatiskt.
//
// Ligger i public/ och inte i lib/ eftersom det är webbläsaren som ställer
// frågan – lib/ nås inte härifrån, den mappen är till för Node och Workers.
//
// Filen rör inga globaler och går därför att köra under node --test.

// Ord och tecken som i praktiken bara förekommer i svenska recept. Måtten
// väger tyngst: "dl" och "msk" står i så gott som varje svenskt recept och i
// inga engelska.
const SVENSKA = /[åäö]|\b(dl|msk|tsk|krm|st|förp|ugnen|grader|blanda|vispa|stek|koka|och|med)\b/gi;
const ENGELSKA = /\b(cup|cups|tbsp|tsp|tablespoon|teaspoon|ounce|oz|pound|lb|the|and|with|until|preheat|bake|stir)\b/gi;

/**
 * Ingen exakt vetenskap, och den behöver inte vara det: gissar den fel kan
 * användaren trycka på översättningsknappen ändå.
 */
export function looksSwedish(text) {
  const sample = String(text ?? '');
  if (!sample.trim()) return true; // Inget att översätta.

  const svenska = (sample.match(SVENSKA) ?? []).length;
  const engelska = (sample.match(ENGELSKA) ?? []).length;
  return svenska >= engelska;
}
