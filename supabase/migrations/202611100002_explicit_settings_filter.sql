-- Supabase safeupdate requires an explicit filter, including on singleton tables.
-- Change function bodies only; this migration never starts or closes a voting stage.
do $$
declare signature text; definition text;
begin
 foreach signature in array array[
  'bratki_private.candidate_admin(text,text,jsonb)',
  'bratki_private.finish_extras()',
  'public.bratki_admin(text,text,jsonb)'
 ] loop
  definition=pg_get_functiondef(signature::regprocedure);
  definition=replace(definition, 'update bratki_private.settings set status=''open'';', 'update bratki_private.settings set status=''open'' where singleton=true;');
  definition=replace(definition, 'update bratki_private.settings set status=''closed'';', 'update bratki_private.settings set status=''closed'' where singleton=true;');
  definition=replace(definition, 'update bratki_private.settings set results_published=true;', 'update bratki_private.settings set results_published=true where singleton=true;');
  definition=replace(definition, 'update bratki_private.settings set extra_status=''closed'';', 'update bratki_private.settings set extra_status=''closed'' where singleton=true;');
  definition=replace(definition, 'extra_closes_at=clock_timestamp()+interval ''72 hours'';', 'extra_closes_at=clock_timestamp()+interval ''72 hours'' where singleton=true;');
  execute definition;
 end loop;
end;
$$;
