-- =============================================================================
-- DevUP · 0038 · El registro de actividad
--
-- LO QUE HOY NO SE PUEDE CONTESTAR: «quién hizo qué». Una tarea guarda su
-- estado actual y nada más. No hay rastro de que se movió, ni de cuándo, ni de
-- quién la movió. Se puede decir «Ana tiene cuatro tareas en Hecho», pero no
-- «Ana cerró cuatro esta semana», que es la pregunta que se hace de verdad
-- antes de una reunión.
--
-- Y no es solo del tablero: de aquí salen también la tarjeta de una persona
-- («qué lleva ahora mismo»), la auditoría por persona y el «¿qué ha pasado
-- aquí desde ayer?» que hace que trabajar en remoto no empiece de cero.
--
-- SOLO SE AÑADE. No hay política de UPDATE ni de DELETE, y esa ausencia es la
-- funcionalidad: un registro que se puede editar no sirve para responder de
-- nada. Ni siquiera quien administra puede reescribirlo desde la aplicación —
-- lo único que lo borra es que se borre el espacio entero, y entonces ya no
-- queda nada de lo que responder. Que la tabla sea inmutable no se consigue
-- con una promesa en el código: se consigue no escribiendo esas dos políticas.
--
-- POR ESPACIO, NO POR ORGANIZACIÓN. Desde 0035 cada espacio es un proyecto
-- aislado: su git, su base, su infraestructura. Su historia también. Se guarda
-- además la organización porque la auditoría por persona cruza varios espacios
-- de la misma empresa, y sacarla por `join` en cada consulta de un panel que
-- se abre a diario es trabajo que se puede ahorrar de una vez.
--
-- EL VERBO ES TEXTO Y NO UN ENUM, a propósito. El vocabulario va a crecer
-- —«movió», «cerró», «asignó», «desplegó», «importó»— y con un enum cada
-- palabra nueva sería una migración. Peor: `alter type ... add value` no
-- siempre puede correr dentro de una transacción, que es justo como corren
-- estas migraciones. La lista viva está en `apps/api/src/lib/actividad.ts`,
-- que es donde se puede leer y cambiar sin tocar la base.
--
-- SE GUARDA CÓMO SE LLAMABA LA COSA. `subject_label` copia el título en el
-- momento de escribir el renglón. Sin eso, borrar una tarea dejaría un
-- historial lleno de «movió algo», y un registro que no se puede leer es un
-- registro que no existe.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activity_source') then
    -- De dónde salió: una persona, una regla automática del producto, o un
    -- agente por la puerta MCP. Son tres y no van a ser más: cualquier cosa
    -- que escriba aquí es una de las tres.
    create type public.activity_source as enum ('persona', 'regla', 'agente');
  end if;
end$$;

create table if not exists public.activity (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Quién. Se queda en null si la persona se borra: el hecho pasó igual, y
  -- perder el renglón entero sería perder historia por una baja.
  actor_id        uuid references public.users(id) on delete set null,
  source          public.activity_source not null default 'persona',
  -- Qué pasó y sobre qué. Ver la cabecera: texto y no enum.
  verb            text not null check (length(btrim(verb)) between 1 and 40),
  subject_type    text not null check (length(btrim(subject_type)) between 1 and 40),
  subject_id      uuid,
  subject_label   text not null default '' check (length(subject_label) <= 200),
  -- Lo que cambió, cuando importa: de qué columna a cuál, de quién a quién.
  -- En jsonb porque cada verbo tiene lo suyo y una columna por caso sería una
  -- tabla con treinta columnas casi siempre vacías.
  detail          jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);

-- La consulta de siempre es «lo último de este espacio», así que el índice va
-- por espacio y fecha descendente. Sin él, el panel lee la tabla entera cada
-- vez que alguien lo abre, y esta tabla solo crece.
create index if not exists activity_workspace_at_idx
  on public.activity (workspace_id, at desc);

-- Y la segunda: «qué ha hecho esta persona», que cruza espacios de la misma
-- organización. Es la que sostiene la auditoría por persona.
create index if not exists activity_actor_at_idx
  on public.activity (organization_id, actor_id, at desc);

-- Para «¿qué le ha pasado a esta tarea?», que es lo que abre su historial.
create index if not exists activity_subject_idx
  on public.activity (subject_id, at desc);

alter table public.activity enable row level security;

-- --- Quién lo ve --------------------------------------------------------------
-- Lo mismo que ve del espacio: si alguien no puede entrar al proyecto, tampoco
-- puede leer su historia. `can_access_workspace` ya resuelve el caso difícil
-- —los espacios personales, que no ve ni quien administra— y repetir aquí esa
-- regla a mano sería la segunda copia que acaba divergiendo.

drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select
  using (public.can_access_workspace(workspace_id));

-- --- Quién lo escribe ---------------------------------------------------------
-- Cualquiera del espacio, porque lo que escribe es lo que acaba de hacer. Lo
-- que NO puede es escribirlo a nombre de otro: `actor_id` tiene que ser quien
-- está conectado. Sin esa comprobación, el registro deja de servir para
-- responder de nada, que es su única razón de existir.
--
-- `actor_id is null` se admite para lo que escribe el producto solo —una regla
-- automática, un barrendero—, que no tiene persona detrás.

drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert
  with check (
    public.can_access_workspace(workspace_id)
    and (actor_id is null or actor_id = public.current_user_id())
  );

-- No hay política de UPDATE ni de DELETE, y es deliberado. Ver la cabecera.
