// Recepten sparade lokalt, så att de går att läsa i köket utan nät.
//
// Bara läsning. Ändringar kräver uppkoppling – se avsnitt 10 i
// docs/projektstart.md för varför.
//
// localStorage och inte Cache API: recepten är text och ryms med god marginal,
// och en synkron läsning betyder att sidan kan rita den sparade kopian direkt
// i stället för att först blinka tom.
//
// storage skickas in, så filen går att köra under node --test.

const KEY = 'receptbok.recept';
const HUSHÅLL = 'receptbok.hushall';

// Höjs när formen på det sparade ändras. En gammal kopia kastas då i stället
// för att renderas fel – recepten hämtas ändå om så fort det finns nät.
const VERSION = 2;

export function saveRecipes(recipes, householdId, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify({
      version: VERSION,
      household_id: householdId,
      saved_at: Date.now(),
      recipes,
    }));
    return true;
  } catch {
    // Fullt lagringsutrymme eller privat läge. Sajten fungerar ändå, bara
    // inte utan nät – det är inte värt att avbryta laddningen för.
    return false;
  }
}

/**
 * @returns {{recipes: object[], saved_at: number}|null} null när ingenting
 * användbart finns sparat för det hushållet.
 */
export function loadRecipes(householdId, storage = globalThis.localStorage) {
  let saved;
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    saved = JSON.parse(raw);
  } catch {
    return null;
  }

  if (saved?.version !== VERSION) return null;
  // Byter man hushåll ska inte det förra hushållets recept dyka upp.
  if (saved.household_id !== householdId) return null;
  if (!Array.isArray(saved.recipes)) return null;

  return { recipes: saved.recipes, saved_at: saved.saved_at ?? 0 };
}

/**
 * Hushållet sparas separat, för det hämtas före recepten och avgör om sidan
 * över huvud taget ritar biblioteket. Utan det spelar den sparade
 * receptkopian ingen roll – då faller laddningen redan på hushållsanropet.
 */
export function saveHousehold(household, storage = globalThis.localStorage) {
  try {
    storage?.setItem(HUSHÅLL, JSON.stringify({ version: VERSION, household }));
    return true;
  } catch {
    return false;
  }
}

export function loadHousehold(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(HUSHÅLL);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== VERSION) return null;
    return saved.household?.id ? saved.household : null;
  } catch {
    return null;
  }
}

export function clearRecipes(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Inget att göra åt, och inget som är värt att krascha för.
  }
}

/** "sparade i går", "sparade för 3 timmar sedan" – till statusraden. */
export function savedAgo(savedAt, now = Date.now()) {
  const minuter = Math.max(0, Math.round((now - savedAt) / 60000));
  if (minuter < 2) return 'nyss';
  if (minuter < 60) return `för ${minuter} minuter sedan`;

  const timmar = Math.round(minuter / 60);
  if (timmar < 24) return `för ${timmar} ${timmar === 1 ? 'timme' : 'timmar'} sedan`;

  const dagar = Math.round(timmar / 24);
  return `för ${dagar} ${dagar === 1 ? 'dag' : 'dagar'} sedan`;
}
