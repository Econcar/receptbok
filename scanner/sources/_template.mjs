// Mall för en ny källadapter. Kopiera, döp om, registrera i index.mjs.
//
// Regler:
//  - Returnera RÅ data. Städningen sker i lib/normalize.mjs så den kan testas separat.
//  - external_id måste vara stabilt över tid för samma annons (annonsens id, inte radnummer).
//  - Kasta hellre än att returnera skräp – run.mjs loggar och går vidare till nästa källa.
//  - Respektera robots.txt och håll takten låg. Se avsnitt 7 i docs/projektstart.md.

import { fetchJson, isAllowedByRobots, sleep } from '../lib/http.mjs';

const LIST_URL = 'https://example.com/api/leasing?page=';

export default {
  id: 'template',
  label: 'Mall (inaktiv)',
  enabled: false,
  segment: 'privat',

  async fetchListings({ maxPages = 5, log = console.log } = {}) {
    if (!(await isAllowedByRobots(LIST_URL + '1'))) {
      throw new Error('robots.txt tillåter inte hämtning av den här sökvägen');
    }

    const out = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await fetchJson(`${LIST_URL}${page}`);
      const items = data.items ?? [];
      if (!items.length) break;

      for (const item of items) {
        out.push({
          external_id: item.id,
          url: item.link,
          brand: item.make,
          model: item.model,
          trim: item.equipment,
          fuel: item.fuelType,
          year: item.modelYear,
          monthly_sek: item.monthlyPrice,
          down_payment_sek: item.downPayment,
          term_months: item.contractLength,
          km_per_year: item.mileage,
          residual_sek: item.residualValue,
          segment: 'privat',
        });
      }

      log(`  sida ${page}: ${items.length} rader`);
      await sleep(1500); // var snäll mot källan
    }
    return out;
  },
};
