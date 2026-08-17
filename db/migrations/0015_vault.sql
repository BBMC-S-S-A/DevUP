-- =============================================================================
-- DevUP · 0015 · Bóveda de credenciales
--
-- Fundación común para cualquier conector que guarde una credencial ajena:
-- GitHub, Spotify, y lo que venga después. Dos tablas, no una — mismo motivo
-- que separa `users` de `profiles` en 0001: si el secreto viviera en la
-- misma fila que lo que se puede listar, cualquier política que deje ver la
-- lista de conexiones dejaría ver también el secreto.
--
--   connections        -- metadata pública: proveedor, quién la conectó, cuándo
--   connection_secrets -- el token cifrado, y nada más
--
-- CONNECTION_SECRETS SÍ TIENE POLÍTICA DE SELECT, a propósito. La primera
-- versión de este archivo no le puso ninguna pensando que así quedaba
-- inaccesible del todo — pero RLS no distingue "lo pide una ruta HTTP" de
-- "lo pide el propio servidor para llamar a GitHub": las dos cosas corren
-- como devup_app. Sin política de SELECT, ni siquiera una llamada legítima
-- podría leer el secreto para usarlo. La protección de verdad es la misma
-- que ya protege `users.password_hash`: la fila se puede leer si eres su
-- dueño (o admin de su organización), y la disciplina de no devolverla nunca
-- al navegador vive en el código de cada ruta, no en la base de datos — RLS
-- decide QUIÉN puede ver la fila, no QUÉ COLUMNA de una respuesta HTTP se
-- construye con ella.
--
-- ORG-SCOPED Y USER-SCOPED A LA VEZ. GitHub se conecta una vez por
-- organización (el equipo entero se beneficia de un token). Spotify se
-- conecta una vez por persona (cada quien autoriza su propia cuenta). Una
-- sola tabla sirve a las dos con un check: exactamente una de
-- organization_id/user_id va rellena, nunca las dos ni ninguna.
-- =============================================================================

do $$ begin
  create type public.connection_provider as enum ('github', 'spotify');
exception when duplicate_object then null;
end $$;

create table if not exists public.connections (
  id              uuid primary key default gen_random_uuid(),
  provider        public.connection_provider not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id         uuid references public.users(id) on delete cascade,
  display_name    text not null default '',
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (
    (organization_id is not null and user_id is null)
    or (organization_id is null and user_id is not null)
  )
);

create index if not exists connections_org_idx
  on public.connections (organization_id) where organization_id is not null;
create index if not exists connections_user_idx
  on public.connections (user_id) where user_id is not null;

-- Una sola fila de secreto por conexión, en su propia tabla: así una ruta que
-- lista conexiones (`select id, provider, display_name, created_at from
-- connections`) no puede arrastrar el secreto ni por descuido con un
-- `select *` — la columna cifrada no está ahí para arrastrarse.
create table if not exists public.connection_secrets (
  connection_id    uuid primary key references public.connections(id) on delete cascade,
  encrypted_secret bytea not null,
  expires_at       timestamptz
);

alter table public.connections       enable row level security;
alter table public.connection_secrets enable row level security;

drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections for select
  using (
    (organization_id is not null and public.is_org_member(organization_id))
    or (user_id is not null and user_id = public.current_user_id())
  );

-- Conectar en nombre de una organización es cosa de quien administra, igual
-- que borrar una etiqueta o un cliente. Conectar la cuenta propia (Spotify)
-- no exige ningún rol: es tuya.
drop policy if exists connections_insert on public.connections;
create policy connections_insert on public.connections for insert
  with check (
    (organization_id is not null and public.is_org_admin(organization_id) and user_id is null)
    or (user_id is not null and user_id = public.current_user_id() and organization_id is null)
  );

drop policy if exists connections_delete on public.connections;
create policy connections_delete on public.connections for delete
  using (
    (organization_id is not null and public.is_org_admin(organization_id))
    or (user_id is not null and user_id = public.current_user_id())
  );

drop policy if exists connection_secrets_select on public.connection_secrets;
create policy connection_secrets_select on public.connection_secrets for select
  using (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_member(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
         )
    )
  );

drop policy if exists connection_secrets_insert on public.connection_secrets;
create policy connection_secrets_insert on public.connection_secrets for insert
  with check (
    exists (
      select 1 from public.connections c
       where c.id = connection_secrets.connection_id
         and (
           (c.organization_id is not null and public.is_org_admin(c.organization_id))
           or (c.user_id is not null and c.user_id = public.current_user_id())
         )
    )
  );

drop policy if exists connection_secrets_delete on public.connection_secrets;
create policy connection_secrets_delete on public.connection_secrets for delete
  using (exists (select 1 from public.connections c where c.id = connection_secrets.connection_id));
