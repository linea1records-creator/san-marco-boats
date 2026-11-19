-- 1Click · Gioca: tris tra amici (da eseguire una volta sul progetto Supabase LAGUNA NAV)
create table if not exists public.tris_games (
  id bigserial primary key,
  x_id bigint not null references public.profiles(id) on delete cascade,
  o_id bigint not null references public.profiles(id) on delete cascade,
  board text not null default '.........',
  turn char(1) not null default 'X',
  status text not null default 'invito',   -- invito | gioco | fine | rifiutata
  winner char(1),                          -- X | O | = (pareggio)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tris_x on public.tris_games(x_id, updated_at desc);
create index if not exists tris_o on public.tris_games(o_id, updated_at desc);
alter table public.tris_games enable row level security;

create or replace function public.tris_win(b text) returns char language sql immutable as $$
  select coalesce((select substr(b, l[1], 1) from (values (array[1,2,3]),(array[4,5,6]),(array[7,8,9]),(array[1,4,7]),(array[2,5,8]),(array[3,6,9]),(array[1,5,9]),(array[3,5,7])) v(l)
    where substr(b, l[1], 1) <> '.' and substr(b, l[1], 1) = substr(b, l[2], 1) and substr(b, l[2], 1) = substr(b, l[3], 1) limit 1),
    case when position('.' in b) = 0 then '=' else null end);
$$;

create or replace function public.tris_json(g public.tris_games, me bigint) returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object('id', g.id, 'board', g.board, 'turn', g.turn, 'status', g.status, 'winner', g.winner,
    'io', case when g.x_id = me then 'X' else 'O' end,
    'avversario', (select clickname from profiles where id = case when g.x_id = me then g.o_id else g.x_id end),
    'mia_mossa', g.status = 'gioco' and g.turn = case when g.x_id = me then 'X' else 'O' end,
    'invitato', g.status = 'invito' and g.o_id = me,
    'agg', g.updated_at);
$$;

create or replace function public.tris_invite(p_token uuid, p_nome text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; t profiles%rowtype; g tris_games%rowtype; n int;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select * into t from profiles where lower(clickname) = lower(p_nome); if not found or t.id = m.id then return jsonb_build_object('errore','utente'); end if;
  if not is_friend(m.id, t.id) then return jsonb_build_object('errore','non_amici'); end if;
  if exists(select 1 from blocks b where b.from_id = t.id and b.to_id = m.id) then return jsonb_build_object('errore','utente'); end if;
  select * into g from tris_games where status in ('invito','gioco') and ((x_id = m.id and o_id = t.id) or (x_id = t.id and o_id = m.id)) order by id desc limit 1;
  if found then return jsonb_build_object('ok', true, 'partita', tris_json(g, m.id)); end if;
  select count(*) into n from tris_games where x_id = m.id and created_at > now() - interval '1 hour';
  if n >= 30 then return jsonb_build_object('errore','troppe'); end if;
  insert into tris_games(x_id, o_id) values (m.id, t.id) returning * into g;
  return jsonb_build_object('ok', true, 'partita', tris_json(g, m.id));
end $$;

create or replace function public.tris_list(p_token uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  update tris_games set status = 'fine', winner = null, updated_at = now()
    where status = 'invito' and created_at < now() - interval '2 days' and (x_id = m.id or o_id = m.id);
  return jsonb_build_object('partite', coalesce((select jsonb_agg(tris_json(g, m.id) order by (g.status in ('invito','gioco')) desc, g.updated_at desc)
    from (select * from tris_games where (x_id = m.id or o_id = m.id) and status <> 'rifiutata' order by (status in ('invito','gioco')) desc, updated_at desc limit 20) g), '[]'::jsonb),
    'vinte', (select count(*) from tris_games where status = 'fine' and ((x_id = m.id and winner = 'X') or (o_id = m.id and winner = 'O'))),
    'perse', (select count(*) from tris_games where status = 'fine' and ((x_id = m.id and winner = 'O') or (o_id = m.id and winner = 'X'))),
    'pari', (select count(*) from tris_games where status = 'fine' and winner = '=' and (x_id = m.id or o_id = m.id)));
end $$;

create or replace function public.tris_get(p_token uuid, p_id bigint) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; g tris_games%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select * into g from tris_games where id = p_id and (x_id = m.id or o_id = m.id); if not found then return jsonb_build_object('errore','partita'); end if;
  return jsonb_build_object('ok', true, 'partita', tris_json(g, m.id));
end $$;

create or replace function public.tris_answer(p_token uuid, p_id bigint, p_ok boolean) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; g tris_games%rowtype;
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select * into g from tris_games where id = p_id and (x_id = m.id or o_id = m.id) for update; if not found then return jsonb_build_object('errore','partita'); end if;
  if g.status = 'invito' and g.o_id = m.id then
    update tris_games set status = case when p_ok then 'gioco' else 'rifiutata' end, updated_at = now() where id = g.id returning * into g;
  elsif g.status = 'invito' and g.x_id = m.id and not p_ok then
    update tris_games set status = 'rifiutata', updated_at = now() where id = g.id returning * into g;
  elsif g.status = 'gioco' and not p_ok then
    update tris_games set status = 'fine', winner = case when g.x_id = m.id then 'O' else 'X' end, updated_at = now() where id = g.id returning * into g;
  end if;
  return jsonb_build_object('ok', true, 'partita', tris_json(g, m.id));
end $$;

create or replace function public.tris_move(p_token uuid, p_id bigint, p_cell int) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare m profiles%rowtype; g tris_games%rowtype; me char(1); nb text; w char(1);
begin
  select * into m from profiles where owner_token = p_token; if not found then return jsonb_build_object('errore','non_autorizzato'); end if;
  select * into g from tris_games where id = p_id and (x_id = m.id or o_id = m.id) for update; if not found then return jsonb_build_object('errore','partita'); end if;
  me := case when g.x_id = m.id then 'X' else 'O' end;
  if g.status <> 'gioco' then return jsonb_build_object('errore','finita', 'partita', tris_json(g, m.id)); end if;
  if g.turn <> me then return jsonb_build_object('errore','turno', 'partita', tris_json(g, m.id)); end if;
  if p_cell < 0 or p_cell > 8 or substr(g.board, p_cell + 1, 1) <> '.' then return jsonb_build_object('errore','casella', 'partita', tris_json(g, m.id)); end if;
  nb := overlay(g.board placing me from p_cell + 1 for 1);
  w := tris_win(nb);
  update tris_games set board = nb, turn = case when me = 'X' then 'O' else 'X' end,
    status = case when w is null then 'gioco' else 'fine' end, winner = w, updated_at = now() where id = g.id returning * into g;
  return jsonb_build_object('ok', true, 'partita', tris_json(g, m.id));
end $$;
