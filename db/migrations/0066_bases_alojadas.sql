-- =============================================================================
-- DevUP · 0066 · Bases de datos alojadas por DevUP
--
-- QUÉ SE PIDIÓ Y POR QUÉ NO ES UN SIMULACRO. La petición era «poder alojar una
-- base de datos» desde DevUP, con la idea de dejarlo como un mock creíble. No
-- hace falta: DevUP ya corre sobre Postgres, así que puede crear una base de
-- verdad —con su rol, su contraseña y su cadena de conexión— y la pantalla de
-- Base de datos que ya existe la navega y le corre SQL. Fingirlo habría sido
-- más trabajo que hacerlo, y encima mentira.
--
-- ESTA TABLA NO GUARDA LA BASE, GUARDA EL RASTRO DE HABERLA CREADO. Los
-- objetos de verdad —la base y el rol— viven en el catálogo de Postgres, que
-- no tiene columna donde anotar de qué espacio de trabajo es cada uno. Sin
-- este rastro no se podría saber cuál borrar al desalojar, ni distinguir una
-- base que creó DevUP de una que alguien pegó a mano en la bóveda.
--
-- LA CONTRASEÑA NO ESTÁ AQUÍ. Va donde ya van todas las credenciales ajenas:
-- cifrada en `connection_secrets` (0015), colgando de una fila de
-- `connections` con proveedor `postgres` (0065). Así la pantalla de
-- administración no necesita saber nada nuevo —ya sabe leer de ahí— y esta
-- tabla se queda con lo que es suyo: qué base, qué rol, y de quién.
--
-- `on delete set null` EN LA CONEXIÓN Y NO `cascade`. Si alguien desconecta la
-- credencial desde la pantalla de conexiones, la base SIGUE EXISTIENDO en el
-- servidor: perder la fila dejaría una base huérfana ocupando disco que nadie
-- sabría que puede borrar. Con la fila viva se puede detectar y ofrecer
-- desalojarla.
--
-- UNA POR ESPACIO, y por eso la restricción única. No es una limitación
-- técnica —Postgres aguanta las que sean— sino de lo que la pantalla sabe
-- enseñar hoy: `conexionDeBase` resuelve UNA conexión por espacio. Permitir
-- varias aquí dejaría filas que la interfaz no puede mostrar.
-- =============================================================================

create table if not exists public.hosted_databases (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- El nombre real de la base y del rol en el servidor. Los genera DevUP a
  -- partir del identificador del espacio, nunca vienen de lo que alguien
  -- escriba: son los que hay que citar para borrarlos, y un nombre de objeto
  -- no se puede parametrizar en SQL.
  db_name         text not null unique check (db_name ~ '^ws_[0-9a-f]{12}$'),
  role_name       text not null unique check (role_name ~ '^ws_[0-9a-f]{12}$'),
  -- La fila de la bóveda con su cadena de conexión. Ver arriba por qué no es
  -- `cascade`.
  connection_id   uuid references public.connections(id) on delete set null,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- Y ESTE ÚNICO YA ES EL ÍNDICE. Un `unique` crea su propio índice btree, así
  -- que añadir aparte uno sobre `workspace_id` sería el mismo índice dos
  -- veces: disco de más y una escritura de más en cada alta, a cambio de nada.
  unique (workspace_id)
);

-- --- Quién la ve y quién la crea ---------------------------------------------

alter table public.hosted_databases enable row level security;

-- Ver que el espacio tiene una base alojada: cualquiera que llegue al espacio,
-- igual que ya ve que hay un repositorio o un entorno conectado. La fila no
-- lleva la contraseña — esa sigue en la bóveda, con sus propias políticas.
drop policy if exists hosted_databases_select on public.hosted_databases;
create policy hosted_databases_select on public.hosted_databases for select
  using (public.can_access_workspace(workspace_id));

-- CREAR Y DESALOJAR SÍ PIDEN MANDO, y esta es la diferencia con el resto de
-- tablas del espacio. Alojar una base consume disco del servidor de todos, y
-- desalojarla BORRA DATOS QUE NO SE PUEDEN RECUPERAR: no es un gesto que deba
-- poder hacer cualquiera que entre al proyecto.
drop policy if exists hosted_databases_insert on public.hosted_databases;
create policy hosted_databases_insert on public.hosted_databases for insert
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists hosted_databases_delete on public.hosted_databases;
create policy hosted_databases_delete on public.hosted_databases for delete
  using (public.can_manage_workspace(workspace_id));
