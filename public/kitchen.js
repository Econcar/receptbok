// Kökläget: skärmen ska inte släckas mitt i degen.
//
// Wake Lock finns inte i alla webbläsare och kräver dessutom att sidan är
// synlig. Saknas det fungerar receptvyn precis som vanligt, bara med vanlig
// skärmsläckning – därför inga felmeddelanden här, bara tysta returer.

let lock = null;
let wanted = false;

async function acquire() {
  if (!wanted || lock) return;
  if (!('wakeLock' in navigator)) return;
  if (document.visibilityState !== 'visible') return;

  try {
    lock = await navigator.wakeLock.request('screen');
    // Systemet släpper låset självt när fliken göms. Nollställ, så att
    // återtagningen nedan vet att den behövs.
    lock.addEventListener('release', () => { lock = null; });
  } catch {
    lock = null; // Nekat av användaren eller av batterisparläget.
  }
}

/** Håll skärmen tänd. Anropas när ett recept fälls ut. */
export function keepAwake() {
  wanted = true;
  return acquire();
}

/** Släpp låset. Anropas när sista receptet fälls ihop. */
export function letSleep() {
  wanted = false;
  lock?.release?.().catch(() => {});
  lock = null;
}

// Att byta flik släpper låset. Kommer man tillbaka till ett öppet recept ska
// det tas igen, annars släcks skärmen mitt i tillagningen ändå.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});
