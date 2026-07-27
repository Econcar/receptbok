-- Bevisar att RLS håller isär hushållen. Kör i Supabase SQL Editor efter varje
-- ändring i db/schema.sql.
--
-- Allt sker i en transaktion som rullas tillbaka på slutet – testet lämnar inga
-- spår. Går något sönder avbryts körningen med ett felmeddelande som säger vad.
-- Tyst körning som slutar med "RLS-testet gick igenom" betyder att det höll.
--
-- Det avgörande är `set local role authenticated`. SQL Editor kör som postgres,
-- som äger tabellerna och därför går förbi RLS helt. Utan rollbytet passerar
-- testet lika glatt med samtliga policyer borttagna.
--
-- Anna   11111111-1111-1111-1111-111111111111  →  hushåll aaaaaaaa-…
-- Bertil 22222222-2222-2222-2222-222222222222  →  hushåll bbbbbbbb-…

begin;

-- --- Uppsättning, som postgres och alltså förbi RLS -------------------------

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'anna@test.invalid',   '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'bertil@test.invalid', '', now(), now(), now());

-- Triggern gör skaparen till ägare, så medlemsraderna skapas av sig själva.
insert into public.households (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Annas hushåll',   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bertils hushåll', '22222222-2222-2222-2222-222222222222');

insert into public.recipes (id, household_id, created_by, title) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'Annas pannkakor'),
  ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'Bertils gryta');

insert into public.recipe_ingredients (recipe_id, position, raw_text) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 1, '3 dl vetemjöl'),
  ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 1, '500 g högrev');

-- Kontrollera att uppsättningen blev som tänkt innan RLS slås på i testet –
-- annars kan ett tomt resultat längre ner misstas för korrekt isolering.
--
-- Räkningen begränsas till testets egna hushåll. Det här blocket kör som
-- postgres och ser alltså hela tabellen, inklusive riktiga hushåll som redan
-- finns i databasen. Räkningarna längre ner sker som Anna eller Bertil, och
-- där filtrerar RLS bort allt annat av sig själv.
do $$
declare n integer;
begin
  select count(*) into n from public.household_members
  where household_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  if n <> 2 then
    raise exception 'Uppsättningen gav % medlemsrader, förväntade 2. Skapar triggern ägaren?', n;
  end if;
end $$;

-- --- Anna ------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.households;
  if n <> 1 then raise exception 'Anna ser % hushåll, förväntade 1', n; end if;

  select count(*) into n from public.household_members;
  if n <> 1 then raise exception 'Anna ser % medlemsrader, förväntade 1', n; end if;

  select count(*) into n from public.recipes;
  if n <> 1 then raise exception 'Anna ser % recept, förväntade 1', n; end if;

  select count(*) into n from public.recipes where title = 'Bertils gryta';
  if n <> 0 then raise exception 'Anna ser Bertils recept – RLS läcker'; end if;

  select count(*) into n from public.recipe_ingredients;
  if n <> 1 then raise exception 'Anna ser % ingrediensrader, förväntade 1', n; end if;

  select count(*) into n from public.recipe_ingredients where raw_text = '500 g högrev';
  if n <> 0 then raise exception 'Anna ser Bertils ingredienser – RLS läcker'; end if;
end $$;

-- Skrivning är ett eget hål: läsningen kan vara tät medan with check saknas.
do $$
declare n integer;
begin
  begin
    insert into public.recipes (household_id, created_by, title)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            '11111111-1111-1111-1111-111111111111', 'Kapat recept');
    raise exception 'Anna kunde skriva in ett recept i Bertils hushåll – RLS läcker';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;

  -- Update filtreras bort av policyn i stället för att avvisas: noll rader är svaret.
  update public.recipes set title = 'Kapat' where title = 'Bertils gryta';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Anna ändrade % rader i Bertils recept – RLS läcker', n; end if;

  delete from public.recipes where title = 'Bertils gryta';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Anna raderade % rader ur Bertils recept – RLS läcker', n; end if;

  -- Ett eget recept ska däremot gå att lägga till, utan att created_by anges:
  -- kolumnens default är auth.uid(), vilket är vad policyn kräver.
  insert into public.recipes (household_id, title)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Annas våfflor');
end $$;

-- Kategorier hör till hushållet, kopplingen till receptet. Båda vägarna testas:
-- att Anna kan skapa och koppla sina egna, och längre ner att Bertil inte ser dem.
do $$
declare
  taggen uuid;
  n integer;
begin
  insert into public.tags (household_id, name)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'middag')
  returning id into taggen;

  insert into public.recipe_tags (recipe_id, tag_id)
  values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', taggen);

  select count(*) into n from public.recipe_tags;
  if n <> 1 then raise exception 'Anna ser % kategorikopplingar, förväntade 1', n; end if;

  -- Gemenformat är ett villkor i schemat, inte en konvention i gränssnittet.
  begin
    insert into public.tags (household_id, name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Vegetariskt');
    raise exception 'Versalt kategorinamn accepterades – dubbletter blir möjliga';
  exception when check_violation then
    null; -- rätt beteende
  end;

  -- Bertils hushåll är inte Annas att kategorisera.
  begin
    insert into public.tags (household_id, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'kapad');
    raise exception 'Anna kunde skapa en kategori i Bertils hushåll – RLS läcker';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;
end $$;

-- Veckoplanen kräver två saker samtidigt: rätt hushåll och ett recept som
-- tillhör det. Utan den andra kontrollen hade en planrad kunnat peka på ett
-- recept man inte får läsa, och titeln läckt genom planen.
do $$
declare n integer;
begin
  insert into public.meal_plan (household_id, recipe_id, date, servings)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', current_date, 4);

  select count(*) into n from public.meal_plan;
  if n <> 1 then raise exception 'Anna ser % planrader, förväntade 1', n; end if;

  -- Bertils recept i Annas plan: hushållet stämmer, receptet gör det inte.
  begin
    insert into public.meal_plan (household_id, recipe_id, date)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', current_date);
    raise exception 'Anna kunde planera in Bertils recept – titeln läcker via planen';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;

  insert into public.shopping_list_items (household_id, name, unit, quantity)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mjölk', 'l', 1);

  begin
    insert into public.shopping_list_items (household_id, name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'kapad vara');
    raise exception 'Anna kunde skriva i Bertils inköpslista – RLS läcker';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;
end $$;

-- Att skapa ett hushåll är ett eget flöde, och det svåraste i hela schemat:
-- policyn kräver created_by = auth.uid(), och triggern måste göra skaparen till
-- ägare i samma andetag. Missas något av det blir användaren utelåst från sitt
-- eget hushåll direkt. Uppsättningen ovan skapar hushållen som postgres och
-- säger därför ingenting om det här – det måste testas som inloggad.
do $$
declare
  nytt uuid;
  n integer;
begin
  insert into public.households (name) values ('Annas andra hushåll');

  select id into nytt from public.households where name = 'Annas andra hushåll';
  if nytt is null then
    raise exception 'Anna kan inte läsa hushållet hon just skapade';
  end if;

  select count(*) into n from public.household_members
  where household_id = nytt
    and user_id = '11111111-1111-1111-1111-111111111111'
    and role = 'owner';
  if n <> 1 then
    raise exception 'Anna blev inte ägare av sitt eget hushåll – triggern gjorde inte sitt';
  end if;

  select count(*) into n from public.households;
  if n <> 2 then raise exception 'Anna ser % hushåll, förväntade 2', n; end if;
end $$;

-- --- Bertil, spegelvänt ----------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.recipes;
  if n <> 1 then raise exception 'Bertil ser % recept, förväntade 1', n; end if;

  select count(*) into n from public.recipes where title like 'Annas%';
  if n <> 0 then raise exception 'Bertil ser Annas recept – RLS läcker'; end if;

  select count(*) into n from public.tags;
  if n <> 0 then raise exception 'Bertil ser % kategorier, Annas är inte hans', n; end if;

  select count(*) into n from public.recipe_tags;
  if n <> 0 then raise exception 'Bertil ser Annas receptkategorier – RLS läcker'; end if;

  select count(*) into n from public.meal_plan;
  if n <> 0 then raise exception 'Bertil ser Annas veckoplan – RLS läcker'; end if;

  select count(*) into n from public.shopping_list_items;
  if n <> 0 then raise exception 'Bertil ser Annas inköpslista – RLS läcker'; end if;

  -- Bertil är inte ägare i Annas hushåll och ska inte kunna bjuda in sig själv.
  begin
    insert into public.household_members (household_id, user_id, role)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '22222222-2222-2222-2222-222222222222', 'member');
    raise exception 'Bertil kunde skriva in sig i Annas hushåll – RLS läcker';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;

  select count(*) into n from public.household_invites;
  if n <> 0 then raise exception 'Bertil ser Annas inbjudningar – RLS läcker'; end if;
end $$;

-- --- Inbjudan --------------------------------------------------------------
--
-- Inlösen är det känsligaste stället i hela schemat: funktionen är security
-- definer och går alltså förbi RLS med flit, eftersom den som löser in en
-- inbjudan ännu inte är medlem. Varje kontroll den gör måste därför testas,
-- annars är den en öppen dörr till hushållets recept.

-- Tokens måste överleva mellan blocken, och rollbytena sker på toppnivå precis
-- som i resten av filen – ett jwt-byte inuti ett DO-block är svårare att följa
-- och lättare att få fel.
create temporary table testinbjudan (sort text primary key, token uuid) on commit drop;

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Anna är ägare och får bjuda in. Tre länkar: en giltig, en förbrukad, en utgången.
--
-- En insert som ska mata en annan insert måste ligga i en CTE. Postgres
-- tillåter inte en data-modifierande sats som subquery i from.
with ny as (
  insert into public.household_invites (household_id)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  returning token
)
insert into testinbjudan (sort, token) select 'giltig', token from ny;

with ny as (
  insert into public.household_invites (household_id, used_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now())
  returning token
)
insert into testinbjudan (sort, token) select 'förbrukad', token from ny;

with ny as (
  insert into public.household_invites (household_id, expires_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '1 day')
  returning token
)
insert into testinbjudan (sort, token) select 'utgången', token from ny;

-- --- Bertil löser in -------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare n integer;
begin
  -- Bertil är inte ägare i Annas hushåll och får inte skapa inbjudningar dit.
  begin
    insert into public.household_invites (household_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    raise exception 'Bertil kunde skapa en inbjudan till Annas hushåll – RLS läcker';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;

  begin
    perform public.redeem_household_invite((select token from testinbjudan where sort = 'förbrukad'));
    raise exception 'En förbrukad inbjudan gick att lösa in – engångsbruket håller inte';
  exception when no_data_found then
    null; -- rätt beteende
  end;

  begin
    perform public.redeem_household_invite((select token from testinbjudan where sort = 'utgången'));
    raise exception 'En utgången inbjudan gick att lösa in – giltighetstiden håller inte';
  exception when no_data_found then
    null; -- rätt beteende
  end;

  begin
    perform public.redeem_household_invite(gen_random_uuid());
    raise exception 'Ett påhittat token gick att lösa in';
  exception when no_data_found then
    null; -- rätt beteende
  end;

  -- Den giltiga länken släpper in honom.
  perform public.redeem_household_invite((select token from testinbjudan where sort = 'giltig'));

  select count(*) into n from public.household_members
  where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222'
    and role = 'member';
  if n <> 1 then raise exception 'Inbjudan släppte inte in Bertil som medlem'; end if;

  -- Nu ser han Annas recept, för nu är de hans hushålls recept också.
  select count(*) into n from public.recipes where title like 'Annas%';
  if n = 0 then raise exception 'Bertil kom in i hushållet men ser inte recepten'; end if;

  -- Men medlem är inte ägare: han får fortfarande inte bjuda in fler.
  begin
    insert into public.household_invites (household_id)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    raise exception 'En medlem kunde bjuda in fler – bara ägare ska få det';
  exception when insufficient_privilege then
    null; -- rätt beteende
  end;

  -- Och samma länk går inte att lösa in igen.
  begin
    perform public.redeem_household_invite((select token from testinbjudan where sort = 'giltig'));
    raise exception 'Länken gick att lösa in två gånger – engångsbruket håller inte';
  exception when no_data_found then
    null; -- rätt beteende
  end;
end $$;

-- --- Utloggad --------------------------------------------------------------

set local role anon;

do $$
declare n integer;
begin
  begin
    select count(*) into n from public.recipes;
    raise exception 'anon kunde läsa recepttabellen – rättigheterna läcker';
  exception when insufficient_privilege then
    null; -- rätt beteende: anon saknar grant helt
  end;
end $$;

reset role;
select 'RLS-testet gick igenom' as resultat;

rollback;
