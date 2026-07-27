-- Receptbok – schema för Supabase (Postgres).
-- Kör i Supabase SQL Editor. Skriptet ska alltid vara idempotent och kunna köras om.
--
-- Tabellerna för recept, hushåll och inköpslista hör till fas 1 i
-- docs/projektstart.md och är inte skrivna ännu. Det som står här är stommen
-- som bar leasingprojektet och som är värd att återanvända oförändrad.

-- ---------------------------------------------------------------------------
-- Hjälpare: håller updated_at aktuell utan att applikationen behöver tänka på det.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Kopplas per tabell:
--
--   drop trigger if exists <tabell>_touch_updated_at on public.<tabell>;
--   create trigger <tabell>_touch_updated_at
--     before update on public.<tabell>
--     for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Mönster att följa när tabellerna skrivs
-- ---------------------------------------------------------------------------
--
-- 1. RLS på varje tabell som innehåller användardata, utan undantag:
--
--      alter table public.<tabell> enable row level security;
--
--    I det här projektet är RLS inte en detalj utan huvudmekanismen. Recept
--    tillhör ett hushåll, och det finns ingen annan spärr som hindrar ett
--    hushåll från att läsa ett annats.
--
-- 2. Policyer skrivs om vid varje körning, så schemat förblir idempotent:
--
--      drop policy if exists "namn" on public.<tabell>;
--      create policy "namn" on public.<tabell> for all
--        to authenticated
--        using (<villkor>) with check (<villkor>);
--
-- 3. Vyer ärver inte RLS. Utan security_invoker körs de med vyägarens
--    rättigheter och läcker förbi policyerna:
--
--      alter view public.<vy> set (security_invoker = on);
--
-- 4. Casta uttryckligen i vyer som räknar. percentile_cont returnerar
--    double precision även för numeric-kolumner, och round(double, int) finns
--    inte i Postgres – det fällde leasingprojektets schema vid första körningen.
--
-- 5. Nya kolumner läggs till med separata alters efter create table, så att
--    skriptet går att köra om mot en databas som redan har tabellen:
--
--      alter table public.<tabell> add column if not exists <kolumn> <typ>;
