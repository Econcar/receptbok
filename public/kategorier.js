// Hushållets receptkategorier: skapa och ta bort.
//
// Egen sida med flit. Att bestämma vilka kategorier som finns är något man gör
// sällan och eftertänksamt; att kryssa i dem på ett recept gör man ofta och i
// förbifarten. Låg de på samma ställe skulle en felträff kunna radera en
// kategori från alla recept när man bara tänkte kryssa i den på ett.

import {
  configured, describe, guard, loadHousehold, registerServiceWorker, setStatus, showVersion,
  startSession,
} from '/session.js';
import { normalizeTag, upsertTags } from '/tags.js';

const els = {
  gate: document.getElementById('gate'),
  manager: document.getElementById('manager'),
  newForm: document.getElementById('new-form'),
  newName: document.getElementById('new-name'),
  list: document.getElementById('list'),
};

let client = null;
let household = null;
let tags = [];
let antal = new Map();

registerServiceWorker();
showVersion();

if (!configured) {
  setStatus('Sajten är utrullad, men public/config.js är inte ifylld ännu.', 'warn');
} else {
  start().catch((err) => setStatus(describe(err), 'error'));
}

async function start() {
  const session = await startSession();
  client = session.client;

  if (!session.user) {
    els.gate.hidden = false;
    setStatus('Du måste vara inloggad för att hantera kategorier.');
    return;
  }

  household = await loadHousehold(client);
  if (!household) {
    els.gate.hidden = false;
    setStatus('Du hör inte till något hushåll ännu. Skapa ett på startsidan.');
    return;
  }

  els.manager.hidden = false;
  els.newForm.addEventListener('submit', guard((event) => {
    event.preventDefault();
    return skapa();
  }));

  await ladda();
}

async function ladda() {
  setStatus('Hämtar kategorier …');

  // Två anrop och räkning här i stället för en aggregerad fråga: RLS ger oss
  // bara hushållets egna rader ändå, och antalet är litet.
  const [rader, kopplingar] = await Promise.all([
    client.rest(`tags?select=id,name&household_id=eq.${household.id}&order=name.asc`),
    client.rest('recipe_tags?select=tag_id'),
  ]);

  tags = rader;
  antal = new Map();
  for (const rad of kopplingar) antal.set(rad.tag_id, (antal.get(rad.tag_id) ?? 0) + 1);

  render();
  setStatus(tags.length
    ? `${tags.length} ${tags.length === 1 ? 'kategori' : 'kategorier'}.`
    : 'Inga kategorier ännu. Skapa den första ovan.', 'ok');
}

function render() {
  if (!tags.length) {
    const tom = document.createElement('li');
    tom.className = 'empty';
    tom.textContent = 'Inga kategorier ännu.';
    els.list.replaceChildren(tom);
    return;
  }

  els.list.replaceChildren(...tags.map((tag) => {
    const n = antal.get(tag.id) ?? 0;

    const li = document.createElement('li');

    const namn = document.createElement('span');
    namn.className = 'tag';
    namn.textContent = tag.name;

    const räkning = document.createElement('span');
    räkning.className = 'source';
    räkning.textContent = n === 0 ? 'används inte' : `${n} recept`;

    const bort = document.createElement('button');
    bort.type = 'button';
    bort.className = 'linkbutton';
    bort.textContent = 'Ta bort';
    bort.addEventListener('click', guard(() => taBort(tag, n)));

    li.append(namn, räkning, bort);
    return li;
  }));
}

async function skapa() {
  const name = normalizeTag(els.newName.value);
  if (!name) return;

  if (tags.some((tag) => tag.name === name)) {
    setStatus(`Kategorin ${name} finns redan.`, 'warn');
    els.newName.value = '';
    return;
  }

  setStatus('Skapar …');
  await upsertTags(client, household.id, [name]);
  els.newName.value = '';
  await ladda();
  setStatus(`Kategorin ${name} är skapad. Sätt den på recepten från startsidan.`, 'ok');
}

async function taBort(tag, n) {
  // Alltid en fråga, även för en oanvänd kategori. Borttagningen går inte att
  // ångra, och knappen sitter bredvid en rad likadana.
  //
  // Texten säger vad som faktiskt händer: en använd kategori försvinner från
  // varje recept den satt på, vilket främmande nyckelns cascade sköter. Att
  // en borttagning här ändrar recept man inte tittar på är inte uppenbart.
  const följd = n > 0
    ? `Den försvinner från ${n} recept. Recepten själva rörs inte.`
    : 'Den används inte av något recept.';

  if (!confirm(`Ta bort kategorin "${tag.name}"?\n\n${följd}`)) return;

  setStatus(`Tar bort ${tag.name} …`);
  await client.rest(`tags?id=eq.${tag.id}`, {
    method: 'DELETE',
    headers: { prefer: 'return=minimal' },
  });

  await ladda();
  setStatus(`Kategorin ${tag.name} är borttagen.`, 'ok');
}
