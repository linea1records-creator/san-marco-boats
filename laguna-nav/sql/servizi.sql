-- clickVenice · Servizi: professionisti ("Lavora con noi") e prenotazioni dei servizi (sostituisce spedizioni.sql, mai eseguito)
-- Le tabelle non hanno policy: si leggono e si scrivono solo tramite le funzioni qui sotto.

-- ===================== professionisti =====================
create table if not exists public.professionisti (
  id bigserial primary key,
  profile_id bigint not null references public.profiles(id) on delete cascade,
  categoria text not null check (categoria ~ '^[a-z_]{2,30}$'),
  categoria_custom text not null default '',          -- solo per "altro"
  nome text not null,
  zona text not null default '',
  tariffa numeric(10,2),                               -- tariffa indicativa in euro
  unita text not null default 'servizio' check (unita in ('ora','servizio','giornata')),
  bio text not null default '',
  whatsapp text not null,
  termini_at timestamptz not null,                     -- quando ha accettato i termini (attività autonoma, fattura/ricevuta al cliente)
  stato text not null default 'pending' check (stato in ('pending','approved','paused','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists professionisti_uno on public.professionisti(profile_id, categoria, lower(categoria_custom));
create index if not exists professionisti_cat on public.professionisti(categoria, stato);
alter table public.professionisti enable row level security;

create or replace function public.pro_json(x public.professionisti) returns jsonb language sql stable as $$
  select jsonb_build_object('id', x.id, 'categoria', x.categoria, 'custom', x.categoria_custom, 'nome', x.nome, 'zona', x.zona,
    'tariffa', x.tariffa, 'unita', x.unita, 'bio', x.bio, 'wa', x.whatsapp, 'stato', x.stato, 'creata', x.created_at, 'agg', x.updated_at);
$$;

-- candidatura (una per categoria: se la rimandi si aggiorna; se era approvata resta approvata)
create or replace function public.pro_candida(p_token uuid, p_data jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; n int; cat text; cu text; t numeric; u text; r professionisti%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select count(*) into n from professionisti where profile_id = m.id and updated_at > now() - interval '1 day';
  if n >= 10 then return jsonb_build_object('errore','troppe'); end if;
  cat := lower(coalesce(p_data->>'categoria','')); cu := case when cat = 'altro' then left(trim(coalesce(p_data->>'custom','')), 40) else '' end;
  if cat !~ '^[a-z_]{2,30}$' or (cat = 'altro' and length(cu) < 3) or length(trim(coalesce(p_data->>'nome',''))) < 2
     or length(regexp_replace(coalesce(p_data->>'wa',''), '\D', '', 'g')) < 8 or coalesce((p_data->>'termini')::boolean, false) is not true then
    return jsonb_build_object('errore','dati'); end if;
  begin t := nullif(replace(coalesce(p_data->>'tariffa',''), ',', '.'), '')::numeric; exception when others then t := null; end;
  if t is not null and (t < 0 or t > 99999) then t := null; end if;
  u := coalesce(p_data->>'unita','servizio'); if u not in ('ora','servizio','giornata') then u := 'servizio'; end if;
  insert into professionisti(profile_id, categoria, categoria_custom, nome, zona, tariffa, unita, bio, whatsapp, termini_at)
  values (m.id, cat, cu, left(trim(p_data->>'nome'), 60), left(coalesce(p_data->>'zona',''), 160), t, u, left(coalesce(p_data->>'bio',''), 400), left(p_data->>'wa', 20), now())
  on conflict (profile_id, categoria, lower(categoria_custom)) do update set
    nome = excluded.nome, zona = excluded.zona, tariffa = excluded.tariffa, unita = excluded.unita, bio = excluded.bio, whatsapp = excluded.whatsapp,
    termini_at = excluded.termini_at, updated_at = now(),
    stato = case when professionisti.stato in ('approved','paused') then professionisti.stato else 'pending' end
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'stato', r.stato);
end $$;

create or replace function public.pro_mie(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(pro_json(x) order by x.created_at desc) from professionisti x where x.profile_id = m.id), '[]'::jsonb));
end $$;

-- quali servizi sono attivi: solo categoria, quanti e tariffa più bassa (nessun dato personale)
create or replace function public.pro_attive(p_token uuid default null) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('lista', coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'n', n, 'tariffa', tmin, 'unita', u)), '[]'::jsonb))
  from (select categoria, count(*) n, min(tariffa) tmin, (array_agg(unita order by tariffa nulls last))[1] u
        from professionisti where stato = 'approved' and categoria <> 'altro' group by categoria) s;
$$;

-- pannello di tropss
create or replace function public.pro_admin(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found or lower(m.clickname) <> 'tropss' then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(pro_json(x) || jsonb_build_object('utente', p.clickname)
    order by (x.stato = 'pending') desc, x.updated_at desc) from professionisti x join profiles p on p.id = x.profile_id), '[]'::jsonb));
end $$;

create or replace function public.pro_stato(p_token uuid, p_id bigint, p_stato text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found or lower(m.clickname) <> 'tropss' then return jsonb_build_object('errore','non_autorizzato'); end if;
  if p_stato not in ('pending','approved','paused','rejected') then return jsonb_build_object('errore','stato'); end if;
  update professionisti set stato = p_stato, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('errore','non_trovata'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ===================== prenotazioni =====================
create table if not exists public.prenotazioni (
  id bigserial primary key,
  codice text not null unique,
  profile_id bigint not null references public.profiles(id) on delete cascade,
  categoria text not null check (categoria ~ '^[a-z_]{2,30}$'),
  ritiro jsonb not null default '{}',        -- luogo del servizio (o ritiro per i trasporti): { name, lat, lng }
  consegna jsonb,                            -- solo trasporti
  dettagli jsonb not null default '{}',      -- risposte specifiche della categoria (volume, ore, tipo di lavoro…)
  note text not null default '',
  giorno date not null,
  fascia text not null,
  nome text not null, telefono text not null,
  totale numeric(10,2) not null default 0,   -- stima calcolata dall'app: va confermata
  anticipo numeric(10,2) not null default 0,
  pro_id bigint references public.professionisti(id) on delete set null,   -- a chi la giri (per dopo)
  stato text not null default 'nuova' check (stato in ('nuova','confermata','fatta','annullata')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prenotazioni_profile on public.prenotazioni(profile_id, created_at desc);
create index if not exists prenotazioni_stato on public.prenotazioni(stato, giorno);
alter table public.prenotazioni enable row level security;

create or replace function public.pren_json(s public.prenotazioni) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'codice', s.codice, 'categoria', s.categoria, 'ritiro', s.ritiro, 'consegna', s.consegna, 'dettagli', s.dettagli,
    'note', s.note, 'giorno', s.giorno, 'fascia', s.fascia, 'nome', s.nome, 'tel', s.telefono, 'totale', s.totale, 'anticipo', s.anticipo, 'stato', s.stato, 'creata', s.created_at);
$$;

create or replace function public.pren_crea(p_token uuid, p_data jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; n int; c text; s prenotazioni%rowtype; g date;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select count(*) into n from prenotazioni where profile_id = m.id and created_at > now() - interval '1 day';
  if n >= 10 then return jsonb_build_object('errore','troppe'); end if;
  if coalesce(p_data->>'categoria','') !~ '^[a-z_]{2,30}$' or (p_data->>'giorno') is null
     or length(trim(coalesce(p_data->>'nome',''))) < 2 or length(regexp_replace(coalesce(p_data->>'tel',''), '\D', '', 'g')) < 8 then
    return jsonb_build_object('errore','dati'); end if;
  g := (p_data->>'giorno')::date;
  if g < current_date - 1 or g > current_date + 90 then return jsonb_build_object('errore','data'); end if;
  loop
    c := 'CV-' || to_char(now() at time zone 'Europe/Rome', 'DDMM') || '-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists(select 1 from prenotazioni where codice = c);
  end loop;
  insert into prenotazioni(codice, profile_id, categoria, ritiro, consegna, dettagli, note, giorno, fascia, nome, telefono, totale, anticipo)
  values (c, m.id, p_data->>'categoria', coalesce(p_data->'ritiro','{}'), p_data->'consegna', coalesce(p_data->'dettagli','{}'),
    left(coalesce(p_data->>'note',''), 400), g, left(coalesce(p_data->>'fascia','flessibile'), 30),
    left(trim(p_data->>'nome'), 60), left(p_data->>'tel', 20),
    greatest(0, least(99999, coalesce((p_data->>'totale')::numeric, 0))), greatest(0, least(99999, coalesce((p_data->>'anticipo')::numeric, 0))))
  returning * into s;
  return jsonb_build_object('ok', true, 'codice', s.codice, 'id', s.id);
end $$;

create or replace function public.pren_mie(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(pren_json(s) order by s.created_at desc)
    from (select * from prenotazioni where profile_id = m.id order by created_at desc limit 30) s), '[]'::jsonb));
end $$;

create or replace function public.pren_tutte(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found or lower(m.clickname) <> 'tropss' then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(pren_json(s) order by (s.stato = 'nuova') desc, s.giorno, s.created_at desc)
    from (select * from prenotazioni where stato in ('nuova','confermata') or updated_at > now() - interval '14 days' order by created_at desc limit 100) s), '[]'::jsonb));
end $$;

create or replace function public.pren_stato(p_token uuid, p_id bigint, p_stato text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found or lower(m.clickname) <> 'tropss' then return jsonb_build_object('errore','non_autorizzato'); end if;
  if p_stato not in ('nuova','confermata','fatta','annullata') then return jsonb_build_object('errore','stato'); end if;
  update prenotazioni set stato = p_stato, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('errore','non_trovata'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pro_json(public.professionisti), public.pren_json(public.prenotazioni) from public, anon, authenticated;
revoke all on function public.pro_candida(uuid, jsonb), public.pro_mie(uuid), public.pro_attive(uuid), public.pro_admin(uuid), public.pro_stato(uuid, bigint, text),
  public.pren_crea(uuid, jsonb), public.pren_mie(uuid), public.pren_tutte(uuid), public.pren_stato(uuid, bigint, text) from public;
grant execute on function public.pro_candida(uuid, jsonb), public.pro_mie(uuid), public.pro_attive(uuid), public.pro_admin(uuid), public.pro_stato(uuid, bigint, text),
  public.pren_crea(uuid, jsonb), public.pren_mie(uuid), public.pren_tutte(uuid), public.pren_stato(uuid, bigint, text) to anon, authenticated;

-- v3.72 · video YouTube dei professionisti e professionista scelto nella prenotazione (già applicato su LAGUNA NAV)
alter table public.professionisti add column if not exists video jsonb not null default '[]'::jsonb;
-- funzioni: pro_video_set(p_token, p_pro, p_video), pro_lista(p_token, p_cat); pren_crea accetta "pro" (id del professionista approvato della stessa categoria)
