-- =============================================================================
-- DevUP · 0001 · Núcleo: identidad, organizaciones, workspaces y canales
--
-- El aislamiento entre organizaciones vive en la base de datos (RLS), no en la
-- aplicación: un WHERE olvidado devuelve cero filas en vez de filas ajenas.
--
-- Las funciones de pertenencia son SECURITY DEFINER a propósito. Sin eso, una
-- política sobre organization_members que consulta organization_members entra
-- en recursión infinita. SECURITY DEFINER salta RLS en la consulta interna.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  created_at   timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(coalesce(new.email, 'usuario'), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Organizaciones
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 80),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create type public.org_role as enum ('owner', 'admin', 'member');

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
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
  created_by      uuid not null references auth.users(id) on delete restrict,
  created_at      timestamptz not null default now()
);

create index if not exists workspaces_org_idx on public.workspaces (organization_id);

create type public.channel_kind as enum ('text', 'voice');

create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  kind         public.channel_kind not null default 'text',
  is_private   boolean not null default false,
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

create index if not exists channels_workspace_idx on public.channels (workspace_id);

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
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
    where m.organization_id = _org and m.user_id = auth.uid()
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
  where m.organization_id = _org and m.user_id = auth.uid();
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
      on m.organization_id = w.organization_id and m.user_id = auth.uid()
    where c.id = _channel
      and (
        not c.is_private
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = auth.uid()
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
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces           enable row level security;
alter table public.channels             enable row level security;
alter table public.channel_members      enable row level security;

-- Perfiles: se ve el propio y el de quien comparte alguna organización.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Organizaciones
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select
  using (public.is_org_member(id));

drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations for insert
  with check (created_by = auth.uid());

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

drop policy if exists organization_members_write on public.organization_members;
create policy organization_members_write on public.organization_members for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists organization_members_update on public.organization_members;
create policy organization_members_update on public.organization_members for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Salir por cuenta propia, o expulsión por un administrador.
drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete on public.organization_members for delete
  using (user_id = auth.uid() or public.is_org_admin(organization_id));

-- Workspaces
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select
  using (public.is_org_member(organization_id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert
  with check (public.is_org_member(organization_id) and created_by = auth.uid());

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
  with check (public.can_access_workspace(workspace_id) and created_by = auth.uid());

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

drop policy if exists channel_members_write on public.channel_members;
create policy channel_members_write on public.channel_members for insert
  with check (public.is_org_admin(public.org_of_channel(channel_id)));

drop policy if exists channel_members_delete on public.channel_members;
create policy channel_members_delete on public.channel_members for delete
  using (user_id = auth.uid() or public.is_org_admin(public.org_of_channel(channel_id)));
