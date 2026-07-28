# Projektstart: Receptsamlingen

> Startdokument för det projekt som ersätter leasingskannern. Samma stack, ny domän.
> Utkast 2026-07-27 – avsnitt 10 är beslut som ska fattas innan bygget börjar.

## 1. I en mening

En webbtjänst där hushållet samlar sina matrecept, lagar efter dem i köket, och
får ut en inköpslista för veckans rätter.

## 2. Mål och avgränsning

- **Måste:** samla recept (importerade från länk eller inmatade för hand), kunna
  söka och läsa dem medan man lagar mat, och slå ihop flera recept till en inköpslista.
- **Vill:** veckoplanering, skalning av portioner, taggar och filtrering.
- **Inte nu:** publik receptdelning, kommentarer, näringsberäkning, native app.

Samlingen är **hushållets**, inte världens. Det är en medveten avgränsning som tar bort
moderering, publika profiler och missbruksskydd ur bygget – och gör upphovsrättsfrågan
i avsnitt 6 hanterlig.

## 3. Arkitektur (ärvd från leasingprojektet, beprövad)

- **Frontend:** statisk PWA på **Cloudflare Pages**, inget byggsteg. Här är PWA:n inte
  en gimmick: receptet ska gå att läsa i köket med skitiga händer, utan nät och utan
  att skärmen släcks.
- **Proxy:** **Cloudflare Pages Functions** i `functions/api/*.js`. Behövs för
  receptimporten – webbläsaren kan inte hämta en receptsida direkt (CORS), så
  `/api/import?url=…` hämtar och tolkar åt den.
- **Databas & auth:** **Supabase** (Postgres + RLS + Google-inloggning). RLS är
  huvudsaken här, inte en detalj: recept är hushållets privata data, till skillnad från
  leasingannonserna som var global läsdata.
- **Ingen skanner.** Det schemalagda GitHub Actions-jobbet försvinner. Import sker när
  användaren klistrar in en länk, inte var sjätte timme.

Pages Functions kör på Workers, inte Node. Delad kod får därför bara använda
webbstandarder (`fetch`, `URL`, `JSON`) – inga Node-moduler. Tolkningskoden vi
återanvänder är ren sträng- och JSON-hantering och klarar det.

## 4. Det som följer med från leasingskannern

| Fil | Vad den blir |
| --- | --- |
| `scanner/sources/alleasing.mjs` → `extractProductLd` | Grunden för receptimporten. Byter `@type: Product` mot `@type: Recipe` |
| `scanner/lib/normalize.mjs` | Mönstret, inte innehållet: rena funktioner som städar fritext, enhetstestade separat |
| `scanner/lib/http.mjs` | Hämtning med timeout och retry |
| `db/schema.sql` | RLS-uppsättningen, `security_invoker` på vyer, `touch_updated_at`-triggern |
| `public/` | PWA-skalet: manifest, service worker, ikoner |
| `scripts/`, `.githooks/`, `.github/workflows/ci.yml` | Syntaxkoll, pre-deploy-spärr, CI |

Resten av `scanner/` – `pricing.mjs`, `dedupe.mjs`, adaptrarna, `run.mjs` – utgår.

## 5. Datamodell (utkast)

```
households (id, name, created_at)
household_members (household_id, user_id, role)     -- 'owner' | 'member'

recipes (
  id, household_id, created_by,
  title, source_url, source_name, image_url,
  servings, total_time_min, instructions, notes,
  source_ldjson,               -- hela blocket sajten publicerade
  created_at, updated_at
)

recipe_ingredients (
  id, recipe_id, position,
  raw_text,                    -- "2 dl vispgrädde" – alltid sparad
  quantity, unit, note         -- ingredient_id tillkommer i fas 4
)

ingredients (id, canonical_name, category)          -- "grädde", "mejeri"

tags (id, household_id, name)
recipe_tags (recipe_id, tag_id)

meal_plan (id, household_id, date, recipe_id, servings)
shopping_list_items (id, household_id, ingredient_id, quantity, unit, checked, source)
```

**`raw_text` sparas alltid**, även när tolkningen lyckas. Samma princip som `raw`-kolumnen
i `listings`: tolkningen kan förbättras i efterhand utan att något behöver importeras om,
och när parsern har fel syns originalet.

## 6. Import: ld+json är nyckeln

Svenska receptsajter (ICA, Coop, Arla, Recept.se, Köket.se) publicerar
`<script type="application/ld+json">` med `@type: Recipe` enligt schema.org:
`name`, `recipeIngredient[]`, `recipeInstructions[]`, `recipeYield`, `totalTime`, `image`.

Det är samma teknik vi redan använder mot alleasing, och det gör importen både
robustare och snällare än HTML-skrapning. Faller den bort får användaren mata in för hand –
ingen halvtolkad soppa.

**Upphovsrätt, kort och ärligt:** en ingredienslista är i praktiken en fakta­uppräkning,
men den skrivna tillagningstexten är skyddad. Att spara kopior för hushållets eget bruk är
en sak; att publicera dem vidare är en annan. Därför: spara alltid `source_url` och länka
tillbaka, och bygg aldrig om det här till en publik receptsajt utan att tänka om.

## 7. Ingredienstolkning – projektets svåraste del

`"2 dl vispgrädde"` → `{ quantity: 2, unit: 'dl', ingredient: 'vispgrädde' }`

Svenska mått: `dl`, `msk`, `tsk`, `krm`, `g`, `kg`, `st`, `klyfta`, `förp`, `påse`, `burk`.
Plus bråk (`½`, `1/2`), intervall (`2–3 dl`), och kvalificerare (`ca`, `finhackad`,
`riven`, `efter smak`).

Det här är `normalize.mjs` om igen: rena funktioner, inga beroenden, tungt enhetstestade.

**Sammanslagningen till inköpslista är svårare än tolkningen.** `2 dl` + `1 dl` går att
addera. `2 dl grädde` + `1 paket grädde` gör det inte. Regeln blir: slå bara ihop när
enheten är identisk eller konverterbar, och lista resten som separata rader. Hellre två
rader "grädde" än en felaktig summa som gör att man står i butiken och gissar.

Två kända begränsningar att skriva in redan nu:

- **Skalning av portioner är inte linjär.** Kryddor, salt och tillagningstid följer inte
  antalet portioner. Skala mängderna, men flagga att det är en approximation.
- **Samma vara har många namn.** "vispgrädde", "grädde 40 %", "matlagningsgrädde".
  `ingredients`-tabellen med kanoniska namn är till för det, men den behöver fyllas på
  efterhand – automatik löser det inte.

## 8. Faser

1. **Schema + inloggning + hushåll.** Google-auth, `households`, RLS som faktiskt testas:
   en användare i ett hushåll ska inte se ett annat hushålls recept.
2. **Import och manuell inmatning.** `/api/import`, ld+json-tolkning, formulär.
   Ingredienser sparas som `raw_text` – ingen tolkning ännu.
3. **Kökläget.** Sök, läsvänlig receptvy, offline via service worker, wake lock.
   Här kommer första verkliga nyttan.
4. **Ingredienstolkning.** `raw_text` → mängd, enhet, vara. Går att köra om på befintliga
   recept eftersom originalet finns kvar.
5. **Veckoplan och inköpslista.** Sammanslagning, gruppering, avbockning.
6. **Inbjudan till hushållet.** Dela samlingen med familjen.

Fas 3 före fas 4 med flit: en sökbar receptsamling är användbar redan innan en enda
ingrediens är tolkad.

## 9. Kvalitet & drift

- Enhetstester på ren logik: ingredienstolkning, sammanslagning, portionsskalning.
- Pre-deploy-spärr (`node --check` + `node --test`) före push.
- **RLS ska testas, inte antas.** Det är den enda mekanism som håller isär hushållen.
- Importen är skör på samma sätt som skrapning var: en sajt kan sluta publicera ld+json
  när som helst. Misslyckad import ska säga det rakt ut och erbjuda manuell inmatning.

## 10. Öppna beslut

- ~~**Namn på projektet.**~~ Avgjort: `receptbok`. Repot är omdöpt.
- ~~**Bilder:**~~ Avgjort: länk till källan. Gratis, upphovsrättsligt enklare, och
  försvinner bilden krymper kortet i stället för att visa en trasig ikon. Blir det
  ett problem i praktiken är Supabase Storage kvar som möjlighet.
- ~~**Offline:**~~ Avgjort: bara läsa. Redigering offline hade krävt konflikthantering –
  två personer som ändrar samma recept utan nät – och det är ett gränsfall i ett hushåll.
  Recepten sparas lokalt vid varje lyckad hämtning och visas därifrån när nätet saknas.
- **Inköpslistan:** gruppera per butiksavdelning (mejeri, grönt, torrvaror)? Kräver att
  `ingredients.category` fylls i noggrant.
- ~~**Hushållsinbjudan:**~~ Avgjort: delbar länk. En inmatad adress kräver att man vet
  exakt vilket Google-konto den andra loggar in med, och gissar man fel händer ingenting
  alls – ett tyst fel är sämre än ett synligt. Länken bär i stället tre spärrar:
  engångsbruk, sju dagars giltighet, och bara ägare får skapa den.

## 11. Uppsättning: fällor vi redan gått i

Från leasingprojektets uppsättning 2026-07-26/27. Läs det här **före** nästa uppsättning.

1. **Supabases nya `sb_secret_`-nycklar fungerade inte** mot Data API:t – allt gav 401 med
   tom svarskropp. Legacy `service_role` (`eyJ…`) fungerade direkt. Börja där.
2. **`SUPABASE_URL` ska vara enbart roten**, `https://<ref>.supabase.co`, utan `/rest/v1/`.
   Koden lägger till sökvägen. GitHub maskerar hela secret-värdet i loggen, så ett fel här
   syns inte – felsök genom att testa nyckeln lokalt med `Invoke-WebRequest` först.
3. **`percentile_cont` returnerar `double precision`** även för `numeric`-kolumner, vilket
   kraschar `round(…, 1)`. Casta i vyn. Gäller varje projekt som räknar medianer i SQL.
4. **Google Drive låser `.git`** mitt under operationer. Vid `could not lock config file`:
   ta bort `.git/*.lock` när ingen git-process kör.
5. **Verifiera i molnet tidigt.** Kör en `workflow_dispatch` innan något byggs vidare på –
   moln-IP och lokal uppkoppling beter sig olika.
