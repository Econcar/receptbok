// POST /api/translate – översätter ett recept till svenska och räknar om måtten.
//
// Ligger på servern eftersom API-nyckeln aldrig får nå webbläsaren. Den skriver
// ingenting till databasen: svaret går tillbaka till formuläret där användaren
// granskar det innan något sparas. En felöversatt mängd ska synas före
// databasen, inte efter.

import { fail, json, options } from './_shared.js';
import { translateRecipe, TranslateError } from '../../lib/translate.mjs';

export const onRequestOptions = options;

export async function onRequestPost({ request, env }) {
  // Samma spärr som importen: utan inloggning vore det här en gratis
  // språkmodell på en publik domän, betald av oss.
  if (!(await isSignedIn(request, env))) {
    return fail('Du måste vara inloggad för att översätta.', 401);
  }

  let recipe;
  try {
    recipe = await request.json();
  } catch {
    return fail('Kunde inte läsa receptet ur anropet.', 400);
  }

  if (!recipe?.title && !recipe?.ingredients?.length) {
    return fail('Det finns inget att översätta.', 400);
  }

  try {
    const translated = await translateRecipe(recipe, { apiKey: env.ANTHROPIC_API_KEY });
    return json({ recipe: translated }, { maxAge: 0 });
  } catch (err) {
    if (err instanceof TranslateError) return fail(err.message, err.status);
    return fail(`Översättningen misslyckades: ${err.message}`, 502);
  }
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
