-- =============================================================================
-- DevUP · 0032 · Servidor de autorización OAuth 2.1 para el MCP remoto
--
-- Primera mitad del transporte remoto que docs/HEARTH-Y-LA-PUERTA-MCP.md dejó
-- pendiente a propósito ("El transporte es stdio, y remoto después"). Esto
-- es lo que hace falta para que Claude pueda añadir DevUP como conector
-- pegando una URL, sin que cada persona tenga que clonar el repo e instalar
-- Node — ver docs/HEARTH-Y-LA-PUERTA-MCP.md y el plan de esta rama.
--
-- NO SE INVENTA UN SISTEMA DE IDENTIDAD NUEVO. El token que sale de
-- `/oauth/token` es exactamente una sesión más de la tabla `sessions`
-- (0001, 0029) — mismo `session_open`, mismo hash, misma rotación. Lo único
-- nuevo aquí es el protocolo de ANTES de eso: quién es el cliente (Claude,
-- u otro) y cómo se le entrega un código de un solo uso tras el
-- consentimiento de la persona.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Clientes OAuth registrados dinámicamente (RFC 7591).
--
-- CON RLS, PERO ABIERTA A PROPÓSITO. No guarda datos de ninguna persona ni
-- de ninguna organización, solo el catálogo de "qué aplicación puede pedir
-- acceso" — nombre y a qué URLs puede redirigir. Es información pública por
-- diseño (Claude la lee de vuelta al registrarse) y el registro en sí
-- también es público (RFC 7591, sin sesión). Explícita y no ausente: así el
-- análisis de migraciones no la confunde con una tabla que se olvidó de
-- aislar, y queda escrito que es una decisión y no un descuido.
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_clients (
  id            uuid primary key default gen_random_uuid(),
  -- Lo generamos nosotros al registrar, no lo elige quien se registra.
  client_id     text not null unique,
  client_name   text not null,
  -- Lista, porque RFC 7591 lo permite y un cliente puede tener más de una
  -- (desarrollo y producción, por ejemplo).
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array'),
  created_at    timestamptz not null default now()
);

alter table public.oauth_clients enable row level security;

drop policy if exists oauth_clients_select on public.oauth_clients;
create policy oauth_clients_select on public.oauth_clients for select using (true);

-- El registro (RFC 7591) es público por diseño: cualquiera puede registrar
-- un cliente, igual que cualquiera puede intentar entrar con correo y
-- contraseña. PKCE es lo que defiende el resto del flujo, no esta política.
drop policy if exists oauth_clients_insert on public.oauth_clients;
create policy oauth_clients_insert on public.oauth_clients for insert with check (true);

-- ---------------------------------------------------------------------------
-- Códigos de autorización: de un solo uso, de vida muy corta (10 minutos),
-- el puente entre "la persona dio su consentimiento en el navegador" y
-- "el cliente OAuth canjea ese consentimiento por un token".
--
-- CON RLS, a diferencia de la tabla de arriba: aquí SÍ hay un `user_id` de
-- por medio, y aunque el código en sí no sirve para nada sin el
-- `code_verifier` que solo tiene el cliente que lo pidió, no hay motivo
-- para que sea visible fuera de su dueño.
-- ---------------------------------------------------------------------------
create table if not exists public.oauth_codes (
  code           text primary key,
  client_id      text not null references public.oauth_clients(client_id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  redirect_uri   text not null,
  -- S256 de PKCE: sha256(code_verifier) en base64url, calculado por quien
  -- inició el flujo. Se guarda el reto, nunca el verificador.
  code_challenge text not null,
  expires_at     timestamptz not null,
  consumed_at    timestamptz
);

create index if not exists oauth_codes_expires_idx on public.oauth_codes (expires_at);

alter table public.oauth_codes enable row level security;

drop policy if exists oauth_codes_select on public.oauth_codes;
create policy oauth_codes_select on public.oauth_codes for select
  using (user_id = public.current_user_id());

-- Insertar es parte de `/oauth/consentir`, que ya exige sesión (requireSession)
-- y por tanto corre con la identidad de quien está dando el consentimiento.
drop policy if exists oauth_codes_insert on public.oauth_codes;
create policy oauth_codes_insert on public.oauth_codes for insert
  with check (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Canjear un código: lo consume y devuelve a quién pertenecía, en la misma
-- sentencia — mismo patrón que `session_consume` (0001/0029), para que un
-- código reutilizado (robado, o reintentado por error) no devuelva nada la
-- segunda vez.
--
-- `security definer` porque quien llama a `/oauth/token` todavía NO tiene
-- sesión — es al revés: el resultado de esto es lo que permite abrir una.
-- Sin esto, `withUser(null, ...)` no vería ninguna fila por RLS y el canje
-- fallaría siempre, sin importar si el código era válido.
--
-- El `code_challenge` se devuelve para que la ruta compare
-- sha256(code_verifier) fuera de la base — la comparación en sí no
-- necesita estar en SQL, y así queda un solo sitio (Node) que entiende PKCE.
-- ---------------------------------------------------------------------------
create or replace function public.oauth_code_consume(_code text)
returns table (
  user_id        uuid,
  client_id      text,
  redirect_uri   text,
  code_challenge text
)
language sql
volatile
security definer
set search_path = public
as $$
  update public.oauth_codes c
     set consumed_at = now()
   where c.code = _code
     and c.consumed_at is null
     and c.expires_at > now()
  returning c.user_id, c.client_id, c.redirect_uri, c.code_challenge;
$$;
