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
--
-- default auth.uid() är inte bekvämlighet. Policyn kräver created_by =
-- auth.uid(), och så länge klienten fyller i värdet själv finns ett läge där
-- den skickar fel eller inget alls och insertet avvisas utan att någon förstår
-- varför. Databasen vet vem som skriver – låt den avgöra det.
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.households
  alter column created_by set default auth.uid();

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
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
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

alter table public.recipes
  alter column created_by set default auth.uid();

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
  -- Varan, utan mängd och tillredning: "vispgrädde" ur "2 dl vispgrädde,
  -- lättvispad". Det är den inköpslistan grupperar på.
  name      text,
  note      text
);

-- Separat alter: tabellen fanns före kolumnen, och create table if not exists
-- rör inte en tabell som redan finns.
alter table public.recipe_ingredients add column if not exists name text;

-- Avsiktligt inte unique: att flytta en ingrediens uppåt i listan hade annars
-- krockat mitt i omnumreringen.
create index if not exists recipe_ingredients_recipe_idx
  on public.recipe_ingredients (recipe_id, position);

-- Kategorier: middag, frukost, vegetariskt, soppa, pasta … Fritt formulerade
-- och per hushåll, inte en fast lista – vad som är en användbar indelning vet
-- familjen bättre än schemat.
--
-- Namnet lagras gemenformat och villkoret säger det uttryckligen. Utan det blir
-- "Vegetariskt" och "vegetariskt" två kategorier som ser likadana ut i listan,
-- och unikhetsvillkoret nedan hade inte fångat det.
create table if not exists public.tags (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (name = lower(btrim(name)) and length(name) > 0),
  created_at   timestamptz not null default now(),
  unique (household_id, name)
);

create table if not exists public.recipe_tags (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  primary key (recipe_id, tag_id)
);

-- För filtreringen: primärnyckeln täcker vägen från recept till kategori,
-- det här indexet vägen tillbaka.
create index if not exists recipe_tags_tag_idx on public.recipe_tags (tag_id);

-- Veckoplanen. Samma rätt kan stå två gånger samma dag – lunch och middag –
-- så dag plus recept är ingen nyckel.
--
-- servings är antalet portioner man planerar, inte receptets. Skiljer de sig
-- skalas mängderna i inköpslistan, och raden flaggas som ungefärlig:
-- kryddor och tillagningstid följer inte portionsantalet.
create table if not exists public.meal_plan (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  date         date not null,
  servings     integer check (servings is null or servings > 0),
  created_at   timestamptz not null default now()
);

create index if not exists meal_plan_household_date_idx
  on public.meal_plan (household_id, date);

-- Inköpslistan räknas fram ur veckoplanen vid varje visning, så själva
-- raderna lagras inte. Det som lagras är det som inte går att räkna fram:
-- vad som redan är avbockat, och det man lagt till för hand.
--
-- Nyckeln är varans namn och enhet, samma nyckel som sammanslagningen
-- använder. Ändras planen försvinner bocken för det som inte längre behövs,
-- vilket är rätt: har man inte varan i listan har man inte köpt den heller.
create table if not exists public.shopping_list_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  unit         text,
  quantity     numeric,
  checked      boolean not null default false,
  -- 'manual' för det man skrivit in själv, 'plan' för en bock på en uträknad
  -- rad. Skillnaden avgör om raden ska visas när planen är tom.
  source       text not null default 'manual' check (source in ('manual', 'plan')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, name, unit, source)
);

create index if not exists shopping_list_household_idx
  on public.shopping_list_items (household_id);

-- Butiksavdelning per vara, så att inköpslistan följer gångarna i stället för
-- bokstavsordningen.
--
-- name är varans namn precis som inköpslistan grupperar på det, gemenformat.
-- Alltså är "vispgrädde" och "matlagningsgrädde" i dag två rader här, och två
-- rader i butiken. Det är avsiktligt: att avgöra vad som är samma vara kräver
-- att en människa säger det, och den delen är inte byggd.
--
-- När den byggs blir det en kolumn till här – canonical_id som pekar på en
-- annan rad i samma tabell – och inte en omskrivning. Kategorierna som fylls i
-- nu överlever alltså det steget.
create table if not exists public.ingredients (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (name = lower(btrim(name)) and length(name) > 0),
  category     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, name)
);

create index if not exists ingredients_household_idx
  on public.ingredients (household_id);

-- Inbjudningar. En delbar länk och inte en inmatad e-postadress: adressen
-- kräver att man vet exakt vilket Google-konto den andra loggar in med, och
-- gissar man fel händer ingenting alls. Ett tyst fel är sämre än ett synligt.
--
-- Länken bär i gengäld tre spärrar: den går ut, den går bara att lösa in en
-- gång, och bara ägare kan skapa den.
create table if not exists public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  -- Nyckeln i länken. Skapas av databasen, aldrig av klienten.
  token        uuid not null unique default gen_random_uuid(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  expires_at   timestamptz not null default now() + interval '7 days',
  used_at      timestamptz,
  used_by      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists household_invites_household_idx
  on public.household_invites (household_id);

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

drop trigger if exists shopping_list_items_touch_updated_at on public.shopping_list_items;
create trigger shopping_list_items_touch_updated_at
  before update on public.shopping_list_items
  for each row execute function public.touch_updated_at();

drop trigger if exists ingredients_touch_updated_at on public.ingredients;
create trigger ingredients_touch_updated_at
  before update on public.ingredients
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
-- Inlösen av inbjudan
-- ---------------------------------------------------------------------------
--
-- Måste vara security definer, och det är hela poängen med funktionen: den som
-- löser in en inbjudan är per definition inte medlem ännu, och kan därför
-- varken läsa inbjudningsraden eller skriva sig in i household_members. Båda
-- policyerna hade sagt nej.
--
-- Funktionen är därför den enda vägen in, och den kontrollerar allt en policy
-- annars hade gjort: att man är inloggad, att inbjudan finns, inte är
-- förbrukad och inte har gått ut. Ingen av kontrollerna får utelämnas – utan
-- dem vore det en öppen dörr till hushållets recept.
create or replace function public.redeem_household_invite(invite_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inbjudan public.household_invites;
begin
  if auth.uid() is null then
    raise exception 'Inbjudan kan bara lösas in av en inloggad användare'
      using errcode = 'insufficient_privilege';
  end if;

  -- for update låser raden, så att två samtidiga inlösningar av samma
  -- engångslänk inte båda hinner se den som oanvänd.
  select * into inbjudan
  from public.household_invites
  where token = invite_token
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Inbjudan är ogiltig, förbrukad eller har gått ut'
      using errcode = 'no_data_found';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (inbjudan.household_id, auth.uid(), 'member')
  on conflict do nothing;

  update public.household_invites
  set used_at = now(), used_by = auth.uid()
  where id = inbjudan.id;

  return inbjudan.household_id;
end;
$$;

revoke execute on function public.redeem_household_invite(uuid) from public;
grant  execute on function public.redeem_household_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.recipes            enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.tags               enable row level security;
alter table public.recipe_tags        enable row level security;
alter table public.meal_plan          enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.household_invites  enable row level security;
alter table public.ingredients        enable row level security;

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

drop policy if exists "hushållets kategorier" on public.tags;
create policy "hushållets kategorier"
  on public.tags for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Kopplingen skyddas via receptet. Att också kräva åtkomst till taggen vore
-- överflödigt: en tagg i ett annat hushåll går inte att peka på ändå, eftersom
-- främmande nyckeln bara accepterar rader som finns.
drop policy if exists "kategorier följer receptet" on public.recipe_tags;
create policy "kategorier följer receptet"
  on public.recipe_tags for all to authenticated
  using (public.is_recipe_in_my_household(recipe_id))
  with check (public.is_recipe_in_my_household(recipe_id));

-- Veckoplanen kräver båda: hushållet man planerar för, och att receptet man
-- planerar in faktiskt är hushållets. Utan den andra kontrollen hade en rad
-- kunnat peka på ett recept man inte får läsa, och titeln läckt via planen.
drop policy if exists "hushållets veckoplan" on public.meal_plan;
create policy "hushållets veckoplan"
  on public.meal_plan for all to authenticated
  using (public.is_household_member(household_id))
  with check (
    public.is_household_member(household_id)
    and public.is_recipe_in_my_household(recipe_id)
  );

drop policy if exists "hushållets inköpslista" on public.shopping_list_items;
create policy "hushållets inköpslista"
  on public.shopping_list_items for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Inbjudningar är läsbara för hushållets medlemmar och skapas bara av ägare.
-- Den som ska lösa in en inbjudan går inte via de här policyerna alls, utan
-- via redeem_household_invite – annars hade vem som helst kunnat lista
-- inbjudningar och gå in genom vilken dörr som helst.
drop policy if exists "hushållets varor" on public.ingredients;
create policy "hushållets varor"
  on public.ingredients for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "medlemmar ser inbjudningar" on public.household_invites;
create policy "medlemmar ser inbjudningar"
  on public.household_invites for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "ägaren bjuder in med länk" on public.household_invites;
create policy "ägaren bjuder in med länk"
  on public.household_invites for insert to authenticated
  with check (public.is_household_owner(household_id));

drop policy if exists "ägaren återkallar inbjudan" on public.household_invites;
create policy "ägaren återkallar inbjudan"
  on public.household_invites for delete to authenticated
  using (public.is_household_owner(household_id));

-- ---------------------------------------------------------------------------
-- Rättigheter
-- ---------------------------------------------------------------------------
-- Recept är hushållets privata data. anon har ingenting här att göra – till
-- skillnad från leasingprojektet, där annonserna var global läsdata.

revoke all on public.households, public.household_members,
              public.recipes, public.recipe_ingredients,
              public.tags, public.recipe_tags,
              public.meal_plan, public.shopping_list_items,
              public.household_invites, public.ingredients from anon;

grant select, insert, update, delete
  on public.households, public.household_members,
     public.recipes, public.recipe_ingredients,
     public.tags, public.recipe_tags,
     public.meal_plan, public.shopping_list_items,
     public.household_invites, public.ingredients
  to authenticated;
