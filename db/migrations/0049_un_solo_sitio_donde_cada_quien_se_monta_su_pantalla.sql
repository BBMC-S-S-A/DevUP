-- =============================================================================
-- DevUP · 0049 · Un solo sitio donde cada quien se monta su pantalla
--
-- QUÉ SE JUNTA, Y POR QUÉ ESTABA PARTIDO. Hay dos funciones en el producto que
-- contestan la misma pregunta —«quiero mis cosas en una sola pantalla»— y que se
-- construyeron por separado sin que nadie se diera cuenta de que eran la misma:
--
--   · El PANEL (0019, rejilla en 0020): widgets colocados libremente, con
--     posición y tamaño. Pero **uno solo para toda la persona**.
--   · La MESA (0025): hasta tres zonas, cada una con una herramienta. Acotada
--     **al espacio de trabajo**, que es lo correcto.
--
-- Cada una tiene la mitad que a la otra le falta. El Panel coloca bien y no sabe
-- dónde está; la Mesa sabe dónde está y solo admite tres huecos. El resultado es
-- que para tener delante el tablero, el canal y lo que hay atascado hay que
-- elegir cuál de las dos pantallas usar, y ninguna de las dos puede sola.
--
-- Esto le da al Panel lo que le faltaba: **alcance de espacio**.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- NADIE PIERDE SU PANEL, Y AHÍ ESTÁ TODO EL DISEÑO DE ESTA MIGRACIÓN. La columna
-- admite NULL, y **NULL significa «el de por defecto»**: la fila que hoy tiene
-- cada persona se queda tal cual y pasa a ser su panel de partida. Un espacio
-- sin panel propio usa ese; en cuanto alguien mueve una tarjeta estando en un
-- espacio, se guarda uno suyo y el de partida deja de aplicar allí.
--
-- La alternativa —meter `workspace_id` en la clave y exigirlo— habría dejado a
-- todo el mundo con la pantalla vacía el día del despliegue, y habría obligado a
-- recolocar el panel una vez por espacio antes de que volviera a servir de algo.
-- Una migración que empieza borrándole a la gente lo que había configurado no se
-- distingue de un fallo.
--
-- `NULLS NOT DISTINCT` ES LO QUE HACE QUE ESO FUNCIONE, y merece decirse porque
-- es lo contrario de lo que Postgres hace por defecto. Sin esa cláusula, dos
-- filas con `workspace_id` nulo del mismo usuario serían distintas para el índice
-- —NULL nunca es igual a NULL— y una persona podría acabar con catorce paneles
-- de partida sin que nada se quejara. Con ella, el de partida es único, que es lo
-- que significa «el de por defecto».
--
-- `ON DELETE CASCADE` HACIA EL ESPACIO: borrado el espacio, el panel que alguien
-- se montó para él no es más que basura apuntando a un sitio que no existe.
--
-- LA POLÍTICA NO CAMBIA, Y HAY QUE VER POR QUÉ NO. La de 0019 es «tu fila, y solo
-- la tuya», sin `organization_id` de por medio. Sigue valiendo: aquí solo se
-- guardan identificadores de widget y coordenadas, nunca contenido. Quien perdiera
-- el acceso a un espacio conservaría su fila —y no le enseñaría nada—, porque cada
-- widget pide sus datos por su cuenta y esos sí pasan por las políticas de lo que
-- pinta. Un panel es una preferencia, no una llave.
--
-- LO QUE NO SE TOCA: `widgets` sigue siendo qué está puesto, `layout` dónde va
-- cada uno, y el catálogo de widgets sigue viviendo en el código del cliente.
-- Añadir uno nuevo no pide migración, que era la decisión de 0019 y sigue siendo
-- la correcta — sobre todo ahora, que el catálogo va a crecer de golpe.
-- =============================================================================

-- La clave primaria era `user_id` a secas, así que hay que soltarla antes de que
-- pueda haber más de una fila por persona.
alter table public.user_dashboard_prefs
  drop constraint if exists user_dashboard_prefs_pkey;

alter table public.user_dashboard_prefs
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists workspace_id uuid
    references public.workspaces(id) on delete cascade;

do $$ begin
  alter table public.user_dashboard_prefs add primary key (id);
exception when invalid_table_definition then null;
end $$;

-- Uno por persona y espacio, y **uno solo** de partida (ver la cabecera: sin
-- `nulls not distinct` los de partida se multiplicarían en silencio).
create unique index if not exists user_dashboard_prefs_suyo_idx
  on public.user_dashboard_prefs (user_id, workspace_id) nulls not distinct;

comment on column public.user_dashboard_prefs.workspace_id is
  'En qué espacio vale este panel. NULL es el de partida: se usa donde no haya '
  'uno propio. Es lo que permitió juntar el Panel (0019) con la Mesa (0025) sin '
  'que nadie perdiera lo que tenía configurado.';

/**
 * El panel que toca en un espacio: el suyo si lo hay, si no el de partida.
 *
 * VIVE EN LA BASE Y NO EN EL CLIENTE porque la regla de «el suyo, si no el de
 * partida» tiene que ser la misma en todas partes. Escrita en el cliente estaría
 * repetida en cada sitio que lea un panel —la web, y mañana lo que venga— y la
 * segunda copia es la que se queda atrás: el síntoma sería que la misma persona
 * ve un panel distinto según por dónde entre, y eso no se parece a un fallo.
 *
 * `STABLE` y no `SECURITY DEFINER`: aquí no hace falta saltarse nada. Corre con
 * las políticas de quien llama, que ya dicen «tu fila y solo la tuya».
 */
create or replace function public.panel_de(_workspace uuid)
returns table (
  id           uuid,
  workspace_id uuid,
  widgets      jsonb,
  layout       jsonb,
  spotify_mode text,
  -- Para que la pantalla pueda decir «estás viendo tu panel de siempre» en vez
  -- de dejar creer que este espacio ya tiene el suyo configurado.
  es_de_partida boolean
)
language sql
stable
set search_path = public
as $$
  select p.id, p.workspace_id, p.widgets, p.layout, p.spotify_mode,
         p.workspace_id is null
    from public.user_dashboard_prefs p
   where p.user_id = public.current_user_id()
     and (p.workspace_id = _workspace or p.workspace_id is null)
   -- El propio primero: `order by` con `nulls last` es lo que hace que el de
   -- partida solo gane cuando no hay otro.
   order by p.workspace_id nulls last
   limit 1;
$$;
