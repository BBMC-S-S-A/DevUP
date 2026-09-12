-- =============================================================================
-- DevUP · 0043 · Un tablero nuevo nace sabiendo dónde se termina
--
-- EL FALLO, Y POR QUÉ NADIE LO VIO. La 0037 añadió `is_terminal` y marcó como
-- terminales las columnas que ya existían con nombre de terminar —«Hecho»,
-- «Done», «Terminado»—. Lo que no tocó fue el disparador que crea las tres
-- columnas de todo tablero nuevo (`handle_new_workspace`, de la 0004), que
-- sigue insertando «Por hacer», «En curso» y «Hecho» **sin marcar ninguna**.
--
-- Resultado: los tableros anteriores a la 0037 saben dónde se termina y todos
-- los creados después, no. El mismo producto, comportándose distinto según el
-- día en que se creó el espacio de trabajo. Y en silencio: la columna se sigue
-- llamando «Hecho», las tarjetas se siguen arrastrando ahí, y lo único que
-- pasa es que nada de lo que depende de `is_terminal` funciona.
--
-- LO QUE ESTABA ROTO SIN QUE SE NOTARA, que es la lista que justifica esta
-- migración:
--
--   · `mis_tareas` del MCP devuelve como pendiente lo que ya está cerrado —y
--     eso es un agente diciéndole a alguien que le queda trabajo que no le
--     queda—.
--   · La portada (`/me/inicio`) cuenta lo terminado entre lo abierto.
--   · `marcar_hecha` contesta «este tablero no tiene ninguna columna marcada
--     como final», que es un callejón sin salida en el gesto más común.
--   · «Cuánto tarda en cerrarse» de la auditoría no se dispara nunca, porque
--     mover a esa columna se anota `tarea.movida` y no `tarea.cerrada`.
--
-- Cuatro funciones distintas fallando, todas por la misma línea que no se
-- actualizó, y ninguna devolviendo un error. Es el mismo patrón que el
-- repositorio ya conoce de RLS: no falla, miente.
--
-- SE ARREGLAN LAS DOS MITADES. El disparador, para los que vengan; y una
-- pasada sobre los que ya existen con el MISMO criterio de nombres de la 0037,
-- que es lo que hace que esto no sea una decisión nueva sino la de entonces
-- aplicada a las filas que se escaparon. Un tablero donde alguien ya marcó su
-- columna a mano no se toca: el `where is_terminal = false` lo respeta, y si
-- alguien la desmarcó a propósito esta pasada volvería a marcarla —el precio de
-- no distinguir «nunca se decidió» de «se decidió que no», que la columna no
-- guarda—. Se asume: el caso de desmarcar una columna llamada «Hecho» es raro y
-- se vuelve a corregir desde el tablero en un clic.
--
-- POR QUÉ NO SE MARCA «LA ÚLTIMA COLUMNA» Y YA. Porque la última columna de un
-- tablero no significa nada: hay equipos cuya última columna es «Bloqueado» o
-- «Archivado». Marcar por posición convertiría un tablero razonable en uno que
-- da por terminadas las tareas atascadas, que es peor que no marcar nada.
-- =============================================================================

create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_columns (workspace_id, name, position, is_terminal)
  values
    (new.id, 'Por hacer', 1000, false),
    (new.id, 'En curso',  2000, false),
    -- La razón de esta migración entera. Sin este `true`, todo lo que el
    -- producto sabe hacer con «terminado» se apaga para este tablero.
    (new.id, 'Hecho',     3000, true);
  return new;
end;
$$;

-- Los tableros creados entre la 0037 y hoy. Mismo criterio de nombres que
-- aquella: solo lo que no admite otra lectura. «Listo» sigue fuera, porque en
-- medio tablero significa terminado y en el otro medio «listo para empezar».
update public.task_columns
   set is_terminal = true
 where is_terminal = false
   and lower(btrim(name)) in (
     'hecho', 'hechos', 'hecha', 'hechas',
     'done',
     'terminado', 'terminados', 'terminada', 'terminadas',
     'completado', 'completados', 'completada', 'completadas',
     'finalizado', 'finalizados', 'finalizada', 'finalizadas'
   );
