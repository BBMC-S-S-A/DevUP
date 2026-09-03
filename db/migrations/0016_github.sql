-- =============================================================================
-- DevUP · 0016 · Conector de GitHub
--
-- Primer conector real sobre la bóveda de 0015. Se conecta con un token de
-- acceso personal de alcance fino, pegado por un administrador — no una
-- GitHub App con OAuth.
-- para el motivo: coincide con BYOI (el cliente trae su credencial) y no
-- exige registrar nada en GitHub para "ver estadísticas".
--
-- LAS ESTADÍSTICAS SE ESCRIBEN SOLO DESDE EL BARRENDERO, NUNCA DESDE UNA
-- PETICIÓN DE USUARIO. Por eso `github_repo_stats` no tiene ninguna política
-- de INSERT/UPDATE: con RLS activo y cero políticas para un comando, nadie
-- puede ejecutarlo salvo el propietario de la tabla — que es exactamente lo
-- que necesita `upsert_github_repo_stats`, `security definer`, igual que
-- `sweep_abandoned_uploads` en 0002_files.sql. La lectura sí es una política
-- normal: cualquier miembro puede ver el panel, no solo quien conectó el
-- token.
-- =============================================================================

create table if not exists public.github_repos (
  id            uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.connections(id) on delete cascade,
  full_name     text not null check (length(btrim(full_name)) between 1 and 200),
  added_by      uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (connection_id, full_name)
);

create table if not exists public.github_repo_stats (
  github_repo_id uuid primary key references public.github_repos(id) on delete cascade,
  data           jsonb not null default '{}',
  refreshed_at   timestamptz,
  last_error     text
);

alter table public.github_repos      enable row level security;
alter table public.github_repo_stats enable row level security;

-- Solo conexiones de organización tienen sentido aquí — un repo no se
-- conecta "a una persona" como Spotify. El `and c.organization_id is not
-- null` es cinturón y tirantes: la app nunca debería insertar un repo contra
-- una conexión personal, pero si algún día lo intentara, esto lo deniega en
-- vez de dejarlo visible a nadie.
drop policy if exists github_repos_select on public.github_repos;
create policy github_repos_select on public.github_repos for select
  using (
    exists (
      select 1 from public.connections c
       where c.id = github_repos.connection_id
         and c.organization_id is not null
         and public.is_org_member(c.organization_id)
    )
  );

drop policy if exists github_repos_insert on public.github_repos;
create policy github_repos_insert on public.github_repos for insert
  with check (
    exists (
      select 1 from public.connections c
       where c.id = github_repos.connection_id
         and c.organization_id is not null
         and public.is_org_admin(c.organization_id)
    )
  );

drop policy if exists github_repos_delete on public.github_repos;
create policy github_repos_delete on public.github_repos for delete
  using (
    exists (
      select 1 from public.connections c
       where c.id = github_repos.connection_id
         and c.organization_id is not null
         and public.is_org_admin(c.organization_id)
    )
  );

-- La visibilidad de las estadísticas se hereda de la del repo, igual que las
-- líneas de una cotización se heredan de su oportunidad: si el repo no se ve,
-- sus estadísticas tampoco.
drop policy if exists github_repo_stats_select on public.github_repo_stats;
create policy github_repo_stats_select on public.github_repo_stats for select
  using (exists (select 1 from public.github_repos r where r.id = github_repo_stats.github_repo_id));

-- `_data` en null significa «no hay estadísticas nuevas que guardar», no
-- «bórralas»: un fallo transitorio al refrescar (el token caducó, GitHub
-- respondió 500 un momento) no debe tirar por la borda la última lectura
-- buena. Por eso el conflicto conserva `github_repo_stats.data` cuando
-- `_data` llega vacío, en vez de sobrescribir con `{}`.
create or replace function public.upsert_github_repo_stats(
  _repo uuid,
  _data jsonb,
  _error text default null
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.github_repo_stats (github_repo_id, data, refreshed_at, last_error)
  values (_repo, coalesce(_data, '{}'::jsonb), now(), _error)
  on conflict (github_repo_id) do update
    set data = coalesce(_data, github_repo_stats.data),
        refreshed_at = now(),
        last_error = _error;
$$;

-- ---------------------------------------------------------------------------
-- El barrendero periódico de server.ts corre con `withUser(null, ...)`: sin
-- identidad, is_org_member/is_org_admin no dejan ver nada (comparan contra un
-- usuario que no existe), así que las dos consultas de más abajo tienen que
-- ser SECURITY DEFINER, igual que sweep_abandoned_uploads.
--
-- OJO SI SE TOCA ESTO: get_connection_secret_for_refresh salta RLS por
-- completo para devolver el secreto CIFRADO de cualquier conexión, sin
-- comprobar pertenencia. Es seguro porque (a) solo lo llama el barrendero del
-- propio servidor, nunca una ruta HTTP con un id que venga del cliente, y (b)
-- lo que devuelve sigue cifrado — sin VAULT_MASTER_KEY no vale nada. Aun así,
-- que no llegue a exponerse por una ruta es una disciplina de código, no una
-- barrera técnica: no le pongas un endpoint encima.
-- ---------------------------------------------------------------------------
create or replace function public.list_github_repos_for_refresh()
returns table (repo_id uuid, connection_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, connection_id, full_name from public.github_repos;
$$;

create or replace function public.get_connection_secret_for_refresh(_connection_id uuid)
returns bytea
language sql
stable
security definer
set search_path = public
as $$
  select encrypted_secret from public.connection_secrets where connection_id = _connection_id;
$$;
