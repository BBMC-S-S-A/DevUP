-- =============================================================================
-- DevUP · 0055 · Los puntos se ganan al cerrar, y se ven
--
-- QUÉ SE PIDIÓ, LITERAL: «se ganan puntos al momento de cerrar una tarea con
-- todas sus implementaciones». Y con la objeción puesta encima de la mesa por
-- quien lo pidió, que es la que de verdad diseña esta tabla: «cualquiera puede
-- colocar las áreas super altas, ponen algo muy fácil para hacer, y farmean
-- puntos».
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CÓMO SE DEFIENDE ESTO DEL FARMEO, Y POR QUÉ NO ES BLOQUEANDO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La salida fácil era no dar puntos a quien trabaja solo. Se descartó, y con
-- razón: alguien puede montar su proyecto aquí él solo, y eso es justo lo que
-- atrae. Prohibirlo castiga al caso bueno para estorbar al malo.
--
-- El razonamiento que sí se sostiene es otro: **el daño de farmear solo existe
-- cuando hay alguien a quien engañar**. Cien puntos que nadie mira no engañan a
-- nadie; cien puntos enseñados como si fueran cien puntos de equipo, sí. Así
-- que esto no bloquea: **hace visible**.
--
--   · Cada punto queda escrito con SU TAREA. Un total sin asientos detrás es
--     un número que hay que creerse; con asientos es una afirmación que se
--     puede ir a comprobar.
--   · Cada asiento lleva `a_solas`: si esa tarea pasó por una sola persona de
--     principio a fin —la creó, la tenía, la cerró, y nadie más la tocó ni dejó
--     una prueba en ella—. No vale menos. Se sabe, que es distinto.
--   · **La cantidad NO depende de nada que ponga quien gana el punto.** Ni de
--     la prioridad, ni de una dificultad declarada, ni del área. Ese es
--     exactamente el vector que se señaló: si el precio lo pone quien cobra, el
--     precio es infinito. Es fija, y la única diferencia la marca haber dejado
--     prueba de cómo se hizo — que es un hecho comprobable por otro, no una
--     opinión propia.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ DISPARADOR Y NO UNA LLAMADA DESDE LA RUTA DE CERRAR
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Porque una tarea se cierra por más de un sitio: `POST /tasks/:id/hecha`,
-- arrastrarla a la columna final en el tablero, y `mover_tarea` desde el MCP.
-- Colgarlo de una de las tres reparte puntos en unos gestos y no en otros, y la
-- persona no tiene forma de saber cuál era cuál. En el disparador es la BASE la
-- que dice qué es cerrar: entrar en una columna marcada como final.
--
-- SE GANA UNA VEZ Y NO SE DESANDA. El índice único por (tarea, motivo) es el
-- que impide el farmeo más tonto de todos: cerrar, reabrir y volver a cerrar la
-- misma tarea en bucle. Y por eso el asiento tampoco se borra al reabrir: el
-- trabajo se hizo, y desandar puntos ya cobrados es una fuente de agravio mucho
-- peor que un punto de más.
--
-- LA PRUEBA TARDÍA TAMBIÉN CUENTA. El widget `sin_justificar` prometió que
-- añadir la prueba después saca la tarea de la lista de deudas. Si el punto
-- solo se pudiera ganar en el instante del cierre, esa promesa sería media
-- promesa. Por eso hay un segundo disparador sobre `task_evidence`.
--
-- QUIÉN GANA: el DELEGADO, quien la hacía, no quien la arrastró. Son cosas
-- distintas desde la 0050 y aquí importa la diferencia — un gerente que
-- ordena su tablero el viernes no está haciendo el trabajo de nadie. Si la
-- tarea no tiene delegado, gana quien la cerró: alguien la hizo.
--
-- RLS. `select` para cualquier miembro de la organización, y esa apertura ES la
-- función: unos puntos que solo ve quien los gana no se pueden contrastar con
-- nada, y entonces vuelven a ser un número que hay que creerse. Escribir, nadie:
-- no hay política de insert, update ni delete, y los dos disparadores entran por
-- `security definer`. Un punto que se pueda escribir a mano no vale nada.
-- =============================================================================

do $$ begin
  create type public.motivo_de_punto as enum ('cerro_tarea', 'dejo_prueba');
exception when duplicate_object then null;
end $$;

create table if not exists public.puntos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id)    on delete cascade,
  user_id         uuid not null references public.users(id)         on delete cascade,
  -- La tarea puede borrarse; el punto ganado no se desanda. Por eso el título
  -- va copiado, igual que `subject_label` en `activity` (0038): un asiento que
  -- pierde su nombre al borrarse la tarea deja de poder comprobarse.
  task_id         uuid references public.tasks(id) on delete set null,
  task_label      text not null default '' check (length(task_label) <= 200),
  motivo          public.motivo_de_punto not null,
  cantidad        integer not null check (cantidad > 0),
  a_solas         boolean not null,
  at              timestamptz not null default now()
);

-- El farmeo más tonto de todos: cerrar, reabrir, volver a cerrar.
create unique index if not exists puntos_una_vez_por_tarea_idx
  on public.puntos (task_id, motivo) where task_id is not null;

create index if not exists puntos_de_cada_quien_idx
  on public.puntos (organization_id, user_id, at desc);

alter table public.puntos enable row level security;

drop policy if exists puntos_select on public.puntos;
-- Ver los de todos, no solo los propios: es lo que convierte un total en algo
-- contrastable. Sin esto la tabla entera pierde su razón de ser.
create policy puntos_select on public.puntos for select
  using (public.is_org_member(organization_id));

-- Sin política de escritura, a propósito: solo entran por los disparadores.

/**
 * Apuntar un punto. La única puerta de entrada a la tabla.
 *
 * `a_solas` se calcula AQUÍ y se guarda, no se deduce al leer: la respuesta
 * cambia con el tiempo —mañana alguien puede comentar esa tarea— y lo que
 * describe es cómo se ganó el punto ENTONCES. Recalcularlo al leer convertiría
 * un hecho fechado en una opinión que se mueve sola.
 */
create or replace function public.apuntar_punto(
  _task     uuid,
  _user     uuid,
  _motivo   public.motivo_de_punto,
  _cantidad integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _ws      uuid;
  _org     uuid;
  _titulo  text;
  _creador uuid;
  _solo    boolean;
begin
  if _user is null then return; end if;

  select t.workspace_id, w.organization_id, t.title, t.created_by
    into _ws, _org, _titulo, _creador
    from public.tasks t
    join public.workspaces w on w.id = t.workspace_id
   where t.id = _task;

  if _ws is null then return; end if;

  -- Pasó por una sola persona de principio a fin. Las tres condiciones son
  -- tres formas distintas de que alguien más apareciera; basta una para que ya
  -- no fuera a solas.
  _solo :=
    coalesce(_creador, _user) = _user
    and not exists (
      select 1 from public.activity a
       where a.subject_id = _task
         and a.actor_id is not null
         and a.actor_id <> _user
    )
    and not exists (
      select 1 from public.task_evidence e
       where e.task_id = _task
         and e.created_by is not null
         and e.created_by <> _user
    );

  insert into public.puntos
    (organization_id, workspace_id, user_id, task_id, task_label, motivo, cantidad, a_solas)
  values (_org, _ws, _user, _task, left(coalesce(_titulo, ''), 200), _motivo, _cantidad, _solo)
  -- Ya estaba cobrado. No es un error: es el estado que se pedía.
  on conflict do nothing;
end;
$$;

/**
 * Al entrar en una columna final.
 *
 * `is_terminal` lo decide el tablero (0037), no esta función: lo que cuenta
 * como terminar lo define cada equipo, y adivinarlo por el nombre de la columna
 * sería inventarse su proceso.
 */
create or replace function public.puntos_al_cerrar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ahora_final boolean;
  _antes_final boolean;
  _quien       uuid;
begin
  select is_terminal into _ahora_final from public.task_columns where id = new.column_id;
  select is_terminal into _antes_final from public.task_columns where id = old.column_id;

  -- `coalesce` porque una columna que no existe no es «final»: en PL/pgSQL un
  -- NULL dentro de un `if` no entra en el bloque, pero dentro de un `and` con
  -- un `not` se propaga y el resultado deja de ser el que se lee.
  if not coalesce(_ahora_final, false) or coalesce(_antes_final, false) then
    return new;
  end if;

  _quien := coalesce(new.assignee_id, public.current_user_id());
  perform public.apuntar_punto(new.id, _quien, 'cerro_tarea', 10);

  -- Si ya había prueba al cerrar, el segundo punto se gana en el mismo gesto.
  if exists (select 1 from public.task_evidence e where e.task_id = new.id) then
    perform public.apuntar_punto(new.id, _quien, 'dejo_prueba', 5);
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_puntos_al_cerrar on public.tasks;
create trigger tasks_puntos_al_cerrar
  after update of column_id on public.tasks
  for each row execute function public.puntos_al_cerrar();

/**
 * Y la prueba que llega tarde.
 *
 * Solo si la tarea YA está cerrada: dejar la prueba antes de cerrar no gana
 * nada por sí sola — el punto llega con el cierre, y lo pone el disparador de
 * arriba. Aquí se cubre el otro orden, que es el que prometió el widget
 * `sin_justificar`: cerrar hoy y justificar el martes.
 */
create or replace function public.puntos_al_probar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _cerrada boolean;
  _quien   uuid;
begin
  select c.is_terminal, coalesce(t.assignee_id, new.created_by)
    into _cerrada, _quien
    from public.tasks t
    join public.task_columns c on c.id = t.column_id
   where t.id = new.task_id;

  if coalesce(_cerrada, false) then
    perform public.apuntar_punto(new.task_id, _quien, 'dejo_prueba', 5);
  end if;

  return new;
end;
$$;

drop trigger if exists task_evidence_puntos on public.task_evidence;
create trigger task_evidence_puntos
  after insert on public.task_evidence
  for each row execute function public.puntos_al_probar();
