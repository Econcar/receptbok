// Ren prislogik. Inga I/O-beroenden – allt här ska vara enhetstestat.

/**
 * Effektiv månadskostnad: månadsavgiften plus kontantinsatsen utslagen över löptiden.
 * Utan detta jämförs äpplen med päron – ett lågt månadspris kan bara vara en stor
 * kontantinsats i förklädnad.
 *
 * @param {{monthly_sek?: number, down_payment_sek?: number, term_months?: number}} offer
 * @returns {number|null} kr/mån, eller null om månadspriset saknas
 */
export function effectiveMonthly(offer) {
  const monthly = toNumber(offer?.monthly_sek);
  if (monthly === null) return null;

  const down = toNumber(offer?.down_payment_sek) ?? 0;
  const term = toNumber(offer?.term_months);
  if (!term || term <= 0) return round2(monthly);

  return round2(monthly + down / term);
}

/**
 * Deal score = hur många procent under baslinjen erbjudandet ligger.
 * Positivt = billigare än baslinjen. Null när jämförelse saknar mening.
 */
export function dealScore(effective, baseline) {
  const e = toNumber(effective);
  const b = toNumber(baseline);
  if (e === null || b === null || b <= 0) return null;
  return round1(((b - e) / b) * 100);
}

/** Median av numeriska värden. Ignorerar null/NaN. */
export function median(values) {
  const nums = (values ?? []).map(toNumber).filter((n) => n !== null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : round2((nums[mid - 1] + nums[mid]) / 2);
}

/** Percentil (linjär interpolation), p mellan 0 och 1. */
export function percentile(values, p) {
  const nums = (values ?? []).map(toNumber).filter((n) => n !== null).sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const pos = Math.min(1, Math.max(0, p)) * (nums.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return nums[lo];
  return round2(nums[lo] + (nums[hi] - nums[lo]) * (pos - lo));
}

/**
 * Baslinje per modell. Kräver minst `minSample` annonser – annars är medianen
 * brus och deal-scoren blir slumpmässig.
 */
export function buildBaselines(listings, { minSample = 3 } = {}) {
  const groups = new Map();
  for (const l of listings ?? []) {
    const eff = toNumber(l.effective_monthly_sek) ?? effectiveMonthly(l);
    if (eff === null || !l.brand || !l.model) continue;
    const key = baselineKey(l);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(eff);
  }

  const baselines = new Map();
  for (const [key, values] of groups) {
    if (values.length < minSample) continue;
    baselines.set(key, {
      sample_size: values.length,
      median_effective_sek: median(values),
      p25_effective_sek: percentile(values, 0.25),
    });
  }
  return baselines;
}

export function baselineKey(listing) {
  return [listing.brand, listing.model, listing.segment ?? 'privat']
    .map((part) => String(part ?? '').trim().toLowerCase())
    .join('|');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
