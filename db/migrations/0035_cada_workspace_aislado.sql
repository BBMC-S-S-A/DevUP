-- =============================================================================
-- DevUP · 0035 · Cada workspace, aislado
--
-- EL FALLO QUE ARREGLA, Y ERA DE LOS QUE NO SE VEN. GitHub, Base de datos,
-- Infraestructura y Arquitectura colgaban de la ORGANIZACIÓN. La URL cambiaba
-- al entrar desde un workspace (`/app/w/…`) pero la pantalla resolvía la
-- organización por debajo, así que los tres workspaces de una empresa veían
-- exactamente los mismos repositorios, los mismos entornos y el mismo
-- diagrama. Parecía que cada proyecto tenía lo suyo y no lo tenía.
--
-- LO QUE PASA A SER DEL WORKSPACE: los repositorios, los entornos con sus
-- despliegues, el diagrama de arquitectura y la credencial con la que se leen.
-- Un proyecto tiene su git, su base y su infraestructura, y no ve los del
-- proyecto de al lado aunque compartan empresa.
--
-- LO QUE NO SE MUEVE: las conexiones personales —la clave de IA de cada quien,
-- su Spotify—. Son de la persona y lo seguirán siendo; un workspace no es
-- dueño de la cuenta de nadie.
--
-- NO SE CAMBIA QUIÉN PUEDE QUÉ, solo el ámbito. Lo que exigía administrar la
-- organización ahora exige administrar el workspace; lo que bastaba con ser
-- miembro sigue bastando. El diagrama de arquitectura sigue siendo de todo el
-- equipo del workspace, como se decidió en 0033: un diagrama que solo toca
-- quien administra deja de reflejar la realidad.
--
-- `organization_id` SE QUEDA EN LAS TABLAS aunque ya no mande. Borrar una
-- columna rompe la primera regla del criterio —una migración solo añade— y
-- además es la red de seguridad si algún día hay que rehacer este reparto. A
-- partir de aquí la columna que manda es `workspace_id`.
-- =============================================================================

-- --- Antes de tocar nada: ¿se puede repartir todo? ---------------------------
--
-- Cada fila se va al workspace más antiguo de su organización. Si alguna
-- organización tiene datos y ningún workspace, no hay a dónde mandarlos: la
-- migración PARA aquí, en vez de dejar filas sin dueño que RLS escondería para
-- siempre sin que nadie se entere de que existen.
do $$
declare
  sueltas int;
begin
  select count(*) into sueltas
    from (
      select organization_id from public.github_repos
      union all select organization_id from public.environments
      union all select organization_id from public.architecture_nodes
    ) t
   where not exists (select 1 from public.workspaces w where w.organization_id = t.organization_id);

  if sueltas > 0 then
    raise exception
      'Hay % fila(s) en organizaciones sin ningún workspace. Crea uno en esas organizaciones y vuelve a lanzar la migración.', sueltas;
  end if;
end$$;

/** El workspace más antiguo de una organización: a donde va lo que ya existe. */
create or replace function public.workspace_por_defecto(_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.workspaces
   where organization_id = _org
   order by created_at, id
   limit 1;
$$;

/**
 * Quien administra un workspace: quien lo creó, o quien administra su
 * organización.
 *
 * Hacía falta un nombre para esto. `can_access_workspace` dice quién lo VE, y
 * hasta ahora lo que se podía tocar se decidía con `is_org_admin` — que al
 * pasar todo al workspace se quedaba sin traducción.
 */
create or replace function public.can_manage_workspace(_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = _workspace
       and (w.created_by = public.current_user_id() or public.is_org_admin(w.organization_id))
  );
$$;

-- --- 1. La credencial --------------------------------------------------------

alter table public.connections
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- El ámbito sigue siendo uno y solo uno, ahora de tres. La restricción vieja
-- solo conocía dos, así que se sustituye entera.
alter table public.connections drop constraint if exists connections_check;
alter table public.connections drop constraint if exists connections_ambito;
alter table public.connections
  add constraint connections_ambito check (
    (organization_id is not null and user_id is null and workspace_id is null)
    or (user_id is not null and organization_id is null and workspace_id is null)
    or (workspace_id is not null and organization_id is null and user_id is null)
  );

create index if not exists connections_workspace_idx
  on public.connections (workspace_id) where workspace_id is not null;

-- Las de GitHub que hoy son de la organización se mudan a su workspace por
-- defecto. Es el único proveedor atado a repositorios, entornos y diagrama;
-- las personales (clave de IA, Spotify) no se tocan.
update public.connections c
   set workspace_id = public.workspace_por_defecto(c.organization_id),
       organization_id = null
 where c.provider = 'github'
   and c.organization_id is not null
   and public.workspace_por_defecto(c.organization_id) is not null;

drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections for select
  using (
    (organization_id is not null and public.is_org_member(organization_id))
    or (user_id is not null and user_id = public.current_user_id())
    or (workspace_id is not null and public.can_access_workspace(workspace_id))
  );

drop policy if exists connections_insert on public.connections;
create policy connections_insert on public.connections for insert
  with check (
    (organization_id is not null and public.is_org_admin(organization_id) and user_id is null)
    or (user_id is not null and user_id = public.current_user_id() and organization_id is null)
    or (workspace_id is not null and public.can_manage_workspace(workspace_id))
  );

drop policy if exists connections_delete on public.connections;
create policy connections_delete on public.connections for delete
  using (
    (organization_id is not null and public.is_org_admin(organization_id))
    or (user_id is not null and user_id = public.current_user_id())
    or (workspace_id is not null and public.can_manage_workspace(workspace_id))
  );

-- El secreto hereda el ámbito de su conexión, como siempre.
drop policy if exists connection_secrets_select on public.connection_secrets;
create policy connection_secrets_select on public.connection_secrets for select
  using (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_member(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
           or (c.workspace_id is not null and public.can_access_workspace(c.workspace_id))
         )
    )
  );

drop policy if exists connection_secrets_insert on public.connection_secrets;
create policy connection_secrets_insert on public.connection_secrets for insert
  with check (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
           or (c.workspace_id is not null and public.can_manage_workspace(c.workspace_id))
         )
    )
  );

drop policy if exists connection_secrets_update on public.connection_secrets;
create policy connection_secrets_update on public.connection_secrets for update
  using (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
           or (c.workspace_id is not null and public.can_manage_workspace(c.workspace_id))
         )
    )
  )
  with check (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
           or (c.workspace_id is not null and public.can_manage_workspace(c.workspace_id))
         )
    )
  );

drop policy if exists connection_secrets_delete on public.connection_secrets;
create policy connection_secrets_delete on public.connection_secrets for delete
  using (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
           or (c.workspace_id is not null and public.can_manage_workspace(c.workspace_id))
         )
    )
  );

-- --- 2. Los repositorios -----------------------------------------------------

alter table public.github_repos
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

update public.github_repos r
   set workspace_id = public.workspace_por_defecto(r.organization_id)
 where r.workspace_id is null;

alter table public.github_repos alter column workspace_id set not null;

create index if not exists github_repos_workspace_idx on public.github_repos (workspace_id);

-- El mismo repositorio puede seguirse desde dos workspaces distintos —dos
-- equipos mirando el mismo código es normal—, así que lo único que no se
-- repite es dentro de un workspace. El índice por organización que ponía 0034
-- lo impediría, y por eso se retira: un índice no es datos.
drop index if exists public.github_repos_org_full_name;
create unique index if not exists github_repos_workspace_full_name
  on public.github_repos (workspace_id, full_name);

drop policy if exists github_repos_select on public.github_repos;
create policy github_repos_select on public.github_repos for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists github_repos_insert on public.github_repos;
create policy github_repos_insert on public.github_repos for insert
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists github_repos_update on public.github_repos;
create policy github_repos_update on public.github_repos for update
  using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists github_repos_delete on public.github_repos;
create policy github_repos_delete on public.github_repos for delete
  using (public.can_manage_workspace(workspace_id));

-- --- 3. Los entornos y sus despliegues ---------------------------------------

alter table public.environments
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

update public.environments e
   set workspace_id = public.workspace_por_defecto(e.organization_id)
 where e.workspace_id is null;

alter table public.environments alter column workspace_id set not null;

create index if not exists environments_workspace_idx on public.environments (workspace_id);

-- `unique (organization_id, name)` se queda: dos workspaces de la misma
-- empresa no pueden llamar «producción» a los dos suyos hasta que esa
-- restricción se sustituya. Se cambia aquí porque si no, el aislamiento sería
-- mentira en cuanto el segundo equipo intentara crear su entorno.
alter table public.environments drop constraint if exists environments_organization_id_name_key;
create unique index if not exists environments_workspace_name
  on public.environments (workspace_id, name);

drop policy if exists environments_select on public.environments;
create policy environments_select on public.environments for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists environments_insert on public.environments;
create policy environments_insert on public.environments for insert
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists environments_update on public.environments;
create policy environments_update on public.environments for update
  using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists environments_delete on public.environments;
create policy environments_delete on public.environments for delete
  using (public.can_manage_workspace(workspace_id));

drop policy if exists deployments_select on public.deployments;
create policy deployments_select on public.deployments for select
  using (
    exists (
      select 1 from public.environments e
       where e.id = deployments.environment_id
         and public.can_access_workspace(e.workspace_id)
    )
  );

-- --- 4. El diagrama de arquitectura ------------------------------------------

alter table public.architecture_nodes
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

update public.architecture_nodes n
   set workspace_id = public.workspace_por_defecto(n.organization_id)
 where n.workspace_id is null;

alter table public.architecture_nodes alter column workspace_id set not null;

create index if not exists architecture_nodes_workspace_idx
  on public.architecture_nodes (workspace_id);

-- Sigue siendo de todo el equipo del workspace, no solo de quien administra:
-- la razón está en la cabecera de 0033 y no ha cambiado.
drop policy if exists architecture_nodes_select on public.architecture_nodes;
create policy architecture_nodes_select on public.architecture_nodes for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists architecture_nodes_insert on public.architecture_nodes;
create policy architecture_nodes_insert on public.architecture_nodes for insert
  with check (public.can_access_workspace(workspace_id));

drop policy if exists architecture_nodes_update on public.architecture_nodes;
create policy architecture_nodes_update on public.architecture_nodes for update
  using (public.can_access_workspace(workspace_id))
  with check (public.can_access_workspace(workspace_id));

drop policy if exists architecture_nodes_delete on public.architecture_nodes;
create policy architecture_nodes_delete on public.architecture_nodes for delete
  using (public.can_access_workspace(workspace_id));

-- Un enlace sigue sin tener ámbito propio: lo saca de sus nodos, que ahora lo
-- sacan del workspace. Y los dos extremos tienen que ser del MISMO workspace,
-- que es lo que impide dibujar una flecha desde el proyecto de al lado.
drop policy if exists architecture_links_select on public.architecture_links;
create policy architecture_links_select on public.architecture_links for select
  using (
    exists (
      select 1 from public.architecture_nodes n
       where n.id = source_id and public.can_access_workspace(n.workspace_id)
    )
  );

drop policy if exists architecture_links_insert on public.architecture_links;
create policy architecture_links_insert on public.architecture_links for insert
  with check (
    exists (
      select 1
        from public.architecture_nodes s
        join public.architecture_nodes t on t.workspace_id = s.workspace_id
       where s.id = source_id and t.id = target_id and public.can_access_workspace(s.workspace_id)
    )
  );

drop policy if exists architecture_links_delete on public.architecture_links;
create policy architecture_links_delete on public.architecture_links for delete
  using (
    exists (
      select 1 from public.architecture_nodes n
       where n.id = source_id and public.can_access_workspace(n.workspace_id)
    )
  );

-- --- 5. El barrendero --------------------------------------------------------
-- Devuelve también el workspace: quien refresca ya no necesita la organización
-- para nada.
--
-- Se suelta antes de volver a crearla porque `create or replace` no puede
-- cambiar el tipo de retorno de una función que ya existe, y añadir una columna
-- a la tabla que devuelve lo es. No se pierde nada: una función no guarda
-- datos, y la única que la llama es la pasada de refresco del servidor.
drop function if exists public.list_github_repos_for_refresh();
create or replace function public.list_github_repos_for_refresh()
returns table (repo_id uuid, connection_id uuid, full_name text, workspace_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select id, connection_id, full_name, workspace_id
    from public.github_repos
   where connection_id is not null;
$$;
