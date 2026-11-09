-- Stage one is independent of candidate ballots: the same personal code works in both.
alter table bratki_private.settings
 add column extra_status text not null default 'pending' check(extra_status in ('pending','open','closed')),
 add column extra_started_at timestamptz,
 add column extra_closes_at timestamptz;
-- Preserve seasons that have already started under the previous version.
update bratki_private.settings set extra_status='closed' where status <> 'preparation';
alter table bratki_private.participants add column extra_voted boolean not null default false;
create table bratki_private.extra_tally (
 nomination_id text primary key references bratki_private.nominations(id),
 votes integer not null default 0 check(votes >= 0)
);
insert into bratki_private.extra_tally(nomination_id) select id from bratki_private.nominations where type='additional';
alter table bratki_private.extra_tally enable row level security;
revoke all on bratki_private.extra_tally from public,anon,authenticated;

-- Keep the proven candidate-ballot implementation private behind the new stage checks.
alter function public.bratki_state() set schema bratki_private;
alter function bratki_private.bratki_state() rename to candidate_state;
alter function public.bratki_voter(text,text) set schema bratki_private;
alter function bratki_private.bratki_voter(text,text) rename to candidate_voter;
alter function public.bratki_submit(text,text,jsonb) set schema bratki_private;
alter function bratki_private.bratki_submit(text,text,jsonb) rename to candidate_submit;
alter function public.bratki_admin(text,text,jsonb) set schema bratki_private;
alter function bratki_private.bratki_admin(text,text,jsonb) rename to candidate_admin;

create function bratki_private.finish_extras() returns void
 language plpgsql set search_path='' as $$
 begin
  -- No scheduler or open browser is needed to enforce the deadline.
  -- Finalization happens on the next read/action, under the same lock as submissions.
  if exists(select 1 from bratki_private.settings where extra_status='open' and extra_closes_at <= clock_timestamp()) then
   perform 1 from bratki_private.settings for update;
   if exists(select 1 from bratki_private.settings where extra_status='open' and extra_closes_at <= clock_timestamp()) then
    update bratki_private.nominations set enabled=(id in (
     select n.id from bratki_private.nominations n join bratki_private.extra_tally t on t.nomination_id=n.id
     order by t.votes desc,n.position limit 2
    )) where type='additional';
    update bratki_private.settings set extra_status='closed';
   end if;
  end if;
 end;
$$;
create function bratki_private.extra_state() returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('status',s.extra_status,'startedAt',s.extra_started_at,'closesAt',s.extra_closes_at,
  'serverNow',clock_timestamp(),'submitted',(select count(*) from bratki_private.participants where extra_voted),
  'options',(select jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'selected',s.extra_status='closed' and n.enabled) ||
   case when s.extra_status='closed' then jsonb_build_object('votes',t.votes) else '{}'::jsonb end order by n.position)
   from bratki_private.nominations n join bratki_private.extra_tally t on t.nomination_id=n.id))
 from bratki_private.settings s;
$$;
create function public.bratki_state() returns jsonb
 language plpgsql security definer set search_path='' as $$
 begin
  perform bratki_private.finish_extras();
  return bratki_private.candidate_state() || jsonb_build_object('stage',
   (select case when extra_status='closed' then 'candidates' else 'extras' end from bratki_private.settings),
   'extra',bratki_private.extra_state());
 end;
$$;
create function public.bratki_voter(p_nick text,p_code text) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare person jsonb; extra_submitted boolean; extra_phase boolean;
 begin
  perform bratki_private.finish_extras();
  person=bratki_private.candidate_voter(p_nick,p_code);
  select extra_voted into extra_submitted from bratki_private.participants
   where normalized_nick=bratki_private.normalize_nick(p_nick);
  select extra_status <> 'closed' into extra_phase from bratki_private.settings;
  return person || jsonb_build_object('candidateSubmitted',person->'submitted','extraSubmitted',extra_submitted,
   'submitted',case when extra_phase then extra_submitted else (person->>'submitted')::boolean end);
 end;
$$;
create function public.bratki_submit_extras(p_nick text,p_code text,p_choices jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare config bratki_private.settings%rowtype; person bratki_private.participants%rowtype;
 begin
  select * into config from bratki_private.settings for update;
  if char_length(coalesce(p_nick,'')) > 100 or char_length(coalesce(p_code,'')) > 100 then raise exception 'BRATKI_INVALID_CODE'; end if;
  select * into person from bratki_private.participants where normalized_nick=bratki_private.normalize_nick(p_nick)
   and code_hash=bratki_private.hash_code(p_code) for update;
  if not found then raise exception 'BRATKI_INVALID_CODE'; end if;
  if person.extra_voted then return jsonb_build_object('accepted',true,'alreadySubmitted',true); end if;
  if config.extra_status <> 'open' or clock_timestamp() >= config.extra_closes_at then raise exception 'BRATKI_EXTRAS_CLOSED'; end if;
  if jsonb_typeof(p_choices) is distinct from 'array' then raise exception 'BRATKI_INVALID_EXTRAS'; end if;
  if jsonb_array_length(p_choices) <> 2 then raise exception 'BRATKI_INVALID_EXTRAS'; end if;
  if (select count(distinct value) from jsonb_array_elements(p_choices)) <> 2 or exists(
   select 1 from jsonb_array_elements(p_choices) choice where jsonb_typeof(choice) <> 'string' or not exists(
    select 1 from bratki_private.nominations where type='additional' and id=choice#>>'{}'
   )) then raise exception 'BRATKI_INVALID_EXTRAS'; end if;
  update bratki_private.extra_tally set votes=votes+1 where nomination_id in (select jsonb_array_elements_text(p_choices));
  update bratki_private.participants set extra_voted=true where id=person.id;
  return jsonb_build_object('accepted',true,'alreadySubmitted',false);
 end;
$$;
create function public.bratki_submit(p_nick text,p_code text,p_choices jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
 begin
  perform 1 from bratki_private.settings for update;
  perform bratki_private.finish_extras();
  if exists(select 1 from bratki_private.settings where extra_status <> 'closed') then raise exception 'BRATKI_EXTRAS_FIRST'; end if;
  return bratki_private.candidate_submit(p_nick,p_code,p_choices);
 end;
$$;
create function public.bratki_admin(p_key text,p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
 declare config bratki_private.settings%rowtype; result jsonb; adjusted jsonb; nomination jsonb;
 begin
  -- Authenticate before taking a write lock or finalizing the round.
  select * into config from bratki_private.settings;
  if config.admin_hash is null or char_length(coalesce(p_key,'')) > 256 or
   config.admin_hash <> encode(extensions.digest(coalesce(p_key,''),'sha256'),'hex') then raise exception 'BRATKI_ADMIN_DENIED'; end if;
  perform 1 from bratki_private.settings for update;
  perform bratki_private.finish_extras();
  select * into config from bratki_private.settings;
  if p_action='open_extras' then
   if config.status <> 'preparation' or config.extra_status <> 'pending' then raise exception 'BRATKI_CONFIG_LOCKED'; end if;
   update bratki_private.nominations set enabled=false where type='additional';
   update bratki_private.settings set extra_status='open',extra_started_at=clock_timestamp(),extra_closes_at=clock_timestamp()+interval '72 hours';
   result=bratki_private.candidate_admin(p_key,'dashboard');
  else
   if p_action='open' and config.extra_status <> 'closed' then raise exception 'BRATKI_EXTRAS_FIRST'; end if;
   if p_action='reissue' and config.extra_status <> 'closed' and exists(
    select 1 from bratki_private.participants where id::text=p_payload->>'id' and extra_voted
   ) then raise exception 'BRATKI_CANNOT_REISSUE'; end if;
   if p_action='configure' and jsonb_typeof(p_payload->'nominations')='array' then
    -- Enabled extras are decided by votes, never by a checkbox in the admin payload.
    adjusted='[]'::jsonb;
    for nomination in select value from jsonb_array_elements(p_payload->'nominations') loop
     adjusted=adjusted||jsonb_build_array(nomination||jsonb_build_object('enabled',coalesce(
      (select enabled from bratki_private.nominations where id=nomination->>'id'),false)));
    end loop;
    p_payload=jsonb_set(p_payload,'{nominations}',adjusted);
   end if;
   result=bratki_private.candidate_admin(p_key,p_action,p_payload);
  end if;
  if result ? 'codes' then return result; end if;
  return result || jsonb_build_object('stage',(select case when extra_status='closed' then 'candidates' else 'extras' end from bratki_private.settings),
   'extra',bratki_private.extra_state(),'participants',
   (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nick',nick,'submitted',voted,'extraSubmitted',extra_voted) order by normalized_nick),'[]'::jsonb)
    from bratki_private.participants));
 end;
$$;
revoke all on all functions in schema bratki_private from public,anon,authenticated;
revoke all on function public.bratki_state(),public.bratki_voter(text,text),public.bratki_submit(text,text,jsonb),
 public.bratki_submit_extras(text,text,jsonb),public.bratki_admin(text,text,jsonb) from public;
grant execute on function public.bratki_state(),public.bratki_voter(text,text),public.bratki_submit(text,text,jsonb),
 public.bratki_submit_extras(text,text,jsonb),public.bratki_admin(text,text,jsonb) to anon,authenticated;
