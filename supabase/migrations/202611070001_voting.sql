-- BRATKI: public pages call only these RPCs; all underlying tables are private.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists bratki_private;
revoke all on schema bratki_private from public, anon, authenticated;

create table bratki_private.settings (
  singleton boolean primary key default true check (singleton),
  season integer not null default 2026,
  status text not null default 'preparation' check (status in ('preparation','open','closed')),
  results_published boolean not null default false,
  admin_hash text
);
insert into bratki_private.settings(singleton) values(true);
create table bratki_private.nominations (
  id text primary key,
  title text not null,
  type text not null check(type in ('main','additional')),
  enabled boolean not null default false,
  position integer not null unique
);
insert into bratki_private.nominations(id,title,type,enabled,position) values
 ('king','Король братков','main',true,1),
 ('positive','Позитив Года','main',true,2),
 ('negative','Негатив Года','main',true,3),
 ('pinned','Закреп года','main',true,4),
 ('delivery','Завоз Года','additional',false,5),
 ('funny','Смешной года','additional',false,6),
 ('heart','Сердце Сбора','additional',false,7),
 ('wise','Мудрость года','additional',false,8);
create table bratki_private.candidates (
  id uuid primary key default gen_random_uuid(),
  nomination_id text not null references bratki_private.nominations(id),
  label text not null check(char_length(label) between 1 and 80),
  position integer not null,
  unique(nomination_id,position)
);
create unique index candidates_unique_name on bratki_private.candidates(nomination_id,lower(label));
create table bratki_private.participants (
  id uuid primary key default gen_random_uuid(),
  nick text not null check(char_length(nick) between 1 and 60),
  normalized_nick text not null unique,
  code_hash text not null unique,
  voted boolean not null default false
);
-- Only aggregate counts are retained. No ballot, voter ID or vote timestamp here.
create table bratki_private.tally (
  candidate_id uuid primary key references bratki_private.candidates(id) on delete cascade,
  votes integer not null default 0 check(votes >= 0)
);
alter table bratki_private.settings enable row level security;
alter table bratki_private.nominations enable row level security;
alter table bratki_private.candidates enable row level security;
alter table bratki_private.participants enable row level security;
alter table bratki_private.tally enable row level security;
revoke all on all tables in schema bratki_private from public, anon, authenticated;

create function bratki_private.normalize_nick(value text) returns text
 language sql immutable set search_path='' as $$
 select lower(regexp_replace(btrim(coalesce(value,'')), '[[:space:]]+', ' ', 'g'));
$$;
create function bratki_private.hash_code(value text) returns text
 language sql immutable set search_path='' as $$
 select encode(extensions.digest(regexp_replace(upper(coalesce(value,'')), '[[:space:]-]', '', 'g'),'sha256'),'hex');
$$;
create function bratki_private.categories(include_disabled boolean, include_results boolean) returns jsonb
 language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',n.id,'title',n.title,'type',n.type,'enabled',n.enabled,
   'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.label) ||
     case when include_results then jsonb_build_object('votes',coalesce(t.votes,0)) else '{}'::jsonb end
     order by c.position),'[]'::jsonb)
     from bratki_private.candidates c left join bratki_private.tally t on t.candidate_id=c.id where c.nomination_id=n.id)
 ) order by n.position),'[]'::jsonb)
 from bratki_private.nominations n where include_disabled or n.enabled;
$$;

create function public.bratki_state() returns jsonb
 language sql stable security definer set search_path='' as $$
 select jsonb_build_object('season',s.season,'status',s.status,'resultsPublished',s.results_published,
  'participants',(select count(*) from bratki_private.participants),
  'submitted',(select count(*) from bratki_private.participants where voted),
  'nominations',bratki_private.categories(false,s.results_published and s.status='closed'))
 from bratki_private.settings s;
$$;

create function public.bratki_voter(p_nick text,p_code text) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare person bratki_private.participants%rowtype;
 begin
  if char_length(coalesce(p_nick,'')) > 100 or char_length(coalesce(p_code,'')) > 100 then
   raise exception 'BRATKI_INVALID_CODE';
  end if;
  select * into person from bratki_private.participants
   where normalized_nick=bratki_private.normalize_nick(p_nick) and code_hash=bratki_private.hash_code(p_code);
  if not found then raise exception 'BRATKI_INVALID_CODE'; end if;
  return jsonb_build_object('nick',person.nick,'submitted',person.voted);
 end;
$$;

create function public.bratki_submit(p_nick text,p_code text,p_choices jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare config bratki_private.settings%rowtype; person bratki_private.participants%rowtype;
  expected integer; actual integer; updated integer;
 begin
  -- Serialize submissions and admin transitions. Validation, consumption and counting
  -- take place in the same PostgreSQL transaction, including concurrent retries.
  select * into config from bratki_private.settings for update;
  if char_length(coalesce(p_nick,'')) > 100 or char_length(coalesce(p_code,'')) > 100 then
   raise exception 'BRATKI_INVALID_CODE';
  end if;
  select * into person from bratki_private.participants
   where normalized_nick=bratki_private.normalize_nick(p_nick) and code_hash=bratki_private.hash_code(p_code) for update;
  if not found then raise exception 'BRATKI_INVALID_CODE'; end if;
  -- A lost HTTP response can be retried without casting a second ballot.
  if person.voted then return jsonb_build_object('accepted',true,'alreadySubmitted',true); end if;
  if config.status <> 'open' then raise exception 'BRATKI_NOT_OPEN'; end if;
  if jsonb_typeof(p_choices) is distinct from 'object' then raise exception 'BRATKI_INVALID_BALLOT'; end if;
  select count(*) into expected from bratki_private.nominations where enabled;
  select count(*) into actual from jsonb_object_keys(p_choices);
  if expected <> 6 or actual <> expected then raise exception 'BRATKI_INVALID_BALLOT'; end if;
  if exists(select 1 from bratki_private.nominations n where n.enabled and not exists(
   select 1 from bratki_private.candidates c where c.nomination_id=n.id and c.id::text=p_choices->>n.id
  )) then raise exception 'BRATKI_INVALID_BALLOT'; end if;
  update bratki_private.tally t set votes=t.votes+1 from bratki_private.candidates c,jsonb_each_text(p_choices) choice
   where t.candidate_id=c.id and c.nomination_id=choice.key and c.id::text=choice.value;
  get diagnostics updated = row_count;
  if updated <> expected then raise exception 'BRATKI_INVALID_BALLOT'; end if;
  update bratki_private.participants set voted=true where id=person.id;
  return jsonb_build_object('accepted',true,'alreadySubmitted',false);
 end;
$$;

create function public.bratki_admin(p_key text,p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare config bratki_private.settings%rowtype; entry jsonb; candidate jsonb; issued jsonb='[]'::jsonb;
  nickname text; normalized text; raw_code text; formatted_code text; participant_id uuid;
  candidate_position integer; category_count integer; existing integer;
 begin
  select * into config from bratki_private.settings;
  if config.admin_hash is null or char_length(coalesce(p_key,'')) > 256 or
    config.admin_hash <> encode(extensions.digest(coalesce(p_key,''),'sha256'),'hex') then
   raise exception 'BRATKI_ADMIN_DENIED';
  end if;
  select * into config from bratki_private.settings for update;
  if p_action='configure' then
   if config.status <> 'preparation' then raise exception 'BRATKI_CONFIG_LOCKED'; end if;
   if jsonb_typeof(p_payload->'nominations') is distinct from 'array' or jsonb_array_length(p_payload->'nominations') <> 8 then
    raise exception 'BRATKI_INVALID_CONFIG';
   end if;
   select count(distinct value->>'id') into category_count from jsonb_array_elements(p_payload->'nominations');
   if category_count <> 8 then raise exception 'BRATKI_INVALID_CONFIG'; end if;
   for entry in select value from jsonb_array_elements(p_payload->'nominations') loop
    if not exists(select 1 from bratki_private.nominations where id=entry->>'id') or
      jsonb_typeof(entry->'enabled') is distinct from 'boolean' or
      jsonb_typeof(entry->'candidates') is distinct from 'array' or jsonb_array_length(entry->'candidates') > 100 then
     raise exception 'BRATKI_INVALID_CONFIG';
    end if;
    update bratki_private.nominations set enabled=case when type='main' then true else (entry->>'enabled')::boolean end where id=entry->>'id';
    delete from bratki_private.candidates where nomination_id=entry->>'id';
    candidate_position=0;
    for candidate in select value from jsonb_array_elements(entry->'candidates') loop
     nickname=btrim(candidate#>>'{}');
     if jsonb_typeof(candidate) <> 'string' or char_length(nickname) not between 1 and 80 or nickname ~ '[[:cntrl:]]' then
      raise exception 'BRATKI_INVALID_CONFIG';
     end if;
     candidate_position=candidate_position+1;
     insert into bratki_private.candidates(nomination_id,label,position) values(entry->>'id',nickname,candidate_position);
    end loop;
   end loop;
   insert into bratki_private.tally(candidate_id) select id from bratki_private.candidates;
  elsif p_action='issue' then
   if config.status <> 'preparation' then raise exception 'BRATKI_CONFIG_LOCKED'; end if;
   if jsonb_typeof(p_payload->'nicks') is distinct from 'array' or jsonb_array_length(p_payload->'nicks') not between 1 and 500 then
    raise exception 'BRATKI_INVALID_NICKS';
   end if;
   select count(*) into existing from bratki_private.participants;
   if existing+jsonb_array_length(p_payload->'nicks') > 500 then raise exception 'BRATKI_INVALID_NICKS'; end if;
   for entry in select value from jsonb_array_elements(p_payload->'nicks') loop
    nickname=regexp_replace(btrim(entry#>>'{}'),'[[:space:]]+',' ','g');
    normalized=bratki_private.normalize_nick(nickname);
    if jsonb_typeof(entry) <> 'string' or char_length(nickname) not between 1 and 60 or nickname ~ '[[:cntrl:]]' then
     raise exception 'BRATKI_INVALID_NICKS';
    end if;
    if exists(select 1 from bratki_private.participants where normalized_nick=normalized) then raise exception 'BRATKI_DUPLICATE_NICK'; end if;
    raw_code=upper(encode(extensions.gen_random_bytes(12),'hex'));
    formatted_code=substr(raw_code,1,4)||'-'||substr(raw_code,5,4)||'-'||substr(raw_code,9,4)||'-'||substr(raw_code,13,4)||'-'||substr(raw_code,17,4)||'-'||substr(raw_code,21,4);
    insert into bratki_private.participants(nick,normalized_nick,code_hash) values(nickname,normalized,bratki_private.hash_code(raw_code));
    issued=issued||jsonb_build_array(jsonb_build_object('nick',nickname,'code',formatted_code));
   end loop;
   return jsonb_build_object('codes',issued);
  elsif p_action='reissue' then
   if config.status='closed' then raise exception 'BRATKI_CONFIG_LOCKED'; end if;
   select id into participant_id from bratki_private.participants where id::text=p_payload->>'id' and not voted for update;
   if participant_id is null then raise exception 'BRATKI_CANNOT_REISSUE'; end if;
   raw_code=upper(encode(extensions.gen_random_bytes(12),'hex'));
   formatted_code=substr(raw_code,1,4)||'-'||substr(raw_code,5,4)||'-'||substr(raw_code,9,4)||'-'||substr(raw_code,13,4)||'-'||substr(raw_code,17,4)||'-'||substr(raw_code,21,4);
   update bratki_private.participants set code_hash=bratki_private.hash_code(raw_code) where id=participant_id returning nick into nickname;
   return jsonb_build_object('codes',jsonb_build_array(jsonb_build_object('nick',nickname,'code',formatted_code)));
  elsif p_action='open' then
   if config.status <> 'preparation' then raise exception 'BRATKI_CONFIG_LOCKED'; end if;
   if (select count(*) from bratki_private.nominations where type='additional' and enabled) <> 2 or
      exists(select 1 from bratki_private.nominations n where enabled and (select count(*) from bratki_private.candidates c where c.nomination_id=n.id) < 2) or
      not exists(select 1 from bratki_private.participants) then raise exception 'BRATKI_NOT_READY'; end if;
   update bratki_private.settings set status='open';
  elsif p_action='close' then
   if config.status <> 'open' then raise exception 'BRATKI_NOT_OPEN'; end if;
   update bratki_private.settings set status='closed';
  elsif p_action='publish' then
   if config.status <> 'closed' then raise exception 'BRATKI_CLOSE_FIRST'; end if;
   update bratki_private.settings set results_published=true;
  elsif p_action <> 'dashboard' then raise exception 'BRATKI_UNKNOWN_ACTION';
  end if;
  select * into config from bratki_private.settings;
  return jsonb_build_object('season',config.season,'status',config.status,'resultsPublished',config.results_published,
   'nominations',bratki_private.categories(true,config.status='closed'),
   'participants',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'nick',nick,'submitted',voted) order by normalized_nick),'[]'::jsonb) from bratki_private.participants));
 exception when unique_violation then raise exception 'BRATKI_DUPLICATE_NAME';
 end;
$$;

revoke all on all functions in schema bratki_private from public,anon,authenticated;
revoke all on function public.bratki_state() from public;
revoke all on function public.bratki_voter(text,text) from public;
revoke all on function public.bratki_submit(text,text,jsonb) from public;
revoke all on function public.bratki_admin(text,text,jsonb) from public;
grant execute on function public.bratki_state() to anon,authenticated;
grant execute on function public.bratki_voter(text,text) to anon,authenticated;
grant execute on function public.bratki_submit(text,text,jsonb) to anon,authenticated;
grant execute on function public.bratki_admin(text,text,jsonb) to anon,authenticated;
