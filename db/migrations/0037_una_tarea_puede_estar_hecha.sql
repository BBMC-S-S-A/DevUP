-- =============================================================================
-- DevUP · 0037 · Una tarea puede estar hecha
--
-- LO QUE FALTABA, Y ROMPÍA CUATRO COSAS A LA VEZ. Una tarea tenía columna, y
-- una columna tenía nombre. Nada más. No existía un estado terminal, así que
-- «hecha» era una palabra que alguien escribió una vez en la cabecera de una
-- columna, y nada del producto podía leerla:
--
--   · `mis_tareas` del MCP devolvía también las terminadas, porque solo sabe
--     filtrar por responsable. Preguntarle a tu Claude qué tienes pendiente
--     listaba lo que ya habías cerrado.
--   · El panel no podía contar lo que falta sin adivinar qué columna significa
--     terminar.
--   · No se puede notificar que algo se completó, porque completarse no es un
--     hecho que ocurra: es mover una tarjeta a un sitio con cierto nombre.
--   · Y el grafo no podrá cerrar una tarea desde un commit mientras cerrar no
--     exista.
--
-- Ninguna de las cuatro parecía rota por su lado. Eso es lo que hace que un
-- producto se sienta como piezas: no que las piezas fallen, sino que no
-- comparten vocabulario y por eso no pueden hablarse.
--
-- POR QUÉ EN LA COLUMNA Y NO EN LA TAREA. Una marca en la tarea permitiría que
-- una tarea estuviera «hecha» dentro de la columna «En curso», que es un estado
-- que nadie sabe dibujar y que obliga a decidir cuál de los dos manda. El
-- tablero ya expresa el avance moviendo tarjetas; esto solo enseña a leerlo.
--
-- EL VALOR POR DEFECTO ES `false`, Y ESO ES LO SEGURO. Una columna nueva no
-- termina nada hasta que alguien lo dice. Marcar de más haría desaparecer
-- tareas de «lo que me queda» sin que nadie lo pidiera, que es peor que no
-- marcar: lo segundo se nota y se arregla, lo primero no se nota.
--
-- LA CONJETURA DE ABAJO ES UNA CONJETURA, y por eso es corta. A los tableros
-- que ya existen se les marca la columna solo si su nombre no admite otra
-- lectura. Queda fuera «listo» a propósito: en medio tablero significa
-- terminado y en el otro medio «listo para empezar», y equivocarse ahí es
-- justo el caso que el párrafo anterior evita. Se corrige desde el tablero.
-- =============================================================================

alter table public.task_columns
  add column if not exists is_terminal boolean not null default false;

-- Solo nombres que no admiten otra lectura. `btrim` y `lower` porque «Hecho »
-- y «HECHO» son la misma intención escrita por dos personas distintas.
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

-- Para contar lo que queda sin recorrer el tablero entero. Parcial porque la
-- pregunta que se hace siempre es «¿qué NO está terminado?», y las columnas
-- terminales son la minoría.
create index if not exists task_columns_pendientes_idx
  on public.task_columns (workspace_id)
  where is_terminal = false;

-- El aislamiento no se toca: `task_columns` ya tiene RLS y sus políticas desde
-- la 0004, y esto es una columna más de una tabla que ya estaba protegida. No
-- hay tabla nueva, así que no hay política nueva que escribir — pero sí caso
-- nuevo en `isolation.test.ts`, porque quien puede marcar una columna como
-- terminal es quien puede editarla, y eso hay que comprobarlo.
