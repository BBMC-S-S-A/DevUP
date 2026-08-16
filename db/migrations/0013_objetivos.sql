-- =============================================================================
-- DevUP · 0013 · Objetivos y su avance
--
-- Semana 5 del plan, y el entregable que la define: «un objetivo trimestral
-- que avanza solo al cerrarse una venta».
--
-- LA PALABRA IMPORTANTE ES «SOLO», Y ES LO QUE DECIDE EL DISEÑO.
--
-- Un objetivo no guarda su progreso. No hay columna `achieved_cents` que
-- alguien tenga que sumar al ganar una venta, ni disparador sobre
-- `opportunities` que la mantenga. El avance es una consulta: cuánto suman las
-- ventas ganadas cuya fecha de cierre cae dentro del periodo.
--
-- La diferencia no es de estilo. Con una columna, el objetivo avanza solo
-- mientras todos los caminos que cierran una venta se acuerden de tocarla —y
-- basta uno que no lo haga para tener un objetivo que se queda quieto sin que
-- nada falle—. Además hay que decidir qué pasa al reabrir una venta ganada, al
-- borrar una línea de la cotización, al cambiar una fecha de cierre. Con una
-- consulta, todas esas preguntas tienen la misma respuesta: se vuelve a mirar.
--
-- El coste es recalcular. A este tamaño es instantáneo; el día que no lo sea,
-- se materializa con un índice o una vista y esta función se queda como su
-- definición — igual que `opportunity_amount_cents` en 0012.
--
-- Por eso 0012 puso `closed_at` con un disparador y no desde la aplicación:
-- este archivo entero cuelga de que esa fecha sea de fiar.
-- =============================================================================

create table if not exists public.goals (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  -- En céntimos enteros, como todo el dinero del sistema.
  target_cents    bigint not null check (target_cents > 0),
  -- Fechas y no «trimestre 2026-Q3»: un objetivo mensual, semestral o de una
  -- campaña de tres semanas cabe sin cambiar nada. El trimestre es el caso
  -- común, no el único que el esquema admite.
  starts_on       date not null,
  ends_on         date not null,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint goals_period_valid check (ends_on >= starts_on)
);

create index if not exists goals_org_idx on public.goals (organization_id, starts_on desc);

-- ---------------------------------------------------------------------------
-- El avance
--
-- Suma las ventas ganadas de la organización del objetivo cuya fecha de cierre
-- cae dentro del periodo. `closed_at` es timestamptz y el periodo son fechas,
-- así que el corte va por el día completo: una venta cerrada a las once de la
-- noche del último día cuenta.
--
-- SECURITY INVOKER: si quien pregunta no puede ver esas oportunidades, RLS las
-- filtra y la suma sale a cero. Es lo correcto — un objetivo no puede ser una
-- rendija para contar ventas que no se pueden ver.
-- ---------------------------------------------------------------------------
create or replace function public.goal_progress_cents(_goal uuid)
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(public.opportunity_amount_cents(o.id)), 0)::bigint
    from public.goals g
    join public.opportunities o
      on o.organization_id = g.organization_id
     and o.stage = 'won'
     and o.closed_at is not null
     and o.closed_at >= g.starts_on::timestamptz
     and o.closed_at <  (g.ends_on + 1)::timestamptz
   where g.id = _goal;
$$;

-- Cuántas ventas lo componen. Un objetivo al 80 % con una sola venta y otro al
-- 80 % con doce dicen cosas muy distintas sobre el trimestre que viene.
create or replace function public.goal_deal_count(_goal uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.goals g
    join public.opportunities o
      on o.organization_id = g.organization_id
     and o.stage = 'won'
     and o.closed_at is not null
     and o.closed_at >= g.starts_on::timestamptz
     and o.closed_at <  (g.ends_on + 1)::timestamptz
   where g.id = _goal;
$$;

-- ---------------------------------------------------------------------------
-- Políticas
--
-- Verlo, cualquiera de la organización: un objetivo de equipo que solo ve la
-- dirección no es un objetivo de equipo. Fijarlo y retirarlo, solo quien
-- administra.
-- ---------------------------------------------------------------------------
alter table public.goals enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select
  using (public.is_org_member(organization_id));

drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals for delete
  using (public.is_org_admin(organization_id));
