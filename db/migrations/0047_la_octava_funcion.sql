-- =============================================================================
-- DevUP · 0047 · La octava función
--
-- LA 0039 CONTÓ ESTA HISTORIA Y DESPUÉS LE PASÓ. Su cabecera dice, palabra por
-- palabra, por qué no nombra las funciones una a una: «una lista escrita a mano
-- vuelve a quedarse corta el día que alguien añada la octava, y esa es
-- exactamente la historia que trae esta migración». Pues la octava llegó.
--
-- `check_task_category()` nace en la 0044 —el disparador que impide clasificar
-- una tarea en un área de otro espacio— y la 0044 va DESPUÉS de la 0039. El
-- barrido ya había pasado. No hay ningún descuido que reprochar a nadie: es
-- estructural, y le va a volver a pasar a la siguiente función que se escriba
-- en la siguiente migración.
--
-- QUÉ NO ES, para que nadie lo trate como una urgencia: `check_task_category`
-- NO es `security definer`, así que corre con los permisos de quien llama y no
-- abre nada que esa persona no pudiera abrir por su cuenta. Es higiene, igual
-- que la 0039. Lo grave sería lo contrario: que una `security definer` se
-- escapara, y por eso la prueba las mira todas.
--
-- LO QUE DE VERDAD ARREGLÓ ESTO NO ES ESTA MIGRACIÓN. Es la prueba que la 0039
-- dejó puesta en `isolation.test.ts` —«ninguna función nuestra se queda sin
-- search_path»—, que es quien ha cazado esta. Una migración arregla las que hay
-- hoy; la prueba caza la novena. Por eso el barrido se repite aquí entero en
-- vez de tocar solo la función que falla: cuesta lo mismo y recoge de paso
-- cualquier otra que se haya escrito entre la 0039 y hoy.
--
-- Y POR ESO NO SE «ARREGLA» EDITANDO LA 0044. Está aplicada; editarla haría que
-- el runner se negara a seguir —comprueba el hash— y dejaría dos entornos con
-- esquemas distintos según cuándo se migraran. Una aplicada no se toca.
-- =============================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proconfig is null
       -- `deptype = 'e'` es «esta función pertenece a una extensión». Las de
       -- citext y pgcrypto son suyas: las reinstala `create extension` y
       -- cambiarlas es meterse en algo que no mantenemos.
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('alter function %s set search_path = public', f.firma);
    raise notice 'search_path fijado en %', f.firma;
  end loop;
end$$;
