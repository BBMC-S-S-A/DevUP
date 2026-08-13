-- =============================================================================
-- DevUP · 0003 · Sesiones de llamada
--
-- El estado en vivo de una llamada (quién está dentro, quién habla, quién está
-- silenciado) NO vive aquí: vive en la presencia del servidor de señalización,
-- que se limpia sola cuando alguien cierra la pestaña o pierde la conexión.
-- Estas tablas son el historial: para qué se usó el canal y quién estuvo.
--
-- Por eso `left_at` es mejor-esfuerzo. Una desconexión brusca lo deja en null,
-- y quien calcule duraciones tiene que tratar ese caso explícitamente en vez
-- de fingir un dato que no se tiene.
-- =============================================================================

create table if not exists public.call_sessions (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  started_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create index if not exists call_sessions_channel_idx
  on public.call_sessions (channel_id, started_at desc);

-- Una sola sesión abierta por canal: es lo que permite que el segundo en
-- entrar se enganche a la sesión del primero en vez de abrir una paralela.
create unique index if not exists call_sessions_one_open_per_channel
  on public.call_sessions (channel_id) where ended_at is null;

create table if not exists public.call_participants (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  peer_id    text not null,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  unique (session_id, peer_id)
);

create index if not exists call_participants_session_idx
  on public.call_participants (session_id);

alter table public.call_sessions     enable row level security;
alter table public.call_participants enable row level security;

drop policy if exists call_sessions_select on public.call_sessions;
create policy call_sessions_select on public.call_sessions for select
  using (public.can_access_channel(channel_id));

drop policy if exists call_sessions_insert on public.call_sessions;
create policy call_sessions_insert on public.call_sessions for insert
  with check (public.can_access_channel(channel_id));

drop policy if exists call_sessions_update on public.call_sessions;
create policy call_sessions_update on public.call_sessions for update
  using (public.can_access_channel(channel_id))
  with check (public.can_access_channel(channel_id));

create or replace function public.channel_of_session(_session uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.channel_id from public.call_sessions s where s.id = _session;
$$;

drop policy if exists call_participants_select on public.call_participants;
create policy call_participants_select on public.call_participants for select
  using (public.can_access_channel(public.channel_of_session(session_id)));

drop policy if exists call_participants_insert on public.call_participants;
create policy call_participants_insert on public.call_participants for insert
  with check (
    user_id = public.current_user_id()
    and public.can_access_channel(public.channel_of_session(session_id))
  );

drop policy if exists call_participants_update on public.call_participants;
create policy call_participants_update on public.call_participants for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Entrar a la llamada del canal: reutiliza la sesión abierta o abre una.
-- Va en una función para que las dos operaciones ocurran en una transacción;
-- hacerlo desde el cliente en dos pasos abre una ventana en la que dos
-- personas que entran a la vez crean dos sesiones y no se oyen.
-- ---------------------------------------------------------------------------
create or replace function public.join_call(_channel uuid, _peer_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _session uuid;
begin
  if not public.can_access_channel(_channel) then
    raise exception 'sin acceso al canal' using errcode = '42501';
  end if;

  -- Sin destino en el ON CONFLICT porque el que puede saltar es el índice
  -- único parcial de «una sesión abierta por canal», que no es una restricción
  -- y por tanto no se puede nombrar aquí.
  insert into public.call_sessions (channel_id, started_by)
  values (_channel, public.current_user_id())
  on conflict do nothing
  returning id into _session;

  -- Si el insert no hizo nada, otro llegó primero. Su fila ya está confirmada
  -- —el ON CONFLICT esperó a que cerrara su transacción— así que este SELECT
  -- la ve.
  if _session is null then
    select id into _session
    from public.call_sessions
    where channel_id = _channel and ended_at is null;
  end if;

  insert into public.call_participants (session_id, user_id, peer_id)
  values (_session, public.current_user_id(), _peer_id)
  on conflict (session_id, peer_id) do update set left_at = null;

  return _session;
end;
$$;

-- Salir. Cuando se va el último, la sesión se cierra y deja de ser la abierta.
create or replace function public.leave_call(_session uuid, _peer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.call_participants
  set left_at = now()
  where session_id = _session
    and peer_id = _peer_id
    and user_id = public.current_user_id();

  update public.call_sessions s
  set ended_at = now()
  where s.id = _session
    and s.ended_at is null
    and not exists (
      select 1 from public.call_participants p
      where p.session_id = s.id and p.left_at is null
    );
end;
$$;

-- Cierre de participantes que se fueron sin avisar. Lo llama el servidor de
-- señalización cuando un WebSocket se cae: sin esto, un navegador cerrado de
-- golpe deja un participante «dentro» para siempre y la sesión nunca cierra.
create or replace function public.reap_call_peer(_peer_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _session uuid;
begin
  update public.call_participants
  set left_at = now()
  where peer_id = _peer_id and left_at is null
  returning session_id into _session;

  if _session is null then
    return;
  end if;

  update public.call_sessions s
  set ended_at = now()
  where s.id = _session
    and s.ended_at is null
    and not exists (
      select 1 from public.call_participants p
      where p.session_id = s.id and p.left_at is null
    );
end;
$$;
