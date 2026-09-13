-- =============================================================================
-- DevUP · 0064 · De qué repositorio vino este nodo
--
-- EL PROBLEMA. "Leer del repositorio" (0033) nunca borra, a propósito: lo
-- que alguien puso a mano no se pierde por una importación. Pero eso mismo
-- dejaba un rastro: importar el repositorio A y después el B ACUMULABA los
-- dos diagramas en el mismo lienzo, porque no había manera de distinguir «un
-- nodo que vino de A» de «un nodo que alguien dibujó a mano». Se pidió que
-- cambiar de repositorio conectado reemplace el diagrama, no lo apile.
--
-- LA SALIDA NO ES BORRAR TODO ANTES DE IMPORTAR. Eso se llevaría por delante
-- justo lo que 0033 vino a proteger: un nodo puesto a mano, o traído por un
-- agente con `dibujar_arquitectura`. `imported_from` es la marca que falta
-- para poder decir "esto vino de este repositorio en concreto" y borrar SOLO
-- eso cuando el repositorio conectado cambia — nulo sigue queriendo decir lo
-- mismo que siempre: nadie lo trajo de una importación, no se toca.
-- =============================================================================

alter table public.architecture_nodes
  add column if not exists imported_from text;

create index if not exists architecture_nodes_imported_from_idx
  on public.architecture_nodes (workspace_id, imported_from) where imported_from is not null;
