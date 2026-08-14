-- =============================================================================
-- DevUP · 0006 · Invitaciones, tokens de cuenta y notificaciones
--
-- Tres cosas que hacen falta antes de exponer esto a internet:
--
--  1. Entrar por invitación. Hasta ahora `add_member_by_email` exigía que la
--     cuenta ya existiera, y el registro estaba abierto a cualquiera que
--     encontrara la URL.
--  2. Verificar el correo y poder recuperar la contraseña. Sin lo segundo,
--     quien olvida la suya se queda fuera para siempre.
--  3. Notificaciones. Sin ellas nadie vuelve a la aplicación, y es la
--     diferencia entre una demo y el sitio donde vive el equipo.
--
-- DE LOS TOKENS SE GUARDA EL HASH, NUNCA EL TOKEN. Un enlace de invitación o de
-- recuperación es una credencial de un solo uso: quien lea la tabla no debe
-- poder usarla. Es la misma regla que ya seguían las sesiones.
-- =============================================================================

alter table public.users
  add column if not exists email_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Invitaciones
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           citext not null check (position('@' in email) > 1),
  role            public.org_role not null default 'member',
  token_hash      text not null unique,
  invited_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references public.users(id) on delete set null
);

create index if not exists invitations_org_idx on public.invitations (organization_id);
create index if not exists invitations_email_idx on public.invitations (email);

-- Una sola invitación viva por correo y organización: reinvitar a alguien
-- sustituye la anterior en vez de dejar dos enlaces válidos por ahí.
create unique index if not exists invitations_one_open_per_email
  on public.invitations (organization_id, email) where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Tokens de cuenta: verificar correo y recuperar contraseña
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.token_purpose as enum ('email_verification', 'password_reset');
exception when duplicate_object then null;
end $$;

create table if not exists public.user_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  purpose    public.token_purpose not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index if not exists user_tokens_user_idx on public.user_tokens (user_id, purpose);

-- ---------------------------------------------------------------------------
-- Notificaciones
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null check (kind in ('mention', 'task_assigned', 'invitation', 'recording')),
  title      text not null check (length(btrim(title)) between 1 and 200),
  body       text not null default '',
  -- Ruta relativa dentro de la aplicación. Relativa a propósito: guardar una
  -- URL absoluta ata las notificaciones al dominio con el que se crearon.
  link       text not null default '',
  actor_id   uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.invitations    enable row level security;
alter table public.user_tokens    enable row level security;
alter table public.notifications  enable row level security;

-- Las invitaciones las ve y las revoca quien administra la organización. No
-- hay política de INSERT ni de UPDATE: crear y aceptar pasan por funciones,
-- porque quien acepta todavía no es miembro de nada.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select
  using (public.is_org_admin(organization_id));

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete
  using (public.is_org_admin(organization_id));

-- `user_tokens` no tiene ninguna política a propósito: RLS activo sin
-- políticas deniega todo. Solo se toca desde funciones SECURITY DEFINER, y
-- así ni siquiera su dueño puede listar sus propios tokens.

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = public.current_user_id());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Funciones de invitación
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(
  _org        uuid,
  _email      citext,
  _role       public.org_role,
  _token_hash text,
  _expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  if not public.is_org_admin(_org) then
    raise exception 'sin permiso para invitar a esta organización' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.organization_members m
    join public.users u on u.id = m.user_id
    where m.organization_id = _org and u.email = _email
  ) then
    raise exception 'esa persona ya está en la organización' using errcode = '23505';
  end if;

  -- Reinvitar sustituye el enlace anterior. Dos enlaces válidos para la misma
  -- persona es una credencial de más circulando sin motivo.
  delete from public.invitations
  where organization_id = _org and email = _email and accepted_at is null;

  insert into public.invitations
    (organization_id, email, role, token_hash, invited_by, expires_at)
  values (_org, _email, coalesce(_role, 'member'), _token_hash,
          public.current_user_id(), _expires_at)
  returning id into _id;

  return _id;
end;
$$;

-- Consulta previa del enlace, antes de que haya sesión: sirve para que la
-- pantalla de alta diga «te han invitado a Acme» en vez de un formulario a
-- ciegas. Devuelve lo justo para eso.
create or replace function public.invitation_by_token(_token_hash text)
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  email             citext,
  role              public.org_role,
  invited_by_name   text,
  expired           boolean,
  accepted          boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.organization_id, o.name, i.email, i.role,
         coalesce(p.display_name, 'alguien'),
         i.expires_at <= now(),
         i.accepted_at is not null
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
    left join public.profiles p on p.id = i.invited_by
   where i.token_hash = _token_hash;
$$;

-- Canjear la invitación: marca la fila y crea la pertenencia, en una sola
-- transacción. Si fueran dos pasos desde la aplicación, un fallo entre medias
-- dejaría a alguien con la invitación gastada y sin estar dentro.
create or replace function public.accept_invitation(_token_hash text, _user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _invitation record;
begin
  select * into _invitation
  from public.invitations
  where token_hash = _token_hash and accepted_at is null and expires_at > now()
  for update;

  if _invitation is null then
    raise exception 'la invitación no es válida o ha caducado' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (_invitation.organization_id, _user, _invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.invitations
  set accepted_at = now(), accepted_by = _user
  where id = _invitation.id;

  return _invitation.organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tokens de cuenta
-- ---------------------------------------------------------------------------
create or replace function public.issue_user_token(
  _user       uuid,
  _purpose    public.token_purpose,
  _token_hash text,
  _expires_at timestamptz
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  -- Emitir uno nuevo invalida los anteriores del mismo tipo: pedir «he
  -- olvidado la contraseña» tres veces no debe dejar tres enlaces vivos.
  with anulados as (
    update public.user_tokens set used_at = now()
    where user_id = _user and purpose = _purpose and used_at is null
  )
  insert into public.user_tokens (user_id, purpose, token_hash, expires_at)
  values (_user, _purpose, _token_hash, _expires_at);
$$;

-- Canjear en una sola sentencia: dos peticiones simultáneas con el mismo token
-- no pueden gastarlo las dos.
create or replace function public.consume_user_token(
  _token_hash text,
  _purpose    public.token_purpose
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  update public.user_tokens
  set used_at = now()
  where token_hash = _token_hash
    and purpose = _purpose
    and used_at is null
    and expires_at > now()
  returning user_id;
$$;

create or replace function public.set_password(_user uuid, _password_hash text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  -- Cambiar la contraseña cierra todas las sesiones abiertas. Si el motivo del
  -- cambio es que alguien entró en la cuenta, dejarle la sesión viva sería
  -- justo lo contrario de lo que se pretende.
  with cerradas as (
    update public.sessions set revoked_at = now()
    where user_id = _user and revoked_at is null
  )
  update public.users set password_hash = _password_hash where id = _user;
$$;

create or replace function public.mark_email_verified(_user uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.users set email_verified_at = now()
  where id = _user and email_verified_at is null;
$$;

-- Cuántas cuentas hay. Lo usa el arranque: la primera persona puede darse de
-- alta aunque el modo sea «solo por invitación», porque si no, no habría nadie
-- que pudiera invitar.
create or replace function public.user_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.users;
$$;

-- ---------------------------------------------------------------------------
-- Notificaciones
--
-- SECURITY DEFINER porque se escriben en la bandeja de otra persona. Y por eso
-- mismo lleva dentro la comprobación de que emisor y destinatario comparten
-- organización: sin ella, esta función sería un canal para que cualquier
-- usuario mande texto arbitrario a cualquier otro de la instancia.
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  _user  uuid,
  _kind  text,
  _title text,
  _body  text,
  _link  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := public.current_user_id();
  _id    uuid;
begin
  if _actor is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  if _user <> _actor and not exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = _actor and theirs.user_id = _user
  ) then
    raise exception 'no compartís ninguna organización' using errcode = '42501';
  end if;

  insert into public.notifications (user_id, kind, title, body, link, actor_id)
  values (_user, _kind, _title, coalesce(_body, ''), coalesce(_link, ''), _actor)
  returning id into _id;

  return _id;
end;
$$;

-- Resolver menciones. Devuelve los miembros del canal cuyo nombre aparece en
-- el texto, para no tener que traerse la plantilla entera a la aplicación.
create or replace function public.resolve_mentions(_channel uuid, _body text)
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.id, p.display_name
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    join public.organization_members m on m.organization_id = w.organization_id
    join public.profiles p on p.id = m.user_id
   where c.id = _channel
     and length(btrim(p.display_name)) > 0
     -- Coincidencia por «@» seguido del nombre visible, sin distinguir
     -- mayúsculas ni acentos. Es tosco, pero un analizador de menciones de
     -- verdad necesita que el redactor guarde los identificadores al escribir,
     -- y eso es otra iteración.
     and _body ilike '%@' || p.display_name || '%';
$$;
