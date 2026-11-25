-- clickVenice · file audio dei professionisti (vetrina Mix & Master / Studio, cartella Beat) — già applicato su LAGUNA NAV
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', true, 15728640, array['audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/aac','audio/wav','audio/x-wav','audio/wave','audio/ogg','audio/webm','audio/flac','audio/x-flac'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pro_audio (
  id bigserial primary key,
  pro_id bigint not null references public.professionisti(id) on delete cascade,
  tipo text not null check (tipo in ('vetrina','beat')),
  path text not null unique,
  url text not null,
  titolo text not null,
  info text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pro_audio_pro on public.pro_audio(pro_id, created_at desc);
alter table public.pro_audio enable row level security;

create or replace function public.pro_audio_json(a public.pro_audio) returns jsonb language sql stable as $$
  select jsonb_build_object('id', a.id, 'pro', a.pro_id, 'tipo', a.tipo, 'url', a.url, 'titolo', a.titolo, 'info', a.info, 'creato', a.created_at);
$$;
create or replace function public.pro_audio_cat(p_token uuid default null, p_cat text default '') returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('lista', coalesce(jsonb_agg(pro_audio_json(a) || jsonb_build_object('nome', x.nome) order by a.created_at desc), '[]'::jsonb))
  from pro_audio a join professionisti x on x.id = a.pro_id
  where x.stato = 'approved' and x.categoria = p_cat;
$$;
create or replace function public.pro_audio_mie(p_token uuid, p_pro bigint) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  if not exists(select 1 from professionisti where id = p_pro and (profile_id = m.id or lower(m.clickname) = 'tropss')) then return jsonb_build_object('errore','non_autorizzato'); end if;
  return jsonb_build_object('lista', coalesce((select jsonb_agg(pro_audio_json(a) order by a.created_at desc) from pro_audio a where a.pro_id = p_pro), '[]'::jsonb));
end $$;
revoke all on function public.pro_audio_json(public.pro_audio) from public, anon, authenticated;
revoke all on function public.pro_audio_cat(uuid, text), public.pro_audio_mie(uuid, bigint) from public;
grant execute on function public.pro_audio_cat(uuid, text), public.pro_audio_mie(uuid, bigint) to anon, authenticated;
