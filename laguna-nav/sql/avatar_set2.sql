-- avatar con vestiti: sesso, maglietta, pantaloni/gonna, scarpe, capelli (colori #rrggbb)
create or replace function public.avatar_set2(p_token uuid, p_avatar jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; k text; a jsonb := '{}'::jsonb;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  if coalesce(p_avatar->>'sex','') not in ('m','f') then return jsonb_build_object('errore','dati'); end if;
  a := jsonb_build_object('sex', p_avatar->>'sex');
  foreach k in array array['shirt','legs','shoe','hair'] loop
    if coalesce(p_avatar->>k,'') ~ '^#[0-9a-fA-F]{6}$' then a := a || jsonb_build_object(k, lower(p_avatar->>k)); end if;
  end loop;
  update profiles set avatar = a where id = m.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.avatar_set2(uuid, jsonb) to anon, authenticated;
