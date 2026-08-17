-- =============================================================================
-- DevUP · 0017 · Música compartida (Spotify)
--
-- No es un conector de infraestructura como GitHub (0016): es una comodidad
-- del espacio de trabajo, y por eso no vive bajo `connections` como "el
-- proveedor de la organización" sino como una conexión personal — cada quien
-- autoriza su propia cuenta de Spotify, con provider='spotify' y user_id
-- relleno (el check de 0015_vault.sql ya lo permite, no hace falta tocarlo).
--
-- REPRODUCCIÓN SINCRONIZADA, NO AUDIO COMPARTIDO. El audio de Spotify nunca
-- pasa por DevUP ni por la llamada de voz —eso rompería el cifrado extremo a
-- extremo de las llamadas (decisiones/0001-cifrado-de-salas.md) y además el
-- Web Playback SDK de Spotify no lo permitiría—. Lo que se sincroniza es el
-- ESTADO: qué suena, en qué segundo, en pausa o no. Cada participante con
-- Spotify Premium que quiera oírlo transfiere la reproducción a su propio
-- dispositivo. Quien no tenga Premium puede buscar y añadir canciones a la
-- cola iguialmente —eso no exige Premium, solo el token de aplicación—, pero
-- no puede ser quien reproduce.
--
-- DOS TABLAS, LA MISMA SEPARACIÓN QUE YA EXISTE EN OTROS SITIOS: la cola
-- (channel_queue_tracks) es lo que viene después; la sesión
-- (channel_listening_sessions) es lo que suena ahora. Fusionarlas en una sola
-- tabla con un booleano "es la actual" es la clase de atajo que acaba en una
-- fila casi-actual y otra casi-en-cola después de un fallo a mitad.
-- =============================================================================

create table if not exists public.channel_listening_sessions (
  channel_id     uuid primary key references public.channels(id) on delete cascade,
  track_uri      text,
  track_name     text,
  track_artist   text,
  track_image_url text,
  duration_ms    integer,
  position_ms    integer not null default 0,
  is_playing     boolean not null default false,
  updated_by     uuid references public.users(id) on delete set null,
  updated_at     timestamptz not null default now()
);

create table if not exists public.channel_queue_tracks (
  id             uuid primary key default gen_random_uuid(),
  channel_id     uuid not null references public.channels(id) on delete cascade,
  track_uri      text not null,
  track_name     text not null,
  track_artist   text not null,
  track_image_url text,
  duration_ms    integer,
  added_by       uuid references public.users(id) on delete set null,
  -- Fraccional, mismo motivo que la posición de las tareas en 0004: soltar
  -- una canción entre otras dos calcula el punto medio sin renumerar la cola
  -- entera.
  position       double precision not null,
  created_at     timestamptz not null default now()
);

create index if not exists channel_queue_tracks_channel_idx
  on public.channel_queue_tracks (channel_id, position);

alter table public.channel_listening_sessions enable row level security;
alter table public.channel_queue_tracks       enable row level security;

-- Cuelga de can_access_channel, igual que los mensajes: la música de una sala
-- es tan privada como la sala misma. Cualquier miembro del canal puede leer,
-- añadir a la cola y controlar la reproducción — es una comodidad social, no
-- una acción administrativa, así que no hay ningún gate de is_org_admin aquí.
drop policy if exists channel_listening_sessions_select on public.channel_listening_sessions;
create policy channel_listening_sessions_select on public.channel_listening_sessions for select
  using (public.can_access_channel(channel_id));

drop policy if exists channel_listening_sessions_upsert on public.channel_listening_sessions;
create policy channel_listening_sessions_upsert on public.channel_listening_sessions for insert
  with check (public.can_access_channel(channel_id));

drop policy if exists channel_listening_sessions_update on public.channel_listening_sessions;
create policy channel_listening_sessions_update on public.channel_listening_sessions for update
  using (public.can_access_channel(channel_id))
  with check (public.can_access_channel(channel_id));

drop policy if exists channel_queue_tracks_select on public.channel_queue_tracks;
create policy channel_queue_tracks_select on public.channel_queue_tracks for select
  using (public.can_access_channel(channel_id));

drop policy if exists channel_queue_tracks_insert on public.channel_queue_tracks;
create policy channel_queue_tracks_insert on public.channel_queue_tracks for insert
  with check (public.can_access_channel(channel_id));

drop policy if exists channel_queue_tracks_delete on public.channel_queue_tracks;
create policy channel_queue_tracks_delete on public.channel_queue_tracks for delete
  using (public.can_access_channel(channel_id));
