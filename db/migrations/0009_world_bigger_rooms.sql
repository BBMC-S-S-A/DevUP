-- =============================================================================
-- DevUP · 0009 · Salas más grandes
--
-- 0007 colocaba salas de 8×7, que con muros dejan 6×5 de suelo útil. Suficiente
-- para caminar y demasiado poco para amueblar: un escritorio ocupa dos casillas
-- y una mesa de reunión casi tres, así que una sala de trabajo con tres puestos
-- se quedaba sin sitio para pasar por detrás de las sillas.
--
-- No se supo hasta dibujarlo. Es la clase de número que no se acierta sobre el
-- papel — la geometría del mobiliario es la que manda, y el mobiliario se
-- diseñó después.
--
-- Ahora 11×9 (9×7 de suelo) en celdas de 13×11.
--
-- SE BORRAN LAS ZONAS EXISTENTES A PROPÓSITO. Cambiar el tamaño sin re-colocar
-- dejaría las salas viejas solapándose con las nuevas, cada una con las
-- coordenadas de una distribución distinta. Borrarlas es seguro y barato: una
-- zona no guarda nada propio —es la proyección de un canal que sigue intacto—
-- y `ensure_world_room` las vuelve a crear en la siguiente lectura del mapa.
-- Cuando exista el editor de la fase 2 esto ya no será cierto, y entonces una
-- migración así tendrá que mover en vez de borrar.
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
  _placed      integer;
  _channel     record;
  -- Celda de 13×11 con sala de 11×9 dentro: dos casillas de pasillo entre
  -- salas, que es lo justo para cruzarse con alguien sin quedarse encajado.
  _cell_w      constant integer := 13;
  _cell_h      constant integer := 11;
  _zone_w      constant integer := 11;
  _zone_h      constant integer := 9;
  _per_row     constant integer := 4;
  _margin      constant integer := 2;
  _col         integer;
  _row         integer;
  _rows        integer;
begin
  if not public.can_access_workspace(_workspace) then
    raise exception 'sin acceso al workspace' using errcode = '42501';
  end if;

  select organization_id into _org from public.workspaces where id = _workspace;
  if _org is null then
    raise exception 'workspace inexistente' using errcode = 'P0002';
  end if;

  insert into public.world_rooms (workspace_id, organization_id)
  values (_workspace, _org)
  on conflict (workspace_id) do nothing;

  select id into _room from public.world_rooms where workspace_id = _workspace;

  select count(*) into _placed from public.world_zones where room_id = _room;

  for _channel in
    select c.id
      from public.channels c
     where c.workspace_id = _workspace
       and not exists (select 1 from public.world_zones z where z.channel_id = c.id)
     order by c.created_at, c.id
  loop
    _col := _placed % _per_row;
    _row := _placed / _per_row;

    insert into public.world_zones (room_id, channel_id, x, y, width, height, palette)
    values (
      _room,
      _channel.id,
      _margin + _col * _cell_w,
      _margin + _row * _cell_h,
      _zone_w,
      _zone_h,
      _placed % 8
    )
    on conflict (channel_id) do nothing;

    _placed := _placed + 1;
  end loop;

  _rows := greatest(1, ceil(_placed::numeric / _per_row)::integer);
  update public.world_rooms
     set width      = greatest(32, _margin * 2 + _per_row * _cell_w),
         height     = greatest(24, _margin * 2 + _rows * _cell_h),
         updated_at = now()
   where id = _room;

  return _room;
end;
$$;

-- Re-distribución única. Las salas se recrean con el tamaño nuevo la próxima
-- vez que alguien abra la oficina.
delete from public.world_zones;
