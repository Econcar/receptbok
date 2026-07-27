// Fas 1: inloggning och hushåll. Recepten själva hör till fas 2–3 i
// docs/projektstart.md.
//
// Sidan har tre lägen och visar exakt ett i taget: utloggad, inloggad utan
// hushåll, inloggad med hushåll. Statusraden säger alltid vad som gäller –
// det var tystnaden kring kopplingen till Supabase som kostade mest tid i
// förra projektet.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js';
import { createClient, RestError } from '/supabase.js';

const els = {
  status: document.getElementById('status'),
  meta: document.getElementById('meta'),
  account: document.getElementById('account'),
  accountName: document.getElementById('account-name'),
  signOut: document.getElementById('signout'),
  signIn: document.getElementById('signin'),
  signInButton: document.getElementById('signin-button'),
  setup: document.getElementById('household-setup'),
  setupForm: document.getElementById('household-form'),
  setupName: document.getElementById('household-name'),
  household: document.getElementById('household'),
  householdTitle: document.getElementById('household-title'),
  householdMeta: document.getElementById('household-meta'),
};

function setStatus(text, tone) {
  els.status.textContent = text;
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

/** Ett läge i taget – annars blinkar två paneler förbi under laddningen. */
function showOnly(section) {
  for (const candidate of [els.signIn, els.setup, els.household]) {
    candidate.hidden = candidate !== section;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Utan service worker fungerar sajten ändå, bara inte offline.
  });
}

els.meta.textContent = 'Receptbok · fas 1';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  setStatus('Sajten är utrullad, men public/config.js är inte ifylld ännu.', 'warn');
} else {
  start().catch((err) => setStatus(describe(err), 'error'));
}

async function start() {
  const client = createClient({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });

  // Efter återkomsten från Google ligger resultatet i adressens fragment.
  const { error } = client.consumeRedirect();
  if (error) setStatus(`Inloggningen avbröts: ${error}`, 'error');

  els.signInButton.addEventListener('click', () => client.signIn());
  els.signOut.addEventListener('click', async () => {
    await client.signOut();
    location.reload();
  });

  const session = await client.getSession();
  if (!session) {
    els.account.hidden = true;
    showOnly(els.signIn);
    if (!error) setStatus('Inte inloggad.');
    return;
  }

  const user = client.user;
  els.accountName.textContent = user?.email ?? 'Inloggad';
  els.account.hidden = false;

  els.setupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    createHousehold(client, user).catch((err) => setStatus(describe(err), 'error'));
  });

  await loadHousehold(client, user);
}

async function loadHousehold(client, user) {
  setStatus('Hämtar hushåll …');

  // Ett anrop räcker: RLS ser till att bara egna medlemskap kommer tillbaka,
  // och hushållsraden följer med inbäddad via främmande nyckeln.
  const memberships = await client.rest(
    'household_members?select=role,households(id,name)',
  );

  if (!memberships.length) {
    showOnly(els.setup);
    setStatus('Du hör inte till något hushåll ännu.');
    return;
  }

  const { households: household, role } = memberships[0];
  const roleName = role === 'owner' ? 'ägare' : 'medlem';

  showOnly(els.household);
  els.householdTitle.textContent = household.name;

  const recipes = await client.rest(`recipes?select=id&household_id=eq.${household.id}`);
  els.householdMeta.textContent = recipes.length === 0
    ? `Du är ${roleName}. Inga recept ännu – importen kommer i fas 2.`
    : `Du är ${roleName}. ${recipes.length} recept.`;

  setStatus('Ansluten.', 'ok');
}

async function createHousehold(client, user) {
  const name = els.setupName.value.trim();
  if (!name) return;

  setStatus('Skapar hushåll …');
  // Bara namnet skickas. created_by sätts av kolumnens default till auth.uid(),
  // vilket är precis vad policyn kräver – klienten ska inte kunna ha fel om det.
  //
  // return=minimal av samma skäl: raden går inte att läsa tillbaka i samma
  // ögonblick som den skapas, eftersom triggern hinner göra oss till medlem
  // först efteråt. Vi hämtar hushållet i nästa anrop i stället.
  await client.insert('households', { name }, { returning: 'minimal' });
  await loadHousehold(client, user);
}

function describe(err) {
  if (err instanceof RestError && err.status === 401) {
    return 'Supabase avvisade nyckeln (401). Kontrollera anon-nyckeln i config.js.';
  }
  if (err instanceof RestError) {
    return `Supabase svarade ${err.status}: ${err.message}`;
  }
  return `Något gick fel: ${err.message}`;
}
