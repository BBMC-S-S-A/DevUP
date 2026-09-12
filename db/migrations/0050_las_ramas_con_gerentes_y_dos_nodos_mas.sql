-- =============================================================================
-- DevUP · 0050 · Las ramas con gerentes, y dos nodos más en el grafo
--
-- TRES DECISIONES DE PRODUCTO, TOMADAS. Vienen de una conversación sobre qué es
-- una categoría, y las tres desmontan supuestos que estaban escritos en el
-- código:
--
--   1. Una categoría **es una rama de trabajo** —frontend, backend,
--      infraestructura— y una tarea vive en **una sola**. Si viviera en dos,
--      «cómo va frontend» contaría la misma tarea dos veces y la vista del
--      espacio entero dejaría de sumar.
--
--   2. Quien lleva una rama es su **gerente**: responde de que funcione y
--      **reparte**. No carga con las tareas por defecto — de hecho su trabajo
--      es delegarlas. Y pueden ser **varios**, porque una persona sola se va de
--      vacaciones y la rama se queda sin nadie que responda.
--
--   3. En el grafo faltaban dos tipos de nodo: **área** y **persona**.
--
-- ─────────────────────────────────────────────────────────────────────────────
--
-- LO QUE ESTO CORRIGE, Y NO ES UN MATIZ. La 0044 dejó `owner_id` como
-- **delegado por defecto**: archivar una tarea en un área se la asignaba a esa
-- persona. Con el modelo de arriba eso está al revés — le asigna todo justo a
-- quien tiene que repartirlo. Un gerente con cuarenta tareas a su nombre no
-- puede distinguir las suyas de las que le cayeron, que es exactamente lo que
-- necesita ver para repartir.
--
-- PERO LA 0044 TENÍA RAZÓN EN ALGO y no se tira: que nada se quede sin dueño en
-- silencio. La respuesta no es asignar, es **hacer visible el reparto**. Una
-- tarea archivada en una rama y sin delegado no se asigna a nadie: aparece en la
-- lista de «por repartir» de esa rama, que es lo que el gerente abre. El gesto
-- pasa de implícito a explícito, y a nadie se le llena la bandeja sin haber
-- dicho que sí.
--
-- Y POR ESO SE RETIRA `tags.owner_id` (0040). Ahí vivía la otra mitad de esta
-- misma idea —el «jefe de rama»— sobre las etiquetas, que son de muchos a
-- muchos. Dos modelos del mismo concepto es lo que hace que archivar signifique
-- una cosa o la contraria según por dónde se entre. Las etiquetas vuelven a ser
-- lo que sirven bien: cruzar («urgente», «deuda», «diseño»).
--
-- SE MIGRA LO QUE HUBIERA ANTES DE QUITARLO. Un `owner_id` puesto a mano en una
-- etiqueta es una afirmación de alguien sobre quién lleva algo, y borrarla sin
-- mirar sería perder trabajo de una persona para arreglar un problema nuestro.
-- =============================================================================

-- --- 1. Los gerentes de una rama, que pueden ser varios ----------------------

create table if not exists public.task_category_owners (
  category_id uuid not null references public.task_categories(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (category_id, user_id)
);

create index if not exists task_category_owners_user_idx
  on public.task_category_owners (user_id);

comment on table public.task_category_owners is
  'Quién responde por una rama de trabajo. VARIOS a propósito: con uno solo, '
  'unas vacaciones dejan la rama sin nadie. Un gerente REPARTE y también puede '
  'hacer tareas; lo que NO hace es cargar con ellas por defecto. Para eso está '
  'tasks.assignee_id, que es otra cosa: quien la tiene que hacer.';

-- Quién la ve y quién la escribe.
--
-- LEER: quien llega al espacio de esa rama. Saber quién responde de qué es
-- información de equipo, no un secreto — y quien no llega al espacio no ve ni
-- la rama, así que tampoco sus gerentes.
--
-- ESCRIBIR: quien puede gestionar el espacio. Nombrar a quien responde de un
-- área es repartir poder, no clasificar, y por eso no basta con pertenecer.
-- La función de abajo es `security definer` y comprueba lo mismo; estas
-- políticas son lo que impide que se escriba por otra puerta.
alter table public.task_category_owners enable row level security;

drop policy if exists task_category_owners_select on public.task_category_owners;
create policy task_category_owners_select on public.task_category_owners for select
  using (
    public.can_access_workspace(
      (select c.workspace_id from public.task_categories c where c.id = category_id)
    )
  );

drop policy if exists task_category_owners_write on public.task_category_owners;
create policy task_category_owners_write on public.task_category_owners for all
  using (
    public.can_manage_workspace(
      (select c.workspace_id from public.task_categories c where c.id = category_id)
    )
  )
  with check (
    public.can_manage_workspace(
      (select c.workspace_id from public.task_categories c where c.id = category_id)
    )
  );

-- Lo que ya hubiera en la columna de uno solo pasa a ser el primer gerente.
insert into public.task_category_owners (category_id, user_id)
select id, owner_id from public.task_categories where owner_id is not null
on conflict do nothing;

-- Y lo que se puso sobre etiquetas (0040) se lleva a la rama del mismo nombre,
-- si la hay. Si no la hay no se inventa ninguna: se pierde el dato antes que
-- crear una rama que nadie pidió.
insert into public.task_category_owners (category_id, user_id)
select c.id, t.owner_id
  from public.tags t
  join public.task_categories c on lower(btrim(c.name)) = lower(btrim(t.name))
  join public.workspaces w on w.id = c.workspace_id
 where t.owner_id is not null
   and w.organization_id = t.organization_id
on conflict do nothing;

-- La columna vieja se queda por ahora: quitarla rompería a quien la lea todavía.
-- Lo que sí se hace es dejar dicho que ya no manda.
comment on column public.task_categories.owner_id is
  'OBSOLETA desde 0050: los gerentes viven en task_category_owners, y pueden '
  'ser varios. Ya no se usa para asignar — archivar en una rama NO asigna a '
  'nadie; lo que no tiene delegado aparece en «por repartir». Se mantiene solo '
  'para no romper lo que aún la lea; no escribir aquí.';

comment on column public.tags.owner_id is
  'OBSOLETA desde 0050. El «jefe de rama» se movió a task_category_owners, '
  'porque una rama es una categoría (de uno a muchos) y no una etiqueta (de '
  'muchos a muchos). Las etiquetas vuelven a servir para cruzar.';

/**
 * Poner y quitar gerentes.
 *
 * `security definer` con la comprobación dentro, por lo mismo de siempre: la
 * regla de quién puede vive en un sitio. Y la comprobación es que quien llama
 * pueda **gestionar el espacio** de esa rama, no solo verlo — nombrar a quien
 * responde de un área es repartir poder, no clasificar.
 *
 * NO SE COMPRUEBA QUE EL GERENTE SEA DEL ESPACIO con una clave foránea, porque
 * una clave foránea solo puede mirar `users`, que no sabe de espacios. Se
 * comprueba aquí, que es donde se puede.
 */
create or replace function public.set_category_owner(
  _category uuid,
  _user     uuid,
  _es_gerente boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _ws uuid;
begin
  select workspace_id into _ws from public.task_categories where id = _category;

  -- La misma respuesta para «no existe» y «no es tuya»: separarlas dejaría
  -- probar identificadores hasta averiguar qué ramas tiene otra organización.
  if _ws is null or not public.can_manage_workspace(_ws) then
    raise exception 'esa rama no existe o no está a tu alcance' using errcode = '42501';
  end if;

  if _es_gerente then
    -- Que la persona tenga acceso al espacio se comprueba AQUÍ y a mano, y no
    -- con `can_access_workspace`: esa función mira a quien llama, no a un
    -- tercero, y no existe una variante que acepte otro usuario. Inventarla
    -- solo para esto sería una función más que mantener alineada con la de
    -- verdad. La condición es la misma de 0027, reducida a lo que aplica:
    -- pertenecer a la organización, y llegar al espacio.
    if not exists (
      select 1
        from public.workspaces w
        join public.organization_members m
          on m.organization_id = w.organization_id and m.user_id = _user
       where w.id = _ws
         and (
           w.created_by = _user
           or m.role in ('owner', 'admin')
           or (
             w.visibility = 'shared'
             and (
               m.all_workspaces
               or exists (
                 select 1 from public.workspace_members wm
                  where wm.workspace_id = w.id and wm.user_id = _user
               )
             )
           )
         )
    ) then
      raise exception 'esa persona no tiene acceso a este espacio' using errcode = '23503';
    end if;
    insert into public.task_category_owners (category_id, user_id)
    values (_category, _user)
    on conflict do nothing;
  else
    delete from public.task_category_owners
     where category_id = _category and user_id = _user;
  end if;
end;
$$;

-- --- 2. Área y persona, como nodos del grafo ---------------------------------
--
-- SIN `area` NO SE PUEDE LEER UNA RAMA DESDE EL GRAFO, solo desde el tablero.
-- Y la pregunta que se quiere contestar —«qué cuelga de frontend, y por qué se
-- hizo así»— es de grafo, no de tablero.
--
-- SIN `persona` EL GRAFO NO SABE DE QUIÉN ES NADA. «De qué sabe Carlos» hoy no
-- se puede preguntar: se puede contar sus tareas, que dice otra cosa —dice qué
-- le tocó, no qué domina—.

-- SE AÑADEN AQUÍ Y SE USAN EN LA 0051, Y NO ES UN CAPRICHO DE ORDEN. Postgres
-- no deja usar un valor de enum en la misma transacción en la que se añadió, y
-- el runner envuelve cada migración en una. Meter aquí también el `case` de
-- `puede_ver_nodo` que los nombra haría fallar la migración con un error que no
-- se parece en nada a la causa.
alter type public.graph_node_kind add value if not exists 'area';
alter type public.graph_node_kind add value if not exists 'persona';
