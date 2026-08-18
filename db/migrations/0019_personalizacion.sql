-- =============================================================================
-- DevUP · 0019 · Personalización: panel por persona, entidades y noticias
--
-- Cuatro piezas nuevas para la capa de personalización:
--
--   organizations.logo_key    -- la foto de la organización (clave en S3/MinIO,
--                                 nunca la URL: el bucket es privado y toda
--                                 lectura se firma al vuelo, igual que `files`)
--   organization_links        -- enlaces que la organización quiere fijar
--                                 (repositorio, documentación, lo que sea)
--   announcements             -- el sistema de noticias: quien administra
--                                 publica, el resto de la organización lee
--   user_dashboard_prefs      -- cómo quiere CADA PERSONA su panel: qué
--                                 widgets, en qué orden, y en qué modo el de
--                                 Spotify
--
-- TRES SON ORG-SCOPED, UNA ES USER-SCOPED, Y LA POLÍTICA LO REFLEJA. Las tres
-- primeras siguen el patrón ya establecido en 0001: leer exige ser miembro
-- (`is_org_member`), escribir exige administrar (`is_org_admin`). La cuarta no
-- lleva `organization_id` en absoluto — es un panel personal, no algo que la
-- organización pueda ver ni tocar, así que su única regla es «tu fila, y solo
-- la tuya» (mismo patrón que `notifications` en 0006).
--
-- POR QUÉ `user_dashboard_prefs` ES TABLA PROPIA Y NO UNA COLUMNA EN `profiles`.
-- Mismo motivo que separa `users` de `profiles`, o `connections` de
-- `connection_secrets`: `profiles` la lee cualquier compañero de organización
-- (política `profiles_select`), y la disposición del panel de alguien no es
-- algo que el resto de la organización necesite ni deba poder leer.
-- =============================================================================

alter table public.organizations
  add column if not exists logo_key text;

-- ---------------------------------------------------------------------------
-- Enlaces de la organización
-- ---------------------------------------------------------------------------
create table if not exists public.organization_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label           text not null check (length(btrim(label)) between 1 and 60),
  url             text not null check (length(btrim(url)) between 1 and 2000),
  position        int not null default 0,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists organization_links_org_idx
  on public.organization_links (organization_id, position);

-- ---------------------------------------------------------------------------
-- Noticias
--
-- Sin columna de «fijada» ni de borrador: es la versión mínima que ya cumple
-- la promesa (publicar algo que todo el mundo vea al entrar). Añadir eso
-- encima es la próxima iteración si hace falta, no un requisito de esta.
-- ---------------------------------------------------------------------------
create table if not exists public.announcements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_id       uuid references public.users(id) on delete set null,
  title           text not null check (length(btrim(title)) between 1 and 140),
  body            text not null check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists announcements_org_idx
  on public.announcements (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Preferencias de panel, por persona
-- ---------------------------------------------------------------------------
create table if not exists public.user_dashboard_prefs (
  user_id      uuid primary key references public.users(id) on delete cascade,
  -- Orden de arriba a abajo. Un catálogo nuevo de widgets no exige migración:
  -- vive en el código del cliente, y esto solo guarda una lista de
  -- identificadores y en qué orden pintarlos.
  widgets      jsonb not null default '["spotify","noticias","notificaciones","enlaces"]'::jsonb,
  spotify_mode text not null default 'boton' check (spotify_mode in ('boton', 'expandido')),
  updated_at   timestamptz not null default now()
);

alter table public.organization_links   enable row level security;
alter table public.announcements        enable row level security;
alter table public.user_dashboard_prefs enable row level security;

drop policy if exists organization_links_select on public.organization_links;
create policy organization_links_select on public.organization_links for select
  using (public.is_org_member(organization_id));

drop policy if exists organization_links_insert on public.organization_links;
create policy organization_links_insert on public.organization_links for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists organization_links_update on public.organization_links;
create policy organization_links_update on public.organization_links for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists organization_links_delete on public.organization_links;
create policy organization_links_delete on public.organization_links for delete
  using (public.is_org_admin(organization_id));

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select
  using (public.is_org_member(organization_id));

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete
  using (public.is_org_admin(organization_id));

drop policy if exists user_dashboard_prefs_select on public.user_dashboard_prefs;
create policy user_dashboard_prefs_select on public.user_dashboard_prefs for select
  using (user_id = public.current_user_id());

drop policy if exists user_dashboard_prefs_insert on public.user_dashboard_prefs;
create policy user_dashboard_prefs_insert on public.user_dashboard_prefs for insert
  with check (user_id = public.current_user_id());

drop policy if exists user_dashboard_prefs_update on public.user_dashboard_prefs;
create policy user_dashboard_prefs_update on public.user_dashboard_prefs for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists user_dashboard_prefs_delete on public.user_dashboard_prefs;
create policy user_dashboard_prefs_delete on public.user_dashboard_prefs for delete
  using (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Un tipo de notificación nuevo: que hay una noticia publicada.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'task_assigned', 'invitation', 'recording', 'announcement'));
