// Slår ihop veckans recept till en inköpslista.
//
// Svårare än tolkningen, och av ett skäl som är värt att skriva ut: 2 dl och
// 1 dl går att addera, men 2 dl grädde och 1 paket grädde gör det inte. Ett
// paket är inte ett mått. Regeln är därför att bara addera när enheterna är
// identiska eller går att räkna om exakt – resten blir egna rader.
//
// Hellre två rader grädde än en felaktig summa. En summa som ser rimlig ut men
// är fel upptäcker man i butiken, och då är det för sent.

/**
 * Enheter som mäter samma sak och går att räkna om exakt. Nyckeln är basenhet
 * per familj: milliliter respektive gram.
 *
 * Svenska mått är definierade i milliliter – krm är 1, tsk 5, msk 15 – så
 * omräkningen är exakt och inte en uppskattning.
 */
const VOLYM = { ml: 1, krm: 1, tsk: 5, msk: 15, cl: 10, dl: 100, l: 1000 };
const VIKT = { g: 1, hg: 100, kg: 1000 };

// Vad summan skrivs i. Största enheten där talet blir minst 1, så att 2500 ml
// blir 2,5 l och inte 2500 ml.
const VOLYMSTEGE = [['l', 1000], ['dl', 100], ['msk', 15], ['tsk', 5], ['ml', 1]];
const VIKTSTEGE = [['kg', 1000], ['g', 1]];

function familj(unit) {
  if (unit && VOLYM[unit] !== undefined) return { bas: VOLYM[unit], stege: VOLYMSTEGE, namn: 'volym' };
  if (unit && VIKT[unit] !== undefined) return { bas: VIKT[unit], stege: VIKTSTEGE, namn: 'vikt' };
  // st, förp, burk, klyfta, cup, lb … går bara ihop med exakt sig själva.
  return null;
}

/**
 * Nyckeln avgör vad som får slås ihop. Samma nyckel, samma rad.
 *
 * Exporterad för att anroparen ska kunna peka ut en rad utan att gissa hur
 * grupperingen fungerar – "2 dl grädde" och "2 msk grädde" hamnar i samma
 * grupp, och en nyckel byggd på råa enheter hade missat det.
 */
export function groupKey(name, unit) {
  const vara = normalizeName(name);
  const grupp = familj(unit)?.namn ?? `=${unit ?? ''}`;
  return `${vara}|${grupp}`;
}

/** "Vispgrädde" och "vispgrädde " är samma vara. Mer än så gissar vi inte. */
export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {Array<{recipe: object, servings: number|null}>} poster veckans rätter
 * @param {Array<{name, quantity, unit}>} egna rader man lagt till för hand
 * @param {Set<string>} dolda gruppnycklar vars planbidrag ska hoppas över
 * @returns {Array<{name, quantity, unit, approximate, manuellt, recipes: string[]}>}
 */
export function buildShoppingList(poster, egna = [], dolda = new Set()) {
  const grupper = new Map();

  // Handtillagda rader går genom samma sammanslagning som planens. Att stå med
  // två mjölkrader för att den ena kom från en knapp och den andra från en
  // veckoplan är precis den sortens fel som får en att sluta lita på listan.
  for (const rad of egna ?? []) {
    if (!normalizeName(rad?.name)) continue;
    const grupp = hämtaGrupp(grupper, rad.name, rad.unit);
    grupp.manuellt = true;
    if (rad.quantity !== null && rad.quantity !== undefined) {
      const f = familj(rad.unit);
      grupp.summa = (grupp.summa ?? 0) + rad.quantity * (f ? f.bas : 1);
    }
  }

  for (const post of poster ?? []) {
    const recipe = post?.recipe;
    if (!recipe) continue;

    // Skalning är inte linjär – kryddor och tillagningstid följer inte antalet
    // portioner. Mängderna skalas ändå, men raden flaggas som ungefärlig så
    // att det syns i listan i stället för att tigas ihjäl.
    const faktor = skalfaktor(recipe.servings, post.servings);

    for (const rad of recipe.recipe_ingredients ?? []) {
      const name = rad.name ?? rad.raw_text;
      if (!normalizeName(name)) continue;

      // Bortplockat gäller bara det planen bidrar med. En handtillagd rad med
      // samma nyckel står kvar – det är så en ändrad rad ersätter den uträknade
      // i stället för att adderas till den.
      if (dolda.has(groupKey(name, rad.unit))) continue;

      const grupp = hämtaGrupp(grupper, name, rad.unit);
      grupp.recipes.add(recipe.title);

      if (rad.quantity !== null && rad.quantity !== undefined) {
        const f = familj(rad.unit);
        const bidrag = rad.quantity * faktor * (f ? f.bas : 1);
        grupp.summa = (grupp.summa ?? 0) + bidrag;
        if (faktor !== 1) grupp.approximate = true;
      }
    }
  }

  return [...grupper.values()]
    .map(skrivUt)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

/** Samma nyckel oavsett varifrån raden kom – det är hela poängen. */
function hämtaGrupp(grupper, name, unit) {
  const k = groupKey(name, unit);
  if (!grupper.has(k)) {
    grupper.set(k, {
      name: String(name).trim(),
      unit: unit ?? null,
      summa: null,
      approximate: false,
      manuellt: false,
      recipes: new Set(),
    });
  }
  return grupper.get(k);
}

function skalfaktor(receptets, planerade) {
  if (!receptets || !planerade) return 1; // Saknas uppgift skalar vi inte.
  const faktor = planerade / receptets;
  return Number.isFinite(faktor) && faktor > 0 ? faktor : 1;
}

function skrivUt(grupp) {
  const gemensamt = {
    name: grupp.name,
    approximate: grupp.approximate,
    manuellt: grupp.manuellt,
    recipes: [...grupp.recipes],
  };

  // Rader utan mängd behåller sin brist. "Salt" står kvar som "salt".
  if (grupp.summa === null) return { ...gemensamt, quantity: null, unit: grupp.unit };

  const f = familj(grupp.unit);
  if (!f) return { ...gemensamt, quantity: round(grupp.summa), unit: grupp.unit };

  const [unit, storlek] = f.stege.find(([, s]) => grupp.summa >= s) ?? f.stege.at(-1);
  return { ...gemensamt, quantity: round(grupp.summa / storlek), unit };
}

/** Två decimaler räcker. Ingen mäter upp 1,333 dl. */
const round = (n) => Math.round(n * 100) / 100;

/** "2 dl grädde", "salt" – raden som den ska stå i listan. */
export function formatItem(item) {
  const mängd = item.quantity === null
    ? ''
    : `${String(item.quantity).replace('.', ',')}${item.unit ? ` ${item.unit}` : ''} `;
  return `${mängd}${item.name}`.trim();
}
