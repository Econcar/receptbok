-- Engångsstädning: tar bort leasingskannerns tabeller ur det återanvända
-- Supabase-projektet, så att receptboken börjar i en ren databas.
--
-- KÖRS EN GÅNG, MEDVETET. Det här raderar data på riktigt och går inte att
-- ångra. Schemat finns kvar i git (`git show 1ea9eb9:db/schema.sql`), men
-- annonserna som samlats in gör det inte. Vill du behålla dem: exportera
-- listings till CSV via Table Editor → Export innan du kör.
--
-- touch_updated_at lämnas kvar med flit – receptbokens schema återanvänder den.
--
-- Kör db/schema.sql efter det här.

begin;

-- Vyerna först: de hänger på listings och blockerar annars droppen.
drop view if exists public.listings_view;
drop view if exists public.model_baselines;

-- Indexen och policyerna följer med tabellen.
drop table if exists public.listings;
drop table if exists public.scan_runs;
drop table if exists public.watches;

commit;

-- Kontroll: ska ge noll rader.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('listings', 'scan_runs', 'watches', 'listings_view', 'model_baselines');
