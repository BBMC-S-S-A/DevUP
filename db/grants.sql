-- =============================================================================
-- DevUP · Privilegios del rol de la aplicación
--
-- Se aplica después de cada tanda de migraciones y es idempotente.
--
-- `devup_app` es deliberadamente un rol corriente: no es propietario de nada y
-- no tiene BYPASSRLS. Postgres salta las políticas para el propietario de la
-- tabla, así que si la API se conectara con el rol que ejecuta las migraciones,
-- todo el aislamiento entre organizaciones desaparecería sin un solo error.
-- =============================================================================

-- El camino de búsqueda del rol, no solo el de la conexión. La API ya lo fija
-- al conectar, pero cualquier otra cosa que entre con este rol —psql, un script
-- suelto— no lo hace, y sin `extensions` el tipo `citext` no se resuelve en un
-- Postgres gestionado. Fijarlo en el rol cubre las dos vías.
alter role devup_app set search_path = public, extensions;

grant usage on schema public to devup_app;

grant select, insert, update, delete on all tables in schema public to devup_app;
grant usage, select on all sequences in schema public to devup_app;

-- Las tablas que se creen en migraciones futuras heredan esto sin tener que
-- acordarse de repetir el grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to devup_app;
alter default privileges in schema public
  grant usage, select on sequences to devup_app;

-- Las funciones SECURITY DEFINER corren con los privilegios del propietario:
-- quitarlas de PUBLIC y dárselas solo a la aplicación evita que un rol futuro
-- las herede por descuido.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('grant execute on function %s to devup_app', fn.sig);
  end loop;
end $$;

-- El resto de funciones (las que no son SECURITY DEFINER) no necesitan trato
-- especial: corren con los privilegios de quien llama y RLS se les aplica.
grant execute on all functions in schema public to devup_app;

-- ---------------------------------------------------------------------------
-- Y cerrar lo que un Postgres gestionado abre por su cuenta.
--
-- Supabase expone el esquema `public` por su API REST y le da acceso a los
-- roles `anon` y `authenticated`. La clave `anon` es PÚBLICA por diseño: viaja
-- dentro del JavaScript del cliente. Tal como queda un proyecto recién creado,
-- cualquiera con la URL del proyecto podía llamar a
-- `public.auth_credentials('correo@de.alguien')` y recibir su hash de
-- contraseña, o a `get_connection_secret_for_refresh()` y sacar credenciales
-- de la bóveda. Las dos son SECURITY DEFINER — se saltan RLS a propósito,
-- porque están pensadas para que las llame nuestra API, que comprueba antes
-- quién pregunta. Por esa misma vía se saltaban también las políticas.
--
-- Comprobado en el proyecto de Supabase el 1 de septiembre de 2026: 40
-- funciones alcanzables por `anon` y otras 40 por `authenticated`.
--
-- DevUP no usa esa API REST para nada: se conecta por Postgres directo con
-- `devup_app`. Así que estos dos roles no necesitan absolutamente nada aquí.
--
-- Va con guarda porque en un Postgres nuestro esos roles no existen y esto se
-- ejecuta también en desarrollo.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke usage on schema public         from anon, authenticated;
    revoke all on all tables    in schema public from anon, authenticated;
    revoke all on all functions in schema public from anon, authenticated;
    revoke all on all sequences in schema public from anon, authenticated;

    -- Y que la próxima migración que cree una tabla no vuelva a concederlo.
    alter default privileges in schema public revoke all on tables    from anon, authenticated;
    alter default privileges in schema public revoke all on functions from anon, authenticated;
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
  end if;
end $$;

-- La tabla de control de migraciones también: no guarda datos de nadie, pero
-- sin RLS y con el esquema expuesto le cuenta la lista entera de migraciones a
-- quien pregunte. Sin política = deniega a todo el mundo, que es lo correcto:
-- solo la toca el runner, y ese entra como propietario.
alter table if exists public.schema_migrations enable row level security;
