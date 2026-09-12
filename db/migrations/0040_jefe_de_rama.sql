-- =============================================================================
-- DevUP · 0040 · Una categoría tiene jefe de rama
--
-- QUÉ RESUELVE. Las categorías ya funcionan como ramas de trabajo —filtran el
-- tablero, tienen su pantalla, se renombran— pero no tenían jefe. La pantalla
-- sacaba «quién la lleva» contando quién tiene más tareas sin terminar, que es
-- una aproximación y dice otra cosa: dice quién CARGA más, no quién RESPONDE
-- por el área.
--
-- Y LA DISTINCIÓN IMPORTA, no es un matiz. Quien lleva una rama reparte su
-- trabajo: que alguien sea jefe de «profundización de funcionalidades» no
-- significa que todas esas tareas sean suyas —de hecho delega, y al revés—.
-- Sin esta columna la pantalla no puede distinguir «es tuya» de «te tocó una».
--
-- POR QUÉ NO HACE FALTA POLÍTICA NUEVA. Es una columna de `tags`, no una tabla:
-- las cuatro políticas que ya tiene esa tabla cubren quién puede leerla y
-- escribirla. Lo que sí hace falta es un caso en la prueba de aislamiento,
-- porque es una ESCRITURA nueva: que nadie de otra organización pueda ponerse
-- de jefe de una categoría ajena pasando su identificador a mano.
--
-- `on delete set null` Y NO `cascade`: si la persona se borra, la categoría se
-- queda sin jefe, no desaparece. Borrar a alguien del equipo no puede llevarse
-- por delante un área de trabajo entera y las tareas que cuelgan de ella.
--
-- NO SE COMPRUEBA AQUÍ QUE EL JEFE SEA DE LA ORGANIZACIÓN. Una restricción de
-- clave foránea solo puede mirar `users`, que no sabe de organizaciones; lo
-- comprueba la ruta antes de escribir, y la prueba de aislamiento lo fija.
-- Ponerlo en la base pediría un disparador, y un disparador para esto es más
-- maquinaria de la que el problema merece.
-- =============================================================================

alter table public.tags
  add column if not exists owner_id uuid references public.users(id) on delete set null;

-- Para «qué ramas lleva esta persona», que es la pregunta desde su ficha.
create index if not exists tags_owner_idx on public.tags (owner_id) where owner_id is not null;
