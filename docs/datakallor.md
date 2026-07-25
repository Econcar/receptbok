# Fas 1: Datakällskartläggning

> Leverabel enligt avsnitt 4 i [projektstart.md](projektstart.md): tabell över källor
> + beslut om vilka 1–2 vi börjar med.
> Kartlagt 2026-07-25. Uppgifterna nedan är verifierade genom att hämta robots.txt,
> sitemaps och exempelsidor – inte gissade. **Verifiera om innan en adapter byggs**,
> sajter byggs om.

## Avgränsning för fas 1

| Beslut | Val | Motivering |
| --- | --- | --- |
| Segment | **Privatleasing** först | Priserna är inkl. moms och direkt jämförbara. Företagsleasing har annan prislogik (ex moms, avdrag, förmånsvärde) och blandas den in blir baslinjen meningslös. `segment`-kolumnen finns redan i schemat för att kunna lägga till det senare. |
| Geografi | **Hela Sverige** | Leasingkampanjer är oftast rikstäckande. Ort är intressant först för lagerbilar. |
| Bilskick | Nya + "nästan nya" | Begagnat-leasing (re-leasing) har egen prisnivå – tas in senare med egen baslinje. |

## Kartlagda källor

Skala för **Värde**: hur mycket källan bidrar till en användbar baslinje (volym × fältkvalitet ÷ ansträngning).

| # | Källa | Typ | Hämtningssätt | Volym | Fält | Uppdateringstakt | robots.txt / villkor | Risk | Värde |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [alleasing.se](https://www.alleasing.se/) | Jämförelsesajt (aggregator, 17 återförsäljare) | HTML-skrapning av `/erbjudande/{märke}/{modell}/{id}`. **Sitemap listar varje erbjudande** (`sitemap/offers-0..9.xml`, ~1 000 URL:er per fil) → ingen sökpaginering behöver skrapas. Next.js, serverrenderat. | **~9 000–10 000** | märke, modell, mån.kostnad, löptid, körsträcka, totalkostnad, "ingår" (service/försäkring/vinterdäck), återförsäljare, skick, drivlina, årsmodell. Kontantinsats via URL-param `?deposit=` | 4 ggr/dygn (06/12/18/24) | `Allow: /`, bara `/favoriter` spärrad. Crawl-delay 60 s för meta/Ahrefs, inget för `*`. Inga användarvillkor publicerade; enmansföretag, affiliatefinansierat, kontakt hej@alleasing.se | Aggregator = andrahandsdata. Enmansprojekt → kan försvinna. Sitemap-lastmod var identisk för alla 1 000 rader → dålig signal för "ändrad sedan sist" | **Högst** |
| 2 | [carplus.se](https://carplus.se/bilar/) | Leasinggivare (förstahandsdata, egna avtal) | HTML-skrapning av `/bilar/{märke}/{modell-variant}/`. WordPress, serverrenderat, `sitemap_index.xml`. | ~50–100 aktiva | mån.kostnad, löptid (36 mån), körsträcka (1 000 mil/år), vad som ingår, lagerstatus ("Tillfälligt slut"). Ingen kontantinsats (0 kr) | Okänd, sannolikt dygn/vecka | `Disallow:` (tomt) = allt tillåtet, sitemap angiven | Liten volym. Egna produkter → smal modellbredd | **Hög** (som facit) |
| 3 | [leasingkollen.nu](https://leasingkollen.nu/) | Jämförelsesajt | HTML-skrapning av `/deal/{uuid}`, alla listade i `sitemap.xml` (~250 deal-URL:er av ~580 totalt) | ~250–430 | märke, modell, mån.pris, löptid, körsträcka, drivmedel, förhöjd förstagångshyra | Dagligen (egen skrapning) | `Allow: /` för alla, sitemap angiven | Aggregator av aggregerad data. Överlappar #1 kraftigt | Medel |
| 4 | Tillverkarnas kampanjsidor – [Volvo](https://www.volvocars.com/se/promotions/), [Kia](https://www.kia.com/se/kopa/erbjudanden/), [Hyundai](https://www.hyundai.com/se/sv/kop/kop/kampanjer-och-erbjudanden.html) m.fl. | Förstahandskälla (officiella kampanjpriser) | HTML-skrapning, en adapter per märke | 5–20 modeller/märke | Officiellt kampanjpris, löptid, körsträcka, giltighetsdatum | Månad/kvartal | Varierar per märke – måste kollas individuellt | Mycket lågt datautbyte per adapter (en adapter per märke). Layouterna ändras vid varje kampanjstart | Medel (bra **ankare**, dålig volym) |
| 5 | [Hedin Automotive](https://hedinautomotive.se/bilar/privatleasing/privatleasing-bilar) | Återförsäljarkedja | Listan är klientladdad ("Visar 48 av 1 456", *Visa fler*) → kräver att XHR-endpointen kartläggs, annars 1 456 detaljsidor | ~1 456 | Listvyn visar bara mån.kostnad per finansieringsform. **Löptid/körsträcka finns bara på detaljsidan** | Löpande (lagerbilar) | `Allow: /`, spärrar `/en/` och `/Presentation/` | Dyrast per rad: kräver 1 456 detaljhämtningar för fullständiga fält | Låg (nu) |
| 6 | [Bilia](https://www.bilia.se/) | Återförsäljarkedja | HTML-skrapning, `sitemap_index.xml` | Okänd | Ej kartlagt i detalj | Löpande | `Allow: /`, sitemap angiven | Samma som #5 | Låg (nu) |
| 7 | [privatleasa.se](https://www.privatleasa.se/) | Redaktionell sajt + liten databas | HTML-skrapning av `/bilar/{märke}/{märke}-{modell}-{år}` | "hundratals", homepage visar 20 | mån.pris, körsträcka, drivmedel, vad som ingår. **Ingen kontantinsats** | Okänd | `Allow: /` men **`Disallow: /api/` och `/_next/`**, `Crawl-delay: 1` | Tunna fält, redaktionellt urval snarare än fullständig databas | Låg |
| 8 | [Blocket](https://www.blocket.se/) / [Bytbil](https://www.bytbil.com/) | Marknadsplatser | **Ingen öppen väg.** Blocket API 5.0 (REST/OAuth2, webhooks) är en *säljarintegration* – ingår i återförsäljarens annonspaket sedan 2026-02-01, inte en publik sök-API. Åtkomst går via partner (Swapi, Tokov Media) och kräver återförsäljarkonto | Störst i landet | Fullständiga | Löpande | Båda domänerna gick **inte att hämta alls** under kartläggningen (blockerat på nätverksnivå) | Blockerar automatiserad trafik aktivt. Skrapning här är både tekniskt och avtalsmässigt fel väg | **Avfärdad** |
| 9 | [jamforbil.se](https://jamforbil.se/) | Jämförelsesajt | HTML-skrapning | Okänd | Ej kartlagt i detalj | Okänd | `Allow: /`, sitemap angiven | Ytterligare en aggregator ovanpå samma underliggande data | Låg |

### Inga officiella API:er finns

Kartläggningen hittade **ingen** publik, öppen JSON-API för svenska leasingerbjudanden.
Blockets API är säljarsidans, tillverkarna har ingen publik prislista i maskinläsbart format,
och ingen av jämförelsesajterna erbjuder API. Allt blir HTML-skrapning – vilket gör
avsnitt 7 i projektstart ("skrapning är skör") till projektets viktigaste driftsregel,
inte en fotnot.

## Beslut: vi börjar med #1 och #2

**Adapter 1 – `alleasing`** (volymen som gör baslinjen statistiskt meningsfull)

- Enumerera `sitemap/offers-0.xml` … `offers-9.xml` → ~10 000 stabila erbjudande-URL:er.
  Det gör adaptern robust: ingen sökpaginering, inga filterparametrar att lista ut, och
  URL:en innehåller redan märke + modell + id (`/erbjudande/volvo/ex40/465c0a33c812`) →
  `external_id` = id-suffixet, stabilt över tid.
- Fältuppsättningen matchar `listings`-schemat nästan rakt av.
- Uppdateras 4 ggr/dygn, så vår 6-timmarstakt är rimlig – inte snålare, inte tätare.

**Adapter 2 – `carplus`** (förstahandsdata som facit)

- Liten men ren: leasinggivarens egna priser, inte en aggregators tolkning.
- Rollen är att **validera adapter 1**. Om samma bil hos Carplus har ett pris och
  alleasing ett annat, är det aggregatorn som halkat efter – exakt den sortens tyst fel
  som annars förgiftar baslinjen.

Övriga källor lämnas kartlagda men obyggda tills #1 och #2 gått stabilt i minst en vecka.
Tillverkarnas kampanjsidor (#4) är nästa i tur – de ger officiella ankarpriser att mäta
aggregatorernas drift mot.

## Att göra innan adaptrarna byggs

1. **Testa hämtningen från GitHub Actions, inte bara lokalt.** Blocket och Bytbil gick inte
   att nå ens från en vanlig hämtning under den här kartläggningen – moln-IP straffas hårdare.
   Kör en `DRY_RUN=1`-körning via `workflow_dispatch` som allra första test mot alleasing.
2. **Hör av dig till alleasing.se** (hej@alleasing.se) innan skanningen sätts i drift.
   Sajten drivs av en enskild person och finansieras av affiliateintäkter; en artig
   förfrågan + låg hämtningstakt kostar ingenting och tar bort hela konfliktrisken.
   Det finns inga publicerade användarvillkor att luta sig mot – varken för eller emot.
3. **Ta bara det vi behöver.** Vi lagrar normaliserade sifferfält + länk tillbaka till
   annonsen. Vi kopierar inte annonstexter, bilder eller hela databasen – dels för att
   databasskyddet (49 § upphovsrättslagen) skyddar väsentliga delar av en sammanställning,
   dels för att det är onödigt för vårt syfte. Alltid deep link till källan.
4. **Sätt hämtningstakten lågt.** 1,5 s mellan requests (som i `sources/_template.mjs`),
   max ~10 000 sidor per körning fördelat över körningen. Vid 429: backa av,
   inte retry-storm. `lib/http.mjs` gör redan detta.
5. **Kartlägg XHR-endpointen på alleasing** innan HTML-skrapning väljs. Sajten är Next.js
   och har sannolikt `/_next/data/<buildId>/…json` bakom erbjudandesidorna. En JSON-väg är
   både snällare mot källan och mindre skör än HTML-selektorer – men buildId ändras vid
   varje deploy, så adaptern måste falla tillbaka till HTML.

## Fältmatchning mot `listings`

| `listings`-kolumn | alleasing | carplus | Kommentar |
| --- | --- | --- | --- |
| `brand`, `model` | ✅ i URL + sida | ✅ i URL | Normaliseras via `normalizeBrand`/`normalizeModel` |
| `trim` | ✅ (utrustningsnivå i titeln) | ✅ (i modellnamnet) | Måste separeras från `model` |
| `fuel`, `year` | ✅ | delvis | |
| `monthly_sek` | ✅ | ✅ | Obligatoriskt – rader utan pris kastas |
| `down_payment_sek` | ⚠️ via `?deposit=`-param | ❌ (0 kr) | Default 0 om inget anges |
| `term_months` | ✅ (24/36) | ✅ (36) | |
| `km_per_year` | ✅ (anges i **mil**) | ✅ (mil) | `parseKmPerYear` gör mil → km |
| `residual_sek` | ❌ | ❌ | **Ingen källa visar restvärde.** Kolumnen blir tom tills vidare |
| `external_id` | id-suffix ur URL | slug ur URL | Måste vara stabilt över körningar |

Två luckor att vara medveten om när "bra pris"-logiken byggs:

- **Restvärde saknas överallt.** Deal-score får bygga på effektiv månadskostnad enbart.
- **"Vad som ingår" varierar** (service, försäkring, vinterdäck, däckhotell). Två annonser
  med samma månadspris är inte samma erbjudande om den ena inkluderar försäkring. Det här
  är den största kända felkällan i jämförelsen och bör fångas som flaggor på raden innan
  baslinjen tas i bruk skarpt – annars ser avskalade erbjudanden systematiskt ut som fynd.

## Källor

- [Alleasing.se](https://www.alleasing.se/) · [robots.txt](https://www.alleasing.se/robots.txt) · [sitemap](https://www.alleasing.se/sitemap.xml) · [om oss](https://www.alleasing.se/om-oss)
- [Carplus.se](https://carplus.se/bilar/) · [robots.txt](https://carplus.se/robots.txt)
- [LeasingKollen](https://leasingkollen.nu/) · [robots.txt](https://leasingkollen.nu/robots.txt)
- [privatleasa.se](https://www.privatleasa.se/) · [robots.txt](https://www.privatleasa.se/robots.txt)
- [jamforbil.se](https://jamforbil.se/)
- [Hedin Automotive privatleasing](https://hedinautomotive.se/bilar/privatleasing/privatleasing-bilar) · [Bilia](https://www.bilia.se/)
- [Volvo Cars erbjudanden](https://www.volvocars.com/se/promotions/) · [Kia erbjudanden](https://www.kia.com/se/kopa/erbjudanden/) · [Hyundai kampanjer](https://www.hyundai.com/se/sv/kop/kop/kampanjer-och-erbjudanden.html)
- Blocket API 5.0 via partner: [Swapi](https://swapi.se/tjanster/bytbil-api-wordpress/) · [Tokov Media](https://tokovmedia.se/blocket-api-digital-bilhall-for-bilhandlares-hemsida/)
