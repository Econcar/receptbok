// Det båda sidorna delar: konfiguration, inloggning, kontorad och hushåll.
//
// Sidorna är två för att de gör olika saker. Listsidan läser man i köket, med
// en hand och skitiga fingrar; inmatningssidan sitter man vid. Att blanda dem
// gjorde listan rörig av formulär man sällan använder.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js';
import { createClient, RestError } from '/supabase.js';

export { RestError };

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const els = {
  status: () => document.getElementById('status'),
  account: () => document.getElementById('account'),
  accountName: () => document.getElementById('account-name'),
  signOut: () => document.getElementById('signout'),
};

export function setStatus(text, tone) {
  const el = els.status();
  if (!el || text === undefined) return; // Annars står det "undefined" på sidan.
  el.textContent = text;
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

/**
 * Skapar klienten, plockar upp en inloggning ur adressen och ritar kontoraden.
 * @returns {{client: object, user: object|null, error: string|null}}
 */
export async function startSession() {
  const client = createClient({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });

  // Efter återkomsten från Google ligger resultatet i adressens fragment.
  const { error } = client.consumeRedirect();
  const session = await client.getSession();
  const user = session ? client.user : null;

  const account = els.account();
  if (account) account.hidden = !user;
  if (user) {
    const name = els.accountName();
    if (name) name.textContent = user.email ?? 'Inloggad';
    els.signOut()?.addEventListener('click', async () => {
      await client.signOut();
      location.href = '/';
    });
  }

  return { client, user, error };
}

/** Hushållet användaren tillhör, eller null. RLS filtrerar åt oss. */
export async function loadHousehold(client) {
  const rows = await client.rest('household_members?select=role,households(id,name)');
  if (!rows.length) return null;
  return { ...rows[0].households, role: rows[0].role };
}

export function describe(err) {
  if (err instanceof RestError && err.status === 401) {
    return 'Supabase avvisade nyckeln (401). Kontrollera anon-nyckeln i config.js.';
  }
  if (err instanceof RestError) return `Supabase svarade ${err.status}: ${err.message}`;
  return err.message;
}

/** Fångar fel från en händelsehanterare och skriver dem i statusraden. */
export function guard(handler) {
  return (event) => {
    try {
      const result = handler(event);
      if (result?.catch) result.catch((err) => setStatus(describe(err), 'error'));
    } catch (err) {
      setStatus(describe(err), 'error');
    }
  };
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Utan service worker fungerar sajten ändå, bara inte offline.
  });
}
