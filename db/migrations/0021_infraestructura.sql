-- =============================================================================
-- DevUP · 0021 · Entornos y despliegues
--
-- La tercera promesa del producto: ver dónde corre lo que el equipo escribe,
-- en una sola pantalla, sin entrar en la consola de cada proveedor.
--
-- NO SE CONSTRUYE INFRAESTRUCTURA PROPIA. Está cerrado en la propuesta y es lo
-- que da forma a estas tablas: DevUP no despliega nada, ORQUESTA. Guarda la
-- credencial en la bóveda que ya existe, pregunta a la plataforma que el
-- cliente ya usa, y enseña el estado. Por eso aquí no hay ni una columna de
-- configuración de despliegue —ni comando, ni variables, ni región—: todo eso
-- vive en el proveedor, y duplicarlo sería empezar a competir con él y además
-- quedarse desincronizado.
--
-- LO QUE SE GUARDA ES UN REFLEJO, NO LA VERDAD. `deployments` es una copia
-- local de lo que dijo el proveedor la última vez que se preguntó, para que la
-- pantalla abra al instante y para poder enseñar historia sin machacar su API.
-- La verdad está siempre al otro lado, y por eso cada fila lleva de dónde salió
-- (`external_id`) y cuándo se miró (`synced_at`).
--
-- EL ENTORNO ES DE LA ORGANIZACIÓN, NO DE LA CONEXIÓN. Un mismo entorno puede
-- cambiar de proveedor —de Actions a otra cosa— sin dejar de ser «producción»,
-- y la historia de despliegues no debería evaporarse con ese cambio. Por eso
-- `organization_id` es la columna que manda y `connection_id` puede quedarse a
-- null cuando la conexión se borra.
--
-- COMO EN 0016, LOS DESPLIEGUES SOLO LOS ESCRIBE EL SINCRONIZADOR. `deployments`
-- no tiene política de INSERT ni de UPDATE: con RLS activo y cero políticas
-- para un comando, nadie puede ejecutarlo salvo el propietario de la tabla, que
-- es lo que necesita `upsert_deployment`, `security definer`. Un despliegue que
-- se pueda inventar desde una petición de usuario no es un reflejo de nada.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'environment_kind') then
    -- `preview` incluido desde el principio aunque hoy no se use: los tres
    -- nombres son los que usa todo el mundo, y añadir un valor a un enum en
    -- caliente obliga a una migración aparte por cómo Postgres los trata
    -- dentro de una transacción.
    create type public.environment_kind as enum ('production', 'staging', 'preview');
  end if;
  if not exists (select 1 from pg_type where typname = 'deployment_state') then
    -- Estados normalizados. Cada proveedor tiene los suyos —GitHub dice
    -- `queued`/`in_progress`/`completed` con una `conclusion` aparte, otros
    -- dicen `BUILDING`/`READY`/`ERROR`— y traducirlos al entrar es lo que
    -- permite que la pantalla no sepa de quién viene cada fila.
    create type public.deployment_state as enum (
      'pending', 'running', 'success', 'failure', 'cancelled'
    );
  end if;
end$$;

create table if not exists public.environments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 60),
  kind            public.environment_kind not null default 'production',
  -- Dónde se ve funcionando. Es lo primero que alguien quiere pulsar.
  url             text check (url is null or url ~ '^https?://'),
  -- De dónde salen sus despliegues. Null = entorno anotado a mano, que es un
  -- caso legítimo: alguien despliega por SSH y quiere que aparezca en la
  -- pantalla igual.
  connection_id   uuid references public.connections(id) on delete set null,
  -- El identificador del entorno en el proveedor, cuando lo tiene. Para GitHub
  -- es `owner/repo:nombre-del-entorno`.
  external_id     text,
  synced_at       timestamptz,
  last_error      text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.deployments (
  id             uuid primary key default gen_random_uuid(),
  environment_id uuid not null references public.environments(id) on delete cascade,
  -- Lo que el proveedor llama a este despliegue. Es la clave de la
  -- sincronización: preguntar dos veces no puede crear dos filas.
  external_id    text not null,
  state          public.deployment_state not null default 'pending',
  -- Qué se desplegó. El sha corto se calcula al pintar, no se guarda: guardar
  -- una versión abreviada de algo es guardarlo dos veces.
  commit_sha     text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),
  commit_message text,
  author         text,
  -- Dónde mirar el registro cuando algo sale mal. Sin esto, «falló» es un
  -- callejón sin salida y hay que ir a buscarlo al proveedor a mano.
  log_url        text check (log_url is null or log_url ~ '^https://'),
  started_at     timestamptz,
  finished_at    timestamptz,
  synced_at      timestamptz not null default now(),
  unique (environment_id, external_id)
);

-- Buscar «el último despliegue de este entorno» es la consulta de la pantalla,
-- y sin índice es un recorrido completo por cada tarjeta.
create index if not exists deployments_por_entorno
  on public.deployments (environment_id, started_at desc nulls last);

alter table public.environments enable row level security;
alter table public.deployments  enable row level security;

-- --- Entornos ---------------------------------------------------------------
-- Ver es de todo el equipo: saber si producción está en pie no es un privilegio
-- de administración. Crear, cambiar y borrar sí, porque un entorno mal
-- apuntado hace que la pantalla mienta, y una pantalla que miente sobre
-- producción es peor que no tenerla.

drop policy if exists environments_select on public.environments;
create policy environments_select on public.environments for select
  using (public.is_org_member(organization_id));

drop policy if exists environments_insert on public.environments;
create policy environments_insert on public.environments for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists environments_update on public.environments;
create policy environments_update on public.environments for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists environments_delete on public.environments;
create policy environments_delete on public.environments for delete
  using (public.is_org_admin(organization_id));

-- --- Despliegues ------------------------------------------------------------
-- Solo lectura, y por la organización de su entorno. Sin INSERT ni UPDATE a
-- propósito: los escribe `upsert_deployment` y nadie más.

drop policy if exists deployments_select on public.deployments;
create policy deployments_select on public.deployments for select
  using (
    exists (
      select 1 from public.environments e
       where e.id = deployments.environment_id
         and public.is_org_member(e.organization_id)
    )
  );

/**
 * Mete o actualiza un despliegue tal como lo cuenta el proveedor.
 *
 * `security definer` por el mismo motivo que en 0016: la tabla no tiene
 * política de escritura para nadie, así que solo su propietario puede tocarla.
 * Es lo que hace imposible que una petición de usuario invente un despliegue.
 *
 * `search_path` fijado, que en una función `security definer` no es opcional:
 * sin él, quien pueda crear un esquema por delante en su search_path puede
 * colar su propia `environments` y hacer que esta función escriba en ella.
 */
create or replace function public.upsert_deployment(
  _environment_id uuid,
  _external_id    text,
  _state          public.deployment_state,
  _commit_sha     text,
  _commit_message text,
  _author         text,
  _log_url        text,
  _started_at     timestamptz,
  _finished_at    timestamptz
) returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.deployments as d (
    environment_id, external_id, state, commit_sha, commit_message,
    author, log_url, started_at, finished_at, synced_at
  )
  values (
    _environment_id, _external_id, _state, _commit_sha, _commit_message,
    _author, _log_url, _started_at, _finished_at, now()
  )
  on conflict (environment_id, external_id) do update
     set state          = excluded.state,
         commit_sha     = coalesce(excluded.commit_sha, d.commit_sha),
         commit_message = coalesce(excluded.commit_message, d.commit_message),
         author         = coalesce(excluded.author, d.author),
         log_url        = coalesce(excluded.log_url, d.log_url),
         started_at     = coalesce(excluded.started_at, d.started_at),
         finished_at    = excluded.finished_at,
         synced_at      = now()
  returning d.id;
$$;

/** Marca cuándo se miró un entorno, y con qué resultado. */
create or replace function public.mark_environment_synced(
  _environment_id uuid,
  _error          text
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.environments
     set synced_at = now(), last_error = _error
   where id = _environment_id;
$$;
