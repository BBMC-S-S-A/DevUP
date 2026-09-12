-- =============================================================================
-- DevUP · 0039 · `search_path` fijo en todas nuestras funciones
--
-- QUÉ ES ESTO. Una función sin `search_path` fijo resuelve los nombres que usa
-- con el `search_path` de QUIEN LA LLAMA. Si alguien pone delante un esquema
-- suyo con una tabla o una función que se llame igual, la función acaba
-- trabajando sobre la copia y no sobre la de verdad.
--
-- Y QUÉ NO ES, que conviene decirlo para que nadie lo trate como una urgencia
-- ni lo entierre como una tontería: **ninguna de las que faltaban es
-- `security definer`**, así que corren con los permisos de quien llama y no
-- abren nada que esa persona no pudiera abrir por su cuenta. Las 55 que sí son
-- `security definer` —las que pueden saltarse RLS— ya lo llevaban todas. Esto
-- es higiene, no un agujero.
--
-- LA CUENTA NO CUADRABA, y por eso se hizo contra la base y no contra el
-- documento. `LO-QUE-HAY-Y-LO-QUE-FALTA.md` hablaba de seis funciones; la
-- tarea, de cinco, dando por hecho que `touch_task` ya lo llevaba. Preguntando
-- a `pg_proc` son SIETE: las cinco de la lista, más `touch_task` —que no lo
-- llevaba— y más `touch_architecture_node`, que nació con la 0033 y no estaba
-- en ninguna de las dos listas. Es justo lo que pasa cuando una lista de esto
-- se mantiene a mano.
--
-- POR ESO NO SE NOMBRAN UNA A UNA. El bucle le pregunta a la base cuáles son
-- las suyas y les pone el ajuste. Una lista escrita a mano vuelve a quedarse
-- corta el día que alguien añada la octava, y esa es exactamente la historia
-- que trae esta migración.
--
-- LAS DE LAS EXTENSIONES NO SE TOCAN. `citext` y `pgcrypto` traen noventa
-- funciones sin `search_path`; son suyas, las reinstala `create extension` y
-- cambiarlas es meterse en algo que no mantenemos.
--
-- Y PARA QUE NO VUELVA A PASAR, la prueba de aislamiento comprueba desde hoy
-- que ninguna función nuestra se queda sin él. Una regla que solo vive en una
-- migración se cumple el día que se escribe y se olvida al siguiente.
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
       -- `deptype = 'e'` es «esta función pertenece a una extensión».
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e'
       )
  loop
    execute format('alter function %s set search_path = public', f.firma);
    raise notice 'search_path fijado en %', f.firma;
  end loop;
end$$;
