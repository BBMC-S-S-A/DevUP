-- =============================================================================
-- DevUP · 0041 · El código corto de invitación
--
-- QUÉ FALTABA. Las invitaciones ya funcionan con su token y su canje, pero lo
-- único que se puede repartir es una URL de cien caracteres. Por teléfono, o en
-- una reunión, eso no se dicta: se dicta un código.
--
-- EL ALFABETO ES LA MITAD DEL TRABAJO. Fuera `O` y `0`, fuera `I`, `L` y `1`:
-- son los pares que hacen que un código dictado llegue mal, y llegar mal aquí
-- significa que la persona lo prueba, falla, y piensa que la invitación está
-- rota. Quedan 31 símbolos; con ocho posiciones son unas 850.000 millones de
-- combinaciones, que con la caducidad de abajo y el límite de intentos de la
-- ruta es de sobra.
--
-- Y CADUCA ANTES QUE EL ENLACE, en una columna aparte y no reusando
-- `expires_at`. Un código corto es mucho más fácil de probar a lo bruto que un
-- token de 32 bytes, así que no pueden vivir lo mismo. El enlace largo puede
-- durar días; el código se dicta en el momento y se usa en el momento. La
-- ventana la decide la API (`account.ts`), pero la columna separada es lo que
-- permite que sean distintas — con una sola, la decisión quedaba cerrada aquí.
--
-- SE GUARDA EL HASH, NO EL CÓDIGO, igual que el token. No es ceremonia: desde
-- que hay respaldos automáticos, un código en claro viajaría dentro de cada
-- volcado guardado como artefacto. El código se enseña UNA vez a quien invita,
-- que es cuando lo va a dictar; si se pierde, se vuelve a invitar y el
-- anterior se sustituye, que es lo que `create_invitation` ya hacía.
--
-- CÓMO SE CANJEA: por el mismo sitio que el enlace. `invitation_by_token` y
-- `accept_invitation` pasan a mirar las DOS columnas en vez de duplicarse en
-- una pareja de funciones gemelas. La pantalla de «entrar con código» ya
-- mandaba lo que le pegaran por el mismo campo, así que no cambia.
-- =============================================================================

alter table public.invitations
  add column if not exists code_hash text,
  add column if not exists code_expires_at timestamptz;

-- Único entre las que siguen vivas: dos invitaciones sin canjear no pueden
-- compartir código, o canjearlo sería ambiguo. Parcial porque las viejas y las
-- ya aceptadas no estorban, y porque la mayoría no tendrá código.
create unique index if not exists invitations_code_hash_idx
  on public.invitations (code_hash)
  where code_hash is not null and accepted_at is null;

-- --- Crear -------------------------------------------------------------------
-- Se borra y se recrea en vez de añadir parámetros con valor por defecto: dos
-- versiones de la misma función, una de seis argumentos y otra de ocho con
-- defecto, dejan la llamada de seis AMBIGUA y Postgres la rechaza. Es el mismo
-- motivo por el que 0035 tuvo que borrar `list_github_repos_for_refresh`.

drop function if exists public.create_invitation(uuid, citext, public.org_role, text, timestamptz, uuid);

create or replace function public.create_invitation(
  _org        uuid,
  _email      citext,
  _role       public.org_role,
  _token_hash text,
  _expires_at timestamptz,
  _workspace  uuid default null,
  _code_hash  text default null,
  _code_expires_at timestamptz default null
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
    if _workspace is null then
      raise exception 'esa persona ya está en la organización' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.users u
      where u.email = _email
        and (
          exists (
            select 1 from public.workspace_members wm
            where wm.workspace_id = _workspace and wm.user_id = u.id
          )
          or exists (
            select 1 from public.organization_members m
            where m.organization_id = _org and m.user_id = u.id and m.all_workspaces
          )
        )
    ) then
      raise exception 'esa persona ya tiene acceso a ese workspace' using errcode = '23505';
    end if;
  end if;

  -- Reinvitar al mismo destino sustituye el enlace anterior — y con él su
  -- código, que es lo correcto: quien reinvita dicta el nuevo.
  delete from public.invitations
  where organization_id = _org and email = _email and accepted_at is null
    and workspace_id is not distinct from _workspace;

  insert into public.invitations
    (organization_id, email, role, token_hash, invited_by, expires_at, workspace_id,
     code_hash, code_expires_at)
  values (_org, _email, coalesce(_role, 'member'), _token_hash,
          public.current_user_id(), _expires_at, _workspace,
          _code_hash, _code_expires_at)
  returning id into _id;

  return _id;
end;
$$;

-- --- Mirar y canjear ---------------------------------------------------------
-- Las dos miran token Y código. Duplicarlas en una pareja de gemelas habría
-- dejado dos copias de la regla de «qué invitación vale», que es exactamente
-- la que no puede divergir.

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
         -- Caducada según por dónde se haya entrado: el código tiene su propia
         -- ventana, más corta. Si se entró por el token, manda `expires_at`.
         case when i.token_hash = _token_hash
              then i.expires_at <= now()
              else coalesce(i.code_expires_at, i.expires_at) <= now()
         end,
         i.accepted_at is not null
    from public.invitations i
    join public.organizations o on o.id = i.organization_id
    left join public.workspaces w on w.id = i.workspace_id
    left join public.profiles p on p.id = i.invited_by
   where i.token_hash = _token_hash
      or (i.code_hash is not null and i.code_hash = _token_hash);
$$;

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
  where accepted_at is null
    and (
      (token_hash = _token_hash and expires_at > now())
      or (code_hash is not null and code_hash = _token_hash
          and coalesce(code_expires_at, expires_at) > now())
    )
  for update;

  if _invitation is null then
    raise exception 'la invitación no es válida o ha caducado' using errcode = 'P0002';
  end if;

  insert into public.organization_members (organization_id, user_id, role, all_workspaces)
  values (_invitation.organization_id, _user, _invitation.role,
          _invitation.workspace_id is null)
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
