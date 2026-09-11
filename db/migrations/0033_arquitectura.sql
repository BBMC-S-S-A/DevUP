-- =============================================================================
-- DevUP · 0033 · Diagrama de arquitectura
--
-- Lo que Infraestructura no tenía: un sitio para DIBUJAR la arquitectura, no
-- solo ver despliegues. Un nodo por componente —servicio, base de datos,
-- cola— y un enlace por relación entre dos. Traer una arquitectura ya escrita
-- en Terraform queda para después; esto es la pieza a mano: crear un nodo,
-- conectarlo, moverlo por el lienzo.
--
-- DOS TABLAS Y NO UNA POR TIPO DE COMPONENTE. Un servicio, una base de datos y
-- una cola no necesitan columnas distintas: todas son «una caja con nombre y
-- un tipo», y lo único que cambia es el icono con el que se pintan. Cuando
-- llegue la importación de Terraform, sus recursos entran por la misma tabla
-- en vez de abrir una nueva.
--
-- ES DEL EQUIPO, NO DE QUIEN LO DIBUJÓ. Mismo criterio que el tablero: no hace
-- falta ser admin para añadir, mover o borrar un nodo. Un diagrama que solo
-- puede tocar quien administra la organización deja de reflejar la realidad
-- en cuanto esa persona está de vacaciones.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'architecture_node_kind') then
    create type public.architecture_node_kind as enum (
      'servicio', 'base_datos', 'cola', 'cache', 'almacenamiento', 'api_externa', 'otro'
    );
  end if;
end$$;

create table if not exists public.architecture_nodes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind            public.architecture_node_kind not null default 'servicio',
  name            text not null check (length(btrim(name)) between 1 and 60),
  description     text not null default '',
  -- Posición en el lienzo. Reales y no enteros: el arrastre libre genera
  -- decimales todo el rato, y redondear en cada movimiento no aporta nada.
  pos_x           real not null default 0,
  pos_y           real not null default 0,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists architecture_nodes_org_idx on public.architecture_nodes (organization_id);

create table if not exists public.architecture_links (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid not null references public.architecture_nodes(id) on delete cascade,
  target_id   uuid not null references public.architecture_nodes(id) on delete cascade,
  -- Cómo se relacionan: «llama a», «lee de», «publica en»… Libre porque el
  -- vocabulario de cada equipo es suyo, no nuestro.
  label       text not null default '' check (length(label) <= 60),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (source_id <> target_id),
  unique (source_id, target_id, label)
);

create index if not exists architecture_links_source_idx on public.architecture_links (source_id);
create index if not exists architecture_links_target_idx on public.architecture_links (target_id);

create or replace function public.touch_architecture_node()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists architecture_nodes_touch on public.architecture_nodes;
create trigger architecture_nodes_touch before update on public.architecture_nodes
  for each row execute function public.touch_architecture_node();

alter table public.architecture_nodes enable row level security;
alter table public.architecture_links enable row level security;

-- --- Nodos -------------------------------------------------------------------

drop policy if exists architecture_nodes_select on public.architecture_nodes;
create policy architecture_nodes_select on public.architecture_nodes for select
  using (public.is_org_member(organization_id));

drop policy if exists architecture_nodes_insert on public.architecture_nodes;
create policy architecture_nodes_insert on public.architecture_nodes for insert
  with check (public.is_org_member(organization_id));

drop policy if exists architecture_nodes_update on public.architecture_nodes;
create policy architecture_nodes_update on public.architecture_nodes for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists architecture_nodes_delete on public.architecture_nodes;
create policy architecture_nodes_delete on public.architecture_nodes for delete
  using (public.is_org_member(organization_id));

-- --- Enlaces -------------------------------------------------------------------
-- No guardan su propia organization_id: la sacan de sus nodos, que ya la
-- tienen. Duplicarla sería otra columna que puede desincronizarse si un nodo
-- cambiara de organización, cosa que hoy no ocurre pero que RLS no debería dar
-- por supuesta.

drop policy if exists architecture_links_select on public.architecture_links;
create policy architecture_links_select on public.architecture_links for select
  using (
    exists (
      select 1 from public.architecture_nodes n
       where n.id = source_id and public.is_org_member(n.organization_id)
    )
  );

drop policy if exists architecture_links_insert on public.architecture_links;
create policy architecture_links_insert on public.architecture_links for insert
  with check (
    exists (
      select 1
        from public.architecture_nodes s
        join public.architecture_nodes t on t.organization_id = s.organization_id
       where s.id = source_id and t.id = target_id and public.is_org_member(s.organization_id)
    )
  );

drop policy if exists architecture_links_delete on public.architecture_links;
create policy architecture_links_delete on public.architecture_links for delete
  using (
    exists (
      select 1 from public.architecture_nodes n
       where n.id = source_id and public.is_org_member(n.organization_id)
    )
  );
