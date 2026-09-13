-- =============================================================================
-- DevUP · 0061 · Una oficina ocupa el sitio que quedó libre
--
-- QUÉ SE ROMPÍA, Y ES DE LOS FALLOS QUE SE VEN: al borrar un canal, su zona
-- desaparece en cascada y la SIGUIENTE oficina se dibujaba ENCIMA de otra.
--
-- El porqué, exacto. `ensure_world_room` usaba el número de zonas ya colocadas
-- como el índice del siguiente sitio:
--
--     select count(*) into _placed from world_zones where room_id = _room;
--     _col := _placed % _per_row;  _row := _placed / _per_row;
--
-- Con cuatro canales hay zonas en los sitios 0, 1, 2 y 3. Se borra el del sitio
-- 1 y el contador baja a tres, así que la siguiente oficina se coloca en el
-- sitio 3 — que ya está ocupado. Dos salas en las mismas coordenadas, con sus
-- muros y sus muebles pisándose.
--
-- Y el hueco del medio no lo ocupaba nadie: quedaba un solar vacío en la planta
-- mientras las nuevas se apilaban al final.
--
-- CÓMO SE ARREGLA. Las posiciones dejan de deducirse de un contador y pasan a
-- calcularse de la lista ordenada de canales: la primera oficina va al sitio 0,
-- la segunda al 1, y así. Al borrar un canal, las de después se corren una
-- posición y el solar se cierra solo — que es justo lo que espera quien borra un
-- canal y mira la planta.
--
-- POR QUÉ ES SEGURO MOVER UNA ZONA. Los muebles se guardan en coordenadas
-- RELATIVAS al origen de su sala (ver el comentario de `world_zones.props` en la
-- 0007), así que una sala amueblada se lleva sus muebles al cambiarse de sitio.
-- Si se guardaran en coordenadas de la planta, esto no se podría hacer.
--
-- LA PALETA DEJA DE DEPENDER DEL SITIO, y es la otra mitad del mismo error.
-- Antes salía de `_placed % 8`, o sea del contador: al recolocar la planta
-- cambiaría el color de las salas de al lado cada vez que alguien borrara un
-- canal, y una sala que cambia de color porque otra desapareció no se lee como
-- orden — se lee como un fallo. Ahora sale de un byte del md5 del
-- identificador del canal: determinista, estable para siempre, y sin contar
-- nada.
--
-- Aditiva e idempotente: solo reemplaza una función. No toca ninguna fila de
-- datos y no cambia ningún esquema.
-- =============================================================================

create or replace function public.ensure_world_room(_workspace uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _room        uuid;
  _org         uuid;
  _channel     record;
  _zona        record;
  _indice      integer;
  -- Celda de 13×11 con sala de 11×9 dentro: dos casillas de pasillo entre
  -- salas, que es lo justo para cruzarse con alguien sin quedarse encajado.
  _cell_w      constant integer := 13;
  _cell_h      constant integer := 11;
  _zone_w      constant integer := 11;
  _zone_h      constant integer := 9;
  _per_row     constant integer := 4;
  _margin      constant integer := 2;
  _total       integer;
  _rows        integer;
begin
  select organization_id into _org from public.workspaces where id = _workspace;
  if _org is null then
    return null;
  end if;

  insert into public.world_rooms (workspace_id, organization_id)
  values (_workspace, _org)
  on conflict (workspace_id) do nothing;

  select id into _room from public.world_rooms where workspace_id = _workspace;

  -- 1 · Que cada canal tenga su zona. La posición da igual aquí: se recoloca
  --     todo a continuación, así que lo único que importa es que exista.
  for _channel in
    select c.id
      from public.channels c
     where c.workspace_id = _workspace
       and not exists (select 1 from public.world_zones z where z.channel_id = c.id)
     order by c.created_at, c.id
  loop
    insert into public.world_zones (room_id, channel_id, x, y, width, height, palette)
    values (
      _room,
      _channel.id,
      _margin,
      _margin,
      _zone_w,
      _zone_h,
      -- El color sale del IDENTIFICADOR del canal, no de su sitio en la planta
      -- ni de cuántos había antes. Así es estable para siempre: no cambia al
      -- borrar un canal ni al recolocar la planta, que es justo lo que hacía
      -- que una sala pareciera cambiar de color sin motivo.
      --
      -- Un byte del md5 y módulo ocho. Es determinista, no puede salir
      -- negativo, y no depende de contar nada — que es el error que esta
      -- migración viene a corregir en el otro sitio.
      get_byte(decode(md5(_channel.id::text), 'hex'), 0) % 8
    )
    on conflict (channel_id) do nothing;
  end loop;

  -- 2 · Recolocar TODAS las zonas de la planta, por orden de creación de su
  --     canal. Esto es lo que cierra los solares y, sobre todo, lo que impide
  --     que dos salas acaben en las mismas coordenadas.
  _indice := 0;
  for _zona in
    select z.id
      from public.world_zones z
      join public.channels c on c.id = z.channel_id
     where z.room_id = _room
     order by c.created_at, c.id
  loop
    update public.world_zones
       set x = _margin + (_indice % _per_row) * _cell_w,
           y = _margin + (_indice / _per_row) * _cell_h,
           width = _zone_w,
           height = _zone_h
     where id = _zona.id;
    _indice := _indice + 1;
  end loop;

  _total := _indice;
  _rows := greatest(1, ceil(_total::numeric / _per_row)::integer);
  update public.world_rooms
     set width      = greatest(32, _margin * 2 + _per_row * _cell_w),
         height     = greatest(24, _margin * 2 + _rows * _cell_h),
         updated_at = now()
   where id = _room;

  return _room;
end;
$$;
