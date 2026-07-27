# Leasingbil-skanner

Webbtjänst som regelbundet skannar svenska leasingerbjudanden, normaliserar dem per
bilmodell/utrustning och flaggar vilka som är **bra pris** jämfört med en baslinje.

Startdokument: [docs/projektstart.md](docs/projektstart.md)
Datakällskartläggning (fas 1): [docs/datakallor.md](docs/datakallor.md)

## Stack

| Del | Teknik |
| --- | --- |
| Frontend | Statisk PWA på Cloudflare Pages (`public/`), inget byggsteg |
| Proxys | Cloudflare Pages Functions (`functions/api/*.js`) → `/api/<namn>` |
| Databas & auth | Supabase (Postgres + RLS + Google-inloggning) |
| Motor | Node-skript i `scanner/`, körs av GitHub Actions var 6:e timme |
| Tester | Nodes inbyggda `node --test` (inga beroenden) |

Projektet ligger på Google Drive (G:\) där lokala `npm install` är opålitliga – därför
**inga npm-beroenden**, inget byggsteg, och deploy via GitHub → Cloudflare (inte lokalt).

## Mappar

```
public/              Statisk frontend (Cloudflare Pages root)
functions/api/       Pages Functions, en fil per endpoint
scanner/             Skannermotorn (Node, global fetch)
  sources/           En adapter per datakälla
  lib/               Ren logik: normalisering, deal-score, dubbletter
db/                  SQL-schema för Supabase
tests/               node --test
scripts/             Pre-deploy-spärr m.m.
docs/                Projektdokumentation
```

## Kommandon

```bash
npm test          # node --check på alla .js + node --test tests/
npm run check     # bara syntaxkontroll
npm run scan      # kör skannern lokalt (kräver env, se nedan)
npm run predeploy # pre-deploy-spärr (körs av pre-push-hooken)
```

Installera pre-push-spärren en gång per klon:

```bash
git config core.hooksPath .githooks
```

## Miljövariabler

Skannern (GitHub Actions → Settings → Secrets and variables → Actions):

| Namn | Var | Beskrivning |
| --- | --- | --- |
| `SUPABASE_URL` | Actions secret | `https://<projekt>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Actions secret | Service-nyckel, **aldrig** i frontend |
| `SCAN_SOURCES` | valfri | Kommaseparerad lista, tom = alla aktiva |
| `DRY_RUN` | valfri | `1` = skriv inget till Supabase |
| `ALLEASING_MAX_OFFERS` | Actions **variable** | Sidor per körning (standard 400). Full svep tar flera körningar |
| `ALLEASING_DELAY_MS` | Actions **variable** | Paus mellan hämtningar (standard 1500) |

De två sista är *variables*, inte *secrets* – de är inte hemliga och ska gå att läsa av.
Tomma värden är ofarliga; adaptern använder sina standardvärden då.

Den schemalagda körningen är **avstängd** i [scan.yml](.github/workflows/scan.yml) tills det är
avgjort vad projektet ska bli. Skanningen startas manuellt via `workflow_dispatch`.

Frontend (`public/config.js`, publika värden – anon-nyckeln är avsedd att exponeras och
skyddas av RLS):

| Namn | Beskrivning |
| --- | --- |
| `SUPABASE_URL` | Samma projekt-URL |
| `SUPABASE_ANON_KEY` | Publik anon-nyckel |

## Uppsättning (engångs)

1. **GitHub:** skapa repo, `git remote add origin …`, `git push -u origin main`.
2. **Cloudflare Pages:** nytt projekt kopplat till repot. Build command: *(tomt)*.
   Build output directory: `public`. Functions hittas automatiskt i `functions/`.
3. **Supabase:** nytt projekt → SQL Editor → kör [db/schema.sql](db/schema.sql).
   Aktivera Google som auth-provider när bevakningar ska byggas.
4. Fyll i `public/config.js` och lägg Actions-secrets enligt tabellen ovan.
5. Kör workflowen `Skanna leasingerbjudanden` manuellt (workflow_dispatch) för att
   verifiera att skanningen fungerar **från moln-IP**, inte bara lokalt.

## Status

- [x] Steg 1–2: repo-struktur, PWA-skal, schema (Cloudflare/Supabase-konton sätts upp manuellt)
- [x] Steg 3: fas 1 – datakällskartläggning → [docs/datakallor.md](docs/datakallor.md).
      Beslut: börja med `alleasing` (volym) + `carplus` (facit).
- [x] Steg 4: första skanner-adaptern (`alleasing`) – RSC-flight-payload med ld+json som
      fallback, ~9 400 erbjudanden via sitemap. Verifierad med `DRY_RUN=1` mot live-sajten.
- [ ] Steg 4b: `carplus`-adaptern (facit mot alleasing)
- [ ] Steg 5: frontend lista + filter
- [ ] Steg 6: deal-score + baslinje
- [ ] Steg 7: bevakning + notis
