-- =============================================================================
-- DevUP · 0010 · El editor de la oficina
--
-- Ver docs/LO-QUE-HAY-Y-LO-QUE-FALTA.md.
--
-- Hasta ahora el mobiliario se deducía del nombre del canal y no se guardaba:
-- «música» salía con piano y «desarrollo» con escritorios. Eso sigue siendo el
-- comportamiento por defecto y no se toca. Lo que se añade es la posibilidad
-- de apartarse de él.
--
-- LO QUE SE GUARDA ES LA DIFERENCIA, NO EL AMUEBLADO.
--
-- Es la decisión que hace que el editor se use más de una vez. Si abrir el
-- editor vaciara la sala —porque a partir de ese momento el mobiliario sale de
-- una tabla vacía— nadie lo abre dos veces. Por eso hay una marca explícita:
-- mientras `customized` sea falso, la sala se amuebla sola y esta tabla se
-- ignora. Al colocar la primera pieza, el cliente vuelca el amueblado deducido
-- como punto de partida y marca la sala.
--
-- Y por eso «restaurar» es borrar filas y bajar la marca, no recolocar nada.
-- Nunca se sobrescribe el defecto, así que nunca se puede perder.
--
-- COORDENADAS RELATIVAS A LA SALA, NO A LA PLANTA. Mover una sala tiene que
-- llevarse sus muebles dentro. Con coordenadas absolutas, redimensionar una
-- sala dejaría el sofá en mitad del pasillo — y redimensionar salas es
-- justamente lo siguiente que pide el editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- La marca, y el material de suelo
-- ---------------------------------------------------------------------------
alter table public.world_zones
  add column if not exists customized boolean not null default false;

-- Nulo significa «el que le toque por su tema». Guardar el material deducido
-- ataría la sala a la palabra que hoy tiene el canal en el nombre: renombrarlo
-- de «música» a «podcast» dejaría de redecorarla, que es justo lo bueno de
-- deducirlo.
alter table public.world_zones
  add column if not exists material smallint
    check (material is null or material between 0 and 7);

comment on column public.world_zones.customized is
  'Si alguien ha editado esta sala. En falso, el mobiliario se deduce del '
  'nombre del canal y world_props se ignora por completo.';

-- ---------------------------------------------------------------------------
-- Los muebles colocados
-- ---------------------------------------------------------------------------
create table if not exists public.world_props (
  id      uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.world_zones(id) on delete cascade,
  -- El catálogo vive en el cliente, que es quien sabe dibujarlo. Aquí solo se
  -- guarda cuál eligió. Texto y no un enum: añadir un mueble no debería ser
  -- una migración, y un `kind` desconocido el cliente lo ignora sin romperse.
  kind    text not null check (length(kind) between 1 and 40),
  -- Relativas al origen de la sala. Ver la cabecera.
  x       integer not null check (x between 0 and 40),
  y       integer not null check (y between 0 and 40),
  facing  text not null default 's' check (facing in ('n','s','e','o')),
  tone    smallint not null default 0 check (tone between 0 and 63),
  created_at timestamptz not null default now()
);

create index if not exists world_props_zone_idx on public.world_props (zone_id);

-- ---------------------------------------------------------------------------
-- Guardado por lotes
--
-- Un editor manda la sala entera, no un mueble. Arrastrar un sofá por la
-- pantalla son decenas de posiciones intermedias y ninguna interesa: lo que
-- se guarda es dónde acabó.
--
-- Reemplaza el contenido de la sala en una sola transacción. Que sea
-- reemplazo y no diferencia es deliberado: calcular la diferencia en el
-- cliente y aplicarla aquí abre la puerta a que dos personas editando a la vez
-- dejen la sala en un estado que ninguna de las dos pidió. Con reemplazo, la
-- última en guardar gana entera — que es fácil de explicar y fácil de
-- deshacer.
--
-- SECURITY INVOKER a propósito: las políticas de abajo deciden quién puede.
-- ---------------------------------------------------------------------------
create or replace function public.save_world_props(_zone uuid, _props jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  _n integer;
begin
  -- Si RLS no deja ver la zona, esto no encuentra nada y el guardado no hace
  -- nada. No hace falta comprobación explícita: la ausencia de la fila ya es
  -- la denegación.
  if not exists (select 1 from public.world_zones where id = _zone) then
    raise exception 'zona no encontrada' using errcode = 'P0002';
  end if;

  delete from public.world_props where zone_id = _zone;

  insert into public.world_props (zone_id, kind, x, y, facing, tone)
  select _zone,
         p->>'kind',
         (p->>'x')::integer,
         (p->>'y')::integer,
         coalesce(p->>'facing', 's'),
         coalesce((p->>'tone')::smallint, 0::smallint)
    from jsonb_array_elements(_props) as p;

  get diagnostics _n = row_count;

  update public.world_zones set customized = true where id = _zone;

  return _n;
end;
$$;

-- Volver al amueblado deducido. Borra y baja la marca; no recoloca nada,
-- porque el defecto nunca se llegó a sobrescribir.
create or replace function public.reset_world_zone(_zone uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.world_zones where id = _zone) then
    raise exception 'zona no encontrada' using errcode = 'P0002';
  end if;

  delete from public.world_props where zone_id = _zone;
  update public.world_zones
     set customized = false,
         material   = null
   where id = _zone;
end;
$$;

-- ---------------------------------------------------------------------------
-- Políticas
--
-- Decorar es social y reestructurar es administrativo. Colocar un sofá lo
-- puede hacer cualquiera que pertenezca al canal —es su sala— pero mover la
-- sala entera por la planta afecta a todo el mundo, y eso ya está restringido
-- en la política de UPDATE de world_zones que llegará con el redimensionado.
--
-- Todo cuelga de `can_access_channel` a través de la zona, no de
-- `can_access_workspace`: es la misma frontera que las zonas, por el mismo
-- motivo. Un mueble de una sala privada revela que esa sala existe.
-- ---------------------------------------------------------------------------
alter table public.world_props enable row level security;

drop policy if exists world_props_select on public.world_props;
create policy world_props_select on public.world_props for select
  using (
    exists (
      select 1 from public.world_zones z
       where z.id = world_props.zone_id
         and public.can_access_channel(z.channel_id)
    )
  );

drop policy if exists world_props_insert on public.world_props;
create policy world_props_insert on public.world_props for insert
  with check (
    exists (
      select 1 from public.world_zones z
       where z.id = world_props.zone_id
         and public.can_access_channel(z.channel_id)
    )
  );

drop policy if exists world_props_delete on public.world_props;
create policy world_props_delete on public.world_props for delete
  using (
    exists (
      select 1 from public.world_zones z
       where z.id = world_props.zone_id
         and public.can_access_channel(z.channel_id)
    )
  );

drop policy if exists world_props_update on public.world_props;
create policy world_props_update on public.world_props for update
  using (
    exists (
      select 1 from public.world_zones z
       where z.id = world_props.zone_id
         and public.can_access_channel(z.channel_id)
    )
  )
  with check (
    exists (
      select 1 from public.world_zones z
       where z.id = world_props.zone_id
         and public.can_access_channel(z.channel_id)
    )
  );
