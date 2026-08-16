-- =============================================================================
-- DevUP · 0012 · Servicios, clientes y embudo de ventas
--
-- Semana 4 del plan. La segunda de las tres promesas del producto: hasta ahora
-- estaba entera la primera —el espacio de trabajo— y esta no existía.
--
-- Cuatro tablas y una decisión que las explica:
--
--   servicios   → lo que el equipo vende, con su precio
--   clientes    → a quién
--   oportunidades → una venta concreta, con su etapa en el embudo
--   líneas      → qué servicios lleva esa venta, y a qué precio se ofreció
--
-- EL PRECIO SE COPIA EN LA LÍNEA, NO SE REFERENCIA. Es lo que parece
-- redundante y no lo es: subir la tarifa de un servicio no puede cambiar
-- retroactivamente lo que se le cotizó a un cliente el mes pasado. Con una
-- referencia viva, revisar precios reescribiría el historial de ventas sin que
-- nadie lo pidiera y sin dejar rastro. La línea guarda el precio del día en que
-- se ofreció.
--
-- ETAPAS COMO ENUM Y NO COMO TABLA. Un embudo configurable por organización es
-- una funcionalidad razonable y no es esta: con etapas libres, «ganada» deja de
-- ser un valor y pasa a ser una convención, y el objetivo trimestral de la
-- semana 5 —que avanza solo al cerrarse una venta— no tendría de dónde
-- colgarse. Cuando haga falta configurarlas, se añade un orden y una etiqueta
-- visible por encima de estos cinco valores, que siguen siendo los que el
-- sistema entiende.
-- =============================================================================

do $$ begin
  create type public.deal_stage as enum ('lead', 'qualified', 'proposal', 'won', 'lost');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Catálogo de servicios
--
-- Las etiquetas ya son polimórficas desde 0002, así que un servicio se etiqueta
-- con las mismas que un archivo. Es la tercera cosa que las usa y no hizo falta
-- cambiarlas.
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  description     text not null default '',
  -- En céntimos, entero. Un `numeric` sería correcto y un `double` no: 0,1 + 0,2
  -- en coma flotante no da 0,3, y en una cotización eso acaba siendo un céntimo
  -- que no cuadra y una tarde perdida. Entero de céntimos evita la conversación.
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  currency        char(3) not null default 'EUR',
  /** Cómo se factura: por hora, por unidad, por mes. Texto libre corto. */
  unit            text not null default 'unidad' check (length(unit) <= 24),
  active          boolean not null default true,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists services_org_idx on public.services (organization_id, active);

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 160),
  contact_name    text not null default '',
  contact_email   text not null default '',
  notes           text not null default '',
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists clients_org_idx on public.clients (organization_id);

-- ---------------------------------------------------------------------------
-- Oportunidades
--
-- `closed_at` se rellena al pasar a ganada o perdida, con un disparador. Que lo
-- ponga la base y no la aplicación importa: es el dato del que colgará el
-- objetivo trimestral de la semana 5, y si dependiera de que cada ruta se
-- acuerde de escribirlo, el primer camino que lo olvide deja un objetivo que
-- no avanza sin que nada falle.
-- ---------------------------------------------------------------------------
create table if not exists public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  title           text not null check (length(btrim(title)) between 1 and 200),
  stage           public.deal_stage not null default 'lead',
  -- A quién le toca. `set null` y no cascade: que alguien deje el equipo no
  -- puede borrar la venta.
  owner_id        uuid references public.users(id) on delete set null,
  expected_close  date,
  closed_at       timestamptz,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists opportunities_org_idx on public.opportunities (organization_id, stage);
create index if not exists opportunities_client_idx on public.opportunities (client_id);

-- ---------------------------------------------------------------------------
-- Líneas de la cotización
-- ---------------------------------------------------------------------------
create table if not exists public.opportunity_items (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  -- El servicio puede desaparecer del catálogo sin llevarse la línea por
  -- delante: la venta ya ocurrió y su desglose tiene que seguir siendo legible.
  service_id     uuid references public.services(id) on delete set null,
  -- Copiados del servicio en el momento de añadirlo. Ver la cabecera.
  name           text not null check (length(btrim(name)) between 1 and 120),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  quantity       numeric(12,2) not null default 1 check (quantity > 0),
  created_at     timestamptz not null default now()
);

create index if not exists opportunity_items_deal_idx on public.opportunity_items (opportunity_id);

-- ---------------------------------------------------------------------------
-- El importe de una oportunidad
--
-- Función y no columna. Una columna con el total exige mantenerla a mano en
-- cada alta, baja y cambio de línea, y basta con que un camino se la salte para
-- que el embudo enseñe cifras que no cuadran con su propio desglose. A este
-- tamaño la suma es instantánea; el día que no lo sea, se materializa con un
-- disparador y esta función se queda como su definición.
-- ---------------------------------------------------------------------------
create or replace function public.opportunity_amount_cents(_deal uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(round(unit_price_cents * quantity))::bigint, 0)
    from public.opportunity_items
   where opportunity_id = _deal;
$$;

-- Marca la fecha de cierre al entrar en una etapa terminal, y la borra si la
-- venta se reabre.
create or replace function public.touch_opportunity()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.stage in ('won', 'lost') and old.stage not in ('won', 'lost') then
    new.closed_at := now();
  elsif new.stage not in ('won', 'lost') then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_touch on public.opportunities;
create trigger opportunities_touch before update on public.opportunities
  for each row execute function public.touch_opportunity();

-- ---------------------------------------------------------------------------
-- Políticas
--
-- Todo cuelga de `is_org_member`. No hay equivalente a los canales privados
-- aquí: quien está en la organización ve su embudo entero. Si algún día hace
-- falta que un comercial vea solo sus cuentas, el sitio es esta política y no
-- un filtro en la aplicación.
-- ---------------------------------------------------------------------------
alter table public.services          enable row level security;
alter table public.clients           enable row level security;
alter table public.opportunities     enable row level security;
alter table public.opportunity_items enable row level security;

drop policy if exists services_select on public.services;
create policy services_select on public.services for select
  using (public.is_org_member(organization_id));

drop policy if exists services_write on public.services;
create policy services_write on public.services for insert
  with check (public.is_org_member(organization_id));

drop policy if exists services_update on public.services;
create policy services_update on public.services for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists services_delete on public.services;
create policy services_delete on public.services for delete
  using (public.is_org_admin(organization_id));

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select
  using (public.is_org_member(organization_id));

drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients for insert
  with check (public.is_org_member(organization_id));

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete
  using (public.is_org_admin(organization_id));

drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities for select
  using (public.is_org_member(organization_id));

drop policy if exists opportunities_write on public.opportunities;
create policy opportunities_write on public.opportunities for insert
  with check (public.is_org_member(organization_id));

drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update on public.opportunities for update
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists opportunities_delete on public.opportunities;
create policy opportunities_delete on public.opportunities for delete
  using (public.is_org_admin(organization_id));

-- Las líneas cuelgan de su oportunidad. Si esa oportunidad no se ve, sus
-- líneas tampoco — y por eso la política mira la tabla de arriba en vez de
-- llevar su propio `organization_id`, que sería un segundo sitio donde el
-- aislamiento podría desincronizarse.
drop policy if exists opportunity_items_select on public.opportunity_items;
create policy opportunity_items_select on public.opportunity_items for select
  using (
    exists (
      select 1 from public.opportunities o
       where o.id = opportunity_items.opportunity_id
         and public.is_org_member(o.organization_id)
    )
  );

drop policy if exists opportunity_items_write on public.opportunity_items;
create policy opportunity_items_write on public.opportunity_items for insert
  with check (
    exists (
      select 1 from public.opportunities o
       where o.id = opportunity_items.opportunity_id
         and public.is_org_member(o.organization_id)
    )
  );

drop policy if exists opportunity_items_update on public.opportunity_items;
create policy opportunity_items_update on public.opportunity_items for update
  using (
    exists (
      select 1 from public.opportunities o
       where o.id = opportunity_items.opportunity_id
         and public.is_org_member(o.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.opportunities o
       where o.id = opportunity_items.opportunity_id
         and public.is_org_member(o.organization_id)
    )
  );

drop policy if exists opportunity_items_delete on public.opportunity_items;
create policy opportunity_items_delete on public.opportunity_items for delete
  using (
    exists (
      select 1 from public.opportunities o
       where o.id = opportunity_items.opportunity_id
         and public.is_org_member(o.organization_id)
    )
  );
