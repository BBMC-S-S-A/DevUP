-- =============================================================================
-- DevUP · 0007 · La vista inmersiva: plantas, zonas y avatares
--
-- Ver docs/decisiones/0002-vistas-profesional-e-inmersiva.md.
--
-- La regla que gobierna todo este archivo, y de la que sale su forma:
--
--   EL MUNDO ES UNA PROYECCIÓN DE LO QUE YA EXISTE, NUNCA UNA FUENTE DE VERDAD.
--
-- Una zona no es un sitio nuevo donde hablar: es la representación de un canal
-- que ya está en `channels`. Por eso `world_zones.channel_id` es NOT NULL y
-- cae con el canal. Si alguna vez hiciera falta una zona sin canal, la
-- pregunta correcta no es «quito el NOT NULL» sino «¿qué ve quien usa la vista
-- profesional?» — y la respuesta es «nada», que es justo el fallo que esta
-- restricción impide.
--
-- Un mundo por workspace. Cada persona que crea su cuenta ya tiene el suyo, y
-- puede crear cuantos canales quiera; la planta se distribuye sola conforme
-- aparecen, porque un mapa dibujado a mano no sobrevive a que el usuario cree
-- el canal número trece.
--
-- CUIDADO CON LO MISMO DE SIEMPRE, QUE AQUÍ VUELVE DISFRAZADO. El mapa es una
-- lista de zonas y cada zona lleva el identificador y el nombre de su canal.
-- Componerlo mirando el workspace en vez de preguntar canal por canal filtra
-- los nombres de los canales privados a quien no pertenece a ellos: no podría
-- leer sus mensajes —RLS lo pararía— pero sabría que existen y cómo se llaman.
-- Eso ya es una fuga. La política de `world_zones` cuelga de
-- `can_access_channel`, no de `can_access_workspace`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Plantas
--
-- Una por workspace. El tamaño crece con el número de zonas y lo calcula
-- `ensure_world_room`; se guarda para que el cliente sepa cuánto lienzo pedir
-- antes de recibir las zonas.
-- ---------------------------------------------------------------------------
create table if not exists public.world_rooms (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  -- Denormalizado a propósito: la política de esta tabla lo necesita, y sin él
  -- cada comprobación tendría que saltar a `workspaces`.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  width        integer not null default 32 check (width between 16 and 200),
  height       integer not null default 24 check (height between 16 and 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists world_rooms_org_idx on public.world_rooms (organization_id);

-- ---------------------------------------------------------------------------
-- Zonas
--
-- Cada una proyecta exactamente un canal. `unique (channel_id)` impide que el
-- mismo canal aparezca dos veces en la planta, que es lo que pasaría si dos
-- personas pidieran el mapa a la vez y ambas dispararan la distribución.
--
-- Las coordenadas se guardan aunque hoy las calcule la máquina: el editor de
-- la fase 2 mueve zonas, y una distribución recalculada en cada lectura
-- movería la oficina bajo los pies de quien está dentro.
-- ---------------------------------------------------------------------------
create table if not exists public.world_zones (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.world_rooms(id) on delete cascade,
  channel_id uuid not null unique references public.channels(id) on delete cascade,
  x          integer not null check (x >= 0),
  y          integer not null check (y >= 0),
  width      integer not null check (width between 3 and 40),
  height     integer not null check (height between 3 and 40),
  -- Índice de paleta, no un color literal. El cliente decide qué tono le toca
  -- a cada uno; guardar `#5b8cff` aquí ataría la base de datos al tema de la
  -- interfaz, y el día que cambie la paleta habría que migrar filas.
  palette    smallint not null default 0 check (palette between 0 and 7),
  created_at timestamptz not null default now()
);

create index if not exists world_zones_room_idx on public.world_zones (room_id);

-- ---------------------------------------------------------------------------
-- Avatares
--
-- Uno por persona, no por workspace: tu personaje eres tú en todos los sitios
-- donde entras, igual que tu nombre visible.
--
-- Vive aparte de `profiles` por la misma razón por la que `users` y `profiles`
-- están separadas: son datos con distinta audiencia. Aquí no hay nada secreto,
-- pero sí hay una tabla que se va a escribir a menudo (probarse ropa) frente a
-- una que casi nunca cambia, y mezclarlas obligaría a que cada cambio de
-- camiseta tocara la fila que lee media aplicación.
--
-- Las piezas son índices de catálogo. El catálogo vive en el cliente, que es
-- quien sabe dibujarlo; la base solo guarda qué combinación eligió cada uno.
-- ---------------------------------------------------------------------------
create table if not exists public.world_avatars (
  user_id    uuid primary key references public.users(id) on delete cascade,
  body       smallint not null default 0 check (body between 0 and 63),
  hair       smallint not null default 0 check (hair between 0 and 63),
  top        smallint not null default 0 check (top between 0 and 63),
  bottom     smallint not null default 0 check (bottom between 0 and 63),
  -- Tono de piel y color de pelo y ropa, también por índice de paleta.
  skin_tone  smallint not null default 0 check (skin_tone between 0 and 15),
  hair_tone  smallint not null default 0 check (hair_tone between 0 and 15),
  top_tone   smallint not null default 0 check (top_tone between 0 and 15),
  bottom_tone smallint not null default 0 check (bottom_tone between 0 and 15),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Distribución automática de la planta
--
-- SECURITY DEFINER, y conviene entender por qué antes de tocarlo.
--
-- Para colocar una zona sin solaparse hay que ver TODAS las que ya hay,
-- incluidas las de canales privados a los que quien pide el mapa no pertenece.
-- Con RLS aplicándose aquí dentro, esa persona no vería la zona del canal
-- privado y colocaría la suya encima: dos salas en el mismo sitio, y cada uno
-- viendo una.
--
-- Que esta función lo vea todo NO abre ninguna puerta: no devuelve nada de lo
-- que ve. Lo que devuelve es el identificador de la planta, y la lectura de
-- las zonas vuelve a pasar por RLS como cualquier otra consulta. Es la misma
-- forma que ya tienen las funciones de pertenencia: saltar RLS en la consulta
-- interna, sin exponer su resultado.
--
-- Es idempotente: coloca solo los canales que aún no tienen zona. Se puede
-- llamar en cada lectura del mapa, y de hecho es lo que se hace — así un canal
-- creado hace diez segundos ya aparece en la planta sin ningún proceso de
-- fondo que lo vigile.
-- ---------------------------------------------------------------------------
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
  -- Cada sala ocupa 8×7 con un pasillo de 2 alrededor, y caben 4 por fila
  -- antes de bajar. Números elegidos para que una oficina de 4 canales quepa
  -- en una pantalla sin desplazamiento y una de 20 siga siendo recorrible.
  _cell_w      constant integer := 10;
  _cell_h      constant integer := 9;
  _zone_w      constant integer := 8;
  _zone_h      constant integer := 7;
  _per_row     constant integer := 4;
  _margin      constant integer := 2;
  _col         integer;
  _row         integer;
  _rows        integer;
begin
  -- Sin acceso al workspace no hay planta que preparar. La comprobación es
  -- explícita justamente porque SECURITY DEFINER desactiva la que haría RLS.
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

  -- Cuántas zonas hay ya colocadas. Es el índice donde empieza la siguiente, y
  -- por eso la distribución es estable: colocar la zona número 5 no mueve las
  -- cuatro anteriores.
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
      -- El tono lo decide la posición, no el azar: así la misma oficina se ve
      -- igual en dos navegadores y las zonas contiguas no salen del mismo
      -- color.
      _placed % 8
    )
    -- Dos peticiones simultáneas pueden entrar aquí a la vez con el mismo
    -- hueco calculado. La restricción única de `channel_id` hace que la
    -- segunda no duplique, y seguir adelante es correcto: el mapa que se
    -- devuelve se lee después de esto, ya con la fila que ganó.
    on conflict (channel_id) do nothing;

    _placed := _placed + 1;
  end loop;

  -- La planta crece con las zonas. `greatest` mantiene el mínimo de 32×24 para
  -- que una oficina de un solo canal no salga apretada contra los bordes.
  _rows := greatest(1, ceil(_placed::numeric / _per_row)::integer);
  update public.world_rooms
     set width      = greatest(32, _margin * 2 + _per_row * _cell_w),
         height     = greatest(24, _margin * 2 + _rows * _cell_h),
         updated_at = now()
   where id = _room;

  return _room;
end;
$$;

-- Se lee sola: qué avatar tiene alguien. Existe como función para que la
-- interfaz pueda pedir el de otra persona sin abrir una política de escritura
-- sobre la tabla entera.
create or replace function public.upsert_world_avatar(
  _body smallint, _hair smallint, _top smallint, _bottom smallint,
  _skin_tone smallint, _hair_tone smallint, _top_tone smallint, _bottom_tone smallint
)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.world_avatars (
    user_id, body, hair, top, bottom, skin_tone, hair_tone, top_tone, bottom_tone, updated_at
  )
  values (
    public.current_user_id(), _body, _hair, _top, _bottom,
    _skin_tone, _hair_tone, _top_tone, _bottom_tone, now()
  )
  on conflict (user_id) do update set
    body = excluded.body, hair = excluded.hair,
    top = excluded.top, bottom = excluded.bottom,
    skin_tone = excluded.skin_tone, hair_tone = excluded.hair_tone,
    top_tone = excluded.top_tone, bottom_tone = excluded.bottom_tone,
    updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
alter table public.world_rooms   enable row level security;
alter table public.world_zones   enable row level security;
alter table public.world_avatars enable row level security;

-- La planta se ve si se ve el workspace. Nada más: la planta en sí no dice
-- nada que el workspace no diga ya.
drop policy if exists world_rooms_select on public.world_rooms;
create policy world_rooms_select on public.world_rooms for select
  using (public.can_access_workspace(workspace_id));

-- Nadie inserta plantas a mano: `ensure_world_room` es SECURITY DEFINER y
-- comprueba el acceso él mismo. Sin política de insert, la tabla queda cerrada
-- a la aplicación, que es lo que se quiere.

-- LA POLÍTICA QUE IMPORTA. Cuelga del canal, no del workspace: una zona que
-- proyecta un canal privado no existe para quien no está dentro de ese canal.
-- Si algún día alguien la «simplifica» a can_access_workspace, los nombres de
-- todos los canales privados del workspace pasan a viajar en cada mapa.
drop policy if exists world_zones_select on public.world_zones;
create policy world_zones_select on public.world_zones for select
  using (public.can_access_channel(channel_id));

-- Mover una zona es editar la oficina: hace falta acceso al canal que
-- proyecta. La fase 2 estrechará esto a quien administre el workspace; hoy
-- basta con que no lo pueda hacer alguien de fuera.
drop policy if exists world_zones_update on public.world_zones;
create policy world_zones_update on public.world_zones for update
  using (public.can_access_channel(channel_id))
  with check (public.can_access_channel(channel_id));

-- El avatar de un compañero se ve —hay que dibujarlo— pero solo dentro de una
-- organización compartida. La condición es la misma que la de `profiles`: si
-- puedes ver su nombre, puedes ver su personaje.
drop policy if exists world_avatars_select on public.world_avatars;
create policy world_avatars_select on public.world_avatars for select
  using (
    user_id = public.current_user_id()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = public.current_user_id()
        and theirs.user_id = public.world_avatars.user_id
    )
  );

drop policy if exists world_avatars_write on public.world_avatars;
create policy world_avatars_write on public.world_avatars for insert
  with check (user_id = public.current_user_id());

drop policy if exists world_avatars_update on public.world_avatars;
create policy world_avatars_update on public.world_avatars for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- Nada de posiciones aquí.
--
-- Dónde está parado alguien es estado en vivo y se queda en memoria, en
-- `worldHub`. Se limpia solo cuando el socket se cierra —pestaña cerrada, red
-- caída, portátil dormido— y una tabla no hace eso. Es la misma decisión que
-- 0003 tomó para las llamadas, por el mismo motivo, y por eso `call_sessions`
-- es historial y no presencia.
-- ---------------------------------------------------------------------------
