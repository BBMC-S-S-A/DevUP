-- =============================================================================
-- DevUP · 0039 · Categorías de tareas
--
-- EL PROBLEMA ES DE CANTIDAD, NO DE FALTA DE SITIO. Un tablero con cuarenta
-- tarjetas en «Por hacer» no se lee: se hojea. Las columnas no lo arreglan
-- porque una columna es un ESTADO —por hacer, en curso, hecho— y lo que hace
-- falta es el otro eje, el del ÁREA: de qué trata esto y de quién es.
--
-- POR QUÉ NO SE HACE CON ETIQUETAS, QUE YA EXISTEN. Fue lo primero que miré, y
-- no vale, por dos motivos que importan:
--
--   · Una etiqueta es de muchos a muchos. Una tarea podría estar en dos áreas a
--     la vez, y entonces «las tareas de DevVerse» deja de ser una lista y pasa
--     a ser una opinión.
--   · Una etiqueta no tiene dueño. Y el dueño es justo lo que se pide: cada
--     área la lleva alguien.
--
-- Las etiquetas siguen sirviendo para lo suyo —«urgente», «diseño», «deuda»—,
-- que es cruzar varias cosas. Una categoría es otra cosa: es dónde vive la
-- tarea.
--
-- LO QUE HACE QUE ESTO SEA CÓMODO Y NO UN CAMPO MÁS QUE RELLENAR: la categoría
-- lleva su **delegado por defecto**. Crear una tarea en «DevVerse» la asigna a
-- quien lleva DevVerse sin que nadie elija a nadie. Eso cambia el gesto: se deja
-- de asignar tareas y se pasa a archivarlas, y el reparto sale solo. Un campo
-- que además decide algo se rellena; uno que solo clasifica, se olvida.
--
-- POR ESPACIO Y NO POR ORGANIZACIÓN. Las columnas son por espacio y esto es su
-- otro eje, así que comparten grano: un tablero se explica solo. Y en una
-- empresa que lleva varios clientes, las áreas del cliente A no tienen por qué
-- aparecer en el tablero del cliente B. El coste es repetir las áreas cuando de
-- verdad son las mismas en dos espacios; se asume, porque lo contrario —una
-- taxonomía única para toda la empresa— no se puede deshacer después.
--
-- BORRAR UNA CATEGORÍA NO BORRA SUS TAREAS (`on delete set null`). Es lo
-- contrario de lo que hacen las columnas, y a propósito: una tarea sin columna
-- no se puede dibujar, pero una tarea sin categoría se dibuja perfectamente —
-- simplemente no está clasificada. Que reorganizar las áreas pueda llevarse por
-- delante trabajo escrito sería una trampa esperando.
-- =============================================================================

create table if not exists public.task_categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 40),

  -- Índice de paleta, no color literal: igual que las zonas del mundo. El tono
  -- concreto lo decide el cliente, así que cambiar la paleta no obliga a una
  -- migración de datos.
  color        smallint not null default 0 check (color between 0 and 15),

  -- El delegado por defecto. Nulo = el área no tiene dueño todavía, que es un
  -- estado legítimo y no un error: se crea el área y se decide después.
  owner_id     uuid references public.users(id) on delete set null,

  position     double precision not null default 0,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  -- Dos áreas con el mismo nombre en el mismo tablero es siempre un error de
  -- dedo, nunca una intención.
  unique (workspace_id, name)
);

create index if not exists task_categories_workspace_idx
  on public.task_categories (workspace_id, position);

alter table public.tasks
  add column if not exists category_id uuid
    references public.task_categories(id) on delete set null;

-- Parcial: la pregunta que se hace es «las de esta categoría», nunca «las que
-- no tienen ninguna».
create index if not exists tasks_category_idx
  on public.tasks (category_id)
  where category_id is not null;

alter table public.task_categories enable row level security;

-- Ver las áreas de un tablero es ver el tablero. Crearlas y cambiarlas, en
-- cambio, es organizarlo: `can_manage_workspace`, igual que las columnas — y
-- por el mismo motivo, que reorganizar el trabajo de otros no es algo que deba
-- poder hacer cualquiera que pase por allí.
drop policy if exists task_categories_select on public.task_categories;
create policy task_categories_select on public.task_categories for select
  using (public.can_access_workspace(workspace_id));

drop policy if exists task_categories_insert on public.task_categories;
create policy task_categories_insert on public.task_categories for insert
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists task_categories_update on public.task_categories;
create policy task_categories_update on public.task_categories for update
  using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists task_categories_delete on public.task_categories;
create policy task_categories_delete on public.task_categories for delete
  using (public.can_manage_workspace(workspace_id));

-- --- La trampa que RLS no puede cerrar ---------------------------------------
-- Una categoría de OTRO espacio al que la persona también tiene acceso pasaría
-- las políticas de arriba sin problema: las dos son visibles para ella. Lo que
-- no puede es dejar que una tarea del espacio A quede clasificada en un área
-- del espacio B — el tablero enseñaría una categoría que no es suya, y filtrar
-- por ella devolvería tareas de otro sitio.
--
-- Es el mismo caso que `asistente.ts` ya tiene con las columnas, y allí se
-- resuelve en el código. Aquí se resuelve en la base, porque una restricción
-- que vive en un `if` de una ruta se pierde en cuanto aparece la segunda ruta
-- que escribe lo mismo.
create or replace function public.check_task_category()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is not null
     and not exists (
       select 1 from public.task_categories c
        where c.id = new.category_id and c.workspace_id = new.workspace_id
     )
  then
    raise exception 'la categoría no es de este espacio de trabajo';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_category_del_espacio on public.tasks;
create trigger tasks_category_del_espacio
  before insert or update of category_id, workspace_id on public.tasks
  for each row execute function public.check_task_category();
