-- =============================================================================
-- DevUP · 0043 · `puede_ver_nodo`, y la tabla de enlaces que depende de ella
--
-- ESTO ES LA CONDICIÓN PARA QUE EL GRAFO NO SEA UNA FUGA, y por eso va ANTES de
-- tejer nada. Diseño en docs/DISENO-GRAFO-DEL-PROYECTO.md §5.
--
-- POR QUÉ UN ENLACE NO SE PROTEGE COMO UNA FILA NORMAL. Una fila se protege
-- preguntando si quien mira pertenece a la organización. Un enlace toca DOS
-- extremos, y quien puede ver uno puede no poder ver el otro. Un enlace entre
-- un mensaje de un canal privado y una tarea lo vería cualquiera con acceso al
-- tablero — y con él, LA EXISTENCIA DE ESE CANAL. No es hipotético: es la misma
-- fuga que el producto ya se cuidó de evitar en las menciones, donde está
-- escrito que avisar a quien no está en el canal «revelaría que ese canal
-- existe, que es media filtración».
--
-- POR QUÉ LA FUNCIÓN Y LA TABLA VAN EN LA MISMA MIGRACIÓN. Crear la tabla antes
-- y protegerla después deja una ventana en la que los enlaces existen sin
-- política. Y con RLS encendido y sin política, la tabla devuelve cero filas
-- SIN DAR ERROR: la ventana no se nota hasta que se cierra mal.
--
-- LO QUE NO SE RECONOCE, NO SE VE. `puede_ver_nodo` devuelve `false` —nunca
-- NULL— para cualquier tipo que no sepa despachar. Es lo contrario de lo
-- cómodo: obliga a tocar esta función el día que se añada un tipo de nodo. Es
-- deliberado, y la migración 0042 explica por qué importa tanto: un guardián
-- que devuelve NULL en vez de `false` no bloquea nada dentro de un `if not`, y
-- así fue como cualquiera podía invitarse a una organización ajena.
--
-- NO HAY POLÍTICA DE UPDATE. Un enlace es un hecho: dice que esto y aquello
-- están relacionados. Cambiarle un extremo no es editarlo, es otro enlace — y
-- dejarlo editable permitiría mover un extremo a algo que quien edita no puede
-- ver, saltándose la comprobación de arriba por la puerta de atrás.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'graph_node_kind') then
    create type public.graph_node_kind as enum (
      'espacio', 'canal', 'mensaje', 'tarea', 'archivo', 'componente', 'repositorio', 'entorno'
    );
  end if;
end$$;

-- --- Quién puede ver qué -----------------------------------------------------

create or replace function public.puede_ver_nodo(_tipo public.graph_node_kind, _id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Cada tipo pregunta por su propia frontera, y todas acaban en las funciones
  -- que ya deciden el acceso en el resto del producto. Repetir aquí la regla a
  -- mano sería la segunda copia que acaba divergiendo.
  --
  -- `coalesce(..., false)` envolviendo TODO: un id que no existe hace que el
  -- `select` no devuelva fila, y eso es NULL. NULL aquí significaría «no se
  -- sabe», que dentro de una política se lee como «no», pero dentro de un
  -- `if not` se lee como «adelante». Ver 0042.
  select coalesce(
    case _tipo
      when 'espacio' then public.can_access_workspace(_id)
      when 'canal'   then public.can_access_channel(_id)
      when 'mensaje' then (
        select public.can_access_channel(m.channel_id) from public.messages m where m.id = _id
      )
      when 'tarea' then (
        select public.can_access_workspace(t.workspace_id) from public.tasks t where t.id = _id
      )
      when 'archivo' then (
        select public.can_access_workspace(f.workspace_id) from public.files f where f.id = _id
      )
      when 'componente' then (
        select public.can_access_workspace(n.workspace_id)
          from public.architecture_nodes n where n.id = _id
      )
      when 'repositorio' then (
        select public.can_access_workspace(r.workspace_id)
          from public.github_repos r where r.id = _id
      )
      when 'entorno' then (
        select public.can_access_workspace(e.workspace_id)
          from public.environments e where e.id = _id
      )
      -- Sin `else`: un tipo nuevo cae aquí, el `case` da NULL y el `coalesce`
      -- lo convierte en `false`. Un nodo que nadie enseñó a comprobar no se ve.
    end,
    false
  );
$$;

-- --- Los enlaces -------------------------------------------------------------

create table if not exists public.graph_links (
  id           uuid primary key default gen_random_uuid(),
  source_kind  public.graph_node_kind not null,
  source_id    uuid not null,
  target_kind  public.graph_node_kind not null,
  target_id    uuid not null,
  -- Qué relación es: «menciona», «cierra», «despliega». Libre, como en el
  -- diagrama de arquitectura: el vocabulario de cada equipo es suyo.
  label        text not null default '' check (length(label) <= 60),
  -- De dónde salió, con el mismo vocabulario que el registro de actividad: los
  -- enlaces son un índice que se recalcula desde los hechos, y hay que poder
  -- distinguir los que tejió una regla de los que puso una persona.
  source       public.activity_source not null default 'regla',
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (not (source_kind = target_kind and source_id = target_id)),
  unique (source_kind, source_id, target_kind, target_id, label)
);

create index if not exists graph_links_source_idx on public.graph_links (source_kind, source_id);
create index if not exists graph_links_target_idx on public.graph_links (target_kind, target_id);

alter table public.graph_links enable row level security;

-- LOS DOS EXTREMOS, y no la organización. Es toda la decisión de esta
-- migración: basta con no poder ver UNO de los dos para que el enlace no
-- exista para quien mira — y con él, tampoco la pista de que el otro extremo
-- existe.

drop policy if exists graph_links_select on public.graph_links;
create policy graph_links_select on public.graph_links for select
  using (
    public.puede_ver_nodo(source_kind, source_id)
    and public.puede_ver_nodo(target_kind, target_id)
  );

-- Y para escribir, lo mismo: nadie teje un enlace hacia algo que no ve. Si no,
-- se podría averiguar si una fila existe probando a enlazarla y mirando si la
-- escritura pasa.
drop policy if exists graph_links_insert on public.graph_links;
create policy graph_links_insert on public.graph_links for insert
  with check (
    public.puede_ver_nodo(source_kind, source_id)
    and public.puede_ver_nodo(target_kind, target_id)
  );

drop policy if exists graph_links_delete on public.graph_links;
create policy graph_links_delete on public.graph_links for delete
  using (
    public.puede_ver_nodo(source_kind, source_id)
    and public.puede_ver_nodo(target_kind, target_id)
  );

-- No hay política de UPDATE, y es deliberado. Ver la cabecera.
