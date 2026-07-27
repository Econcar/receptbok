-- Receptbok – schema för Supabase (Postgres).
-- Kör i Supabase SQL Editor. Skriptet är idempotent och ska alltid gå att köra om.
--
-- Fas 1 i docs/projektstart.md: hushåll, medlemskap, recept och ingrediensrader.
-- Taggar, kanoniska ingredienser, veckoplan och inköpslista hör till fas 4–5 och
-- läggs till senare – nya kolumner och tabeller med separata alters, så att det
-- här skriptet fortsätter gå att köra om mot en databas som redan har innehåll.
--
-- RLS är projektets huvudmekanism, inte en detalj. Recept tillhör ett hushåll och
-- det finns ingen annan spärr som hindrar ett hushåll från att läsa ett annats.
-- db/rls-test.sql bevisar att spärren håller – kör det efter varje ändring här.
--
-- Ordningen i filen är inte fri: tabellerna måste komma före policy-hjälparna.
-- En funktion med `language sql` får sin kropp analyserad redan vid create, så
-- tabellen den läser måste finnas då (42P01 annars). `language plpgsql` kollas
-- bara syntaktiskt och är inte lika kinkig, men samma ordning gäller ändå här.

-- ---------------------------------------------------------------------------
-- Hjälpare utan tabellberoenden
-- ---------------------------------------------------------------------------

-- Håller updated_at aktuell utan att applikationen behöver tänka på det.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------------

-- Hushållet överlever sin skapare: created_by nollas om kontot tas bort, men
-- samlingen tillhör familjen och ska inte följa med i fallet.
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_idx
  on public.household_members (user_id);

create table if not exists public.recipes (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  created_by     uuid references auth.users(id) on delete set null,
  title          text not null check (length(btrim(title)) > 0),
  source_url     text,
  source_name    text,
  image_url      text,
  servings       integer check (servings is null or servings > 0),
  total_time_min integer check (total_time_min is null or total_time_min > 0),
  instructions   text[] not null default '{}',
  notes          text,
  -- Hela ld+json-blocket precis som sajten publicerade det. Samma princip som
  -- raw-kolumnen i leasingprojektets listings: tolkningen kan förbättras i
  -- efterhand utan att något importeras om, och när parsern har fel finns
  -- originalet kvar att jämföra med.
  source_ldjson  jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists recipes_household_idx on public.recipes (household_id);

create table if not exists public.recipe_ingredients (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position  integer not null,
  -- raw_text sparas alltid, även när tolkningen lyckas. Fas 4 fyller quantity,
  -- unit och (senare) ingredient_id utifrån den – originalet är facit.
  raw_text  text not null,
  quantity  numeric,
  unit      text,
  note      text
);

-- Avsiktligt inte unique: att flytta en ingrediens uppåt i listan hade annars
-- krockat mitt i omnumreringen.
create index if not exists recipe_ingredients_recipe_idx
  on public.recipe_ingredients (recipe_id, position);

-- ---------------------------------------------------------------------------
-- Policy-hjälpare (kräver tabellerna ovan)
-- ---------------------------------------------------------------------------

-- Medlemskapsfrågan som varje policy vilar på.
--
-- security definer är inte valfritt här. En policy på household_members som
-- själv läser household_members ger rekursion (Postgres 42P17) och gör tabellen
-- oläsbar. Funktionen kör som sin ägare, förbi RLS, och bryter cirkeln.
-- search_path låses eftersom en definer-funktion annars kan luras att leta upp
-- tabellen i ett schema som anroparen styr över.
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

-- Ägarskap styr vem som får bjuda in och kasta ut (fas 6).
create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- Ingrediensrader ärver sitt skydd från receptet. Egen definer-funktion i
-- stället för en subquery i policyn: subqueryn hade träffat recipes egna RLS och
-- gett två lager att felsöka i stället för ett.
create or replace function public.is_recipe_in_my_household(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.recipes r
    join public.household_members m on m.household_id = r.household_id
    where r.id = rid and m.user_id = auth.uid()
  );
$$;

revoke execute on function public.is_household_member(uuid)       from public;
revoke execute on function public.is_household_owner(uuid)        from public;
revoke execute on function public.is_recipe_in_my_household(uuid) from public;
grant  execute on function public.is_household_member(uuid)       to authenticated;
grant  execute on function public.is_household_owner(uuid)        to authenticated;
grant  execute on function public.is_recipe_in_my_household(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists households_touch_updated_at on public.households;
create trigger households_touch_updated_at
  before update on public.households
  for each row execute function public.touch_updated_at();

drop trigger if exists recipes_touch_updated_at on public.recipes;
create trigger recipes_touch_updated_at
  before update on public.recipes
  for each row execute function public.touch_updated_at();

-- Utan det här blir den som skapar ett hushåll utelåst från det direkt: bara
-- ägare får lägga till medlemmar, och ingen är ägare förrän första raden finns.
create or replace function public.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := coalesce(new.created_by, auth.uid());
begin
  if uid is not null then
    insert into public.household_members (household_id, user_id, role)
    values (new.id, uid, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists households_add_creator_as_owner on public.households;
create trigger households_add_creator_as_owner
  after insert on public.households
  for each row execute function public.add_creator_as_owner();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.recipes            enable row level security;
alter table public.recipe_ingredients enable row level security;

-- Policyer skrivs om vid varje körning, så skriptet förblir idempotent.

drop policy if exists "medlemmar ser sitt hushåll" on public.households;
create policy "medlemmar ser sitt hushåll"
  on public.households for select to authenticated
  using (public.is_household_member(id));

drop policy if exists "vem som helst skapar ett hushåll" on public.households;
create policy "vem som helst skapar ett hushåll"
  on public.households for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "ägaren ändrar hushållet" on public.households;
create policy "ägaren ändrar hushållet"
  on public.households for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

drop policy if exists "ägaren tar bort hushållet" on public.households;
create policy "ägaren tar bort hushållet"
  on public.households for delete to authenticated
  using (public.is_household_owner(id));

drop policy if exists "medlemmar ser varandra" on public.household_members;
create policy "medlemmar ser varandra"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "ägaren bjuder in" on public.household_members;
create policy "ägaren bjuder in"
  on public.household_members for insert to authenticated
  with check (public.is_household_owner(household_id));

drop policy if exists "ägaren ändrar roller" on public.household_members;
create policy "ägaren ändrar roller"
  on public.household_members for update to authenticated
  using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

-- Ägaren kastar ut, och vem som helst får lämna själv.
drop policy if exists "ägaren kastar ut, medlemmen lämnar" on public.household_members;
create policy "ägaren kastar ut, medlemmen lämnar"
  on public.household_members for delete to authenticated
  using (public.is_household_owner(household_id) or user_id = auth.uid());

drop policy if exists "hushållets recept" on public.recipes;
create policy "hushållets recept"
  on public.recipes for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "medlemmar lägger till recept" on public.recipes;
create policy "medlemmar lägger till recept"
  on public.recipes for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists "medlemmar ändrar recept" on public.recipes;
create policy "medlemmar ändrar recept"
  on public.recipes for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "medlemmar tar bort recept" on public.recipes;
create policy "medlemmar tar bort recept"
  on public.recipes for delete to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "ingredienser följer receptet" on public.recipe_ingredients;
create policy "ingredienser följer receptet"
  on public.recipe_ingredients for all to authenticated
  using (public.is_recipe_in_my_household(recipe_id))
  with check (public.is_recipe_in_my_household(recipe_id));

-- ---------------------------------------------------------------------------
-- Rättigheter
-- ---------------------------------------------------------------------------
-- Recept är hushållets privata data. anon har ingenting här att göra – till
-- skillnad från leasingprojektet, där annonserna var global läsdata.

revoke all on public.households, public.household_members,
              public.recipes, public.recipe_ingredients from anon;

grant select, insert, update, delete
  on public.households, public.household_members,
     public.recipes, public.recipe_ingredients
  to authenticated;
