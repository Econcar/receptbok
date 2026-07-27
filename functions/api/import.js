// GET /api/import?url=… – hämtar en receptsida och lämnar tillbaka den tolkad.
//
// Webbläsaren kan inte hämta sidan själv: receptsajterna skickar inga
// CORS-huvuden, så anropet måste gå via servern. Den här funktionen skriver
// dock ingenting till databasen. Det gör klienten efteråt, med användarens eget
// token, så att RLS avgör vad som får sparas och var. En endpoint som både
// hämtar och skriver hade behövt fatta det beslutet själv.

import { fail, json, options } from './_shared.js';
import { fetchText } from '../../lib/http.mjs';
import { recipeFromHtml } from '../../lib/recipe.mjs';

export const onRequestOptions = options;

export async function onRequestGet({ request, env }) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return fail('Ingen adress angiven.', 400);

  const problem = checkTarget(target);
  if (problem) return fail(problem, 400);

  // Inloggning krävs trots att inget skrivs. Utan den vore det här en öppen
  // proxy på en publik domän – vem som helst kunde låta vår server hämta vad
  // som helst, i vårt namn.
  if (!(await isSignedIn(request, env))) {
    return fail('Du måste vara inloggad för att importera.', 401);
  }

  let html;
  try {
    html = await fetchText(target, { retries: 2, timeoutMs: 15000 });
  } catch (err) {
    return fail(`Kunde inte hämta sidan: ${err.message}`, 502);
  }

  const recipe = recipeFromHtml(html, { sourceUrl: target });
  if (!recipe) {
    // Ett ärligt nej. Sajten publicerar inget maskinläsbart recept, och att
    // gissa fram ett ur HTML:en vore att bygga in fel vi inte kan upptäcka.
    return fail('Sidan innehåller inget recept vi kan läsa. Mata in det för hand.', 422);
  }

  return json({ recipe }, { maxAge: 0 });
}

/**
 * Adresskontroll. Utan den kan endpointen användas för att nå adresser som
 * bara vår server ser – molnets metadatatjänst, interna nät, localhost.
 */
function checkTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'Adressen går inte att tolka.';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Bara http och https stöds.';
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked = host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.internal')
    || host === '::1'
    || /^(10|127)\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  return blocked ? 'Den adressen går inte att importera från.' : null;
}

async function isSignedIn(request, env) {
  const auth = request.headers.get('authorization');
  if (!auth || !/^bearer\s+\S+/i.test(auth)) return false;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;

  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth },
    });
    return res.ok;
  } catch {
    return false;
  }
}
