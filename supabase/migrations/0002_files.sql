-- =============================================================================
-- DevUP · 0002 · Archivos, etiquetas y almacenamiento
--
-- Los objetos viven en el bucket privado `files` con la ruta
--   {organization_id}/{workspace_id}/{uuid}.{ext}
-- La primera carpeta ES la frontera de seguridad: las políticas de
-- storage.objects la leen para decidir el acceso, así que la convención de
-- ruta no es cosmética y no se puede cambiar sin revisar estas políticas.
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
  created_by      uuid references auth.users(id) on delete set null,
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
  storage_path    text not null unique,
  name            text not null check (length(btrim(name)) between 1 and 255),
  description     text not null default '',
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null default 0 check (size_bytes >= 0),
  uploaded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists files_workspace_idx on public.files (workspace_id, created_at desc);
create index if not exists files_channel_idx   on public.files (channel_id, created_at desc);
create index if not exists files_org_idx       on public.files (organization_id, created_at desc);

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
    and uploaded_by = auth.uid()
  );

-- Renombrar y reetiquetar lo puede hacer cualquier miembro; el borrado no.
drop policy if exists files_update on public.files;
create policy files_update on public.files for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete
  using (uploaded_by = auth.uid() or public.is_org_admin(organization_id));

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
-- Bucket y políticas de almacenamiento
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 104857600)  -- 100 MB
on conflict (id) do update set public = false, file_size_limit = 104857600;

-- La ruta puede no ser un uuid si alguien sube fuera de la aplicación, así que
-- el cast tiene que ser tolerante: un texto no-uuid devuelve null y la política
-- deniega en vez de reventar la consulta entera.
create or replace function public.try_uuid(_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  return _text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.storage_org_of(_object_name text)
returns uuid
language sql
immutable
as $$
  select public.try_uuid((storage.foldername(_object_name))[1]);
$$;

drop policy if exists "devup files select" on storage.objects;
create policy "devup files select" on storage.objects for select
  using (
    bucket_id = 'files'
    and public.is_org_member(public.storage_org_of(name))
  );

drop policy if exists "devup files insert" on storage.objects;
create policy "devup files insert" on storage.objects for insert
  with check (
    bucket_id = 'files'
    and public.is_org_member(public.storage_org_of(name))
    and owner = auth.uid()
  );

drop policy if exists "devup files update" on storage.objects;
create policy "devup files update" on storage.objects for update
  using (
    bucket_id = 'files'
    and public.is_org_member(public.storage_org_of(name))
  );

drop policy if exists "devup files delete" on storage.objects;
create policy "devup files delete" on storage.objects for delete
  using (
    bucket_id = 'files'
    and (
      owner = auth.uid()
      or public.is_org_admin(public.storage_org_of(name))
    )
  );
