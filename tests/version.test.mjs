import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { VERSION } from '../public/version.js';

const rot = join(dirname(fileURLToPath(import.meta.url)), '..');
const läs = (fil) => readFileSync(join(rot, fil), 'utf8');

test('sw.js cachar under samma version som sidfoten visar', () => {
  // Glider de isär visar sidan en version medan cachen bär en annan, och då
  // säger sidfoten inte längre det den finns till för att säga. Det felet ser
  // dessutom ut som något helt annat: "jag pushade men det kom inte ut".
  const träff = /CACHE_VERSION = '([^']+)'/.exec(läs('public/sw.js'));

  assert.ok(träff, 'CACHE_VERSION hittades inte i sw.js');
  assert.equal(träff[1], VERSION);
});

test('versionen ser ut som en version', () => {
  assert.match(VERSION, /^v\d+$/);
});

test('varje sida hämtas av service workern', () => {
  // En sida som inte ligger i skalet fungerar inte utan nät, och det märks
  // inte förrän man står i köket utan täckning.
  const sw = läs('public/sw.js');

  for (const sida of ['/', '/nytt', '/veckan']) {
    assert.ok(sw.includes(`'${sida}'`), `${sida} saknas i sw.js SHELL`);
  }
});

test('varje modul sidorna importerar ligger i skalet', () => {
  const sw = läs('public/sw.js');
  const moduler = new Set();

  for (const sida of ['public/app.js', 'public/nytt.js', 'public/veckan.js', 'public/session.js']) {
    for (const m of läs(sida).matchAll(/from '(\/[\w.-]+\.js)'/g)) moduler.add(m[1]);
  }

  for (const modul of moduler) {
    assert.ok(sw.includes(`'${modul}'`), `${modul} importeras men saknas i sw.js SHELL`);
  }
});
