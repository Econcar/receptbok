#!/usr/bin/env node
// Pre-deploy-spärr. Körs av .githooks/pre-push och stoppar pushen vid fel –
// `git push` deployar direkt till Cloudflare, så det här är sista kontrollen.

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const steps = [
  { name: 'Syntaxkontroll', run: () => node(['scripts/check-syntax.mjs']) },
  { name: 'Enhetstester', run: () => node(['--test', 'tests/*.test.mjs']) },
  { name: 'Inga läckta hemligheter', run: checkSecrets },
];

let failures = 0;
for (const step of steps) {
  process.stdout.write(`→ ${step.name} … `);
  const result = await step.run();
  if (result === true) {
    console.log('OK');
  } else {
    failures += 1;
    console.log('FEL');
    if (typeof result === 'string') console.error(`  ${result}`);
  }
}

if (failures) {
  console.error(`\n✗ Pre-deploy-spärren stoppade ${failures} steg. Pushen avbryts.`);
  process.exit(1);
}
console.log('\n✓ Allt grönt – ok att pusha.');

function node(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  return result.status === 0 ? true : `${args.join(' ')} gav exit-kod ${result.status}`;
}

/**
 * Service-nyckeln får aldrig hamna i det som deployas. Supabase service-JWT:er
 * innehåller rollen i payloaden – vi letar efter den och efter uppenbara
 * nyckelnamn i frontendfiler.
 */
async function checkSecrets() {
  const files = ['public/config.js', 'public/app.js', 'public/sw.js', 'public/index.html'];
  const problems = [];

  for (const file of files) {
    let text;
    try {
      text = await readFile(new URL(file, `file://${root.replace(/\\/g, '/')}`), 'utf8');
    } catch {
      continue;
    }
    if (/service_role/i.test(text)) problems.push(`${file}: innehåller "service_role"`);
    if (/SUPABASE_SERVICE_ROLE_KEY/.test(text)) problems.push(`${file}: refererar service-nyckeln`);
  }

  return problems.length ? problems.join('; ') : true;
}
