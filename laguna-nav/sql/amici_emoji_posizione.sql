-- unClick: emoji tra amici, riepilogo all'apertura, ultima posizione sempre visibile agli amici, barca visibile agli amici, vestiti dell'avatar

-- 1) emoji (oltre a baci e cuori): la colonna dice quale emoji è stata mandata
alter table public.kisses add column if not exists emoji text not null default '💋';

create or replace function public.kiss_send2(p_token uuid, p_nome text, p_lat double precision, p_lng double precision, p_emoji text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; t profiles%rowtype; n int;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  if p_emoji is null or p_emoji not in ('💋','❤️','😘','💌','🌹','🍹','💩','😂','🔥','👋') then return jsonb_build_object('errore','emoji'); end if;
  select * into t from profiles where lower(clickname) = lower(p_nome); if not found or t.id = m.id then return jsonb_build_object('errore','utente'); end if;
  if not is_friend(m.id, t.id) then return jsonb_build_object('errore','non_amici'); end if;
  if exists(select 1 from blocks b where (b.from_id = t.id and b.to_id = m.id)) then return jsonb_build_object('ok', true); end if;
  select count(*) into n from kisses where from_id = m.id and created_at > now() - interval '1 minute';
  if n >= 10 then return jsonb_build_object('errore','troppi'); end if;
  insert into kisses(from_id, to_id, from_lat, from_lng, emoji) values (m.id, t.id, p_lat, p_lng, p_emoji);
  delete from kisses where created_at < now() - interval '7 days';
  return jsonb_build_object('ok', true);
end $$;

-- in arrivo mentre l'app è aperta (ultimi 2 minuti), con l'emoji
create or replace function public.kiss_inbox(p_token uuid, p_after bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  if p_after is null or p_after < 0 then return jsonb_build_object('ultimo', coalesce((select max(id) from kisses where to_id = m.id), 0), 'baci', '[]'::jsonb); end if;
  return jsonb_build_object('ultimo', coalesce((select max(id) from kisses where to_id = m.id), p_after),
    'baci', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'nome', p.clickname, 'emoji', k.emoji, 'lat', coalesce(k.from_lat, l.lat), 'lng', coalesce(k.from_lng, l.lng)) order by k.id)
      from kisses k join profiles p on p.id = k.from_id left join live_locs l on l.profile_id = k.from_id
      where k.to_id = m.id and k.id > p_after and k.created_at > now() - interval '2 minutes'), '[]'::jsonb));
end $$;

-- riepilogo di quello che è arrivato mentre l'app era chiusa: chi, cosa e quanti
create or replace function public.kiss_summary(p_token uuid, p_after bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('ultimo', coalesce((select max(id) from kisses where to_id = m.id), coalesce(p_after, 0)),
    'righe', coalesce((select jsonb_agg(jsonb_build_object('nome', x.nome, 'emoji', x.emoji, 'n', x.n)) from (
      select p.clickname nome, k.emoji, count(*) n from kisses k join profiles p on p.id = k.from_id
      where k.to_id = m.id and k.id > coalesce(p_after, 0) group by p.clickname, k.emoji order by max(k.id)) x), '[]'::jsonb));
end $$;

-- 2) posizione: si ricorda se sei in barca, e gli amici vedono sempre l'ultima posizione (con da quanto tempo)
alter table public.live_locs add column if not exists boat boolean not null default false;

create or replace function public.loc_push2(p_token uuid, p_lat double precision, p_lng double precision, p_hdg real, p_boat boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  if not m.share_loc then return jsonb_build_object('ok', false, 'share', false); end if;
  if p_lat not between 44 and 47 or p_lng not between 11 and 14 then return jsonb_build_object('errore','fuori_zona'); end if;
  insert into live_locs(profile_id, lat, lng, hdg, boat, updated_at) values (m.id, p_lat, p_lng, p_hdg, coalesce(p_boat, false), now())
    on conflict (profile_id) do update set lat = excluded.lat, lng = excluded.lng, hdg = excluded.hdg, boat = excluded.boat, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.loc_friends(p_token uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nome', p.clickname, 'lat', l.lat, 'lng', l.lng, 'hdg', l.hdg, 'avatar', p.avatar, 'barca', l.boat,
      'minuti', floor(extract(epoch from now() - l.updated_at) / 60)))
    from friends f join profiles p on p.id = case when f.from_id = m.id then f.to_id else f.from_id end
    join live_locs l on l.profile_id = p.id
    where f.accepted and (f.from_id = m.id or f.to_id = m.id) and p.share_loc), '[]'::jsonb);
end $$;

-- 3) avatar con i vestiti (maglietta, pantaloni/gonna, scarpe, capelli)
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

grant execute on function public.kiss_send2(uuid, text, double precision, double precision, text) to anon, authenticated;
grant execute on function public.kiss_summary(uuid, bigint) to anon, authenticated;
grant execute on function public.loc_push2(uuid, double precision, double precision, real, boolean) to anon, authenticated;
grant execute on function public.avatar_set2(uuid, jsonb) to anon, authenticated;
