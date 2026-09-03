-- =============================================================================
-- DevUP · 0027 · Invitar por workspace, no solo por organización
--
-- POR QUÉ. Hasta ahora un workspace "compartido" lo veía cualquiera de la
-- organización, sin excepción: no había forma de meter a alguien a un solo
-- equipo de trabajo sin dejarle ver todos los demás. En una organización con
-- varios equipos de desarrollo eso es justo lo que no se quiere.
--
-- `workspace_members` es la lista explícita de quién entra a un workspace
-- "compartido". Los personales no la usan — siguen viéndolos solo quien los
-- creó, exactamente como antes.
--
-- MIGRACIÓN SIN SORPRESAS: se rellena `workspace_members` con todo el mundo
-- que hoy ya puede ver cada workspace (todo miembro de la organización, para
-- los compartidos). Nadie pierde acceso a lo que ya veía. Lo que cambia es
-- solo lo que pasa DE AQUÍ EN ADELANTE: un workspace compartido nuevo, o
-- alguien nuevo en la organización, ya no entran automáticamente a todos los
-- workspaces — hace falta invitarlos al workspace en concreto.
-- =============================================================================

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

insert into public.workspace_members (workspace_id, user_id)
select w.id, m.user_id
from public.workspaces w
join public.organization_members m on m.organization_id = w.organization_id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Acceso a workspace: dueño, o administrador de la organización, o —si es
-- compartido— estar en `workspace_members`.
--
-- El administrador sigue viendo todo. Ya podía renombrar o borrar cualquier
-- workspace compartido (`workspaces_update`/`workspaces_delete` de la 0004);
-- no verlo en la lista sería un permiso a medias, más confuso que útil.
-- ---------------------------------------------------------------------------
create or replace function public.can_access_workspace(_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.organization_members m
      on m.organization_id = w.organization_id
     and m.user_id = public.current_user_id()
    where w.id = _workspace
      and (
        w.created_by = public.current_user_id()
        or public.is_org_admin(w.organization_id)
        or (
          w.visibility = 'shared'
          and exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = w.id and wm.user_id = public.current_user_id()
          )
        )
      )
  );
$$;

-- Misma regla, reescrita para llamar a la función de arriba en vez de repetir
-- la lógica de visibilidad una tercera vez.
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
    where c.id = _channel
      and public.can_access_workspace(c.workspace_id)
      and (
        not c.is_private
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = public.current_user_id()
        )
      )
  );
$$;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select
  using (public.can_access_workspace(id));

alter table public.workspace_members enable row level security;

drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members for select
  using (public.can_access_workspace(workspace_id));

-- Solo quien administra la organización mete gente a un workspace. Mismo
-- criterio que `channel_members_insert` en la 0001.
drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members for insert
  with check (public.is_org_admin(public.org_of_workspace(workspace_id)));

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members for delete
  using (
    user_id = public.current_user_id()
    or public.is_org_admin(public.org_of_workspace(workspace_id))
  );

-- ---------------------------------------------------------------------------
-- Invitaciones con workspace opcional
-- ---------------------------------------------------------------------------
alter table public.invitations
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- Sustituye al índice de la 0006: ahora el destino de una invitación es
-- (organización, correo, workspace), y `workspace_id` en null (invitación a
-- toda la organización) tiene que contar como un valor más, no como "distinto
-- siempre de sí mismo" —que es como trata NULL un índice único normal—, o
-- reinvitar a alguien a la organización entera dejaría dos enlaces vivos.
drop index if exists invitations_one_open_per_email;
create unique index invitations_one_open_per_target
  on public.invitations (organization_id, email, workspace_id) nulls not distinct
  where accepted_at is null;

drop function if exists public.create_invitation(uuid, citext, public.org_role, text, timestamptz);

create or replace function public.create_invitation(
  _org        uuid,
  _email      citext,
  _role       public.org_role,
  _token_hash text,
  _expires_at timestamptz,
  _workspace  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id           uuid;
  _ya_es_miembro boolean;
begin
  if not public.is_org_admin(_org) then
    raise exception 'sin permiso para invitar a esta organización' using errcode = '42501';
  end if;

  if _workspace is not null and public.org_of_workspace(_workspace) is distinct from _org then
    raise exception 'ese workspace no pertenece a esta organización' using errcode = '23503';
  end if;

  select exists (
    select 1 from public.organization_members m
    join public.users u on u.id = m.user_id
    where m.organization_id = _org and u.email = _email
  ) into _ya_es_miembro;

  if _ya_es_miembro then
    -- Ya está en la organización: una invitación a toda la organización no
    -- tiene sentido. Una a un workspace en concreto sí, siempre que no esté ya
    -- dentro de ese workspace.
    if _workspace is null then
      raise exception 'esa persona ya está en la organización' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.workspace_members wm
      join public.users u on u.id = wm.user_id
      where wm.workspace_id = _workspace and u.email = _email
    ) then
      raise exception 'esa persona ya tiene acceso a ese workspace' using errcode = '23505';
    end if;
  end if;

  -- Reinvitar al mismo destino (misma organización, mismo workspace o ambas
  -- veces "toda la organización") sustituye el enlace anterior.
  delete from public.invitations
  where organization_id = _org and email = _email and accepted_at is null
    and workspace_id is not distinct from _workspace;

  insert into public.invitations
    (organization_id, email, role, token_hash, invited_by, expires_at, workspace_id)
  values (_org, _email, coalesce(_role, 'member'), _token_hash,
          public.current_user_id(), _expires_at, _workspace)
  returning id into _id;

  return _id;
end;
$$;

drop function if exists public.invitation_by_token(text);

create or replace function public.invitation_by_token(_token_hash text)
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  workspace_id      uuid,
  workspace_name    text,
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
  select i.id, i.organization_id, o.name, i.workspace_id, w.name,
         i.email, i.role,
         coalesce(p.display_name, 'alguien'),
         i.expires_at <= now(),
         i.accepted_at is not null
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
    left join public.workspaces w on w.id = i.workspace_id
    left join public.profiles p on p.id = i.invited_by
   where i.token_hash = _token_hash;
$$;

-- Aceptar añade también al workspace, cuando la invitación era para uno en
-- concreto. Sigue siendo una sola transacción: un fallo entre medias no debe
-- dejar a nadie en la organización pero fuera del workspace al que en
-- realidad le invitaron.
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

  if _invitation.workspace_id is not null then
    insert into public.workspace_members (workspace_id, user_id)
    values (_invitation.workspace_id, _user)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = _user
  where id = _invitation.id;

  return _invitation.organization_id;
end;
$$;
