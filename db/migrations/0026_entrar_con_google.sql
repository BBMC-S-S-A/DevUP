-- =============================================================================
-- DevUP · 0026 · Entrar con Google
--
-- QUÉ AÑADE Y QUÉ NO. Añade una segunda forma de demostrar quién eres. No
-- cambia nada más: la sesión se sigue emitiendo aquí, `sessions` sigue siendo
-- nuestra, y las políticas siguen leyendo `app.user_id`. Google solo dice «este
-- correo es de quien dice ser»; todo lo demás sigue igual.
--
-- SE GUARDA EL `sub`, NO EL CORREO, COMO IDENTIFICADOR. El `sub` de Google es
-- estable para siempre; el correo no —una persona puede cambiar el suyo en
-- Google Workspace y conservar la misma cuenta—. Si la identidad colgara del
-- correo, ese cambio crearía una cuenta nueva y la vieja quedaría huérfana con
-- todo su trabajo dentro.
--
-- `password_hash` PASA A SER OPCIONAL. Quien entra solo con Google no tiene
-- contraseña, y guardar una inventada sería peor que no tener ninguna: parece
-- una credencial válida y nadie sabría que no lo es. Es una migración que
-- relaja una restricción, no que borra datos: las cuentas existentes siguen
-- exactamente igual.
--
-- LA PUERTA DE LAS INVITACIONES NO SE TOCA. Esta migración no decide quién
-- puede darse de alta; solo ofrece las piezas. La comprobación de
-- `SIGNUP_MODE`, primera cuenta e invitación válida sigue viviendo en un único
-- sitio, en la API, y el alta por Google pasa por ella igual que la de
-- contraseña. Duplicar esa lógica aquí sería garantizar que un día las dos
-- copias dejen de decir lo mismo.
-- =============================================================================

alter table public.users
  add column if not exists google_sub text unique;

alter table public.users
  alter column password_hash drop not null;

-- Una cuenta sin ninguna de las dos cosas no puede entrar por ningún sitio, y
-- sería una fila que nadie puede recuperar ni borrar desde la aplicación.
alter table public.users
  drop constraint if exists users_tiene_alguna_credencial;
alter table public.users
  add constraint users_tiene_alguna_credencial
  check (password_hash is not null or google_sub is not null);

-- ---------------------------------------------------------------------------
-- Funciones de acceso
--
-- SECURITY DEFINER por lo mismo que `auth_credentials`: cuando alguien está
-- entrando todavía no hay identidad, así que RLS deniega la lectura de `users`.
-- Y por eso mismo devuelven lo mínimo y nunca la fila entera.
-- ---------------------------------------------------------------------------

/**
 * Quién es, mirando por el `sub` de Google. Null si esa cuenta de Google no
 * está enlazada con nadie.
 */
create or replace function public.auth_by_google_sub(_sub text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from public.users u where u.google_sub = _sub;
$$;

/**
 * Qué hay ya con ese correo, para decidir entre enlazar y dar de alta.
 *
 * Devuelve si tiene contraseña y si ya tiene un Google enlazado, pero **nunca
 * el hash**: quien llama solo necesita saber que existe, no con qué entra.
 */
create or replace function public.auth_identity(_email citext)
returns table (user_id uuid, tiene_contrasena boolean, google_sub text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.password_hash is not null, u.google_sub
  from public.users u
  where u.email = _email;
$$;

/**
 * Enlazar una cuenta de Google con una cuenta que ya existe.
 *
 * Solo si esa cuenta no tiene ya otro Google enlazado. Sin esa condición,
 * quien lograra pasar por el callback podría reapuntar la cuenta de otra
 * persona a su propio Google y quedarse con ella.
 */
create or replace function public.link_google(_user uuid, _sub text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _hecho boolean;
begin
  update public.users
     set google_sub = _sub
   where id = _user and google_sub is null;

  get diagnostics _hecho = row_count;
  return _hecho;
end;
$$;

/**
 * Alta de una cuenta que entra por Google y no tiene contraseña.
 *
 * Espejo de `register_user`, con dos diferencias: no hay hash que guardar, y el
 * correo nace verificado — pero solo porque quien llama ya ha comprobado que
 * Google dice `email_verified`. Esa comprobación es de la API y es
 * imprescindible: sin ella, cualquiera podría registrar en Google una dirección
 * ajena sin demostrar que es suya y entrar aquí como esa persona.
 */
create or replace function public.register_google_user(
  _email        citext,
  _sub          text,
  _display_name text,
  _avatar_url   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  insert into public.users (email, password_hash, google_sub, email_verified_at)
  values (_email, null, _sub, now())
  returning id into _id;

  insert into public.profiles (id, display_name, avatar_url)
  values (
    _id,
    coalesce(nullif(btrim(_display_name), ''), split_part(_email::text, '@', 1)),
    nullif(btrim(coalesce(_avatar_url, '')), '')
  );

  return _id;
end;
$$;

-- Los privilegios de estas cuatro los reaplica db/grants.sql: quita el EXECUTE
-- de PUBLIC —y de los roles que un Postgres gestionado añade por su cuenta— y
-- se lo da solo a devup_app.
