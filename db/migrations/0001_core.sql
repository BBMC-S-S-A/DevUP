-- =============================================================================
-- DevUP · 0001 · Núcleo: identidad, organizaciones, workspaces y canales
--
-- El aislamiento entre organizaciones vive en la base de datos (RLS), no en la
-- aplicación: un WHERE olvidado devuelve cero filas en vez de filas ajenas.
--
-- Sin Supabase, `auth.uid()` no existe. Su equivalente es la variable de sesión
-- `app.user_id`, que la API fija al abrir cada transacción:
--
--     begin;
--     select set_config('app.user_id', $1, true);   -- true = local a la txn
--     ...
--     commit;
--
-- Dos condiciones sostienen todo el esquema. Si una se rompe, el aislamiento
-- desaparece sin que nada falle de forma visible:
--
--   1. La API se conecta con el rol `devup_app`, que NO es propietario de
--      estas tablas. Postgres salta RLS para el propietario. Conectar la API
--      como `postgres` desactiva todas las políticas en silencio.
--   2. Las funciones de pertenencia son SECURITY DEFINER a propósito. Sin eso,
--      una política sobre organization_members que consulta organization_members
--      entra en recursión infinita y Postgres aborta la consulta. SECURITY
--      DEFINER salta RLS en la consulta interna y corta el ciclo.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Identidad de la petición
-- ---------------------------------------------------------------------------
-- Tolerante a propósito: si nadie fijó la variable, o trae basura, devuelve
-- null y las políticas deniegan. Lanzar una excepción desde dentro de una
-- política aborta la consulta entera y convierte un fallo de autorización en
-- un error 500 difícil de leer.
create or replace function public.current_user_id()
returns uuid
language plpgsql
stable
as $$
begin
  return nullif(current_setting('app.user_id', true), '')::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Usuarios y perfiles
--
-- Separados a propósito. RLS es por fila, no por columna: si el hash de la
-- contraseña viviera en la misma tabla que el nombre visible, cualquier
-- política que deje ver el perfil de un compañero dejaría ver también su hash.
-- `users` solo es legible por su dueño; `profiles` es lo que se comparte.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null unique check (position('@' in email) > 1),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references public.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sesiones (tokens de refresco)
--
-- Se guarda el hash del token, nunca el token. Quien lea la tabla no puede
-- suplantar a nadie con lo que encuentre.
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  refresh_token_hash text not null unique,
  user_agent         text not null default '',
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  revoked_at         timestamptz
);

create index if not exists sessions_user_idx on public.sessions (user_id);

-- ---------------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 80),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

do $$ begin
  create type public.org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null;
end $$;

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  role            public.org_role not null default 'member',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx
  on public.organization_members (user_id);

-- Quien crea la organización entra como propietario en la misma transacción.
-- SECURITY DEFINER porque en ese instante todavía no es miembro de nada y la
-- política de inserción de organization_members lo rechazaría.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (organization_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_organization_created on public.organizations;
create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------------------------------------------------------------------------
-- Workspaces y canales
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 80),
  created_by      uuid not null references public.users(id) on delete restrict,
  created_at      timestamptz not null default now()
);

create index if not exists workspaces_org_idx on public.workspaces (organization_id);

do $$ begin
  create type public.channel_kind as enum ('text', 'voice');
exception when duplicate_object then null;
end $$;

create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  kind         public.channel_kind not null default 'text',
  is_private   boolean not null default false,
  created_by   uuid not null references public.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

create index if not exists channels_workspace_idx on public.channels (workspace_id);

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Funciones de pertenencia (SECURITY DEFINER: saltan RLS, evitan recursión)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = _org and m.user_id = public.current_user_id()
  );
$$;

create or replace function public.org_role_of(_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.organization_members m
  where m.organization_id = _org and m.user_id = public.current_user_id();
$$;

create or replace function public.is_org_admin(_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_role_of(_org) in ('owner', 'admin');
$$;

create or replace function public.org_of_workspace(_workspace uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.organization_id from public.workspaces w where w.id = _workspace;
$$;

create or replace function public.can_access_workspace(_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(public.org_of_workspace(_workspace));
$$;

-- Un canal es accesible si eres miembro de la organización y, cuando el canal
-- es privado, además estás en su lista de miembros.
create or replace function public.can_access_channel(_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.channels c
    join public.workspaces w on w.id = c.workspace_id
    join public.organization_members m
      on m.organization_id = w.organization_id
     and m.user_id = public.current_user_id()
    where c.id = _channel
      and (
        not c.is_private
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = public.current_user_id()
        )
      )
  );
$$;

create or replace function public.org_of_channel(_channel uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w.organization_id
  from public.channels c
  join public.workspaces w on w.id = c.workspace_id
  where c.id = _channel;
$$;

-- ---------------------------------------------------------------------------
-- Creación de organizaciones y canales
--
-- Estas dos van en funciones SECURITY DEFINER por un motivo que cuesta ver y
-- que se cobró una tarde entera: `INSERT ... RETURNING` evalúa también la
-- política de SELECT sobre la fila recién insertada. Al crear una
-- organización, quien la crea todavía no es miembro —el trigger que lo hace
-- socio corre después—, así que la política de SELECT deniega su propia fila
-- y el INSERT entero se cae con «new row violates row-level security policy».
-- Sin RETURNING funciona; con RETURNING, no. Y la aplicación necesita el id.
--
-- Con los canales pasa lo mismo y peor: un canal privado no es visible para
-- quien no está en su lista de miembros, así que su creador se quedaría fuera
-- de un canal que acaba de crear.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(_name text, _slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _me uuid := public.current_user_id();
  _id uuid;
begin
  if _me is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  -- El trigger on_organization_created añade a _me como propietario.
  insert into public.organizations (name, slug, created_by)
  values (_name, _slug, _me)
  returning id into _id;

  return _id;
end;
$$;

create or replace function public.create_channel(
  _workspace  uuid,
  _name       text,
  _kind       public.channel_kind,
  _is_private boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _me uuid := public.current_user_id();
  _id uuid;
begin
  if _me is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;

  -- La comprobación que la política de INSERT haría por nosotros si no
  -- estuviéramos saltándola. Quitarla convierte esta función en una puerta
  -- para crear canales en workspaces ajenos.
  if not public.can_access_workspace(_workspace) then
    raise exception 'sin acceso al workspace' using errcode = '42501';
  end if;

  insert into public.channels (workspace_id, name, kind, is_private, created_by)
  values (_workspace, _name, coalesce(_kind, 'text'), coalesce(_is_private, false), _me)
  returning id into _id;

  if coalesce(_is_private, false) then
    insert into public.channel_members (channel_id, user_id)
    values (_id, _me)
    on conflict do nothing;
  end if;

  return _id;
end;
$$;

-- Los workspaces no necesitan función propia: quien los crea ya es miembro de
-- la organización, así que la política de SELECT le deja ver la fila y el
-- RETURNING pasa. La asimetría es intencionada — cada SECURITY DEFINER que se
-- añade es un trozo de esquema donde RLS deja de protegernos.

-- ---------------------------------------------------------------------------
-- Autenticación
--
-- El alta y el acceso ocurren cuando todavía no hay identidad: no se puede
-- leer `users` por RLS porque `app.user_id` aún no está fijado. De ahí que
-- estas tres funciones sean SECURITY DEFINER, y de ahí también que devuelvan
-- lo mínimo imprescindible en vez de la fila entera.
-- ---------------------------------------------------------------------------
create or replace function public.register_user(
  _email         citext,
  _password_hash text,
  _display_name  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  insert into public.users (email, password_hash)
  values (_email, _password_hash)
  returning id into _id;

  insert into public.profiles (id, display_name)
  values (
    _id,
    coalesce(nullif(btrim(_display_name), ''), split_part(_email::text, '@', 1))
  );

  return _id;
end;
$$;

create or replace function public.auth_credentials(_email citext)
returns table (user_id uuid, password_hash text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.password_hash from public.users u where u.email = _email;
$$;

-- Rotación: consumir un token de refresco lo revoca y devuelve a su dueño.
-- En una sola sentencia para que dos peticiones simultáneas con el mismo
-- token no puedan canjearlo las dos.
create or replace function public.session_consume(_token_hash text)
returns table (session_id uuid, user_id uuid)
language sql
volatile
security definer
set search_path = public
as $$
  update public.sessions s
  set revoked_at = now()
  where s.refresh_token_hash = _token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  returning s.id, s.user_id;
$$;

create or replace function public.session_open(
  _user       uuid,
  _token_hash text,
  _expires_at timestamptz,
  _user_agent text
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.sessions (user_id, refresh_token_hash, expires_at, user_agent)
  values (_user, _token_hash, _expires_at, coalesce(_user_agent, ''))
  returning id;
$$;

create or replace function public.session_revoke(_token_hash text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.sessions
  set revoked_at = now()
  where refresh_token_hash = _token_hash and revoked_at is null;
$$;

-- Alta de miembros por correo. La comprobación de permiso va dentro porque la
-- función es SECURITY DEFINER: sin ese `if`, cualquiera podría añadirse a
-- cualquier organización.
create or replace function public.add_member_by_email(
  _org   uuid,
  _email citext,
  _role  public.org_role
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _user uuid;
begin
  if not public.is_org_admin(_org) then
    raise exception 'sin permiso para administrar la organización'
      using errcode = '42501';
  end if;

  select id into _user from public.users where email = _email;
  if _user is null then
    raise exception 'no hay ninguna cuenta con ese correo'
      using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (_org, _user, coalesce(_role, 'member'))
  on conflict (organization_id, user_id) do update set role = excluded.role;

  return _user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.users                enable row level security;
alter table public.profiles             enable row level security;
alter table public.sessions             enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces           enable row level security;
alter table public.channels             enable row level security;
alter table public.channel_members      enable row level security;

-- Usuarios: solo el propio. No hay política de inserción a propósito — el alta
-- pasa obligatoriamente por register_user().
drop policy if exists users_select on public.users;
create policy users_select on public.users for select
  using (id = public.current_user_id());

drop policy if exists users_update on public.users;
create policy users_update on public.users for update
  using (id = public.current_user_id()) with check (id = public.current_user_id());

-- Perfiles: el propio y el de quien comparte alguna organización.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    id = public.current_user_id()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = public.current_user_id()
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = public.current_user_id()) with check (id = public.current_user_id());

-- Sesiones: cada cual ve y cierra las suyas.
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions for select
  using (user_id = public.current_user_id());

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions for delete
  using (user_id = public.current_user_id());

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- Organizaciones
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (public.is_org_member(id));

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations for insert
  with check (created_by = public.current_user_id());

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));

drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations for delete
  using (public.org_role_of(id) = 'owner');

-- Miembros
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members for select
  using (public.is_org_member(organization_id));

drop policy if exists organization_members_insert on public.organization_members;
create policy organization_members_insert on public.organization_members for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Salir por cuenta propia, o expulsión por un administrador.
drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members for delete
  using (
    user_id = public.current_user_id()
    or public.is_org_admin(organization_id)
  );

-- Workspaces
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select
  using (public.is_org_member(organization_id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert
  with check (
    public.is_org_member(organization_id)
    and created_by = public.current_user_id()
  );

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces for delete
  using (public.is_org_admin(organization_id));

-- Canales
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select
  using (public.can_access_channel(id));

drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert
  with check (
    public.can_access_workspace(workspace_id)
    and created_by = public.current_user_id()
  );

drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update
  using (public.is_org_admin(public.org_of_workspace(workspace_id)))
  with check (public.is_org_admin(public.org_of_workspace(workspace_id)));

drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete
  using (public.is_org_admin(public.org_of_workspace(workspace_id)));

-- Miembros de canal privado
drop policy if exists channel_members_select on public.channel_members;
create policy channel_members_select on public.channel_members for select
  using (public.can_access_channel(channel_id));

drop policy if exists channel_members_insert on public.channel_members;
create policy channel_members_insert on public.channel_members for insert
  with check (public.is_org_admin(public.org_of_channel(channel_id)));

drop policy if exists channel_members_delete on public.channel_members;
create policy channel_members_delete on public.channel_members for delete
  using (
    user_id = public.current_user_id()
    or public.is_org_admin(public.org_of_channel(channel_id))
  );
