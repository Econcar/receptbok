# Projektstart: Leasingbil-skanner

> Startdokument för projektet. Ge det till en ny Claude-chatt som första kontext.

## 1. I en mening

En webbtjänst som regelbundet skannar svenska leasingerbjudanden, normaliserar dem per
bilmodell/utrustning, och flaggar vilka som är **bra pris** jämfört med en baslinje.

## 2. Mål och avgränsning

- **Måste:** samla in leasingannonser automatiskt, visa dem i en sökbar/filtrerbar lista,
  och räkna ut om ett pris är bra (mot snitt för samma modell).
- **Vill:** bevakningar + notis när ett bra erbjudande dyker upp (Telegram/e-post/PWA-push).
- **Inte nu:** native app, betalflöden, konto-koppling mot leasinggivare.

## 3. Arkitektur (återanvänd den beprövade stacken från conny-stocks)

- **Frontend:** statisk sida på **Cloudflare Pages** (vanilla JS eller ES-moduler, inget
  byggsteg). Byggs som **PWA** från dag ett (manifest + service worker) → installerbar på
  mobilen, offline-cache, push senare.
- **Proxys:** **Cloudflare Pages Functions** i `functions/api/*.js` – all extern hämtning via
  dem (CORS + ev. nycklar dolda). Nås som `/api/<namn>`.
- **Databas & auth:** **Supabase** (Postgres + RLS + Google-inloggning). Bevakningar/
  användardata bakom RLS; skannad annonsdata är global läsdata.
- **Motor (skanner):** schemalagt **GitHub Actions**-jobb (dependency-fritt Node, global
  `fetch`) som körs t.ex. var 6:e timme, hämtar källorna, normaliserar och skriver till
  Supabase med service-nyckeln. Frontend läser färdig data.
- **Deploy:** `git push` → Cloudflare bygger automatiskt. **Pre-deploy-spärr** kör
  `node --check` + enhetstester (Nodes inbyggda `node --test`) och stoppar push vid fel.

Håll backend som **rena JSON-API:er** så en framtida native-app kan plugga in utan omskrivning.
OBS: projektet ligger på Google Drive (G:\) där lokala `npm install` är opålitliga – därför
inget byggsteg och inbyggd testkörare. Deploy via GitHub→Cloudflare, inte lokalt.

## 4. Avgörande första steget: kartlägg datakällorna

Datakällan är hela matchen. För varje tänkbar källa: officiellt API? RSS/feed? Bara HTML att
skrapa? Kandidater att undersöka: Blocket, Bytbil o.likn., leasingspecifika sajter,
återförsäljares/tillverkares **kampanjsidor**, prisjämförelser. Dokumentera per källa: URL,
hämtningssätt, fält (modell, utrustning, månadskostnad, kontantinsats, löptid, körsträcka/år,
restvärde), uppdateringstakt, och **villkor/ToS + robots.txt**.

**Leverabel fas 1:** en tabell över källor + beslut om vilka 1–2 vi börjar med.

## 5. Datamodell (utkast, Supabase)

```
listings (
  id, source, external_id, url,
  brand, model, trim, fuel, year,
  monthly_sek, down_payment_sek, term_months, km_per_year, residual_sek,
  first_seen, last_seen, updated_at
  -- unik: (source, external_id)
)
```

Separat baslinje per modell (median effektiv månadskostnad) → **deal score** = hur mycket
under baslinjen ett erbjudande ligger. Det är den intressanta logiken.

## 6. "Bra pris"-logiken

- Normalisera bort äpplen-och-päron: olika löptid/körsträcka/kontantinsats ger olika
  månadskostnad. Räkna om till **effektiv månadskostnad** (inkl. utslagen kontantinsats)
  innan jämförelse.
- Baslinje = median/percentil för samma modell+utrustning över tid.
- Flagga när ett nytt erbjudande ligger X % under baslinjen → kandidat för notis.
- Var konservativ: hellre få starka träffar än många svaga.

## 7. Kvalitet & drift

- Enhetstester på ren logik (normalisering, deal-score, dubblettfilter).
- Pre-deploy-spärr i deploy-skriptet.
- **Skrapning är skör:** varje källa kan sluta fungera utan förvarning. Logga tydligt när en
  källa ger 0 rader eller ändrat format; låt aldrig en trasig källa fälla hela jobbet.
- Moln-IP kan straffas hårdare (429) än en hemmauppkoppling – testa skanningen från GitHub
  Actions tidigt, inte bara lokalt.

## 8. Konkreta första steg

1. Repo + tom Cloudflare Pages-sajt (deployas direkt).
2. Supabase-projekt + kör `listings`-schemat.
3. **Fas 1: datakällskartläggning** (avsnitt 4) – innan mer kod.
4. Första skanner-adaptern för bästa källan → skriv till `listings`.
5. Frontend: lista + filter (märke/modell/pris/löptid) som läser `listings`.
6. Deal-score + baslinje.
7. Bevakning + notis.

## 9. Öppna beslut (bestäms i projektet)

- Notiskanal (Telegram vs PWA-push vs e-post).
- Skanningstakt per källa.
- Geografi (hela Sverige eller region).
- Privat- vs företagsleasing (olika prislogik).
