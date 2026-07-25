import { PAGE_SIZE } from '/config.js';

const els = {
  filters: document.getElementById('filters'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  meta: document.getElementById('meta'),
};

const sek = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short' });

let all = [];

function setStatus(text, tone) {
  els.status.textContent = text;
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

function currentFilters() {
  const data = new FormData(els.filters);
  return {
    q: String(data.get('q') || '').trim().toLowerCase(),
    maxMonthly: Number(data.get('maxMonthly')) || null,
    term: Number(data.get('term')) || null,
    sort: String(data.get('sort') || 'effective_monthly_sek'),
  };
}

function applyFilters(rows, f) {
  const filtered = rows.filter((row) => {
    if (f.term && row.term_months !== f.term) return false;
    if (f.maxMonthly && Number(row.monthly_sek) > f.maxMonthly) return false;
    if (f.q) {
      const hay = [row.brand, row.model, row.trim, row.fuel].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });

  const desc = f.sort === 'last_seen';
  return filtered.sort((a, b) => {
    const av = a[f.sort] ?? Infinity;
    const bv = b[f.sort] ?? Infinity;
    if (av === bv) return 0;
    return desc ? (av < bv ? 1 : -1) : (av > bv ? 1 : -1);
  });
}

function card(row) {
  const li = document.createElement('li');
  li.className = 'card';

  if (row.deal_score != null && row.deal_score >= 10) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `${Math.round(row.deal_score)} % under snitt`;
    li.append(badge);
  }

  const link = document.createElement('a');
  link.href = row.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = [row.brand, row.model, row.trim].filter(Boolean).join(' ') || 'Okänd modell';
  li.append(link);

  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = row.monthly_sek != null ? `${sek.format(row.monthly_sek)}/mån` : 'Pris saknas';
  if (row.effective_monthly_sek != null && row.effective_monthly_sek !== row.monthly_sek) {
    price.textContent += ` (effektivt ${sek.format(row.effective_monthly_sek)})`;
  }
  li.append(price);

  const terms = document.createElement('div');
  terms.className = 'terms';
  terms.textContent = [
    row.term_months ? `${row.term_months} mån` : null,
    row.km_per_year ? `${row.km_per_year.toLocaleString('sv-SE')} km/år` : null,
    row.down_payment_sek ? `${sek.format(row.down_payment_sek)} kontant` : null,
  ].filter(Boolean).join(' · ') || 'Villkor saknas';
  li.append(terms);

  const source = document.createElement('div');
  source.className = 'source';
  source.textContent = `${row.source}${row.last_seen ? ` · sedd ${date.format(new Date(row.last_seen))}` : ''}`;
  li.append(source);

  return li;
}

function render() {
  const rows = applyFilters(all, currentFilters());
  els.results.replaceChildren(...rows.map(card));
  if (!all.length) setStatus('Inga annonser ännu – skannern har inte fyllt databasen.');
  else if (!rows.length) setStatus('Inga träffar för filtret.');
  else setStatus(`${rows.length} av ${all.length} annonser.`);
}

async function load() {
  setStatus('Laddar …');
  try {
    const res = await fetch(`/api/listings?limit=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    all = Array.isArray(body.listings) ? body.listings : [];
    els.meta.textContent = body.generated_at ? `Data hämtad ${body.generated_at}` : '';
    render();
  } catch (err) {
    setStatus(`Kunde inte hämta annonser: ${err.message}`, 'error');
  }
}

els.filters.addEventListener('input', render);
load();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline-cache är en bonus */ });
  });
}
