-- =============================================================================
-- DevUP · 0004 · Workspaces personales, tablero de tareas y grabaciones
--
-- Tres cosas que llegan juntas porque se tocan entre sí:
--
--  1. Un workspace puede ser compartido (lo ve toda la organización) o
--     personal (solo quien lo creó). El sitio donde una persona trabaja sola
--     sin sacarla de la organización.
--
--  2. Un tablero de tareas por workspace, con columnas ordenables.
--
--  3. Grabaciones de llamada, con el consentimiento de cada participante
--     guardado. Ver docs/decisiones/0001-cifrado-de-salas.md: la grabación
--     ocurre en el navegador de quien graba, no en el servidor, y por eso hace
--     falta que todos digan que sí antes de empezar.
--
-- CUIDADO CON LO PRIMERO. Añadir «personal» a workspaces no es añadir una
-- columna: es cambiar quién ve qué en tres tablas más. Un canal de un
-- workspace personal, o un archivo suyo, seguirían siendo visibles para toda
-- la organización si solo se cambiara la política de `workspaces` — porque
-- `can_access_channel` y `files_select` no miraban el workspace, miraban la
-- organización. Aquí se corrigen las tres a la vez.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Visibilidad de workspace
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.workspace_visibility as enum ('shared', 'personal');
exception when duplicate_object then null;
end $$;

alter table public.workspaces
  add column if not exists visibility public.workspace_visibility not null default 'shared';

create index if not exists workspaces_visibility_idx
  on public.workspaces (organization_id, visibility);

-- Un workspace personal solo lo ve su dueño. `created_by` es el dueño y no se
-- puede cambiar: no hay traspaso de workspaces personales, y no debería
-- haberlo sin una conversación sobre qué pasa con lo que hay dentro.
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
      and (w.visibility = 'shared' or w.created_by = public.current_user_id())
  );
$$;

-- Misma corrección para los canales: sin esto, un canal dentro de un workspace
-- personal aparecería en la lista de toda la organización.
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
      and (w.visibility = 'shared' or w.created_by = public.current_user_id())
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
  using (
    public.is_org_member(organization_id)
    and (visibility = 'shared' or created_by = public.current_user_id())
  );

-- Un administrador de la organización no puede renombrar ni borrar el
-- workspace personal de otra persona. Que administre la organización no le
-- convierte en dueño de lo que cada cual guarda en su propio espacio.
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update
  using (
    case visibility
      when 'personal' then created_by = public.current_user_id()
      else public.is_org_admin(organization_id)
    end
  )
  with check (
    case visibility
      when 'personal' then created_by = public.current_user_id()
      else public.is_org_admin(organization_id)
    end
  );

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces for delete
  using (
    case visibility
      when 'personal' then created_by = public.current_user_id()
      else public.is_org_admin(organization_id)
    end
  );

-- Y los archivos: pasaban por `is_org_member`, que no sabe nada de workspaces
-- personales. Ahora cuelgan del acceso al workspace, que sí.
drop policy if exists files_select on public.files;
create policy files_select on public.files for select
  using (
    public.can_access_workspace(workspace_id)
    and (channel_id is null or public.can_access_channel(channel_id))
  );

-- ---------------------------------------------------------------------------
-- Tablero de tareas
-- ---------------------------------------------------------------------------
create table if not exists public.task_columns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 40),
  position     double precision not null,
  created_at   timestamptz not null default now()
);

create index if not exists task_columns_workspace_idx
  on public.task_columns (workspace_id, position);

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  column_id    uuid not null references public.task_columns(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text not null default '',
  -- La posición es fraccional para poder soltar una tarjeta entre otras dos
  -- calculando el punto medio, sin renumerar la columna entera en cada
  -- arrastre.
  --
  -- Tiene un límite conocido: unos cincuenta movimientos consecutivos al mismo
  -- hueco agotan la precisión del doble y dos tarjetas acaban con la misma
  -- posición. No es catastrófico —se ordena por (position, created_at) y el
  -- empate queda estable— pero cuando el tablero se use en serio toca añadir
  -- una renumeración periódica.
  position     double precision not null,
  assignee_id  uuid references public.users(id) on delete set null,
  created_by   uuid references public.users(id) on delete set null,
  due_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tasks_column_idx on public.tasks (column_id, position);
create index if not exists tasks_workspace_idx on public.tasks (workspace_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);

-- Las etiquetas ya eran polimórficas por diseño; esta es la segunda cosa que
-- las usa y no hizo falta cambiarlas.
create table if not exists public.task_tags (
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag_id  uuid not null references public.tags(id) on delete cascade,
  primary key (task_id, tag_id)
);

create index if not exists task_tags_tag_idx on public.task_tags (tag_id);

create or replace function public.touch_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_task();

-- Un tablero vacío no invita a nada. Todo workspace nace con tres columnas.
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_columns (workspace_id, name, position)
  values (new.id, 'Por hacer', 1000), (new.id, 'En curso', 2000), (new.id, 'Hecho', 3000);
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

alter table public.task_columns enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_tags    enable row level security;

drop policy if exists task_columns_select on public.task_columns;
create policy task_columns_select on public.task_columns for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists task_columns_insert on public.task_columns;
create policy task_columns_insert on public.task_columns for insert
  with check (public.can_access_workspace(workspace_id));

drop policy if exists task_columns_update on public.task_columns;
create policy task_columns_update on public.task_columns for update
  using (public.can_access_workspace(workspace_id))
  with check (public.can_access_workspace(workspace_id));

drop policy if exists task_columns_delete on public.task_columns;
create policy task_columns_delete on public.task_columns for delete
  using (public.can_access_workspace(workspace_id));

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert
  with check (public.can_access_workspace(workspace_id));

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update
  using (public.can_access_workspace(workspace_id))
  with check (public.can_access_workspace(workspace_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete
  using (public.can_access_workspace(workspace_id));

drop policy if exists task_tags_select on public.task_tags;
create policy task_tags_select on public.task_tags for select
  using (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_tags_insert on public.task_tags;
create policy task_tags_insert on public.task_tags for insert
  with check (exists (select 1 from public.tasks t where t.id = task_id));

drop policy if exists task_tags_delete on public.task_tags;
create policy task_tags_delete on public.task_tags for delete
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- ---------------------------------------------------------------------------
-- Grabaciones
--
-- La graba el navegador de un participante, no el servidor: el audio va
-- cifrado entre pares y ningún servidor nuestro lo ve. Consecuencia directa —
-- y el motivo de que exista la tabla de consentimientos— es que grabar deja de
-- ser una decisión técnica del sistema y pasa a ser un acuerdo entre personas
-- que hay que pedir, obtener y poder demostrar después.
-- ---------------------------------------------------------------------------
alter table public.files
  add column if not exists call_session_id uuid references public.call_sessions(id) on delete set null;

create index if not exists files_call_session_idx on public.files (call_session_id);

create table if not exists public.call_recordings (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.call_sessions(id) on delete cascade,
  started_by uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  file_id    uuid references public.files(id) on delete set null
);

create index if not exists call_recordings_session_idx
  on public.call_recordings (session_id, started_at desc);

create table if not exists public.call_recording_consents (
  recording_id uuid not null references public.call_recordings(id) on delete cascade,
  peer_id      text not null,
  user_id      uuid references public.users(id) on delete set null,
  display_name text not null default '',
  granted      boolean not null,
  responded_at timestamptz not null default now(),
  primary key (recording_id, peer_id)
);

alter table public.call_recordings         enable row level security;
alter table public.call_recording_consents enable row level security;

drop policy if exists call_recordings_select on public.call_recordings;
create policy call_recordings_select on public.call_recordings for select
  using (public.can_access_channel(public.channel_of_session(session_id)));

drop policy if exists call_recordings_insert on public.call_recordings;
create policy call_recordings_insert on public.call_recordings for insert
  with check (
    started_by = public.current_user_id()
    and public.can_access_channel(public.channel_of_session(session_id))
  );

drop policy if exists call_recordings_update on public.call_recordings;
create policy call_recordings_update on public.call_recordings for update
  using (started_by = public.current_user_id())
  with check (started_by = public.current_user_id());

-- El consentimiento se puede leer, no reescribir: una vez dicho que sí o que
-- no, esa fila es prueba y no se toca. De ahí que no haya política de UPDATE
-- ni de DELETE.
drop policy if exists call_recording_consents_select on public.call_recording_consents;
create policy call_recording_consents_select on public.call_recording_consents for select
  using (
    exists (
      select 1 from public.call_recordings r
      where r.id = recording_id
        and public.can_access_channel(public.channel_of_session(r.session_id))
    )
  );

-- Registrar la respuesta de cada participante. SECURITY DEFINER porque quien
-- la escribe es el servidor de señalización al recibir el «sí» o el «no», y
-- necesita anotar la respuesta de otro par, no la suya.
create or replace function public.record_recording_consent(
  _recording    uuid,
  _peer_id      text,
  _user         uuid,
  _display_name text,
  _granted      boolean
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.call_recording_consents
    (recording_id, peer_id, user_id, display_name, granted)
  values (_recording, _peer_id, _user, coalesce(_display_name, ''), _granted)
  on conflict (recording_id, peer_id) do nothing;
$$;
