// Skalet. Recepten själva hör till fas 2–3 i docs/projektstart.md.
//
// Det den gör i dag är att svara på en enda fråga: är sajten korrekt utrullad
// och kopplad till rätt Supabase-projekt? Det är värt en sida i sig – det var
// just den kopplingen som kostade mest tid i förra projektet.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '/config.js';

const els = {
  status: document.getElementById('status'),
  meta: document.getElementById('meta'),
};

function setStatus(text, tone) {
  els.status.textContent = text;
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

async function checkConnection() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus('Sajten är utrullad, men public/config.js är inte ifylld ännu.', 'warn');
    return;
  }

  try {
    // Vilken endpoint som helst duger – vi vill bara veta att URL och nyckel
    // hör ihop. PostgREST-roten svarar utan att någon tabell behöver finnas.
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (res.ok) {
      setStatus('Ansluten till Supabase. Inga recept ännu – fas 2 i projektstart.md.', 'ok');
    } else {
      setStatus(`Supabase svarade ${res.status}. Kontrollera URL och anon-nyckel i config.js.`, 'warn');
    }
  } catch (err) {
    setStatus(`Kunde inte nå Supabase: ${err.message}`, 'warn');
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Utan service worker fungerar sajten ändå, bara inte offline.
  });
}

els.meta.textContent = 'Receptbok · fas 1';
checkConnection();
