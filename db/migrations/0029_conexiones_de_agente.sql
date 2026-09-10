-- ---------------------------------------------------------------------------
-- Conexiones de agente: una sesión con nombre, para la puerta MCP.
--
-- Para que alguien conecte su propio Claude a DevUP hace falta una credencial
-- de larga vida. Aquí NO se inventa un tipo de token nuevo: la sesión ya es
-- exactamente eso —un token de refresco de 30 días, guardado como hash, que
-- se cambia por accesos cortos— y además ya trae lo que a un token de agente
-- suele faltarle, que es poder listarlo y revocarlo.
--
-- Lo único que le falta es un nombre. Sin él, la lista de sesiones enseña
-- «Chrome en el portátil» y «Chrome en el portátil» y nadie sabe cuál revocar.
--
-- Todo lo de este archivo es aditivo: dos columnas con valor por defecto y dos
-- funciones. No borra ni reescribe ninguna fila.
-- ---------------------------------------------------------------------------

alter table public.sessions
  add column if not exists label    text    not null default '',
  add column if not exists is_agent boolean not null default false;

-- Las conexiones de agente se listan aparte de los navegadores, y son pocas.
create index if not exists sessions_agente_idx
  on public.sessions (user_id, created_at desc)
  where is_agent;

-- ---------------------------------------------------------------------------
-- Abrir una conexión de agente
--
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO `session_open`. Esa recibe el usuario como
-- parámetro, así que quien pueda llamarla puede abrir una sesión a nombre de
-- cualquiera; hoy es inofensivo porque solo la llama nuestro código con el
-- usuario ya autenticado, pero esto emite una credencial de 30 días y no
-- conviene que su firma permita eso siquiera por error. Esta lo saca de
-- `current_user_id()` y no admite que se le diga otro.
--
-- `security definer` porque `sessions` no tiene política de INSERT a
-- propósito: nadie escribe ahí directamente.
-- ---------------------------------------------------------------------------
create or replace function public.agent_connection_open(
  _label      text,
  _token_hash text,
  _expires_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _me uuid := public.current_user_id();
  _id uuid;
begin
  if _me is null then
    raise exception 'sin sesión' using errcode = '42501';
  end if;
  if coalesce(btrim(_label), '') = '' then
    raise exception 'la conexión necesita un nombre' using errcode = '22023';
  end if;

  insert into public.sessions (user_id, refresh_token_hash, expires_at, user_agent, label, is_agent)
  values (_me, _token_hash, _expires_at, 'devup-mcp', btrim(_label), true)
  returning id into _id;

  return _id;
end;
$$;

-- ---------------------------------------------------------------------------
-- El nombre sobrevive a la rotación
--
-- `/auth/refresh` consume la sesión presentada y abre otra. Sin esto, la
-- primera renovación de una conexión de agente la convertiría en una sesión
-- anónima más: perdería su nombre y su marca, y dejaría de aparecer en la
-- lista de conexiones aunque siguiera viva y con todo el acceso. Sería una
-- credencial de larga vida que ya no se puede encontrar para revocarla.
--
-- Así que `session_consume` devuelve también lo que hay que arrastrar. Se
-- reemplaza en vez de crear otra función porque el contrato es el mismo, solo
-- devuelve dos columnas más.
-- ---------------------------------------------------------------------------
-- `create or replace` no puede cambiar el tipo de retorno, asi que hay que
-- soltarla y volver a crearla. Va dentro de la transaccion de la migracion:
-- entre el drop y el create no hay ningun instante en que la funcion no
-- exista para nadie más.
--
-- Y el codigo viejo sigue valiendo mientras se despliega: `select user_id from
-- session_consume($1)` ignora las columnas nuevas. Al reves no —el codigo
-- nuevo llama a `session_open` con seis argumentos— asi que esta migracion va
-- ANTES del despliegue, que es el orden que el workflow ya obliga.
drop function if exists public.session_consume(text);

create function public.session_consume(_token_hash text)
returns table (session_id uuid, user_id uuid, label text, is_agent boolean)
language sql
volatile
security definer
set search_path = public
as $$
  update public.sessions s
  set revoked_at = now()
  where s.refresh_token_hash = _token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  returning s.id, s.user_id, s.label, s.is_agent;
$$;

-- Y `session_open` acepta el nombre para poder pasárselo. Los parámetros
-- nuevos llevan valor por defecto, así que las llamadas de cuatro argumentos
-- que ya hay siguen valiendo — y por eso hay que SOLTAR la de cuatro: si
-- convivieran, una llamada con cuatro argumentos encajaría en las dos y
-- Postgres la rechazaría por ambigua.
drop function if exists public.session_open(uuid, text, timestamptz, text);

create function public.session_open(
  _user       uuid,
  _token_hash text,
  _expires_at timestamptz,
  _user_agent text,
  _label      text    default '',
  _is_agent   boolean default false
)
returns uuid
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.sessions (user_id, refresh_token_hash, expires_at, user_agent, label, is_agent)
  values (_user, _token_hash, _expires_at, coalesce(_user_agent, ''),
          coalesce(_label, ''), coalesce(_is_agent, false))
  returning id;
$$;
