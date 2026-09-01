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
