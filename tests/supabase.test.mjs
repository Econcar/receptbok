import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authorizeUrl,
  createClient,
  decodeJwtPayload,
  isExpired,
  parseSessionFromHash,
} from '../public/supabase.js';

// public/supabase.js rör inga globaler av sig själv – storage och location
// skickas in – så filen går att importera rakt av under node --test trots att
// den är skriven för webbläsaren.

const URL_BASE = 'https://exempel.supabase.co';

/** Bygger ett JWT utan signatur. Klienten läser bara nyttolasten. */
function jwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.signatur`;
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

function fakeLocation(hash = '') {
  return {
    origin: 'https://receptbok.pages.dev',
    pathname: '/',
    search: '',
    hash,
    assigned: null,
    replaced: null,
    assign(url) { this.assigned = url; },
    replace(url) { this.replaced = url; },
  };
}

test('inloggningsadressen pekar på providern och tillbaka till oss', () => {
  const url = new URL(authorizeUrl(URL_BASE, {
    provider: 'google',
    redirectTo: 'https://receptbok.pages.dev',
  }));

  assert.equal(url.origin + url.pathname, `${URL_BASE}/auth/v1/authorize`);
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('redirect_to'), 'https://receptbok.pages.dev');
});

test('avslutande snedstreck i URL:en ger inte dubbla', () => {
  assert.ok(authorizeUrl(`${URL_BASE}/`).startsWith(`${URL_BASE}/auth/v1/authorize?`));
});

test('sessionen läses ur fragmentet och expires_in blir absolut tid', () => {
  const now = 1_700_000_000_000;
  const { session, error } = parseSessionFromHash(
    '#access_token=abc&refresh_token=def&token_type=bearer&expires_in=3600',
    now,
  );

  assert.equal(error, null);
  assert.equal(session.access_token, 'abc');
  assert.equal(session.refresh_token, 'def');
  assert.equal(session.expires_at, now + 3600_000);
});

test('expires_at i sekunder vinner över expires_in', () => {
  const { session } = parseSessionFromHash('#access_token=abc&expires_at=1700000000&expires_in=60');
  assert.equal(session.expires_at, 1_700_000_000_000);
});

test('ett avbrutet Google-flöde ger felet, inte en halv session', () => {
  const { session, error } = parseSessionFromHash(
    '#error=access_denied&error_description=Anv%C3%A4ndaren+avbr%C3%B6t',
  );

  assert.equal(session, null);
  assert.equal(error, 'Användaren avbröt');
});

test('tomt fragment är varken session eller fel', () => {
  assert.deepEqual(parseSessionFromHash(''), { session: null, error: null });
  assert.deepEqual(parseSessionFromHash(null), { session: null, error: null });
});

test('marginalen gör att ett token som snart går ut räknas som utgånget', () => {
  const now = 1_000_000;
  assert.equal(isExpired({ expires_at: now + 300_000 }, now), false);
  assert.equal(isExpired({ expires_at: now + 30_000 }, now), true, 'inom marginalen');
  assert.equal(isExpired({ expires_at: now - 1 }, now), true);
  assert.equal(isExpired(null, now), true);
});

test('nyttolasten läses ur ett JWT, även med svenska tecken', () => {
  const payload = decodeJwtPayload(jwt({ sub: 'abc-123', email: 'åsa@exempel.se' }));

  assert.equal(payload.sub, 'abc-123');
  assert.equal(payload.email, 'åsa@exempel.se');
});

test('ett trasigt token ger null i stället för att krascha sidan', () => {
  assert.equal(decodeJwtPayload('inte-ett-jwt'), null);
  assert.equal(decodeJwtPayload(''), null);
  assert.equal(decodeJwtPayload(null), null);
});

test('återkomsten från Google sparar sessionen och städar bort fragmentet', () => {
  const storage = fakeStorage();
  const location = fakeLocation('#access_token=abc&refresh_token=def&expires_in=3600');
  const client = createClient({ url: URL_BASE, key: 'anon', storage, location });

  const { session, error } = client.consumeRedirect();

  assert.equal(error, null);
  assert.equal(session.access_token, 'abc');
  assert.equal(location.replaced, '/', 'token får inte ligga kvar i adressfältet');
  assert.ok(storage.getItem('receptbok.session'), 'sessionen ska överleva en omladdning');
});

test('en sparad session plockas upp vid nästa sidladdning', async () => {
  const storage = fakeStorage();
  storage.setItem('receptbok.session', JSON.stringify({
    access_token: jwt({ sub: 'abc-123', email: 'anna@exempel.se' }),
    refresh_token: 'def',
    expires_at: Date.now() + 3600_000,
  }));

  const client = createClient({ url: URL_BASE, key: 'anon', storage, location: fakeLocation() });

  assert.ok(await client.getSession());
  assert.equal(client.user.email, 'anna@exempel.se');
});

test('utgången session förnyas mot /auth/v1/token', async () => {
  const storage = fakeStorage();
  storage.setItem('receptbok.session', JSON.stringify({
    access_token: 'gammalt',
    refresh_token: 'def',
    expires_at: Date.now() - 1,
  }));

  const calls = [];
  const client = createClient({
    url: URL_BASE,
    key: 'anon',
    storage,
    location: fakeLocation(),
  });

  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ access_token: 'nytt', refresh_token: 'ghi', expires_in: 3600 }),
      { status: 200 },
    );
  };

  try {
    const session = await client.getSession();
    assert.equal(session.access_token, 'nytt');
    assert.equal(calls[0].url, `${URL_BASE}/auth/v1/token?grant_type=refresh_token`);
    assert.equal(calls[0].body.refresh_token, 'def');
  } finally {
    globalThis.fetch = original;
  }
});

test('avvisad förnyelse loggar ut i stället för att fastna', async () => {
  const storage = fakeStorage();
  storage.setItem('receptbok.session', JSON.stringify({
    access_token: 'gammalt',
    refresh_token: 'förbrukat',
    expires_at: Date.now() - 1,
  }));

  const client = createClient({ url: URL_BASE, key: 'anon', storage, location: fakeLocation() });

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 400 });

  try {
    assert.equal(await client.getSession(), null);
    assert.equal(storage.getItem('receptbok.session'), null, 'den döda sessionen ska bort');
  } finally {
    globalThis.fetch = original;
  }
});

test('rest skickar användarens token så att RLS gäller', async () => {
  const storage = fakeStorage();
  const token = jwt({ sub: 'abc-123' });
  storage.setItem('receptbok.session', JSON.stringify({
    access_token: token,
    refresh_token: 'def',
    expires_at: Date.now() + 3600_000,
  }));

  const client = createClient({ url: URL_BASE, key: 'anon', storage, location: fakeLocation() });

  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, headers: init.headers };
    return new Response('[]', { status: 200 });
  };

  try {
    await client.rest('recipes?select=id');
    assert.equal(seen.url, `${URL_BASE}/rest/v1/recipes?select=id`);
    assert.equal(seen.headers.authorization, `Bearer ${token}`);
    assert.equal(seen.headers.apikey, 'anon', 'apikey är alltid anon-nyckeln');
  } finally {
    globalThis.fetch = original;
  }
});

test('ett fel från PostgREST kastas med status och meddelande', async () => {
  const client = createClient({ url: URL_BASE, key: 'anon', storage: fakeStorage(), location: fakeLocation() });

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: 'permission denied for table recipes' }),
    { status: 401 },
  );

  try {
    await assert.rejects(
      () => client.rest('recipes?select=id'),
      (err) => err.status === 401 && /permission denied/.test(err.message),
    );
  } finally {
    globalThis.fetch = original;
  }
});
