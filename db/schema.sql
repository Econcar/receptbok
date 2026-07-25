-- Leasingskanner – schema för Supabase (Postgres).
-- Kör i Supabase SQL Editor. Skriptet är idempotent och kan köras om.

-- ---------------------------------------------------------------------------
-- listings: en rad per annons och källa. Skrivs bara av skannern (service role).
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id                 bigint generated always as identity primary key,
  source             text not null,
  external_id        text not null,
  url                text not null,

  brand              text,
  model              text,
  trim               text,
  fuel               text,
  year               int,

  monthly_sek        numeric(10, 2),
  down_payment_sek   numeric(12, 2),
  term_months        int,
  km_per_year        int,
  residual_sek       numeric(12, 2),

  -- Effektiv månadskostnad = månadsavgift + utslagen kontantinsats.
  -- Gör äpplen jämförbara med päron innan baslinjen räknas.
  effective_monthly_sek numeric(12, 2) generated always as (
    coalesce(monthly_sek, 0) + coalesce(down_payment_sek, 0) / nullif(term_months, 0)
  ) stored,

  -- 'privat' eller 'foretag' – prislogiken skiljer sig (moms/avdrag).
  segment            text not null default 'privat',
  raw                jsonb,

  first_seen         timestamptz not null default now(),
  last_seen          timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint listings_source_external_id_key unique (source, external_id),
  constraint listings_segment_check check (segment in ('privat', 'foretag'))
);

create index if not exists listings_brand_model_idx on public.listings (brand, model);
create index if not exists listings_effective_idx   on public.listings (effective_monthly_sek);
create index if not exists listings_last_seen_idx   on public.listings (last_seen desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists listings_touch_updated_at on public.listings;
create trigger listings_touch_updated_at
  before update on public.listings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- model_baselines: median effektiv månadskostnad per modell.
-- Vy (inte tabell) så länge datamängden är liten – byt till materialiserad vy
-- när antalet annonser gör den långsam.
-- ---------------------------------------------------------------------------
create or replace view public.model_baselines as
select
  brand,
  model,
  segment,
  count(*)                                                                   as sample_size,
  percentile_cont(0.5) within group (order by effective_monthly_sek)         as median_effective_sek,
  percentile_cont(0.25) within group (order by effective_monthly_sek)        as p25_effective_sek,
  min(effective_monthly_sek)                                                 as min_effective_sek
from public.listings
where effective_monthly_sek is not null
  and brand is not null
  and model is not null
  and last_seen > now() - interval '90 days'
group by brand, model, segment
having count(*) >= 3;

-- ---------------------------------------------------------------------------
-- listings_view: det frontend läser. deal_score = % under baslinjen.
-- ---------------------------------------------------------------------------
create or replace view public.listings_view as
select
  l.*,
  b.median_effective_sek,
  b.sample_size,
  case
    when b.median_effective_sek is null or b.median_effective_sek = 0 then null
    else round(((b.median_effective_sek - l.effective_monthly_sek) / b.median_effective_sek) * 100, 1)
  end as deal_score
from public.listings l
left join public.model_baselines b
  on b.brand = l.brand and b.model = l.model and b.segment = l.segment;

-- ---------------------------------------------------------------------------
-- scan_runs: driftlogg per körning och källa. Gör trasiga källor synliga.
-- ---------------------------------------------------------------------------
create table if not exists public.scan_runs (
  id            bigint generated always as identity primary key,
  source        text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running',
  rows_found    int  not null default 0,
  rows_upserted int  not null default 0,
  error         text,
  constraint scan_runs_status_check check (status in ('running', 'ok', 'empty', 'error'))
);

create index if not exists scan_runs_source_started_idx on public.scan_runs (source, started_at desc);

-- ---------------------------------------------------------------------------
-- watches: användarens bevakningar. Bakom RLS.
-- ---------------------------------------------------------------------------
create table if not exists public.watches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  label          text,
  brand          text,
  model          text,
  max_monthly_sek numeric(10, 2),
  min_deal_score numeric(5, 1) not null default 10,
  channel        text not null default 'email',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_notified_at timestamptz
);

create index if not exists watches_user_idx on public.watches (user_id);

-- ---------------------------------------------------------------------------
-- RLS: annonsdata är global läsdata, användardata är privat.
-- Skannern använder service-nyckeln och går förbi RLS.
-- ---------------------------------------------------------------------------
alter table public.listings  enable row level security;
alter table public.scan_runs enable row level security;
alter table public.watches   enable row level security;

drop policy if exists "listings är läsbara för alla" on public.listings;
create policy "listings är läsbara för alla"
  on public.listings for select
  to anon, authenticated
  using (true);

drop policy if exists "scan_runs är läsbara för alla" on public.scan_runs;
create policy "scan_runs är läsbara för alla"
  on public.scan_runs for select
  to anon, authenticated
  using (true);

drop policy if exists "egna bevakningar" on public.watches;
create policy "egna bevakningar"
  on public.watches for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Vyer ärver inte RLS automatiskt; security_invoker gör att anroparens
-- rättigheter (och listings-policyn) gäller.
alter view public.model_baselines set (security_invoker = on);
alter view public.listings_view   set (security_invoker = on);

grant select on public.listings_view, public.model_baselines to anon, authenticated;
