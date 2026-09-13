-- =============================================================================
-- DevUP · 0062 · Reuniones con hora
--
-- QUÉ FALTABA, Y POR QUÉ NO ERA DE PANTALLA. Se pidió poder convocar una
-- reunión dentro de DevCall, a una hora, y que el resto del espacio la vea.
-- No había dónde guardarla: una reunión programada es una fila, no una vista
-- calculada sobre otra tabla.
--
-- POR ESPACIO Y NO POR ORGANIZACIÓN, igual que canales y archivos: una
-- reunión vive en un proyecto concreto, y una que colgara de la organización
-- se vería en todos los espacios a la vez, que no es lo que nadie pidió.
--
-- LA SALA DE VOZ ES OPCIONAL Y NO SE BORRA CON ELLA (`on delete set null`).
-- Convocar sin haber decidido todavía el canal tiene que poder hacerse —«a
-- las 3, en algún canal de voz»—, y borrar un canal no puede llevarse por
-- delante el historial de reuniones que se convocaron ahí.
--
-- ASISTENCIA EN TABLA APARTE Y NO UN ARRAY EN LA FILA. Un array de UUIDs no
-- tiene RLS por fila —solo por la fila entera— así que no se puede negar que
-- alguien apunte a un tercero sin permiso, y no se puede consultar «a qué
-- reuniones voy» con un índice normal. La tabla de asistentes es la misma
-- decisión que ya tomaron `organization_members` y `channel_members`.
--
-- QUIÉN PUEDE, EL MISMO LISTÓN QUE UN CANAL O UNA TAREA: cualquiera que
-- llegue al espacio. Convocar una reunión no es un permiso especial, y
-- pedirlo dejaría la función tan poco usada como el token de GitHub antes de
-- la 0034.
-- =============================================================================

create table if not exists public.meeting_events (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id   uuid references public.channels(id) on delete set null,
  title        text not null check (length(btrim(title)) between 1 and 120),
  description  text not null default '',
  starts_at    timestamptz not null,
  -- Un día es el tope: una "reunión" de más de 24 horas es un evento de otro
  -- tipo, y sin tope alguien podría convocar una que dure meses por error de
  -- unidad (minutos en vez de horas).
  duration_minutes int not null check (duration_minutes > 0 and duration_minutes <= 1440),
  created_by   uuid not null references public.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

create index if not exists meeting_events_workspace_idx
  on public.meeting_events (workspace_id, starts_at);

create index if not exists meeting_events_channel_idx
  on public.meeting_events (channel_id) where channel_id is not null;

create table if not exists public.meeting_attendees (
  event_id     uuid not null references public.meeting_events(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- --- Quién la ve y quién la toca ---------------------------------------------

alter table public.meeting_events enable row level security;

drop policy if exists meeting_events_select on public.meeting_events;
create policy meeting_events_select on public.meeting_events for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists meeting_events_insert on public.meeting_events;
create policy meeting_events_insert on public.meeting_events for insert
  with check (public.can_access_workspace(workspace_id));

drop policy if exists meeting_events_delete on public.meeting_events;
create policy meeting_events_delete on public.meeting_events for delete
  using (public.can_access_workspace(workspace_id));

alter table public.meeting_attendees enable row level security;

-- Ver quién va, a quien ya puede ver la reunión — es la misma lista que se
-- enseña debajo del título, no un dato aparte con su propio permiso.
drop policy if exists meeting_attendees_select on public.meeting_attendees;
create policy meeting_attendees_select on public.meeting_attendees for select
  using (
    exists (
      select 1 from public.meeting_events e
       where e.id = event_id
         and public.can_access_workspace(e.workspace_id)
    )
  );

-- APUNTARSE ES DE UNO MISMO, NO DE UN TERCERO. Sin el `user_id = current_user_id()`
-- del `with check`, cualquier miembro del espacio podría apuntar —o
-- desapuntar— a otra persona a una reunión sin que lo pidiera.
drop policy if exists meeting_attendees_insert on public.meeting_attendees;
create policy meeting_attendees_insert on public.meeting_attendees for insert
  with check (
    user_id = public.current_user_id()
    and exists (
      select 1 from public.meeting_events e
       where e.id = event_id
         and public.can_access_workspace(e.workspace_id)
    )
  );

drop policy if exists meeting_attendees_delete on public.meeting_attendees;
create policy meeting_attendees_delete on public.meeting_attendees for delete
  using (user_id = public.current_user_id());
