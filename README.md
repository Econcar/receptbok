# Receptbok

Hushållets receptsamling: importera recept från en länk, laga efter dem i köket, och
få ut en inköpslista för veckans rätter.

Startdokument: [docs/projektstart.md](docs/projektstart.md)

> Projektet är en ombyggnad av en leasingskanner som lades ned när det visade sig att
> källsajten redan gjorde jobbet bättre. Stacken, PWA-skalet och ld+json-läsaren är
> ärvda och genomtestade; domänkoden är ny. Historiken finns kvar i git.

## Stack

| Del | Teknik |
| --- | --- |
| Frontend | Statisk PWA på Cloudflare Pages (`public/`), inget byggsteg |
| Proxy | Cloudflare Pages Functions (`functions/api/*.js`) → `/api/<namn>` |
| Databas & auth | Supabase (Postgres + RLS + Google-inloggning) |
| Delad logik | `lib/`, skriven för både Node och Workers |
| Tester | Nodes inbyggda `node --test` (inga beroenden) |

Projektet ligger på Google Drive (G:\) där lokala `npm install` är opålitliga – därför
**inga npm-beroenden**, inget byggsteg, och deploy via GitHub → Cloudflare (inte lokalt).

## Mappar

```
public/              Statisk frontend (Cloudflare Pages root)
  index.html/app.js    Listsidan: recepten med bild, filtrerade på kategori
  nytt.html/nytt.js    Inmatningssidan: import, översättning, handinmatning
  veckan.html/…js      Veckoplanen och inköpslistan som räknas fram ur den
  session.js           Delat av alla: inloggning, kontorad, hushåll
functions/api/       Pages Functions, en fil per endpoint
lib/                 Delad logik: ld+json, HTTP, tolkning, översättning. Inga
                     Node-API:er – koden körs både i Node och på Workers.
                     Nås inte från webbläsaren; public/ är Pages output root
db/                  SQL-schema för Supabase + RLS-testet
tests/               node --test
scripts/             Pre-deploy-spärr m.m.
docs/                Projektdokumentation
```

## Kommandon

```bash
npm test          # node --check på alla .js + node --test tests/
npm run check     # bara syntaxkontroll
npm run predeploy # pre-deploy-spärr (körs av pre-push-hooken)
```

Installera pre-push-spärren en gång per klon:

```bash
git config core.hooksPath .githooks
```

## Miljövariabler

Frontend (`public/config.js`, publika värden – anon-nyckeln är avsedd att exponeras och
skyddas av RLS):

| Namn | Beskrivning |
| --- | --- |
| `SUPABASE_URL` | `https://<projekt>.supabase.co` – **bara roten**, ingen sökväg |
| `SUPABASE_ANON_KEY` | Publik anon-nyckel |

Pages Functions (Cloudflare → Settings → **Variables and Secrets**). Functions läser inte
`config.js` utan har en egen miljö, och variabler slår igenom först efter en ny deploy:

| Namn | Typ | Beskrivning |
| --- | --- | --- |
| `SUPABASE_URL` | Text | Samma rot som ovan |
| `SUPABASE_ANON_KEY` | Text | Samma anon-nyckel; används för att verifiera inloggning |
| `ANTHROPIC_API_KEY` | **Secret** | Översättningen i `/api/translate`. Till skillnad från anon-nyckeln är den här hemlig och får aldrig hamna i `public/` |

## Uppsättning

1. **Supabase:** projekt → SQL Editor → kör [db/schema.sql](db/schema.sql), och därefter
   [db/rls-test.sql](db/rls-test.sql) som ska sluta med *RLS-testet gick igenom*. Testet
   rullar tillbaka sig självt och lämnar inga spår. Aktivera Google som auth-provider.

   Återanvänds leasingprojektets Supabase-projekt körs [db/drop-leasing.sql](db/drop-leasing.sql)
   först – en gång, medvetet, den raderar de gamla annonserna för gott.
2. **Cloudflare Pages:** projekt kopplat till repot. Build command: *(tomt)*.
   Build output directory: `public`. Functions hittas automatiskt i `functions/`.
3. Fyll i `public/config.js`. Sidan visar själv om kopplingen fungerar.

**Läs [avsnitt 11 i projektstart.md](docs/projektstart.md) före uppsättningen.** Där står
fyra fällor som kostade en kväll förra gången – bland annat att Supabases nya
`sb_secret_`-nycklar inte fungerade mot Data API:t, och att `SUPABASE_URL` inte får
innehålla `/rest/v1/`.

## Status

- [x] Stommen: PWA-skal, Pages Functions, pre-deploy-spärr, CI
- [x] `lib/ldjson.mjs` – läser schema.org-data ur en sida (grunden för receptimporten)
- [x] Fas 1: schema, Google-inloggning, hushåll – RLS bevisad med `db/rls-test.sql`
- [x] Fas 2: import från länk, manuell inmatning, översättning av engelska recept,
      bilder och kategorier
- [x] Fas 3: kökläget – sök, receptvy, offline, wake lock
- [ ] Fas 4: ingredienstolkning
- [ ] Fas 5: veckoplan + inköpslista
- [ ] Fas 6: inbjudan till hushållet
