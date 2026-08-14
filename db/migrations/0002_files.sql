-- =============================================================================
-- DevUP · 0002 · Archivos, etiquetas y almacenamiento
--
-- Los objetos viven en un almacén compatible con S3 (MinIO en desarrollo, R2 o
-- el bucket del propio cliente en producción) bajo la clave
--   {organization_id}/{workspace_id}/{uuid}.{ext}
--
-- La primera carpeta SIGUE siendo la frontera de seguridad, pero ahora se
-- verifica en la API al firmar cada URL, no en políticas de storage.objects.
-- Consecuencia directa: firmar una URL sin comprobar antes la pertenencia a la
-- organización que abre la clave es una fuga entre clientes. Toda firma pasa
-- por apps/api/src/storage/keys.ts, y ese es el único sitio donde se compone
-- una clave.
--
-- ORDEN DE LA SUBIDA — cambia respecto al diseño original, con motivo:
--
--   El plan decía «primero el objeto, después la fila; si la fila falla, borra
--   el objeto». Eso funciona cuando los bytes pasan por el servidor. Aquí no:
--   el cliente sube directo al almacén con una URL firmada y la API nunca se
--   entera de si terminó. Con el orden antiguo, un cliente que cierra la
--   pestaña a mitad deja un objeto que ninguna fila referencia — invisible,
--   inenumerable y facturable.
--
--   Por eso la fila se reserva primero, en estado 'pending', y se marca
--   'ready' al confirmar. Todo objeto tiene fila; la basura es justo el
--   conjunto de filas 'pending' caducadas, que el barrendero puede recorrer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Etiquetas (polimórficas por diseño: hoy archivos, mañana servicios y tareas)
-- ---------------------------------------------------------------------------
create table if not exists public.tags (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 40),
  color           text not null default 'slate'
                  check (color in ('slate','blue','green','amber','red','violet','pink','teal')),
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- Archivos
-- ---------------------------------------------------------------------------
create table if not exists public.files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  channel_id      uuid references public.channels(id) on delete set null,
  storage_key     text not null unique,
  name            text not null check (length(btrim(name)) between 1 and 255),
  description     text not null default '',
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null default 0 check (size_bytes >= 0),
  status          text not null default 'pending' check (status in ('pending','ready')),
  uploaded_by     uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists files_workspace_idx on public.files (workspace_id, created_at desc);
create index if not exists files_channel_idx   on public.files (channel_id, created_at desc);
create index if not exists files_org_idx       on public.files (organization_id, created_at desc);

-- Para el barrendero de subidas abandonadas.
create index if not exists files_pending_idx on public.files (created_at)
  where status = 'pending';

-- Búsqueda por nombre y descripción. `simple` en vez de `spanish` a propósito:
-- los nombres de archivo son en su mayoría identificadores, no prosa, y el
-- lematizador español destroza cosas como "informe-Q3-final".
create index if not exists files_search_idx on public.files
  using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));

create table if not exists public.file_tags (
  file_id uuid not null references public.files(id) on delete cascade,
  tag_id  uuid not null references public.tags(id) on delete cascade,
  primary key (file_id, tag_id)
);

create index if not exists file_tags_tag_idx on public.file_tags (tag_id);

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.tags      enable row level security;
alter table public.files     enable row level security;
alter table public.file_tags enable row level security;

drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags for select
  using (public.is_org_member(organization_id));

drop policy if exists tags_insert on public.tags;
create policy tags_insert on public.tags for insert
  with check (public.is_org_member(organization_id));

drop policy if exists tags_update on public.tags;
create policy tags_update on public.tags for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists tags_delete on public.tags;
create policy tags_delete on public.tags for delete
  using (public.is_org_admin(organization_id));

drop policy if exists files_select on public.files;
create policy files_select on public.files for select
  using (
    public.is_org_member(organization_id)
    and (channel_id is null or public.can_access_channel(channel_id))
  );

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert
  with check (
    public.can_access_workspace(workspace_id)
    and organization_id = public.org_of_workspace(workspace_id)
    and (channel_id is null or public.can_access_channel(channel_id))
    and uploaded_by = public.current_user_id()
  );

-- Renombrar y reetiquetar lo puede hacer cualquier miembro; el borrado no.
drop policy if exists files_update on public.files;
create policy files_update on public.files for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete
  using (
    uploaded_by = public.current_user_id()
    or public.is_org_admin(organization_id)
  );

-- La visibilidad de la relación se hereda de la del archivo: el `exists` se
-- evalúa bajo RLS, así que un archivo que no ves tampoco te muestra etiquetas.
drop policy if exists file_tags_select on public.file_tags;
create policy file_tags_select on public.file_tags for select
  using (exists (select 1 from public.files f where f.id = file_id));

drop policy if exists file_tags_insert on public.file_tags;
create policy file_tags_insert on public.file_tags for insert
  with check (exists (select 1 from public.files f where f.id = file_id));

drop policy if exists file_tags_delete on public.file_tags;
create policy file_tags_delete on public.file_tags for delete
  using (exists (select 1 from public.files f where f.id = file_id));

-- ---------------------------------------------------------------------------
-- Barrendero de subidas abandonadas
--
-- Devuelve las claves cuyas filas se han borrado, para que la API borre
-- también los objetos. SECURITY DEFINER porque es mantenimiento del sistema y
-- no corre en nombre de ningún usuario.
-- ---------------------------------------------------------------------------
create or replace function public.sweep_abandoned_uploads(_older_than interval)
returns table (storage_key text)
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.files
  where status = 'pending'
    and created_at < now() - _older_than
  returning files.storage_key;
$$;
