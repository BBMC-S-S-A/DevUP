-- =============================================================================
-- DevUP · 0072 · Las sesiones de trabajo
--
-- LO QUE FALTABA: «¿qué se hizo en esa sesión, y por qué?». El registro de
-- actividad (0038) ya sabe QUÉ se tocó —movió esta tarea, subió ese archivo—
-- pero no sabe lo que no pasa por DevUP: qué se decidió y por qué, qué PR se
-- abrió en GitHub, qué quedó pendiente. Eso vivía en la conversación con la IA
-- y se perdía al cerrarla. La siguiente sesión, o la IA de otra persona,
-- empezaba de cero.
--
-- UNA SESIÓN ES UN RESUMEN MÁS UNA VENTANA DE TIEMPO. Lo que se escribe aquí
-- es solo lo que DevUP no puede saber solo: el resumen, las decisiones, los
-- PRs, los pendientes. Los hechos —tareas movidas, archivos subidos— NO se
-- copian: se leen del registro de actividad y de `files` entre `started_at` y
-- `ended_at`, filtrando por la persona. Copiarlos sería la segunda versión de
-- la verdad, y la que acaba mintiendo.
--
-- ES DE QUIEN LA ESCRIBE. Cualquiera del espacio la lee —ese es el punto: que
-- otra persona o su IA recoja el contexto—, pero solo su autor la corrige o la
-- borra. Nadie firma la sesión de otro.
-- =============================================================================

create table if not exists public.work_sessions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_id       uuid not null references public.users(id) on delete cascade,
  -- Una persona, o una IA trabajando por ella por la puerta MCP. Se guarda
  -- cuál porque «lo hizo Claude por Ana» y «lo hizo Ana» se leen distinto.
  source          public.activity_source not null default 'persona',
  title           text not null check (length(btrim(title)) between 1 and 160),
  summary         text not null default '' check (length(summary) <= 8000),
  -- Listas cortas de texto. En jsonb y no en tablas aparte: se escriben y se
  -- leen siempre enteras, junto con la sesión, y nadie las consulta sueltas.
  decisions       jsonb not null default '[]'::jsonb,
  pending         jsonb not null default '[]'::jsonb,
  -- [{ repo, numero, url, titulo, estado }] — lo que pasó fuera de DevUP.
  pull_requests   jsonb not null default '[]'::jsonb,
  -- Archivos que no están en la biblioteca: documentos generados en local,
  -- rutas de un repositorio. Los de la biblioteca salen solos de `files`.
  files_touched   jsonb not null default '[]'::jsonb,
  started_at      timestamptz not null,
  ended_at        timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  check (ended_at >= started_at),
  -- Una semana es el tope: una «sesión» más larga es un proyecto, y sin tope
  -- un error de fecha traería medio año de actividad al detalle.
  check (ended_at - started_at <= interval '7 days'),
  check (jsonb_typeof(decisions) = 'array' and jsonb_typeof(pending) = 'array'
     and jsonb_typeof(pull_requests) = 'array' and jsonb_typeof(files_touched) = 'array')
);

-- «Las últimas sesiones de este espacio», que es la consulta de siempre.
create index if not exists work_sessions_workspace_idx
  on public.work_sessions (workspace_id, ended_at desc);

alter table public.work_sessions enable row level security;

drop policy if exists work_sessions_select on public.work_sessions;
create policy work_sessions_select on public.work_sessions for select
  using (public.can_access_workspace(workspace_id));

-- Se escribe a nombre propio, igual que el registro de actividad.
drop policy if exists work_sessions_insert on public.work_sessions;
create policy work_sessions_insert on public.work_sessions for insert
  with check (
    public.can_access_workspace(workspace_id)
    and author_id = public.current_user_id()
  );

drop policy if exists work_sessions_update on public.work_sessions;
create policy work_sessions_update on public.work_sessions for update
  using (author_id = public.current_user_id() and public.can_access_workspace(workspace_id))
  with check (author_id = public.current_user_id());

drop policy if exists work_sessions_delete on public.work_sessions;
create policy work_sessions_delete on public.work_sessions for delete
  using (author_id = public.current_user_id() and public.can_access_workspace(workspace_id));
