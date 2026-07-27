// Handrullad Supabase-klient för webbläsaren: inloggning via Google och
// läsning/skrivning mot PostgREST.
//
// Varför inte supabase-js? Två skäl, båda struktuella.
//
// public/ är Cloudflares output directory, så lib/ ligger utanför det som
// serveras och kan inte importeras härifrån. Och ett CDN-import cachas aldrig
// av service workern – public/sw.js hoppar över allt som inte är samma origin.
// Receptet ska gå att läsa i köket utan nät, och då kan inloggningskoden inte
// bo hos någon annan.
//
// Filen rör inga globaler av sig själv: storage och location skickas in av
// anroparen. Det är därför de rena delarna går att köra under node --test,
// precis som lib/ldjson.mjs.

/** Adressen användaren skickas till för att logga in hos Google. */
export function authorizeUrl(baseUrl, { provider = 'google', redirectTo } = {}) {
  const params = new URLSearchParams({ provider });
  if (redirectTo) params.set('redirect_to', redirectTo);
  return `${trimUrl(baseUrl)}/auth/v1/authorize?${params}`;
}

/**
 * Supabase skickar tillbaka resultatet i URL:ens fragment, inte i query –
 * fragmentet når aldrig servern, vilket är hela poängen med att lägga tokens
 * där. Både lyckat och misslyckat svar landar här.
 *
 * @returns {{ session: object|null, error: string|null }}
 */
export function parseSessionFromHash(hash, now = Date.now()) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));

  const error = params.get('error_description') || params.get('error');
  if (error) return { session: null, error };

  const accessToken = params.get('access_token');
  if (!accessToken) return { session: null, error: null };

  // expires_at kommer i sekunder när det kommer alls; expires_in är relativt.
  // Vi normaliserar till millisekunder så att jämförelser blir raka.
  const expiresAt = Number(params.get('expires_at'));
  const expiresIn = Number(params.get('expires_in'));

  return {
    session: {
      access_token: accessToken,
      refresh_token: params.get('refresh_token') ?? null,
      token_type: params.get('token_type') ?? 'bearer',
      expires_at: Number.isFinite(expiresAt) && expiresAt > 0
        ? expiresAt * 1000
        : now + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    },
    error: null,
  };
}

/** Marginalen finns för att slippa skicka ett token som hinner gå ut på vägen. */
export function isExpired(session, now = Date.now(), skewMs = 60_000) {
  if (!session?.expires_at) return true;
  return session.expires_at - skewMs <= now;
}

/**
 * Läser ut nyttolasten ur ett JWT. Ingen signaturkontroll – den hör hemma på
 * servern, och Postgres gör den vid varje anrop. Här vill vi bara veta vem
 * användaren säger sig vara för att kunna skriva ut namnet i gränssnittet.
 */
export function decodeJwtPayload(token) {
  const part = String(token ?? '').split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(part.length / 4) * 4, '=');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null; // Ett obegripligt token är inte värt att krascha sidan för.
  }
}

export class RestError extends Error {
  constructor(status, body) {
    super(body?.message || `Supabase svarade ${status}`);
    this.name = 'RestError';
    this.status = status;
    this.body = body;
  }
}

const STORAGE_KEY = 'receptbok.session';

/**
 * @param {object} opts
 * @param {string} opts.url  Supabase-projektets rot, utan /rest/v1
 * @param {string} opts.key  Publik anon-nyckel
 * @param {Storage} [opts.storage]   Default localStorage
 * @param {Location} [opts.location] Default window.location
 * @param {History} [opts.history]   Default window.history
 */
export function createClient({ url, key, storage, location, history } = {}) {
  const base = trimUrl(url);
  const store = storage ?? globalThis.localStorage;
  const loc = location ?? globalThis.location;
  const hist = history ?? globalThis.history;

  let session = readStored();
  let refreshing = null;

  function readStored() {
    try {
      const raw = store?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // Privat läge eller trasigt värde – behandla som utloggad.
    }
  }

  function persist(next) {
    session = next;
    try {
      if (next) store?.setItem(STORAGE_KEY, JSON.stringify(next));
      else store?.removeItem(STORAGE_KEY);
    } catch {
      // Utan lagring fungerar sidan, men bara tills fliken stängs.
    }
  }

  /**
   * Plockar upp en session ur adressfältet efter återkomsten från Google och
   * städar bort fragmentet – annars ligger ett giltigt token kvar i historiken
   * och i allt användaren råkar dela.
   */
  function consumeRedirect() {
    const { session: fresh, error } = parseSessionFromHash(loc?.hash ?? '');
    if (fresh) persist(fresh);

    if (fresh || error) {
      // replaceState och inte location.replace: det senare är en navigering och
      // laddar om sidan mitt i uppstarten.
      const clean = `${loc?.pathname ?? '/'}${loc?.search ?? ''}`;
      if (hist?.replaceState) hist.replaceState(null, '', clean);
      else loc?.replace?.(clean);
    }
    return { session: fresh, error };
  }

  async function refresh() {
    if (!session?.refresh_token) return null;
    // En enda förnyelse i taget: två samtidiga anrop bränner varandras token.
    refreshing ??= (async () => {
      try {
        const res = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { apikey: key, 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        if (!res.ok) {
          persist(null); // Förbrukat eller återkallat – be om ny inloggning.
          return null;
        }
        const data = await res.json();
        persist({
          access_token: data.access_token,
          refresh_token: data.refresh_token ?? session.refresh_token,
          token_type: data.token_type ?? 'bearer',
          expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
        });
        return session;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** Giltig session, förnyad vid behov, eller null. */
  async function getSession() {
    if (!session) return null;
    if (!isExpired(session)) return session;
    return refresh();
  }

  function signIn(redirectTo = loc?.origin) {
    loc.assign(authorizeUrl(base, { provider: 'google', redirectTo }));
  }

  async function signOut() {
    const token = session?.access_token;
    persist(null);
    if (!token) return;
    // Serverns utloggning är en artighet – lokalt är vi redan utloggade.
    await fetch(`${base}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  /**
   * PostgREST med användarens token, så att RLS gäller. Utan session skickas
   * anon-nyckeln, och då stoppas anropet av rättigheterna – vilket är avsikten.
   */
  async function rest(path, { method = 'GET', body, headers = {} } = {}) {
    const current = await getSession();
    const token = current?.access_token ?? key;

    const res = await fetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) throw new RestError(res.status, data ?? { message: text.slice(0, 200) });
    return data;
  }

  /**
   * Insert. `returning: 'minimal'` behövs när raden inte är läsbar i samma
   * ögonblick som den skrivs – RETURNING kräver att select-policyn passerar,
   * och för ett nyss skapat hushåll hinner medlemsraden inte finnas än.
   */
  const insert = (table, row, { returning = 'representation' } = {}) => rest(table, {
    method: 'POST',
    body: row,
    headers: { prefer: `return=${returning}` },
  });

  return {
    consumeRedirect,
    getSession,
    signIn,
    signOut,
    rest,
    insert,
    get user() {
      return session ? decodeJwtPayload(session.access_token) : null;
    },
  };
}

function trimUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
