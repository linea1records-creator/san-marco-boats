-- clickVenice · Spedisci & Traslochi (da eseguire una volta sul progetto Supabase LAGUNA NAV)
-- Richieste di trasporto merci, traslochi e consegne veloci. Si legge e si scrive solo tramite le funzioni qui sotto.
create table if not exists public.spedizioni (
  id bigserial primary key,
  codice text not null unique,
  profile_id bigint not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('barca','trasloco','piedi')),
  ritiro jsonb not null,                 -- { name, lat, lng }
  consegna jsonb not null,
  volume text, servizio text, note text,
  giorno date not null,
  fascia text not null,
  nome text not null, telefono text not null,
  totale numeric(10,2) not null default 0,     -- stima calcolata dall'app: va confermata dall'operatore
  anticipo numeric(10,2) not null default 0,
  stato text not null default 'nuova' check (stato in ('nuova','confermata','fatta','annullata')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists spedizioni_profile on public.spedizioni(profile_id, created_at desc);
create index if not exists spedizioni_stato on public.spedizioni(stato, giorno);
alter table public.spedizioni enable row level security;   -- nessuna policy: niente accesso diretto dalle API

create or replace function public.spedizione_json(s public.spedizioni) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'codice', s.codice, 'tipo', s.tipo, 'ritiro', s.ritiro, 'consegna', s.consegna,
    'volume', s.volume, 'servizio', s.servizio, 'note', s.note, 'giorno', s.giorno, 'fascia', s.fascia,
    'nome', s.nome, 'tel', s.telefono, 'totale', s.totale, 'anticipo', s.anticipo, 'stato', s.stato, 'creata', s.created_at);
$$;

create or replace function public.spedizione_crea(p_token uuid, p_data jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; n int; c text; s spedizioni%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select count(*) into n from spedizioni where profile_id = m.id and created_at > now() - interval '1 day';
  if n >= 10 then return jsonb_build_object('errore','troppe'); end if;
  if coalesce(p_data->>'tipo','') not in ('barca','trasloco','piedi') or (p_data->>'giorno') is null
     or length(coalesce(p_data->>'nome','')) < 2 or length(regexp_replace(coalesce(p_data->>'tel',''), '\D', '', 'g')) < 8 then
    return jsonb_build_object('errore','dati'); end if;
  if (p_data->>'giorno')::date < current_date or (p_data->>'giorno')::date > current_date + 60 then return jsonb_build_object('errore','data'); end if;
  loop
    c := 'CV-' || to_char(now() at time zone 'Europe/Rome', 'DDMM') || '-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists(select 1 from spedizioni where codice = c);
  end loop;
  insert into spedizioni(codice, profile_id, tipo, ritiro, consegna, volume, servizio, note, giorno, fascia, nome, telefono, totale, anticipo)
  values (c, m.id, p_data->>'tipo', coalesce(p_data->'ritiro','{}'), coalesce(p_data->'consegna','{}'),
    left(p_data->>'volume', 30), left(p_data->>'servizio', 30), left(coalesce(p_data->>'note',''), 300),
    (p_data->>'giorno')::date, left(coalesce(p_data->>'fascia','flessibile'), 30),
    left(p_data->>'nome', 60), left(p_data->>'tel', 20),
    greatest(0, least(99999, coalesce((p_data->>'totale')::numeric, 0))), greatest(0, least(99999, coalesce((p_data->>'anticipo')::numeric, 0))))
  returning * into s;
  return jsonb_build_object('ok', true, 'codice', s.codice, 'id', s.id);
end $$;

create or replace function public.spedizioni_mie(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(spedizione_json(s) order by s.created_at desc)
    from (select * from spedizioni where profile_id = m.id order by created_at desc limit 30) s), '[]'::jsonb));
end $$;

-- pannello operativo: solo l'account tropss
create or replace function public.spedizioni_tutte(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found or lower(m.clickname) <> 'tropss' then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(spedizione_json(s) order by (s.stato = 'nuova') desc, s.giorno, s.created_at desc)
    from (select * from spedizioni where stato in ('nuova','confermata') or updated_at > now() - interval '14 days' limit 100) s), '[]'::jsonb));
end $$;

create or replace function public.spedizione_stato(p_token uuid, p_id bigint, p_stato text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found or lower(m.clickname) <> 'tropss' then return jsonb_build_object('errore','non_autorizzato'); end if;
  if p_stato not in ('nuova','confermata','fatta','annullata') then return jsonb_build_object('errore','stato'); end if;
  update spedizioni set stato = p_stato, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('errore','non_trovata'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.spedizione_crea(uuid, jsonb), public.spedizioni_mie(uuid), public.spedizioni_tutte(uuid), public.spedizione_stato(uuid, bigint, text) from public;
grant execute on function public.spedizione_crea(uuid, jsonb), public.spedizioni_mie(uuid), public.spedizioni_tutte(uuid), public.spedizione_stato(uuid, bigint, text) to anon, authenticated;
